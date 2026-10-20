import { test } from "node:test";
import assert from "node:assert/strict";
import { RoadGraph } from "../server/routing.ts";
import {
  suggestCameras,
  revisionCoverage,
  type SuggestionOptions,
} from "../server/suggestions.ts";

const target = { id: "target", kind: "vehiculo" };
const graph = new RoadGraph({
  origin: [0, 0],
  N: [0, 0, 100, 0, 200, 0, 300, 0, 100, 100, 100, -100, 100, 200],
  names: ["Calle"],
  W: [
    [3, 0, 0, [0, 1, 2, 3]],
    [3, 0, 0, [5, 1, 4, 6]],
  ],
});
const cam = (id: string, lon: number, lat = 0, number = 1) => ({
  id,
  number,
  name: id,
  lon,
  lat,
  active: true,
});
const source = cam("origen", 0.001);
const capture = (
  id: string,
  at: string,
  camera = source,
  certainty = "confirmado",
) => ({
  id,
  kind: "captura",
  payload: { at, target_ids: ["target"], certainty, cameras: [camera] },
});
const last = capture("last", "2026-10-20T10:01:00Z");
const earlier = capture("earlier", "2026-10-20T10:00:00Z", cam("prev", 0));
const base = {
  ends_at: "2026-10-20T11:00:00Z",
  entries: [earlier, last],
  route_notes: [],
};
const options: SuggestionOptions = {
  target_id: "target",
  mode: "direccion",
  heading: "auto",
  horizon_minutes: 15,
  delay_minutes: 0,
};
const cameras = [
  source,
  cam("este", 0.002, 0, 2),
  cam("oeste", 0, 0, 3),
  cam("norte", 0.001, 0.001, 4),
  cam("sur", 0.001, -0.001, 5),
  cam("lejano", 0.003, 0, 6),
  cam("inactiva", 0.0011, 0, 7),
];
cameras.at(-1)!.active = false;

test("sugiere por calles, dirección y tiempo histórico sin crear capturas", () => {
  const before = JSON.stringify(base);
  const result = suggestCameras(base, target, cameras, options, graph);
  assert.equal(result.origin?.entry_id, "last");
  assert.equal(result.suggestions[0].camera.id, "este");
  assert.equal(result.suggestions.length, 5);
  assert.ok(result.assumptions?.speed_source.includes("último tramo"));
  assert.ok(result.assumptions?.heading_source.includes("continuidad"));
  assert.ok(
    result.suggestions.every(
      (s) => s.camera.id !== "origen" && s.camera.id !== "inactiva",
    ),
  );
  for (const s of result.suggestions) {
    assert.ok(Date.parse(s.from) > Date.parse(last.payload.at));
    assert.ok(Date.parse(s.to) <= Date.parse(base.ends_at));
    assert.ok(Date.parse(s.to) > Date.parse(s.from));
    assert.ok(
      Date.parse(s.at) >= Date.parse(s.from) &&
        Date.parse(s.at) <= Date.parse(s.to),
    );
    assert.equal(s.probability, undefined);
  }
  assert.equal(JSON.stringify(base), before);
});

test("respeta manos de vehículos y permite la circulación peatonal", () => {
  const oneWay = new RoadGraph({
    origin: [0, 0],
    N: [0, 0, 100, 0, 200, 0],
    names: ["Calle"],
    W: [[3, 0, 1, [0, 1, 2]]],
  });
  const car = suggestCameras(
    base,
    target,
    cameras.slice(0, 3),
    options,
    oneWay,
  );
  assert.deepEqual(
    car.suggestions.map((s) => s.camera.id),
    ["este"],
  );
  const walking = suggestCameras(
    base,
    { ...target, kind: "persona" },
    cameras.slice(0, 3),
    options,
    oneWay,
  );
  assert.ok(walking.suggestions.some((s) => s.camera.id === "oeste"));
});

test("revisiones se unen por cámara, objetivo y franja, y reducen la prioridad", () => {
  const revision = (
    from: number,
    to: number,
    target_id: string | null = "target",
    camera_id = "este",
  ) => ({
    kind: "revision",
    payload: {
      camera_id,
      target_id,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
  });
  assert.equal(
    revisionCoverage(
      [revision(0, 600), revision(400, 1000)],
      "este",
      "target",
      0,
      1000,
    ),
    "completa",
  );
  assert.equal(
    revisionCoverage(
      [revision(0, 400), revision(600, 1000)],
      "este",
      "target",
      0,
      1000,
    ),
    "parcial",
  );
  assert.equal(
    revisionCoverage(
      [revision(0, 1000, "otro"), revision(0, 1000, null, "otra")],
      "este",
      "target",
      0,
      1000,
    ),
    "ninguna",
  );
  assert.equal(
    revisionCoverage([revision(0, 1000, null)], "este", "target", 0, 1000),
    "completa",
  );
  const reviewed = {
    ...base,
    entries: [
      ...base.entries,
      revision(
        Date.parse("2026-10-20T10:00:00Z"),
        Date.parse("2026-10-20T11:00:00Z"),
      ),
    ],
  };
  const result = suggestCameras(reviewed, target, cameras, options, graph);
  assert.equal(result.suggestions.at(-1)?.camera.id, "este");
  assert.equal(result.suggestions.at(-1)?.priority, "baja");
});

test("tramo incierto o demora prolongada no transmite dirección ni velocidad automática", () => {
  const note = {
    active: true,
    target_id: "target",
    starts_at: earlier.payload.at,
    ends_at: last.payload.at,
  };
  const result = suggestCameras(
    { ...base, route_notes: [note] },
    target,
    cameras,
    options,
    graph,
  );
  assert.equal(result.assumptions?.speed, 30);
  assert.equal(result.assumptions?.heading_source, "sin dirección preferida");
  assert.equal(result.assumptions?.delay_minutes, 5);
  assert.ok(result.suggestions.every((s) => s.priority !== "alta"));
  const longGap = suggestCameras(
    {
      ...base,
      entries: [capture("old", "2026-10-20T09:40:00Z", cam("prev", 0)), last],
    },
    target,
    cameras,
    options,
    graph,
  );
  assert.equal(longGap.assumptions?.cautious, true);
  const manual = suggestCameras(
    { ...base, route_notes: [note] },
    target,
    cameras,
    { ...options, speed: 12, heading: "O", delay_minutes: 8 },
    graph,
  );
  assert.equal(manual.assumptions?.speed, 12);
  assert.ok(manual.assumptions?.heading_source.includes("sentido O"));
  assert.equal(manual.assumptions?.delay_minutes, 8);
  assert.equal(manual.suggestions[0].camera.id, "oeste");
});

test("sin captura confirmada, origen ambiguo y final de franja devuelven explicación", () => {
  const unconfirmed = suggestCameras(
    { ...base, entries: [capture("x", last.payload.at, source, "probable")] },
    target,
    cameras,
    options,
    graph,
  );
  assert.equal(unconfirmed.origin, null);
  assert.equal(unconfirmed.suggestions.length, 0);
  assert.ok(unconfirmed.message.includes("confirmada"));
  const ambiguous = suggestCameras(
    {
      ...base,
      entries: [last, capture("other", last.payload.at, cam("apartada", 0.01))],
    },
    target,
    cameras,
    options,
    graph,
  );
  assert.equal(ambiguous.suggestions.length, 0);
  assert.ok(ambiguous.message.includes("separadas"));
  const ended = suggestCameras(
    { ...base, ends_at: last.payload.at },
    target,
    cameras,
    options,
    graph,
  );
  assert.equal(ended.suggestions.length, 0);
  assert.ok(ended.message.includes("final"));
});

test("no usa capturas de otros objetivos, borradas o posteriores sin confirmar como origen", () => {
  const newer = capture(
    "new",
    "2026-10-20T10:02:00Z",
    cam("prev", 0),
    "dudoso",
  );
  const other = {
    ...capture("other", "2026-10-20T10:03:00Z"),
    payload: {
      ...last.payload,
      at: "2026-10-20T10:03:00Z",
      target_ids: ["otro"],
    },
  };
  const deleted = {
    ...capture("deleted", "2026-10-20T10:04:00Z"),
    deleted_at: "2026-10-20T10:05:00Z",
  };
  const result = suggestCameras(
    { ...base, entries: [...base.entries, newer, other, deleted] },
    target,
    cameras,
    options,
    graph,
  );
  assert.equal(result.origin?.entry_id, "last");
  assert.equal(result.assumptions?.cautious, true);
});

test("cercanía no usa el rumbo, respeta el final del pedido y explica el origen fuera de cobertura", () => {
  const c = { ...base, ends_at: "2026-10-20T10:02:00Z" };
  const result = suggestCameras(
    c,
    target,
    cameras,
    { ...options, mode: "cercania", heading: "O", speed: 30 },
    graph,
  );
  assert.equal(result.assumptions?.heading_source, "sin dirección preferida");
  assert.ok(
    result.suggestions.every((s) => Date.parse(s.to) <= Date.parse(c.ends_at)),
  );
  assert.deepEqual(
    result.suggestions.map((s) => s.distance),
    result.suggestions.map((s) => s.distance).sort((a, b) => a - b),
  );
  const outside = suggestCameras(
    {
      ...base,
      entries: [capture("outside", last.payload.at, cam("far", 1, 1))],
    },
    target,
    cameras,
    options,
    graph,
  );
  assert.equal(outside.suggestions.length, 0);
  assert.ok(outside.message.includes("cobertura"));
});
