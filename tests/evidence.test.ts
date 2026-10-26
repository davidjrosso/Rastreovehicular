import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evidenceService,
  downloadLocation,
  plateInput,
  boundedBytes,
  extractFrame,
} from "../server/evidence.ts";
import type { IntegrationConfig } from "../server/integrations.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const config: IntegrationConfig = {
  hikUrl: "https://hik.example.test",
  key: "key",
  secret: "secret",
  mapInterval: 60000,
  hikInterval: 60000,
};
const input = {
  plate: "AA123BB",
  from: "2026-10-20T10:00:00-03:00",
  to: "2026-10-20T11:00:00-03:00",
};
const camera = {
  cameraIndexCode: "1",
  cameraName: "CAM-1",
  capabilitySet: "event_veh",
};
const record = {
  cameraIndexCode: "1",
  crossRecordSyscode: "evt",
  plateNo: "AA123BB",
  crossTime: "2026-10-20T10:05:00-03:00",
  vehiclePicUri: "Vsm://private",
};
const response = (data: any) => Response.json({ code: "0", data });
test("ANPR normaliza, acota fechas, filtra coincidencias parciales y retiene sólo campos necesarios", async () => {
  assert.equal(
    plateInput.parse({ ...input, plate: "aa 123-bb" }).plate,
    "AA123BB",
  );
  assert.throws(() => plateInput.parse({ ...input, plate: "*" }));
  assert.throws(() =>
    plateInput.parse({ ...input, to: "2027-01-01T00:00:00Z" }),
  );
  let queries = 0;
  const service = evidenceService(config, (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (String(_url).includes("resource"))
      return response({
        total: 2,
        list: [
          camera,
          { ...camera, cameraIndexCode: "2", capabilitySet: "ptz" },
        ],
      });
    queries++;
    assert.equal(body.cameraIndexCode, "1");
    assert.equal(body.startTime, "2026-10-20T13:00:00+00:00");
    return response({
      total: 3,
      list: [
        { ...record, ownerName: "private owner" },
        { ...record, crossRecordSyscode: "partial", plateNo: "XAA123BB" },
        {
          ...record,
          crossRecordSyscode: "outside",
          crossTime: "2026-10-19T10:05:00-03:00",
        },
      ],
    });
  }) as typeof fetch);
  const result = await service.search(input);
  assert.equal(queries, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.incomplete, false);
  assert.equal("ownerName" in result.records[0], false);
});
test("ANPR informa paginación incompleta y errores por cámara; una falla no es ausencia", async () => {
  const service = evidenceService(config, (async (url: any, init: any) => {
    if (String(url).includes("resource"))
      return response({
        total: 2,
        list: [camera, { ...camera, cameraIndexCode: "2" }],
      });
    if (JSON.parse(init.body).cameraIndexCode === "2")
      throw Error("secret connection detail");
    return response({ total: 200, list: [record] });
  }) as typeof fetch);
  const result = await service.search(input);
  assert.equal(result.incomplete, true);
  assert.equal(result.checks.filter((c) => c.status === "error").length, 2);
  assert.equal(result.records.length, 1);
  assert.ok(!JSON.stringify(result).includes("secret connection"));
});
test("descarga sólo rutas MP4 del servidor configurado y limita bytes", async () => {
  assert.equal(
    downloadLocation("https://:443/download/video/abc_123.mp4", config.hikUrl!)
      .href,
    "https://hik.example.test/download/video/abc_123.mp4",
  );
  assert.equal(
    downloadLocation("http://evil.test/download/abc.mp4", config.hikUrl!).host,
    "hik.example.test",
  );
  for (const raw of [
    "http://evil/private",
    "/download/../../secret.mp4",
    "/download/a.mp4?secret=1",
    "/download/%2e.mp4",
    "file:///download/a.mp4",
  ])
    assert.throws(() => downloadLocation(raw, config.hikUrl!));
  await assert.rejects(boundedBytes(new Response("123456"), 5), /tamaño/);
});
test("fotograma usa grabación histórica, verifica cobertura y no publica URL ni autenticación", async () => {
  const paths: string[] = [];
  const service = evidenceService(
    config,
    (async (url: any, init: any) => {
      const u = new URL(url);
      paths.push(u.pathname);
      assert.equal(init.redirect, "error");
      if (u.pathname.endsWith("playbackURLs"))
        return response({
          url: "rtsp://secret",
          authentication: "private-auth",
          list: [{ beginTime: input.from, endTime: input.to }],
        });
      if (u.pathname.endsWith("/download")) {
        const body = JSON.parse(init.body);
        assert.equal(body.authentication, "private-auth");
        return response({ downloadID: "job" });
      }
      if (u.pathname.endsWith("/downloadURL"))
        return response({
          percent: "100",
          url: "https://:443/download/video/job.mp4",
        });
      assert.equal(u.host, "hik.example.test");
      return new Response("video");
    }) as typeof fetch,
    async () => Buffer.from([255, 216, 255, 0, 255, 217]),
  );
  const image = await service.frame(
    { code: "1", name: "CAM-1" },
    input.from,
    "2026-10-20T10:00:06-03:00",
  );
  assert.equal(image.source.kind, "hik_recording");
  assert.equal(image.source.requested_at, "2026-10-20T13:00:00+00:00");
  assert.ok(!JSON.stringify(image.source).includes("private-auth"));
  assert.ok(!paths.some((p) => p.includes("capture")));
  const absent = evidenceService(config, (async () =>
    response({
      url: "rtsp://x",
      authentication: "x",
      list: [],
    })) as typeof fetch);
  await assert.rejects(
    absent.frame({ code: "1", name: "C1" }, input.from, input.to),
    /fragmento verificable/,
  );
});
test("foto ANPR rechaza errores JSON en vez de adjuntarlos como imágenes", async () => {
  const service = evidenceService(config, (async () =>
    Response.json({ code: "66", secret: "hidden" })) as typeof fetch);
  await assert.rejects(
    service.photo({
      event_id: "a",
      camera_code: "1",
      camera_name: "C1",
      at: input.from,
      plate: "AA123BB",
      pic_uri: "private",
    }),
    /no devolvió una imagen/,
  );
});
test("FFmpeg extrae un JPEG real y limpia el fragmento temporal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rastreo-test-clip-"));
  try {
    const clip = join(dir, "test.mp4");
    await promisify(execFile)(
      ffmpegPath!,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=green:s=320x240:d=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        clip,
      ],
      { windowsHide: true, timeout: 20000 },
    );
    const result = await extractFrame(await readFile(clip));
    assert.equal(result[0], 255);
    assert.equal(result[1], 216);
    assert.ok(result.length > 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
