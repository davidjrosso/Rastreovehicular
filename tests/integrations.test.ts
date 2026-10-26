import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { database } from "../server/db.ts";
import { importCameras } from "../server/cameras.ts";
import {
  applyHikSnapshot,
  cameraHealth,
  cameraIntegrations,
  fetchHikCameras,
  hikHeaders,
  integrationConfig,
} from "../server/integrations.ts";

const config = {
  mapId: "public-map-test",
  hikUrl: "https://hik.example.test",
  key: "test-app",
  secret: "test-secret",
  mapInterval: 300000,
  hikInterval: 60000,
};
const kml = (numbers: number[], lon = -64) =>
  `<kml><Document>${numbers.map((n) => `<Placemark><name>CAM-${n}</name><Point><coordinates>${lon},-32,0</coordinates></Point></Placemark>`).join("")}</Document></kml>`;
const response = (list: any[], total = list.length, pageNo = 1) =>
  new Response(
    JSON.stringify({ code: "0", data: { total, pageNo, pageSize: 500, list } }),
  );

test("HikCentral firma cuerpo, ruta y encabezados; no transmite AppSecret", () => {
  const headers = hikHeaders(
    "/artemis/api/resource/v1/cameras",
    "{}",
    "test-app",
    "test-secret",
    0,
    "nonce",
  );
  const canonical =
    "POST\napplication/json\nmZFLkyvTelC5g8XnyQrpOw==\napplication/json\nThu, 01 Jan 1970 00:00:00 GMT\nx-ca-key:test-app\nx-ca-nonce:nonce\nx-ca-timestamp:0\n/artemis/api/resource/v1/cameras";
  assert.equal(
    headers["x-ca-signature"],
    createHmac("sha256", "test-secret").update(canonical).digest("base64"),
  );
  assert.ok(!JSON.stringify(headers).includes("test-secret"));
  assert.equal(
    headers["x-ca-signature-headers"],
    "x-ca-key,x-ca-nonce,x-ca-timestamp",
  );
});

test("HikCentral recorre todas las páginas y rechaza resultados parciales o incoherentes", async () => {
  let calls = 0;
  const page = Array.from({ length: 500 }, (_, i) => ({
    cameraIndexCode: `id-${i}`,
    cameraName: `CAM-${i}`,
    status: 1,
  }));
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(
      String(url),
      "https://hik.example.test/artemis/api/resource/v1/cameras",
    );
    assert.equal(options?.redirect, "error");
    const request = JSON.parse(String(options?.body));
    assert.equal(request.pageNo, ++calls);
    return calls === 1
      ? response(page, 501)
      : response(
          [{ cameraIndexCode: "last", cameraName: "CAM-500", status: 2 }],
          501,
          2,
        );
  };
  const all = await fetchHikCameras(config, fetcher);
  assert.equal(calls, 2);
  assert.equal(all.length, 501);
  assert.equal(all[500].status, 2);
  let brokenCalls = 0;
  await assert.rejects(
    fetchHikCameras(config, async () =>
      ++brokenCalls === 1 ? response(page, 501) : response([], 501, 2),
    ),
    /incompleta/,
  );
  await assert.rejects(
    fetchHikCameras(config, async () => response([page[0], page[0]])),
    /repetidas/,
  );
  await assert.rejects(
    fetchHikCameras(
      { ...config, hikUrl: "http://hik.example.test" },
      async () => {
        assert.fail("No debe enviar claves sin HTTPS");
      },
    ),
    /HTTPS/,
  );
});

test("estados vencidos o integración deshabilitada se muestran desconocidos", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const camera = {
    health_status: "offline",
    health_checked_at: new Date(now - 1000).toISOString(),
  };
  assert.equal(
    cameraHealth(camera, 180000, true, now).health_status,
    "offline",
  );
  assert.equal(
    cameraHealth(camera, 180000, true, now + 180001).health_status,
    "unknown",
  );
  assert.equal(
    cameraHealth(camera, 180000, false, now).health_status,
    "unknown",
  );
  assert.equal(
    cameraHealth({ health_status: "online" }, 180000, true, now).health_status,
    "unknown",
  );
  assert.throws(
    () => integrationConfig({ HIK_CAMERA_MAPPING: '{"1":"same","2":"same"}' }),
    /únicos/,
  );
});

test("sincronización preserva posiciones ambiguas, rechaza bajas masivas y no convierte errores en cámaras caídas", async (t) => {
  const db = await database(true);
  t.after(() => db.close());
  await importCameras(db, kml([1, 2, 3, 4, 5]), null, true, true);
  const first = (await db.query("SELECT * FROM cameras ORDER BY number")).rows;
  const changed = await importCameras(
    db,
    kml([1, 1, 2, 3, 4, 6], -65),
    null,
    true,
    true,
  );
  assert.deepEqual(changed.duplicates, [1]);
  assert.equal(changed.removed, 1);
  assert.equal(changed.added, 1);
  const after = (await db.query("SELECT * FROM cameras ORDER BY number")).rows;
  assert.equal(after[0].lon, first[0].lon);
  assert.equal(after[0].id, first[0].id);
  assert.equal(after[1].lon, -65);
  assert.equal(after[4].active, false);
  await assert.rejects(importCameras(db, kml([2]), null, true, true), /25%/);
  await assert.rejects(
    importCameras(db, "<kml></kml>", null, true, true),
    /no contiene/,
  );
  await assert.rejects(
    importCameras(
      db,
      "<kml><Placemark><name>sin número</name></Placemark></kml>",
      null,
      true,
      true,
    ),
  );
  assert.deepEqual(
    (await db.query("SELECT * FROM cameras ORDER BY number")).rows,
    after,
  );
  const snapshot = [
    { cameraIndexCode: "one", cameraName: "CAM-1 Plaza", status: 2 },
    { cameraIndexCode: "two", cameraName: "CAM-2 Calle", status: 1 },
    { cameraIndexCode: "three", cameraName: "CAM-3", status: 0 },
    { cameraIndexCode: "four-a", cameraName: "CAM-4 Uno", status: 2 },
    { cameraIndexCode: "four-b", cameraName: "CAM-4 Dos", status: 1 },
  ];
  const summary = await applyHikSnapshot(db, snapshot);
  assert.equal(summary.offline, 1);
  assert.equal(summary.online, 1);
  assert.equal(summary.unknown, 3);
  assert.deepEqual(summary.ambiguous, [4]);
  assert.equal(summary.unmapped, 2);
  const healthBefore = (await db.query("SELECT * FROM cameras ORDER BY number"))
    .rows;
  let calls = 0;
  const service = cameraIntegrations(
    db,
    config,
    () => {},
    async () => {
      calls++;
      return new Response(
        JSON.stringify({
          code: "failed",
          msg: "secret-test-secret-do-not-return",
        }),
      );
    },
  );
  t.after(() => service.close());
  await Promise.all([service.run("hikcentral"), service.run("hikcentral")]);
  assert.equal(calls, 1, "consultas simultáneas comparten la misma ejecución");
  assert.deepEqual(
    (await db.query("SELECT * FROM cameras ORDER BY number")).rows,
    healthBefore,
  );
  const state = await service.status();
  assert.match(
    state.find((s) => s.source === "hikcentral")!.last_error,
    /rechazó/,
  );
  assert.ok(!JSON.stringify(state).includes("test-secret"));
  await applyHikSnapshot(db, snapshot, { "4": "four-b" });
  assert.equal(
    (await db.query("SELECT health_status FROM cameras WHERE number=4")).rows[0]
      .health_status,
    "online",
  );
  await applyHikSnapshot(db, []);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM cameras WHERE active AND health_status <> 'unknown'",
      )
    ).rows[0].count,
    0,
  );
});
