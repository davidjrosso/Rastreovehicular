import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import { Server } from "socket.io";
import { z, ZodError } from "zod";
import argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { DB } from "./db.ts";
import {
  id,
  text,
  roles,
  states,
  caseInput,
  targetInput,
  entryInputs,
  canTransition,
  editable,
  fail,
  isStaff,
  isSupervisor,
  csvCell,
  xml,
  type User,
} from "./domain.ts";
import { importCameras } from "./cameras.ts";
import { cameraIntegrations, integrationConfig } from "./integrations.ts";
import { recordingInput, recordingService } from "./recordings.ts";
import { buildRoutes, streets } from "./routing.ts";
import { suggestCameras, suggestionInput } from "./suggestions.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: User;
  }
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const publicUser = "id,name,username,role,department_id,active";
const SID = "rastreo_session";

export async function createApp(
  db: DB,
  options: { test?: boolean; uploadDir?: string } = {},
) {
  const production = process.env.NODE_ENV === "production";
  const origin = process.env.APP_ORIGIN || "http://localhost:5173";
  if (production && !origin.startsWith("https://"))
    throw new Error("APP_ORIGIN debe usar HTTPS en producción");
  const uploads = resolve(
    options.uploadDir || process.env.UPLOAD_DIR || "uploads",
  );
  await mkdir(uploads, { recursive: true });
  const app = Fastify({
    logger: !options.test,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: production ? (_address, hop) => hop === 0 : false,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // LAN development runs over HTTP; upgrading its assets to HTTPS
        // would leave non-localhost clients with a blank page.
        upgradeInsecureRequests: production ? [] : null,
      },
    },
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 0 },
  });

  async function session(token?: string) {
    if (!token) return null;
    return (
      (
        await db.query<User>(
          `SELECT ${publicUser
            .split(",")
            .map((c) => "u." + c)
            .join(",")}
      FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
          [hash(token)],
        )
      ).rows[0] || null
    );
  }
  async function access(tx: DB, caseId: string, user: User, lock = false) {
    id.parse(caseId);
    const record = (
      await tx.query(
        `SELECT * FROM cases WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
        [caseId],
      )
    ).rows[0];
    if (
      !record ||
      (user.role === "externo" && user.department_id !== record.department_id)
    )
      fail(404, "Búsqueda no encontrada");
    return record;
  }
  const admin = (req: FastifyRequest) => {
    if (req.user.role !== "admin") fail(403, "Se requiere administrador");
  };
  async function audit(
    tx: DB,
    user: User,
    caseId: string | null,
    action: string,
    detail: unknown,
  ) {
    await tx.query(
      "INSERT INTO audit(id,case_id,user_id,action,detail) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), caseId, user.id, action, JSON.stringify(detail)],
    );
  }
  async function notify(
    tx: DB,
    caseId: string,
    message: string,
    actor: User,
    recipientIds?: string[],
  ) {
    const c = (
      await tx.query("SELECT department_id FROM cases WHERE id=$1", [caseId])
    ).rows[0];
    const users = (
      await tx.query<User>(
        "SELECT id,role,department_id FROM users WHERE active=true",
      )
    ).rows;
    for (const u of users) {
      if (
        u.id === actor.id ||
        (u.role === "externo" && u.department_id !== c.department_id)
      )
        continue;
      if (recipientIds && !recipientIds.includes(u.id)) continue;
      await tx.query(
        "INSERT INTO notices(id,user_id,case_id,text) VALUES($1,$2,$3,$4)",
        [randomUUID(), u.id, caseId, message],
      );
    }
  }

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers["x-requested-with"] !== "Rastreo")
        fail(403, "Solicitud no autorizada");
      if (
        req.headers.origin &&
        ![
          origin,
          ...(!production
            ? [
                "http://127.0.0.1:5173",
                "http://localhost:3001",
                "http://127.0.0.1:3001",
              ]
            : []),
        ].includes(req.headers.origin)
      )
        fail(403, "Origen no autorizado");
    }
    if (["/api/login", "/api/health"].includes(req.url.split("?")[0])) return;
    const user = await session(req.cookies[SID]);
    if (!user) fail(401, "Iniciá sesión para continuar");
    req.user = user;
  });
  app.setErrorHandler((error: any, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" · "),
      });
    if (error.code === "23505")
      return reply.code(409).send({ error: "Ese registro ya existe" });
    if (error.code === "23503")
      return reply
        .code(400)
        .send({ error: "El registro relacionado no existe" });
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({ error: error.message });
    req.log.error(error);
    return reply.code(500).send({ error: "No se pudo completar la operación" });
  });

  const io = new Server(app.server, { maxHttpBufferSize: 16384 });
  const integrations = cameraIntegrations(
    db,
    integrationConfig(options.test ? {} : process.env),
    () => io.emit("refresh"),
  );
  const recordings = recordingService(
    integrationConfig(options.test ? {} : process.env),
  );
  app.addHook("onReady", async () => {
    if (!options.test) integrations.start();
  });
  app.addHook("onClose", async () => {
    await integrations.close();
  });
  io.use(async (socket, next) => {
    try {
      const token = app.parseCookie(socket.handshake.headers.cookie || "")[SID];
      const user = await session(token);
      if (!user) return next(new Error("Sin sesión"));
      if (
        socket.handshake.headers.origin &&
        ![
          origin,
          ...(!production
            ? [
                "http://127.0.0.1:5173",
                "http://localhost:3001",
                "http://127.0.0.1:3001",
              ]
            : []),
        ].includes(socket.handshake.headers.origin)
      )
        return next(new Error("Origen no autorizado"));
      socket.data.user = user;
      socket.data.token = token;
      next();
    } catch {
      next(new Error("Sin sesión"));
    }
  });
  const presence = async (room: string) => {
    const clients = await io.in(room).fetchSockets();
    io.to(room).emit("presence", [
      ...new Map(
        clients.map((s) => [
          s.data.user.id,
          { id: s.data.user.id, name: s.data.user.name },
        ]),
      ).values(),
    ]);
  };
  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    socket.on("join", async (caseId: string, ack?: (v: unknown) => void) => {
      try {
        const user = await session(socket.data.token);
        if (!user) {
          socket.disconnect(true);
          return;
        }
        await access(db, caseId, user);
        const old = socket.data.room;
        if (old) {
          await socket.leave(old);
          await presence(old);
        }
        socket.data.room = `case:${caseId}`;
        await socket.join(socket.data.room);
        await presence(socket.data.room);
        if (typeof ack === "function") ack({ ok: true });
      } catch {
        if (typeof ack === "function") ack({ error: "Búsqueda no disponible" });
      }
    });
    socket.on("disconnect", () => {
      if (socket.data.room) void presence(socket.data.room);
    });
    const interval = setInterval(async () => {
      if (!(await session(socket.data.token))) socket.disconnect(true);
    }, 30000);
    interval.unref();
    socket.on("disconnect", () => clearInterval(interval));
  });
  const changed = (caseId: string) => {
    // Invalidation only: clients fetch authorized data through HTTP after receiving this signal.
    io.to(`case:${caseId}`).emit("changed");
    io.emit("refresh");
  };
  app.addHook("preClose", async () => {
    await new Promise<void>((done) => io.close(() => done()));
  });

  app.get("/api/health", async () => ({ ok: true }));
  const dummyHash = await argon2.hash(randomBytes(24));
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = z
        .object({
          username: text.max(80),
          password: z.string().min(1).max(200),
        })
        .parse(req.body);
      const user = (
        await db.query<User & { password_hash: string }>(
          "SELECT * FROM users WHERE username=$1",
          [input.username.toLowerCase()],
        )
      ).rows[0];
      const valid = await argon2.verify(
        user?.password_hash || dummyHash,
        input.password,
      );
      if (!user?.active || !valid) fail(401, "Usuario o clave incorrectos");
      const token = randomBytes(32).toString("hex");
      await db.query("DELETE FROM sessions WHERE expires_at < now()");
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
        [hash(token), user.id],
      );
      reply.setCookie(SID, token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: production,
        maxAge: 43200,
      });
      return { ok: true };
    },
  );
  app.post("/api/logout", async (req, reply) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(req.cookies[SID] || ""),
    ]);
    for (const s of await io.in(`user:${req.user.id}`).fetchSockets())
      if (s.data.token === req.cookies[SID]) s.disconnect(true);
    reply.clearCookie(SID, { path: "/" });
    return { ok: true };
  });
  app.get("/api/me", async (req) => req.user);
  app.get(
    "/api/departments",
    async (req) =>
      (
        await db.query(
          req.user.role === "externo"
            ? "SELECT * FROM departments WHERE id=$1"
            : "SELECT * FROM departments ORDER BY name",
          req.user.role === "externo" ? [req.user.department_id] : [],
        )
      ).rows,
  );
  app.post("/api/departments", async (req) => {
    admin(req);
    const input = z
      .object({
        name: text.max(120),
        kind: z.enum(["policia", "fiscalia", "municipal"]),
      })
      .parse(req.body);
    const record = { id: randomUUID(), ...input };
    await db.query("INSERT INTO departments(id,name,kind) VALUES($1,$2,$3)", [
      record.id,
      record.name,
      record.kind,
    ]);
    return record;
  });
  app.get("/api/users", async (req) => {
    admin(req);
    return (await db.query(`SELECT ${publicUser} FROM users ORDER BY name`))
      .rows;
  });
  app.post("/api/users", async (req) => {
    admin(req);
    const input = z
      .object({
        name: text.max(120),
        username: z.string().regex(/^[a-z0-9._-]{3,80}$/),
        password: z.string().min(12).max(200),
        role: roles,
        department_id: id.nullable(),
      })
      .refine(
        (v) => v.role !== "externo" || v.department_id,
        "El externo necesita una dependencia",
      )
      .parse(req.body);
    const userId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO users(id,name,username,password_hash,role,department_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          userId,
          input.name,
          input.username,
          await argon2.hash(input.password),
          input.role,
          input.department_id,
        ],
      );
      await audit(tx, req.user, null, "user_created", {
        user_id: userId,
        role: input.role,
      });
    });
    return { id: userId };
  });
  app.patch("/api/users/:id", async (req) => {
    admin(req);
    const userId = id.parse((req.params as any).id);
    const input = z
      .object({
        active: z.boolean().optional(),
        password: z.string().min(12).max(200).optional(),
      })
      .parse(req.body);
    if (userId === req.user.id && input.active === false)
      fail(400, "No podés desactivar tu propia cuenta");
    await db.transaction(async (tx) => {
      const u = (await tx.query("SELECT id FROM users WHERE id=$1", [userId]))
        .rows[0];
      if (!u) fail(404, "Usuario no encontrado");
      if (input.active !== undefined)
        await tx.query("UPDATE users SET active=$1 WHERE id=$2", [
          input.active,
          userId,
        ]);
      if (input.password)
        await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
          await argon2.hash(input.password),
          userId,
        ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await audit(tx, req.user, null, "user_updated", {
        user_id: userId,
        active: input.active,
        password_reset: !!input.password,
      });
    });
    io.in(`user:${userId}`).disconnectSockets();
    return { ok: true };
  });
  app.get("/api/cameras", async (req) => {
    if (!isStaff(req.user)) return []; // External views receive only sightings from their own cases.
    return (
      await db.query("SELECT * FROM cameras WHERE active=true ORDER BY number")
    ).rows.map(integrations.health);
  });
  app.get("/api/integrations/cameras", async (req) => {
    admin(req);
    return integrations.status();
  });
  app.post("/api/integrations/cameras/:source/run", async (req) => {
    admin(req);
    const { source } = z
      .object({ source: z.enum(["mymaps", "hikcentral"]) })
      .parse(req.params);
    if (!integrations.configured[source])
      fail(409, "La integración todavía no está configurada en el servidor.");
    await integrations.run(source);
    return integrations.status();
  });
  app.post("/api/cameras/import", async (req) => {
    admin(req);
    const input = z.object({ kml: z.string().max(1800000) }).parse(req.body);
    const result = await importCameras(db, input.kml, req.user.id);
    io.emit("refresh");
    return result;
  });
  app.get("/api/cameras/history", async (req) => {
    admin(req);
    return (
      await db.query(
        "SELECT a.*,COALESCE(u.name,'Sincronización automática') AS author FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE action='camera_sync' ORDER BY created_at DESC LIMIT 30",
      )
    ).rows;
  });
  app.get("/api/streets", async () => streets);
  app.get(
    "/api/notices",
    async (req) =>
      (
        await db.query(
          "SELECT * FROM notices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [req.user.id],
        )
      ).rows,
  );
  app.post("/api/notices/read", async (req) => {
    await db.query("UPDATE notices SET read=true WHERE user_id=$1", [
      req.user.id,
    ]);
    return { ok: true };
  });
  app.get("/api/cases", async (req) => {
    const external = req.user.role === "externo";
    return (
      await db.query(
        `SELECT c.*,d.name AS department_name,
      (SELECT count(*)::int FROM entries e WHERE e.case_id=c.id AND e.kind='captura' AND e.deleted_at IS NULL) AS capture_count
      FROM cases c JOIN departments d ON d.id=c.department_id ${external ? "WHERE c.department_id=$1" : ""} ORDER BY c.updated_at DESC`,
        external ? [req.user.department_id] : [],
      )
    ).rows;
  });
  app.post("/api/cases", async (req) => {
    const input = caseInput.parse(req.body);
    if (
      req.user.role === "externo" &&
      input.department_id !== req.user.department_id
    )
      fail(403, "Dependencia no autorizada");
    const caseId = randomUUID();
    const record = await db.transaction(async (tx) => {
      const n = (await tx.query("SELECT nextval('case_number') AS n")).rows[0]
        .n;
      const year = new Intl.DateTimeFormat("es-AR", {
        year: "numeric",
        timeZone: "America/Argentina/Cordoba",
      }).format(new Date());
      const number = `RT-${year}-${String(n).padStart(4, "0")}`;
      const row = (
        await tx.query(
          `INSERT INTO cases(id,number,department_id,requester_id,title,description,reference,starts_at,ends_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            caseId,
            number,
            input.department_id,
            req.user.id,
            input.title,
            input.description,
            input.reference,
            input.starts_at,
            input.ends_at,
          ],
        )
      ).rows[0];
      await audit(tx, req.user, caseId, "created", { status: "pedida" });
      await notify(tx, caseId, `${number}: nuevo pedido`, req.user);
      return row;
    });
    changed(caseId);
    return record;
  });
  async function detail(caseId: string, user: User) {
    const c = await access(db, caseId, user);
    const [targets, entries, history, attachments, routeNotes] =
      await Promise.all([
        db.query(
          "SELECT * FROM targets WHERE case_id=$1 ORDER BY description",
          [caseId],
        ),
        db.query(
          "SELECT e.*,u.name AS author FROM entries e JOIN users u ON u.id=e.user_id WHERE case_id=$1 AND deleted_at IS NULL ORDER BY e.created_at",
          [caseId],
        ),
        db.query(
          "SELECT a.*,u.name AS author FROM audit a JOIN users u ON u.id=a.user_id WHERE case_id=$1 ORDER BY a.created_at DESC",
          [caseId],
        ),
        db.query(
          "SELECT a.* FROM attachments a JOIN entries e ON e.id=a.entry_id WHERE a.case_id=$1 AND e.deleted_at IS NULL ORDER BY a.created_at",
          [caseId],
        ),
        db.query(
          "SELECT n.*,u.name AS author FROM route_notes n JOIN users u ON u.id=n.user_id WHERE n.case_id=$1 ORDER BY n.created_at",
          [caseId],
        ),
      ]);
    return {
      ...c,
      number: String(c.number),
      targets: targets.rows,
      entries: entries.rows,
      history: history.rows,
      attachments: attachments.rows,
      route_notes: routeNotes.rows,
      routes: buildRoutes(targets.rows, entries.rows, routeNotes.rows),
    };
  }
  app.get("/api/cases/:id", async (req) =>
    detail((req.params as any).id, req.user),
  );
  app.post("/api/cases/:id/suggestions", async (req) => {
    const c = await detail((req.params as any).id, req.user);
    if (!isStaff(req.user))
      fail(403, "Las sugerencias de cámaras son para la sala.");
    const input = suggestionInput.parse(req.body);
    const target = c.targets.find((t) => t.id === input.target_id);
    if (!target) fail(400, "Objetivo ajeno a la búsqueda");
    const cameras = (
      await db.query("SELECT * FROM cameras WHERE active=true ORDER BY number")
    ).rows;
    return suggestCameras(c, target, cameras, input);
  });
  app.post(
    "/api/cases/:id/recordings",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const c = await access(db, (req.params as any).id, req.user);
      if (!isStaff(req.user))
        fail(403, "La consulta de grabaciones es para la sala.");
      const { queries } = recordingInput.parse(req.body);
      if (
        queries.some(
          (q) =>
            Date.parse(q.from) < new Date(c.starts_at).getTime() ||
            Date.parse(q.to) > new Date(c.ends_at).getTime(),
        )
      )
        fail(400, "La consulta debe estar dentro de la franja del pedido.");
      const cameras = (
        await db.query(
          "SELECT id,number,hik_index_code FROM cameras WHERE id=ANY($1::uuid[])",
          [queries.map((q) => q.camera_id)],
        )
      ).rows;
      if (queries.some((q) => !cameras.some((cam) => cam.id === q.camera_id)))
        fail(400, "Una cámara no existe en el registro.");
      return {
        results: await Promise.all(
          queries.map((q) =>
            recordings.check(
              q,
              cameras.find((cam) => cam.id === q.camera_id)!,
            ),
          ),
        ),
      };
    },
  );
  app.post("/api/cases/:id/route-notes", async (req) => {
    const caseId = (req.params as any).id;
    const input = z
      .object({
        target_id: id,
        from_entry_id: id,
        to_entry_id: id,
        reason: text.max(2000),
      })
      .parse(req.body);
    const noteId = randomUUID();
    await db.transaction(async (tx) => {
      const c = await access(tx, caseId, req.user, true);
      if (!isStaff(req.user) || c.status !== "en_curso")
        fail(
          403,
          "Sólo la sala puede modificar recorridos de búsquedas en curso",
        );
      const targets = (
        await tx.query("SELECT * FROM targets WHERE id=$1 AND case_id=$2", [
          input.target_id,
          caseId,
        ])
      ).rows;
      if (!targets.length) fail(400, "Objetivo ajeno a la búsqueda");
      const entries = (
        await tx.query(
          "SELECT * FROM entries WHERE case_id=$1 AND kind='captura' AND deleted_at IS NULL ORDER BY created_at",
          [caseId],
        )
      ).rows;
      const route = buildRoutes(targets, entries)[0];
      if (
        !route.legs.some(
          (l) => l.from === input.from_entry_id && l.to === input.to_entry_id,
        )
      )
        fail(
          409,
          "Las capturas del tramo cambiaron. Actualizá la búsqueda y elegí el tramo nuevamente.",
        );
      const from = entries.find((e) => e.id === input.from_entry_id)!,
        to = entries.find((e) => e.id === input.to_entry_id)!;
      const previous = (
        await tx.query(
          "SELECT id FROM route_notes WHERE target_id=$1 AND from_entry_id=$2 AND to_entry_id=$3 AND active=true",
          [input.target_id, from.id, to.id],
        )
      ).rows;
      if (previous.length) fail(409, "Ese tramo ya está marcado como incierto");
      await tx.query(
        "INSERT INTO route_notes(id,case_id,target_id,from_entry_id,to_entry_id,starts_at,ends_at,reason,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          noteId,
          caseId,
          input.target_id,
          from.id,
          to.id,
          from.payload.at,
          to.payload.at,
          input.reason,
          req.user.id,
        ],
      );
      await audit(tx, req.user, caseId, "route_uncertain", {
        note_id: noteId,
        ...input,
        from_at: from.payload.at,
        to_at: to.payload.at,
      });
      await tx.query("UPDATE cases SET updated_at=now() WHERE id=$1", [caseId]);
    });
    changed(caseId);
    return { id: noteId };
  });
  app.delete("/api/cases/:id/route-notes/:noteId", async (req) => {
    const { id: caseId, noteId } = req.params as any;
    id.parse(noteId);
    await db.transaction(async (tx) => {
      const c = await access(tx, caseId, req.user, true);
      if (!isStaff(req.user) || c.status !== "en_curso")
        fail(
          403,
          "Sólo la sala puede modificar recorridos de búsquedas en curso",
        );
      const note = (
        await tx.query(
          "SELECT * FROM route_notes WHERE id=$1 AND case_id=$2 AND active=true",
          [noteId, caseId],
        )
      ).rows[0];
      if (!note) fail(404, "Anotación no encontrada");
      await tx.query("UPDATE route_notes SET active=false WHERE id=$1", [
        noteId,
      ]);
      await audit(tx, req.user, caseId, "route_uncertainty_removed", {
        note_id: noteId,
        reason: note.reason,
      });
      await tx.query("UPDATE cases SET updated_at=now() WHERE id=$1", [caseId]);
    });
    changed(caseId);
    return { ok: true };
  });
  app.post("/api/cases/:id/state", async (req) => {
    const caseId = (req.params as any).id;
    const input = z
      .object({
        status: states,
        observation: z.string().trim().max(2000).default(""),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const c = await access(tx, caseId, req.user, true);
      if (!canTransition(req.user, c.status, input.status))
        fail(403, "Transición no permitida");
      if (
        ["rechazada", "en_curso"].includes(input.status) &&
        c.status !== "pedida" &&
        !input.observation
      )
        fail(400, "Indicá el motivo de la devolución o reapertura");
      if (input.status === "rechazada" && !input.observation)
        fail(400, "Indicá el motivo del rechazo");
      await tx.query(
        "UPDATE cases SET status=$1,updated_at=now() WHERE id=$2",
        [input.status, caseId],
      );
      await audit(tx, req.user, caseId, "state", {
        from: c.status,
        to: input.status,
        observation: input.observation,
      });
      await notify(
        tx,
        caseId,
        `${c.number}: ${input.status.replaceAll("_", " ")}`,
        req.user,
      );
    });
    changed(caseId);
    return { ok: true };
  });
  app.post("/api/cases/:id/targets", async (req) => {
    const caseId = (req.params as any).id,
      input = targetInput.parse(req.body),
      targetId = randomUUID();
    await db.transaction(async (tx) => {
      const c = await access(tx, caseId, req.user, true);
      if (!isStaff(req.user) || !editable(c.status, "captura"))
        fail(
          403,
          "Los objetivos se cargan por la sala cuando la búsqueda está en curso",
        );
      await tx.query(
        "INSERT INTO targets(id,case_id,kind,description,plate,color) VALUES($1,$2,$3,$4,$5,$6)",
        [
          targetId,
          caseId,
          input.kind,
          input.description,
          input.plate,
          input.color,
        ],
      );
      await audit(tx, req.user, caseId, "target_created", {
        target_id: targetId,
        ...input,
      });
      await tx.query("UPDATE cases SET updated_at=now() WHERE id=$1", [caseId]);
    });
    changed(caseId);
    return { id: targetId };
  });
  app.post("/api/cases/:id/entries/:kind", async (req) => {
    const { id: caseId, kind } = req.params as {
      id: string;
      kind: keyof typeof entryInputs;
    };
    if (!entryInputs[kind]) fail(400, "Tipo de registro inválido");
    const input = entryInputs[kind].parse(req.body) as any;
    const entryId = randomUUID();
    await db.transaction(async (tx) => {
      const c = await access(tx, caseId, req.user, true);
      if (!editable(c.status, kind))
        fail(
          409,
          "La búsqueda no admite esta modificación en su estado actual",
        );
      if (["captura", "revision"].includes(kind) && !isStaff(req.user))
        fail(403, "Sólo la sala puede cargar capturas y revisiones");
      const targetIds: string[] =
        kind === "captura"
          ? input.target_ids
          : kind === "revision" && input.target_id
            ? [input.target_id]
            : [];
      const targetRows = (
        await tx.query("SELECT id FROM targets WHERE case_id=$1", [caseId])
      ).rows;
      if (targetIds.some((t) => !targetRows.some((r) => r.id === t)))
        fail(400, "Objetivo ajeno a la búsqueda");
      const cameraIds: string[] =
        kind === "captura"
          ? input.camera_ids
          : kind === "revision"
            ? [input.camera_id]
            : [];
      if (cameraIds.length) {
        const rows = (
          await tx.query(
            "SELECT id,number,name,lon,lat FROM cameras WHERE active=true AND id=ANY($1::uuid[])",
            [cameraIds],
          )
        ).rows;
        if (rows.length !== new Set(cameraIds).size)
          fail(400, "Cámara inexistente o inactiva");
        input.cameras = rows; // Snapshot kept even if a camera moves in a later import.
      }
      if (kind === "captura") {
        if (
          Date.parse(input.at) < new Date(c.starts_at).getTime() ||
          Date.parse(input.at) > new Date(c.ends_at).getTime()
        )
          fail(400, "La captura debe estar dentro de la franja del pedido");
        input.target_ids = [...new Set(input.target_ids)];
      }
      await tx.query(
        "INSERT INTO entries(id,case_id,kind,payload,user_id) VALUES($1,$2,$3,$4,$5)",
        [entryId, caseId, kind, JSON.stringify(input), req.user.id],
      );
      await audit(tx, req.user, caseId, `${kind}_created`, {
        entry_id: entryId,
      });
      await tx.query("UPDATE cases SET updated_at=now() WHERE id=$1", [caseId]);
      if (kind === "mensaje" && input.mentions.length)
        await notify(
          tx,
          caseId,
          `${c.number}: ${req.user.name} te mencionó`,
          req.user,
          input.mentions,
        );
    });
    changed(caseId);
    return { id: entryId };
  });
  app.delete("/api/cases/:id/entries/:entryId", async (req) => {
    const { id: caseId, entryId } = req.params as any;
    id.parse(entryId);
    await db.transaction(async (tx) => {
      const c = await access(tx, caseId, req.user, true);
      const e = (
        await tx.query(
          "SELECT * FROM entries WHERE id=$1 AND case_id=$2 AND deleted_at IS NULL",
          [entryId, caseId],
        )
      ).rows[0];
      if (!e) fail(404, "Registro no encontrado");
      if (
        !editable(c.status, e.kind) ||
        (!isSupervisor(req.user) && e.user_id !== req.user.id)
      )
        fail(403, "No podés eliminar este registro");
      await tx.query("UPDATE entries SET deleted_at=now() WHERE id=$1", [
        entryId,
      ]);
      await audit(tx, req.user, caseId, "entry_deleted", {
        entry_id: entryId,
        kind: e.kind,
      });
    });
    changed(caseId);
    return { ok: true };
  });
  app.post("/api/cases/:id/entries/:entryId/attachments", async (req) => {
    const { id: caseId, entryId } = req.params as any;
    id.parse(entryId);
    const c = await access(db, caseId, req.user);
    const e = (
      await db.query(
        "SELECT * FROM entries WHERE id=$1 AND case_id=$2 AND deleted_at IS NULL",
        [entryId, caseId],
      )
    ).rows[0];
    if (!e || !["captura", "aporte"].includes(e.kind))
      fail(404, "Registro no encontrado");
    if (
      !editable(c.status, e.kind) ||
      (req.user.role === "externo" &&
        (e.kind !== "aporte" || e.user_id !== req.user.id))
    )
      fail(403, "No podés adjuntar archivos aquí");
    const file = await req.file();
    if (!file) fail(400, "Elegí un archivo");
    const attachmentId = randomUUID(),
      path = resolve(uploads, attachmentId);
    const digest = createHash("sha256");
    let size = 0;
    try {
      await pipeline(
        file.file,
        new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.length;
            digest.update(chunk);
            callback(null, chunk);
          },
        }),
        createWriteStream(path, { flags: "wx" }),
      );
      if (file.file.truncated) fail(413, "El adjunto supera los 50 MB");
      await db.transaction(async (tx) => {
        const current = await access(tx, caseId, req.user, true);
        const entry = (
          await tx.query("SELECT deleted_at FROM entries WHERE id=$1", [
            entryId,
          ])
        ).rows[0];
        if (!editable(current.status, e.kind) || entry.deleted_at)
          fail(409, "La búsqueda o el registro cambió durante la carga");
        await tx.query(
          "INSERT INTO attachments(id,case_id,entry_id,user_id,name,mime,size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            attachmentId,
            caseId,
            entryId,
            req.user.id,
            file.filename.slice(0, 255),
            file.mimetype,
            size,
            digest.digest("hex"),
          ],
        );
        await audit(tx, req.user, caseId, "attachment_created", {
          attachment_id: attachmentId,
          entry_id: entryId,
        });
      });
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    changed(caseId);
    return { id: attachmentId };
  });
  app.get("/api/attachments/:id", async (req, reply) => {
    const attachmentId = id.parse((req.params as any).id);
    const a = (
      await db.query(
        "SELECT a.* FROM attachments a JOIN entries e ON e.id=a.entry_id WHERE a.id=$1 AND e.deleted_at IS NULL",
        [attachmentId],
      )
    ).rows[0];
    if (!a) fail(404, "Adjunto no encontrado");
    await access(db, a.case_id, req.user);
    reply
      .type("application/octet-stream")
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      );
    return reply.send(createReadStream(resolve(uploads, a.id)));
  });
  app.get("/api/cases/:id/export/:format", async (req, reply) => {
    const { id: caseId, format } = req.params as any;
    if (!["csv", "kml"].includes(format)) fail(400, "Formato no disponible");
    const c = await detail(caseId, req.user);
    const captures = c.entries
      .filter((e) => e.kind === "captura")
      .sort((a, b) => Date.parse(a.payload.at) - Date.parse(b.payload.at));
    reply.header(
      "Content-Disposition",
      `attachment; filename="${c.number}.${format}"`,
    );
    if (format === "csv") {
      const rows = [
        [
          "Búsqueda",
          "Fecha y hora (Argentina)",
          "Cámaras",
          "Objetivos",
          "Certeza",
          "Sentido",
          "Observación",
          "Operador",
          "Tipo de registro",
          "Lugar / dirección",
          "Incertidumbre del tramo",
        ],
      ];
      for (const e of captures)
        rows.push([
          c.number,
          new Intl.DateTimeFormat("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
            timeZone: "America/Argentina/Cordoba",
          }).format(new Date(e.payload.at)),
          e.payload.cameras.map((p: any) => `CAM-${p.number}`).join(" / "),
          c.targets
            .filter((t) => e.payload.target_ids.includes(t.id))
            .map((t) => t.description)
            .join(" / "),
          e.payload.certainty,
          e.payload.direction,
          e.payload.note,
          e.author,
          "Captura",
          "",
          c.routes
            .flatMap((r) =>
              r.legs
                .filter((l) => l.to === e.id && l.uncertain)
                .map(
                  (l) =>
                    `${r.description}: ${l.notes.map((n) => n.reason).join(" · ")}`,
                ),
            )
            .join(" / "),
        ]);
      for (const e of c.entries.filter((e) => e.kind === "aporte"))
        rows.push([
          c.number,
          e.payload.at
            ? new Intl.DateTimeFormat("es-AR", {
                dateStyle: "short",
                timeStyle: "medium",
                hourCycle: "h23",
                timeZone: "America/Argentina/Cordoba",
              }).format(new Date(e.payload.at))
            : "",
          "",
          "",
          "",
          "",
          e.payload.text,
          e.author,
          e.payload.place_kind === "hecho"
            ? "Lugar del hecho"
            : e.payload.place_kind === "camara_particular"
              ? "Cámara particular"
              : "Aporte",
          [
            e.payload.place_name,
            e.payload.address,
            e.payload.lon !== undefined
              ? `${e.payload.lon}, ${e.payload.lat}`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
          "",
        ]);
      for (const n of c.route_notes.filter((n) => n.active))
        rows.push([
          c.number,
          "",
          "",
          c.targets.find((t) => t.id === n.target_id)?.description || "",
          "",
          "",
          n.reason,
          n.author,
          "Tramo incierto",
          `${new Date(n.starts_at).toISOString()} → ${new Date(n.ends_at).toISOString()}`,
          n.reason,
        ]);
      return reply
        .type("text/csv; charset=utf-8")
        .send(
          "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n"),
        );
    }
    const points = captures.flatMap((e) =>
      e.payload.cameras.map(
        (p: any) =>
          `<Placemark><name>${xml(e.payload.at)} · CAM-${p.number}</name><description>${xml(e.payload.certainty)} · ${xml(e.payload.note)}</description><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`,
      ),
    );
    const lines = c.routes.flatMap((r) =>
      r.legs
        .filter((l) => l.coordinates.length > 1)
        .map(
          (l) =>
            `<Placemark><name>${xml(r.description)} · recorrido probable</name><LineString><coordinates>${l.coordinates.map((p) => `${p[0]},${p[1]},0`).join(" ")}</coordinates></LineString></Placemark>`,
        ),
    );
    const places = c.entries
      .filter((e) => e.kind === "aporte" && e.payload.lon !== undefined)
      .map(
        (e) =>
          `<Placemark><name>${xml(e.payload.place_kind === "hecho" ? "Lugar del hecho" : e.payload.place_kind === "camara_particular" ? "Cámara particular" : "Aporte")} · ${xml(e.payload.place_name)}</name><description>${xml([e.payload.address, e.payload.at, e.payload.text].filter(Boolean).join(" · "))}</description><Point><coordinates>${e.payload.lon},${e.payload.lat},0</coordinates></Point></Placemark>`,
      );
    const uncertain = c.route_notes
      .filter((n) => n.active)
      .map(
        (n) =>
          `<Placemark><name>Recorrido incierto · ${xml(c.targets.find((t) => t.id === n.target_id)?.description)}</name><description>${xml(n.reason)} · ${xml(new Date(n.starts_at).toISOString())} → ${xml(new Date(n.ends_at).toISOString())}</description></Placemark>`,
      );
    return reply
      .type("application/vnd.google-earth.kml+xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(c.number)}</name>${points.join("")}${lines.join("")}${places.join("")}${uncertain.join("")}</Document></kml>`,
      );
  });
  const dist = resolve("dist");
  if (existsSync(dist)) {
    await app.register(staticFiles, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/"))
        return reply.code(404).send({ error: "Ruta no encontrada" });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
