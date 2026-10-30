import type { FastifyInstance } from "fastify";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { DB } from "./db.ts";
import { fail, id, isStaff, type User } from "./domain.ts";
import { withinCasePeriod, periodBounds } from "../shared/case-period.ts";
import { IntegrationError, type IntegrationConfig } from "./integrations.ts";
import {
  evidenceService,
  plateInput,
  type PlateRecord,
  type EvidenceImage,
} from "./evidence.ts";

type Context = {
  db: DB;
  uploads: string;
  config: IntegrationConfig;
  service?: ReturnType<typeof evidenceService>;
  access: (db: DB, caseId: string, user: User, lock?: boolean) => Promise<any>;
  audit: (
    db: DB,
    user: User,
    caseId: string | null,
    action: string,
    detail: unknown,
  ) => Promise<void>;
  changed: (id: string) => void;
};
type Scope = { user: string; caseId: string; expires: number };
export function registerEvidenceRoutes(app: FastifyInstance, ctx: Context) {
  const { db, access, audit, changed, uploads, config } = ctx;
  const media = ctx.service || evidenceService(config);
  const records = new Map<string, Scope & { record: PlateRecord }>();
  const previews = new Map<
    string,
    Scope & { image: EvidenceImage; entryId: string }
  >();
  const cleanup = () => {
    for (const map of [records, previews])
      for (const [key, value] of map)
        if (value.expires <= Date.now()) map.delete(key);
  };
  const timer = setInterval(cleanup, 60000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    records.clear();
    previews.clear();
  });
  const scope = (user: User, caseId: string) => ({
    user: user.id,
    caseId,
    expires: Date.now() + 10 * 60000,
  });
  function get<T extends Scope>(
    map: Map<string, T>,
    token: string,
    user: User,
    caseId: string,
  ): T {
    cleanup();
    const item = map.get(token);
    if (!item || item.user !== user.id || item.caseId !== caseId)
      fail(
        404,
        "El resultado venció o no pertenece a esta búsqueda. Volvé a consultar.",
      );
    return item;
  }
  async function staffCase(caseId: string, user: User) {
    const c = await access(db, caseId, user);
    if (!isStaff(user)) fail(403, "La consulta de HikCentral es para la sala.");
    return c;
  }
  async function safe<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof IntegrationError) fail(409, error.message);
      throw error;
    }
  }
  function within(c: any, from: string, to = from) {
    if (!withinCasePeriod(c, from, to) || Date.parse(to) > Date.now())
      fail(
        400,
        "La consulta debe estar dentro del período del pedido y no incluir horas futuras.",
      );
  }
  async function capture(caseId: string, entryId: string) {
    id.parse(entryId);
    const e = (
      await db.query(
        "SELECT * FROM entries WHERE id=$1 AND case_id=$2 AND kind='captura' AND deleted_at IS NULL",
        [entryId, caseId],
      )
    ).rows[0];
    if (!e) fail(404, "Captura no encontrada");
    return e;
  }
  const rate = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  app.post("/api/cases/:id/hik/plates", rate, async (req) => {
    const caseId = (req.params as any).id,
      c = await staffCase(caseId, req.user);
    const input = plateInput.parse(req.body);
    within(c, input.from, input.to);
    const result = await safe(() => media.search(input));
    cleanup();
    // Bound cached private source URIs; only opaque tokens leave the server.
    while (records.size + result.records.length > 2000)
      records.delete(records.keys().next().value!);
    const cameras = (
      await db.query(
        "SELECT id,number,name,hik_index_code FROM cameras WHERE active=true",
      )
    ).rows;
    const publicRecords = result.records.map((record) => {
      const token = randomUUID();
      records.set(token, { ...scope(req.user, caseId), record });
      const matches = cameras.filter(
        (cam) =>
          (config.mappings?.[String(cam.number)] || cam.hik_index_code) ===
          record.camera_code,
      );
      const { pic_uri, ...rest } = record;
      return {
        ...rest,
        token,
        has_photo: !!pic_uri,
        camera: matches.length === 1 ? matches[0] : null,
      };
    });
    await audit(db, req.user, caseId, "hik_plate_search", {
      ...input,
      result_count: publicRecords.length,
      incomplete: result.incomplete,
    });
    return { ...result, records: publicRecords };
  });
  app.post(
    "/api/cases/:id/hik/plates/:token/photo",
    rate,
    async (req, reply) => {
      const { id: caseId, token } = req.params as any;
      await staffCase(caseId, req.user);
      const { record } = get(records, token, req.user, caseId);
      const image = await safe(() => media.photo(record));
      return reply.type(image.mime).send(image.bytes);
    },
  );

  async function saveAttachment(
    tx: DB,
    user: User,
    caseId: string,
    entryId: string,
    image: EvidenceImage,
    attachmentId: string,
    key: string,
  ) {
    const source = image.source;
    const name = `${source.kind === "hik_anpr" ? "ANPR" : "Grabacion"}_${String(
      source.camera_name,
    )
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(
        0,
        70,
      )}_${String(source.at || source.requested_at).replace(/[^0-9T]/g, "_")}.${image.mime === "image/png" ? "png" : "jpg"}`;
    await tx.query(
      "INSERT INTO attachments(id,case_id,entry_id,user_id,name,mime,size,sha256,source,source_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        attachmentId,
        caseId,
        entryId,
        user.id,
        name,
        image.mime,
        image.bytes.length,
        createHash("sha256").update(image.bytes).digest("hex"),
        JSON.stringify(source),
        key,
      ],
    );
    await audit(tx, user, caseId, "attachment_created", {
      attachment_id: attachmentId,
      entry_id: entryId,
      source,
    });
  }
  app.post("/api/cases/:id/hik/plates/:token/import", rate, async (req) => {
    const { id: caseId, token } = req.params as any;
    const c = await staffCase(caseId, req.user);
    if (c.status !== "en_curso")
      fail(409, "Reabrí la búsqueda para incorporar capturas.");
    const input = z
      .object({
        target_id: id,
        camera_id: id,
        include_photo: z.boolean(),
        certainty: z
          .enum(["probable", "confirmado", "dudoso"])
          .default("probable"),
      })
      .parse(req.body);
    const { record } = get(records, token, req.user, caseId);
    within(c, record.at);
    const target = (
      await db.query(
        "SELECT id FROM targets WHERE id=$1 AND case_id=$2 AND kind='vehiculo'",
        [input.target_id, caseId],
      )
    ).rows[0];
    if (!target) fail(400, "Elegí un vehículo de esta búsqueda.");
    const camera = (
      await db.query(
        "SELECT id,number,name,lon,lat,hik_index_code FROM cameras WHERE id=$1 AND active=true",
        [input.camera_id],
      )
    ).rows[0];
    if (!camera) fail(400, "Elegí una cámara activa del mapa.");
    const key = createHash("sha256")
      .update(JSON.stringify([record.camera_code, record.event_id]))
      .digest("hex");
    const existing = (
      await db.query(
        "SELECT id FROM entries WHERE case_id=$1 AND source_key=$2 AND deleted_at IS NULL",
        [caseId, key],
      )
    ).rows[0];
    if (existing) return { id: existing.id, already_imported: true };
    const image = input.include_photo
      ? await safe(() => media.photo(record))
      : null;
    const entryId = randomUUID(),
      attachmentId = randomUUID(),
      path = resolve(uploads, attachmentId);
    let usedFile = false;
    try {
      if (image)
        await writeFile(path, image.bytes, { flag: "wx", mode: 0o600 });
      const result = await db.transaction(async (tx) => {
        const current = await access(tx, caseId, req.user, true);
        if (current.status !== "en_curso")
          fail(409, "La búsqueda cambió de estado. Volvé a abrirla.");
        within(current, record.at);
        const duplicate = (
          await tx.query(
            "SELECT id FROM entries WHERE case_id=$1 AND source_key=$2 AND deleted_at IS NULL",
            [caseId, key],
          )
        ).rows[0];
        if (duplicate) return { id: duplicate.id, already_imported: true };
        const matched =
          (config.mappings?.[String(camera.number)] ||
            camera.hik_index_code) === record.camera_code;
        const source = {
          kind: "hik_anpr",
          event_id: record.event_id,
          camera_code: record.camera_code,
          camera_name: record.camera_name,
          plate: record.plate,
          at: record.at,
          mapping: matched ? "verified" : "operator_selected",
        };
        const { hik_index_code, ...snapshot } = camera;
        const payload = {
          camera_ids: [camera.id],
          cameras: [snapshot],
          target_ids: [target.id],
          at: record.at,
          certainty: input.certainty,
          direction: "",
          note: `Lectura automática de patente: ${record.plate}. Fuente: ${record.camera_name} (HikCentral ${record.camera_code}). ${matched ? "" : "Cámara del mapa vinculada manualmente por el operador. "}${input.certainty === "confirmado" ? "Confirmada por el operador al incorporar." : "Requiere revisión visual del vehículo y la patente."}`,
          source,
        };
        await tx.query(
          "INSERT INTO entries(id,case_id,kind,payload,user_id,source_key) VALUES($1,$2,'captura',$3,$4,$5)",
          [entryId, caseId, JSON.stringify(payload), req.user.id, key],
        );
        if (image)
          await saveAttachment(
            tx,
            req.user,
            caseId,
            entryId,
            image,
            attachmentId,
            key,
          );
        await audit(tx, req.user, caseId, "captura_created", {
          entry_id: entryId,
          source,
        });
        await tx.query("UPDATE cases SET updated_at=now() WHERE id=$1", [
          caseId,
        ]);
        return { id: entryId, already_imported: false };
      });
      usedFile = !!image && !result.already_imported;
      changed(caseId);
      return result;
    } finally {
      if (image && !usedFile) await rm(path, { force: true });
    }
  });

  app.post("/api/cases/:id/entries/:entryId/hik/frame", rate, async (req) => {
    const { id: caseId, entryId } = req.params as any;
    const c = await staffCase(caseId, req.user),
      entry = await capture(caseId, entryId);
    const input = z
      .object({
        camera_id: id,
        offset_seconds: z.number().int().min(-5).max(5).default(0),
      })
      .parse(req.body);
    const snapshot = entry.payload.cameras.find(
      (cam: any) => cam.id === input.camera_id,
    );
    if (!snapshot) fail(400, "La cámara no pertenece a esta captura.");
    const camera = (
      await db.query("SELECT number,hik_index_code FROM cameras WHERE id=$1", [
        input.camera_id,
      ])
    ).rows[0];
    const code =
      config.mappings?.[String(camera?.number)] || camera?.hik_index_code;
    if (!code)
      fail(
        409,
        "La cámara no tiene una correspondencia única en HikCentral. Revisá la vinculación en Integraciones.",
      );
    const at = new Date(
      Math.floor(Date.parse(entry.payload.at) / 1000) * 1000 +
        input.offset_seconds * 1000,
    ).toISOString();
    const end = new Date(
      Math.min(Date.parse(at) + 6000, periodBounds(c).to, Date.now()),
    ).toISOString();
    within(c, at, end);
    if (Date.parse(end) - Date.parse(at) < 1000)
      fail(
        400,
        "Elegí un segundo anterior para obtener un fragmento dentro del período.",
      );
    const image = await safe(() =>
      media.frame(
        { code, name: `CAM-${snapshot.number} ${snapshot.name}` },
        at,
        end,
      ),
    );
    cleanup();
    while (previews.size >= 8) previews.delete(previews.keys().next().value!);
    const token = randomUUID();
    previews.set(token, { ...scope(req.user, caseId), image, entryId });
    return {
      token,
      source: image.source,
      image: `data:${image.mime};base64,${image.bytes.toString("base64")}`,
    };
  });
  app.post(
    "/api/cases/:id/entries/:entryId/hik/frame/attach",
    rate,
    async (req) => {
      const { id: caseId, entryId } = req.params as any;
      const c = await staffCase(caseId, req.user);
      await capture(caseId, entryId);
      if (c.status !== "en_curso")
        fail(409, "Reabrí la búsqueda para adjuntar imágenes.");
      const { token } = z.object({ token: z.uuid() }).parse(req.body);
      const preview = get(previews, token, req.user, caseId);
      if (preview.entryId !== entryId)
        fail(404, "La imagen no pertenece a esta captura.");
      const { image } = preview;
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            image.source.kind,
            image.source.camera_code,
            image.source.requested_at,
            image.source.record_type,
          ]),
        )
        .digest("hex");
      const attachmentId = randomUUID(),
        path = resolve(uploads, attachmentId);
      let saved = false;
      try {
        await writeFile(path, image.bytes, { flag: "wx", mode: 0o600 });
        const result = await db.transaction(async (tx) => {
          const current = await access(tx, caseId, req.user, true);
          const entry = (
            await tx.query("SELECT deleted_at FROM entries WHERE id=$1", [
              entryId,
            ])
          ).rows[0];
          if (current.status !== "en_curso" || !entry || entry.deleted_at)
            fail(409, "La búsqueda o la captura cambió. Volvé a consultar.");
          const duplicate = (
            await tx.query(
              "SELECT id FROM attachments WHERE entry_id=$1 AND source_key=$2",
              [entryId, key],
            )
          ).rows[0];
          if (duplicate) return { id: duplicate.id, already_attached: true };
          await saveAttachment(
            tx,
            req.user,
            caseId,
            entryId,
            image,
            attachmentId,
            key,
          );
          await tx.query("UPDATE cases SET updated_at=now() WHERE id=$1", [
            caseId,
          ]);
          return { id: attachmentId, already_attached: false };
        });
        saved = !result.already_attached;
        changed(caseId);
        return result;
      } finally {
        if (!saved) await rm(path, { force: true });
      }
    },
  );
}
