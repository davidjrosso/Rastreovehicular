import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { database } from "../server/db.ts";
import type { evidenceService } from "../server/evidence.ts";

test("evidencia HikCentral: aislamiento, revisión, adjuntos, duplicados, informe y estados", async (t) => {
  const db = await database(true),
    uploadDir = await mkdtemp(join(tmpdir(), "rastreo-evidence-test-"));
  const dep = randomUUID(),
    foreignDep = randomUUID(),
    caseId = randomUUID(),
    targetId = randomUUID(),
    cameraId = randomUUID();
  const from = "2026-10-20T10:00:00-03:00",
    to = "2026-10-20T11:00:00-03:00";
  const image = {
    bytes: Buffer.from([255, 216, 255, 0, 255, 217]),
    mime: "image/jpeg",
    source: {
      kind: "hik_anpr",
      camera_code: "1",
      camera_name: "CAM-1",
      event_id: "evt1",
      plate: "AA123BB",
      at: from,
      obtained_at: from,
    },
  };
  let searches = 0,
    photos = 0,
    frames = 0;
  const evidence: ReturnType<typeof evidenceService> = {
    async search() {
      searches++;
      return {
        records: [
          {
            event_id: "evt1",
            camera_code: "1",
            camera_name: "CAM-1",
            plate: "AA123BB",
            at: from,
            pic_uri: "Vsm://secret-source",
          },
        ],
        checks: [{ camera_name: "CAM-1", status: "complete" }],
        incomplete: false,
        checked_at: from,
      };
    },
    async photo() {
      photos++;
      return image;
    },
    async frame(camera, at) {
      frames++;
      return {
        ...image,
        source: {
          kind: "hik_recording",
          camera_code: camera.code,
          camera_name: camera.name,
          requested_at: at,
          record_type: "0",
          obtained_at: from,
          timing: "Primer fotograma; verificar hora sobreimpresa.",
        },
      };
    },
  };
  const app = await createApp(db, {
    test: true,
    uploadDir,
    evidence,
    evidenceConfig: { mapInterval: 60000, hikInterval: 60000 },
  });
  t.after(async () => {
    await app.close();
    await db.close();
    await rm(uploadDir, { recursive: true, force: true });
  });
  await db.query(
    "INSERT INTO departments(id,name,kind) VALUES($1,'Sala','municipal'),($2,'Otra','municipal')",
    [dep, foreignDep],
  );
  const cookies: Record<string, string> = {},
    users: Record<string, string> = {};
  for (const [name, role, d] of [
    ["staff", "operador", dep],
    ["otherstaff", "operador", dep],
    ["external", "externo", dep],
    ["foreign", "externo", foreignDep],
  ]) {
    const userId = randomUUID(),
      token = randomUUID();
    users[name] = userId;
    await db.query(
      "INSERT INTO users(id,name,username,password_hash,role,department_id) VALUES($1,$2,$2,'unused',$3,$4)",
      [userId, name, role, d],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [createHash("sha256").update(token).digest("hex"), userId],
    );
    cookies[name] = `rastreo_session=${token}`;
  }
  await db.query(
    "INSERT INTO cases(id,number,department_id,requester_id,title,description,starts_at,ends_at,status) VALUES($1,'TEST-HIK',$2,$3,'Prueba','Prueba',$4,$5,'en_curso')",
    [caseId, dep, users.staff, from, to],
  );
  await db.query(
    "INSERT INTO targets(id,case_id,kind,description,plate,color) VALUES($1,$2,'vehiculo','Auto','AA123BB','#112233')",
    [targetId, caseId],
  );
  await db.query(
    "INSERT INTO cameras(id,number,name,lon,lat,hik_index_code) VALUES($1,1,'Cam 1',-64.1,-32.1,'1')",
    [cameraId],
  );
  const req = (
    who: string,
    path: string,
    payload?: any,
    method: any = "POST",
  ) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: cookies[who], "x-requested-with": "Rastreo" },
      payload,
    });
  const base = `/api/cases/${caseId}`,
    searchPath = `${base}/hik/plates`,
    searchInput = { plate: "AA123BB", from, to };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: searchPath,
        headers: { "x-requested-with": "Rastreo" },
        payload: searchInput,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await req("external", searchPath, searchInput)).statusCode,
    403,
  );
  assert.equal((await req("foreign", searchPath, searchInput)).statusCode, 404);
  assert.equal(
    (
      await req("staff", searchPath, {
        ...searchInput,
        from: "2026-10-19T00:00:00Z",
      })
    ).statusCode,
    400,
  );
  assert.equal(searches, 0);
  const search = await req("staff", searchPath, searchInput);
  assert.equal(search.statusCode, 200, search.body);
  assert.ok(!search.body.includes("Vsm://"));
  assert.equal(search.json().records[0].camera.id, cameraId);
  const token = search.json().records[0].token,
    photoPath = `${searchPath}/${token}/photo`,
    importPath = `${searchPath}/${token}/import`;
  assert.equal((await req("otherstaff", photoPath)).statusCode, 404);
  assert.equal(
    (await req("staff", photoPath)).headers["content-type"],
    "image/jpeg",
  );
  const importInput = {
    target_id: targetId,
    camera_id: cameraId,
    include_photo: true,
  };
  assert.equal(
    (
      await req("staff", importPath, {
        ...importInput,
        target_id: randomUUID(),
      })
    ).statusCode,
    400,
  );
  const imported = await req("staff", importPath, importInput);
  assert.equal(imported.statusCode, 200, imported.body);
  const entryId = imported.json().id;
  const again = await req("staff", importPath, importInput);
  assert.equal(again.json().already_imported, true);
  assert.equal(photos, 2);
  assert.equal((await readdir(uploadDir)).length, 1);
  let detail = (await req("staff", base, undefined, "GET")).json();
  assert.equal(detail.entries[0].payload.certainty, "probable");
  assert.equal(detail.entries[0].payload.source.event_id, "evt1");
  assert.equal(detail.attachments[0].source.kind, "hik_anpr");
  const attachmentPath = `/api/attachments/${detail.attachments[0].id}?inline=1`;
  assert.equal(
    (await req("foreign", attachmentPath, undefined, "GET")).statusCode,
    404,
  );
  assert.equal(
    (await req("external", attachmentPath, undefined, "GET")).headers[
      "content-type"
    ],
    "image/jpeg",
  );
  const framePath = `${base}/entries/${entryId}/hik/frame`;
  assert.equal(
    (await req("staff", framePath, { camera_id: randomUUID() })).statusCode,
    400,
  );
  assert.equal(
    (await req("staff", framePath, { camera_id: cameraId, offset_seconds: -2 }))
      .statusCode,
    400,
  );
  assert.equal(frames, 0);
  const preview = await req("staff", framePath, {
    camera_id: cameraId,
    offset_seconds: 2,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  const frameToken = preview.json().token;
  assert.equal(
    (await req("otherstaff", `${framePath}/attach`, { token: frameToken }))
      .statusCode,
    404,
  );
  const attached = await req("staff", `${framePath}/attach`, {
    token: frameToken,
  });
  assert.equal(attached.statusCode, 200, attached.body);
  assert.equal(
    (await req("staff", `${framePath}/attach`, { token: frameToken })).json()
      .already_attached,
    true,
  );
  assert.equal((await readdir(uploadDir)).length, 2);
  const report = await req("external", `${base}/report`, undefined, "GET");
  assert.equal(report.statusCode, 200, report.body);
  assert.equal(report.json().attachments.length, 2);
  assert.equal(report.json().attachments[1].source.kind, "hik_recording");
  await db.query("UPDATE cases SET status='entregada' WHERE id=$1", [caseId]);
  assert.equal(
    (await req("staff", `${framePath}/attach`, { token: frameToken }))
      .statusCode,
    409,
  );
  assert.equal((await req("staff", importPath, importInput)).statusCode, 409);
  assert.equal(
    (await req("staff", framePath, { camera_id: cameraId })).statusCode,
    200,
  );
  await db.query("UPDATE entries SET deleted_at=now() WHERE id=$1", [entryId]);
  assert.equal(
    (await req("staff", attachmentPath, undefined, "GET")).statusCode,
    404,
  );
  assert.equal(
    (await req("staff", framePath, { camera_id: cameraId })).statusCode,
    404,
  );
  detail = (await req("staff", `${base}/report`, undefined, "GET")).json();
  assert.equal(detail.attachments.length, 0);
});
