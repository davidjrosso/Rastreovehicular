import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  fetchRecordingIntervals,
  recordingCoverage,
  recordingInput,
  recordingService,
} from "../server/recordings.ts";

const config = {
  hikUrl: "https://hik.example.test",
  key: "app",
  secret: "private-secret",
  mapInterval: 300000,
  hikInterval: 60000,
};
const from = "2024-10-20T10:00:00-03:00",
  to = "2024-10-20T11:00:00-03:00";
const query = { camera_id: randomUUID(), from, to };
const camera = {
  number: 276,
  hik_index_code: "cam-276",
  health_status: "offline",
};
const segment = (beginTime = from, endTime = to) => ({ beginTime, endTime });
const response = (list: unknown, uuid = "") =>
  new Response(
    JSON.stringify({
      code: "0",
      data: {
        list,
        uuid,
        url: "rtsp://private/video",
        authentication: "private-stream-token",
      },
    }),
  );

test("cobertura histórica une solapamientos, recorta al período y conserva huecos", () => {
  const complete = recordingCoverage(from, to, [
    { from: "2024-10-20T09:59:00-03:00", to: "2024-10-20T10:40:00-03:00" },
    { from: "2024-10-20T13:30:00Z", to: "2024-10-20T14:02:00Z" },
  ]);
  assert.equal(complete.status, "complete");
  assert.deepEqual(complete.intervals, [
    { from: "2024-10-20T13:00:00.000Z", to: "2024-10-20T14:00:00.000Z" },
  ]);
  assert.deepEqual(complete.gaps, []);
  const partial = recordingCoverage(from, to, [
    { from, to: "2024-10-20T10:20:00-03:00" },
    { from: "2024-10-20T10:25:00-03:00", to },
  ]);
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.gaps, [
    { from: "2024-10-20T13:20:00.000Z", to: "2024-10-20T13:25:00.000Z" },
  ]);
  assert.equal(
    recordingCoverage(from, to, [
      { from: "2024-10-19T10:00:00Z", to: "2024-10-19T11:00:00Z" },
    ]).status,
    "none",
  );
});

test("busca video del hecho aunque hoy esté desconectada; no filtra por estado actual ni expone acceso al stream", async () => {
  let calls = 0;
  const service = recordingService(config, async (url, options) => {
    calls++;
    assert.equal(
      String(url),
      "https://hik.example.test/artemis/api/video/v1/cameras/playbackURLs",
    );
    const body = JSON.parse(String(options?.body));
    assert.equal(body.beginTime, from);
    assert.equal(body.endTime, to);
    assert.equal(body.recordType, "0");
    assert.equal(body.mergeSegment, 0);
    assert.equal(body.cameraIndexCode, camera.hik_index_code);
    return response([segment()]);
  });
  const [first, second] = await Promise.all([
    service.check(query, camera),
    service.check(query, camera),
  ]);
  assert.equal(first.status, "complete");
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(first).includes("private"));
  assert.ok(!JSON.stringify(first).includes("rtsp"));
  const empty = recordingService(config, async () => response([]));
  assert.equal(
    (await empty.check(query, { ...camera, health_status: "online" })).status,
    "none",
  );
});

test("fallas, datos ausentes o páginas incompletas son no verificables; jamás ausencia de video", async () => {
  const noConfig = recordingService(
    { mapInterval: 300000, hikInterval: 60000 },
    async () => {
      assert.fail("No debe consultar sin configuración");
    },
  );
  assert.equal((await noConfig.check(query, camera)).status, "unknown");
  const noMatch = recordingService(config, async () => {
    assert.fail("No debe adivinar una cámara");
  });
  assert.equal((await noMatch.check(query, { number: 276 })).status, "unknown");
  for (const fetcher of [
    async () => {
      throw new Error("private-secret");
    },
    async () =>
      new Response(JSON.stringify({ code: "403", msg: "private-secret" })),
    async () => response(undefined),
    async () => response([segment("invalid", to)]),
  ]) {
    const result = await recordingService(config, fetcher).check(query, camera);
    assert.equal(result.status, "unknown");
    assert.deepEqual(result.intervals, []);
    assert.deepEqual(result.gaps, []);
    assert.ok(!JSON.stringify(result).includes("private-secret"));
  }
  let calls = 0;
  const partialFailure = recordingService(config, async () =>
    ++calls === 1
      ? response([segment(from, "2024-10-20T10:30:00-03:00")], "continuation")
      : new Response("unavailable", { status: 503 }),
  );
  assert.equal((await partialFailure.check(query, camera)).status, "unknown");
});

test("paginación de grabaciones conserva cursor y detecta bucles sin perder intervalos", async () => {
  let calls = 0;
  const intervals = await fetchRecordingIntervals(
    config,
    "cam-276",
    from,
    to,
    async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      calls++;
      if (calls === 1) {
        assert.equal(body.uuid, undefined);
        return response([segment(from, "2024-10-20T10:30:00-03:00")], "cursor");
      }
      assert.equal(body.uuid, "cursor");
      if (calls === 2)
        return response([segment("2024-10-20T10:30:00-03:00", to)], "cursor");
      return response([], "cursor");
    },
  );
  assert.equal(calls, 3);
  assert.equal(recordingCoverage(from, to, intervals).status, "complete");
  await assert.rejects(
    fetchRecordingIntervals(config, "cam-276", from, to, async () =>
      response([segment()], "loop"),
    ),
    /repitió/,
  );
});

test("limita concurrencia y valida franjas con huso horario y hasta 72 horas", async () => {
  let active = 0,
    peak = 0;
  const service = recordingService(config, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return response([]);
  });
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      service.check({ ...query, camera_id: randomUUID() }, camera),
    ),
  );
  assert.equal(peak, 3);
  assert.ok(results.every((r) => r.status === "none"));
  assert.equal(recordingInput.safeParse({ queries: [query] }).success, true);
  assert.equal(
    recordingInput.safeParse({ queries: [{ ...query, to: from }] }).success,
    false,
  );
  assert.equal(
    recordingInput.safeParse({
      queries: [{ ...query, to: "2024-10-24T11:00:00-03:00" }],
    }).success,
    false,
  );
  assert.equal(
    recordingInput.safeParse({
      queries: [{ ...query, from: "2024-10-20T10:00:00" }],
    }).success,
    false,
  );
});
