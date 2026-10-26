import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import argon2 from "argon2";
import { database } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { importCameras } from "../server/cameras.ts";
import { io } from "socket.io-client";

test("flujo completo, aislamiento, archivos, estados e historial", async (t) => {
  if (process.env.TEST_DATABASE_URL)
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const db = await database(!process.env.TEST_DATABASE_URL);
  const uploadDir = await mkdtemp(join(tmpdir(), "rastreo-tests-"));
  const app = await createApp(db, { test: true, uploadDir });
  t.after(async () => {
    await app.close();
    await db.close();
    await rm(uploadDir, { recursive: true, force: true });
  });
  const depA = randomUUID(),
    depB = randomUUID();
  await db.query(
    "INSERT INTO departments(id,name,kind) VALUES($1,'Comisaría A','policia'),($2,'Fiscalía B','fiscalia')",
    [depA, depB],
  );
  const userIds: Record<string, string> = {},
    cookies: Record<string, string> = {};
  const password = "Prueba-segura-2026";
  const passHash = await argon2.hash(password);
  for (const [username, role, dep] of [
    ["admin", "admin", depA],
    ["operador", "operador", depA],
    ["externoa", "externo", depA],
    ["externob", "externo", depB],
  ]) {
    userIds[username] = randomUUID();
    await db.query(
      "INSERT INTO users(id,name,username,password_hash,role,department_id) VALUES($1,$2,$3,$4,$5,$6)",
      [userIds[username], username, username, passHash, role, dep],
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { "x-requested-with": "Rastreo" },
      payload: { username, password },
    });
    assert.equal(login.statusCode, 200, login.body);
    cookies[username] = login.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
  async function req(who: string, method: any, url: string, payload?: any) {
    return app.inject({
      method,
      url,
      headers: { cookie: cookies[who], "x-requested-with": "Rastreo" },
      payload,
    });
  }
  assert.equal((await app.inject("/api/cases")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/cases",
        headers: { cookie: cookies.admin },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/notices/read",
        headers: {
          cookie: cookies.admin,
          "x-requested-with": "Rastreo",
          origin: "https://untrusted.example",
        },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal((await req("externoa", "GET", "/api/users")).statusCode, 403);
  assert.deepEqual((await req("externoa", "GET", "/api/cameras")).json(), []);
  assert.equal(
    (await req("externoa", "GET", "/api/integrations/cameras")).statusCode,
    403,
  );
  assert.equal(
    (await req("operador", "POST", "/api/integrations/cameras/mymaps/run"))
      .statusCode,
    403,
  );
  const integrations = await req("admin", "GET", "/api/integrations/cameras");
  assert.equal(integrations.statusCode, 200);
  assert.ok(integrations.json().every((s: any) => s.configured === false));
  assert.equal(
    (await req("admin", "POST", "/api/integrations/cameras/hikcentral/run"))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await req("externoa", "POST", "/api/departments", {
        name: "No permitido",
        kind: "policia",
      })
    ).statusCode,
    403,
  );
  const input = {
    title: "Caso de prueba",
    description: "Vehículo de prueba",
    department_id: depA,
    reference: "OF-123",
    starts_at: "2026-10-20T12:00:00-03:00",
    ends_at: "2026-10-20T13:00:00-03:00",
  };
  assert.equal(
    (
      await req("externoa", "POST", "/api/cases", {
        ...input,
        department_id: depB,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await req("admin", "POST", "/api/cases", {
        ...input,
        ends_at: "2026-10-20T11:00:00-03:00",
      })
    ).statusCode,
    400,
  );
  const created = await req("externoa", "POST", "/api/cases", input);
  assert.equal(created.statusCode, 200, created.body);
  const caseId = created.json().id,
    base = `/api/cases/${caseId}`;
  assert.equal((await req("externob", "GET", base)).statusCode, 404);
  assert.equal(
    (await req("externob", "GET", `${base}/export/csv`)).statusCode,
    404,
  );
  assert.equal((await req("externob", "GET", "/api/cases")).json().length, 0);
  assert.equal(
    (await req("externoa", "POST", `${base}/state`, { status: "en_curso" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await req("operador", "POST", `${base}/state`, { status: "en_curso" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await req("admin", "POST", `${base}/state`, { status: "en_curso" }))
      .statusCode,
    200,
  );
  const targetInput = {
    kind: "vehiculo",
    description: "Auto gris",
    plate: "TEST",
    color: "#dd8833",
  };
  assert.equal(
    (await req("externoa", "POST", `${base}/targets`, targetInput)).statusCode,
    403,
  );
  const targetResponse = await req(
    "operador",
    "POST",
    `${base}/targets`,
    targetInput,
  );
  assert.equal(targetResponse.statusCode, 200, targetResponse.body);
  const targetId = targetResponse.json().id;
  const cam = (number: number, lon = -64.117) =>
    `<Placemark><name>CAM-${number}_TEST</name><Point><coordinates>${lon},-32.175,0</coordinates></Point></Placemark>`;
  const kml = (body: string) => `<kml><Document>${body}</Document></kml>`;
  const imported = await req("admin", "POST", "/api/cameras/import", {
    kml: kml(cam(1) + cam(2, -64.116)),
  });
  assert.equal(imported.statusCode, 200, imported.body);
  assert.equal(
    (
      await req("admin", "POST", "/api/cameras/import", {
        kml: kml(cam(1) + cam(1)),
      })
    ).statusCode,
    400,
  );
  const cameras = (await req("operador", "GET", "/api/cameras")).json();
  assert.equal(cameras.length, 2);
  const capture = {
    camera_ids: [cameras[0].id],
    target_ids: [targetId],
    at: "2026-10-20T12:15:10-03:00",
    certainty: "confirmado",
    direction: "N",
    note: "Prueba",
  };
  assert.equal(
    (await req("externoa", "POST", `${base}/entries/captura`, capture))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await req("operador", "POST", `${base}/entries/captura`, {
        ...capture,
        target_ids: [randomUUID()],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req("operador", "POST", `${base}/entries/captura`, {
        ...capture,
        at: "2026-10-19T12:15:10-03:00",
      })
    ).statusCode,
    400,
  );
  const cap = await req("operador", "POST", `${base}/entries/captura`, capture);
  assert.equal(cap.statusCode, 200, cap.body);
  const captureId = cap.json().id;
  const second = await req("operador", "POST", `${base}/entries/captura`, {
    ...capture,
    camera_ids: [cameras[1].id],
    at: "2026-10-20T12:35:10-03:00",
  });
  assert.equal(second.statusCode, 200, second.body);
  const suggestionOptions = { target_id: targetId, horizon_minutes: 15 };
  assert.equal(
    (await req("externoa", "POST", `${base}/suggestions`, suggestionOptions))
      .statusCode,
    403,
  );
  assert.equal(
    (await req("externob", "POST", `${base}/suggestions`, suggestionOptions))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await req("operador", "POST", `${base}/suggestions`, {
        ...suggestionOptions,
        target_id: randomUUID(),
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req("operador", "POST", `${base}/suggestions`, {
        ...suggestionOptions,
        speed: 0,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req("operador", "POST", `${base}/suggestions`, {
        ...suggestionOptions,
        horizon_minutes: 999,
      })
    ).statusCode,
    400,
  );
  const suggested = await req(
    "operador",
    "POST",
    `${base}/suggestions`,
    suggestionOptions,
  );
  assert.equal(suggested.statusCode, 200, suggested.body);
  assert.equal(suggested.json().origin.entry_id, second.json().id);
  assert.ok(suggested.json().suggestions.length <= 5);
  assert.equal((await req("operador", "GET", base)).json().entries.length, 2);
  const routeInput = {
    target_id: targetId,
    from_entry_id: captureId,
    to_entry_id: second.json().id,
    reason: "Demora de veinte minutos; recorrido desconocido",
  };
  assert.equal(
    (await req("externoa", "POST", `${base}/route-notes`, routeInput))
      .statusCode,
    403,
  );
  assert.equal(
    (await req("externob", "POST", `${base}/route-notes`, routeInput))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await req("operador", "POST", `${base}/route-notes`, {
        ...routeInput,
        to_entry_id: randomUUID(),
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req("operador", "POST", `${base}/route-notes`, {
        ...routeInput,
        reason: " ",
      })
    ).statusCode,
    400,
  );
  const uncertain = await req(
    "operador",
    "POST",
    `${base}/route-notes`,
    routeInput,
  );
  assert.equal(uncertain.statusCode, 200, uncertain.body);
  const noteId = uncertain.json().id;
  assert.equal(
    (await req("operador", "POST", `${base}/route-notes`, routeInput))
      .statusCode,
    409,
  );
  const uncertainDetail = (await req("operador", "GET", base)).json();
  assert.equal(uncertainDetail.routes[0].legs[0].uncertain, true);
  assert.equal(uncertainDetail.routes[0].legs[0].elapsed, 1200);
  assert.deepEqual(uncertainDetail.routes[0].legs[0].coordinates, []);
  assert.equal(
    (
      await req("operador", "POST", `${base}/suggestions`, suggestionOptions)
    ).json().assumptions.cautious,
    true,
  );
  const place = {
    place_kind: "camara_particular",
    place_name: "Comercio de prueba",
    address: "Esquina de prueba",
    text: "Avistamiento de prueba <sin verificar>",
    lon: -64.115,
    lat: -32.174,
  };
  assert.equal(
    (await req("externoa", "POST", `${base}/entries/aporte`, place)).statusCode,
    400,
  );
  assert.equal(
    (
      await req("externoa", "POST", `${base}/entries/aporte`, {
        ...place,
        at: capture.at,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await req("externoa", "POST", `${base}/entries/aporte`, {
        ...place,
        place_kind: "hecho",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await req("externoa", "POST", `${base}/entries/aporte`, {
        place_kind: "hecho",
        text: "Sin ubicación",
        place_name: "Sitio",
      })
    ).statusCode,
    400,
  );
  const revision = await req("operador", "POST", `${base}/entries/revision`, {
    camera_id: cameras[1].id,
    from: input.starts_at,
    to: input.ends_at,
    target_id: targetId,
  });
  assert.equal(revision.statusCode, 200, revision.body);
  assert.equal(
    (
      await req("externoa", "POST", `${base}/entries/aporte`, {
        text: "Dato de un testigo",
        lon: -64.11,
        lat: -32.17,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await req("externob", "POST", `${base}/entries/aporte`, {
        text: "Intrusión",
      })
    ).statusCode,
    404,
  );
  const message = await req("externoa", "POST", `${base}/entries/mensaje`, {
    text: "@operador revisar",
    mentions: [userIds.operador, userIds.externob],
  });
  assert.equal(message.statusCode, 200);
  const notices = (await req("operador", "GET", "/api/notices")).json();
  assert.ok(notices.some((n: any) => n.text.includes("mencionó")));
  assert.equal((await req("externob", "GET", "/api/notices")).json().length, 0);

  const boundary = "RastreoBoundary";
  const fileBody = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="prueba.txt"\r\nContent-Type: text/plain\r\n\r\nArchivo de prueba\r\n--${boundary}--\r\n`,
  );
  const upload = await app.inject({
    method: "POST",
    url: `${base}/entries/${captureId}/attachments`,
    headers: {
      cookie: cookies.operador,
      "x-requested-with": "Rastreo",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: fileBody,
  });
  assert.equal(upload.statusCode, 200, upload.body);
  const fileId = upload.json().id;
  assert.equal(
    (await req("externob", "GET", `/api/attachments/${fileId}`)).statusCode,
    404,
  );
  const download = await req("externoa", "GET", `/api/attachments/${fileId}`);
  assert.equal(download.body, "Archivo de prueba");
  assert.equal(download.headers["content-type"], "application/octet-stream");
  const csv = await req("externoa", "GET", `${base}/export/csv`);
  assert.equal(csv.statusCode, 200);
  assert.ok(csv.body.includes("20/10/26") || csv.body.includes("20/10/2026"));
  assert.ok(csv.body.includes("12:15:10"));
  assert.ok(csv.body.includes("Comercio de prueba"));
  assert.ok(csv.body.includes(routeInput.reason));
  const exportKml = (await req("externoa", "GET", `${base}/export/kml`)).body;
  assert.ok(exportKml.includes("Cámara particular"));
  assert.ok(exportKml.includes("Lugar del hecho"));
  assert.ok(exportKml.includes("&lt;sin verificar&gt;"));
  assert.ok(exportKml.includes(routeInput.reason));
  assert.equal(exportKml.includes("<LineString>"), false);
  assert.equal(
    (await req("externoa", "DELETE", `${base}/route-notes/${noteId}`))
      .statusCode,
    403,
  );
  assert.equal(
    (await req("externob", "DELETE", `${base}/route-notes/${noteId}`))
      .statusCode,
    404,
  );
  assert.equal(
    (await req("operador", "DELETE", `${base}/route-notes/${noteId}`))
      .statusCode,
    200,
  );
  const restored = (await req("operador", "GET", base)).json();
  assert.equal(restored.routes[0].legs[0].uncertain, false);
  assert.equal(restored.route_notes[0].active, false);
  assert.ok(
    restored.history.some((h: any) => h.action === "route_uncertainty_removed"),
  );
  assert.ok(
    (await req("externoa", "GET", `${base}/export/kml`)).body.includes(
      "<Placemark>",
    ),
  );
  await req("admin", "POST", "/api/cameras/import", {
    kml: kml(cam(1, -64.12) + cam(2)),
  });
  const detail = (await req("operador", "GET", base)).json();
  assert.equal(
    detail.entries.find((e: any) => e.id === captureId).payload.cameras[0].lon,
    -64.117,
  );
  assert.equal(detail.attachments[0].sha256.length, 64);

  assert.equal(
    (await req("operador", "POST", `${base}/state`, { status: "en_revision" }))
      .statusCode,
    200,
  );
  assert.equal(
    (await req("operador", "POST", `${base}/entries/captura`, capture))
      .statusCode,
    409,
  );
  assert.equal(
    (await req("operador", "POST", `${base}/route-notes`, routeInput))
      .statusCode,
    403,
  );
  assert.equal(
    (await req("admin", "POST", `${base}/state`, { status: "en_curso" }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await req("admin", "POST", `${base}/state`, {
        status: "en_curso",
        observation: "Revisar nuevamente",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await req("externoa", "DELETE", `${base}/entries/${captureId}`))
      .statusCode,
    403,
  );
  assert.equal(
    (await req("operador", "DELETE", `${base}/entries/${captureId}`))
      .statusCode,
    200,
  );
  assert.equal(
    (await req("externoa", "GET", `/api/attachments/${fileId}`)).statusCode,
    404,
  );
  assert.ok(
    (await db.query("SELECT deleted_at FROM entries WHERE id=$1", [captureId]))
      .rows[0].deleted_at,
  );
  await req("operador", "POST", `${base}/state`, { status: "en_revision" });
  await req("admin", "POST", `${base}/state`, { status: "entregada" });
  assert.equal(
    (await req("admin", "POST", `${base}/state`, { status: "archivada" }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await req("admin", "POST", `${base}/entries/mensaje`, {
        text: "No escribir",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req("externoa", "POST", `${base}/entries/aporte`, {
        text: "No escribir",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await req("admin", "DELETE", `${base}/entries/${message.json().id}`))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await req("admin", "PATCH", `/api/users/${userIds.admin}`, {
        active: false,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req("admin", "PATCH", `/api/users/${userIds.externoa}`, {
        active: false,
      })
    ).statusCode,
    200,
  );
  assert.equal((await req("externoa", "GET", base)).statusCode, 401);
  const stored = (
    await db.query("SELECT password_hash FROM users WHERE id=$1", [
      userIds.admin,
    ])
  ).rows[0];
  assert.ok(stored.password_hash.startsWith("$argon2id$"));
  assert.equal(
    (await req("admin", "GET", "/api/users")).body.includes("password_hash"),
    false,
  );
  assert.ok(
    (await req("admin", "GET", base))
      .json()
      .history.some((h: any) => h.action === "entry_deleted"),
  );

  // Concurrent writers serialize state transitions on the case row.
  await req("admin", "POST", `${base}/state`, {
    status: "en_curso",
    observation: "Reabierta",
  });
  const concurrent = await Promise.all([
    req("operador", "POST", `${base}/state`, { status: "en_revision" }),
    req("operador", "POST", `${base}/state`, { status: "en_revision" }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 403]);

  const quarantine = await importCameras(
    db,
    kml(cam(10) + cam(10) + cam(11)),
    userIds.admin,
    true,
  );
  assert.equal(quarantine.total, 1);
  assert.deepEqual(quarantine.duplicates, [10]);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };
  const socket = io(`http://127.0.0.1:${address.port}`, {
    extraHeaders: { Cookie: cookies.externob },
    transports: ["websocket"],
    forceNew: true,
  });
  t.after(() => socket.disconnect());
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const joinResult: any = await new Promise((resolve) =>
    socket.emit("join", caseId, resolve),
  );
  assert.ok(joinResult.error);
  socket.disconnect();
  const staffSocket = io(`http://127.0.0.1:${address.port}`, {
    extraHeaders: { Cookie: cookies.operador },
    transports: ["websocket"],
    forceNew: true,
  });
  t.after(() => staffSocket.disconnect());
  await new Promise<void>((resolve, reject) => {
    staffSocket.once("connect", resolve);
    staffSocket.once("connect_error", reject);
  });
  const allowed: any = await new Promise((resolve) =>
    staffSocket.emit("join", caseId, resolve),
  );
  assert.equal(allowed.ok, true);
  const changed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("No llegó el evento de actualización")),
      3000,
    );
    staffSocket.once("changed", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await req("admin", "POST", `${base}/entries/mensaje`, {
    text: "Actualización en vivo",
  });
  await changed;
  const disconnected = new Promise<void>((resolve) =>
    staffSocket.once("disconnect", () => resolve()),
  );
  await req("admin", "PATCH", `/api/users/${userIds.operador}`, {
    active: false,
  });
  await disconnected;
});
