import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, csvCell, type User } from "../server/domain.ts";
import { parseKml } from "../server/cameras.ts";
import { RoadGraph, buildRoutes } from "../server/routing.ts";
import { matchesCamera, normalizeClock } from "../src/form-utils.ts";

test("las transiciones distinguen operador, supervisor y externo", () => {
  const u = { role: "operador" } as User;
  assert.equal(canTransition(u, "en_curso", "en_revision"), true);
  assert.equal(canTransition(u, "pedida", "en_curso"), false);
  assert.equal(canTransition(u, "en_revision", "entregada"), false);
  assert.equal(
    canTransition({ role: "externo" } as User, "en_curso", "en_revision"),
    false,
  );
  assert.equal(
    canTransition({ role: "supervisor" } as User, "archivada", "en_curso"),
    true,
  );
  assert.equal(
    canTransition({ role: "supervisor" } as User, "pedida", "entregada"),
    false,
  );
});

test("KML detecta prefijos, duplicados, coordenadas inválidas y entidades", () => {
  const kml =
    "<kml><Document><Folder><Placemark><name>CAM-2_A</name><Point><coordinates>-64,-32,0</coordinates></Point></Placemark><Placemark><name>CAM-2_B</name><Point><coordinates>-64.01,-32,0</coordinates></Point></Placemark><Placemark><name>Sin prefijo</name><Point><coordinates>-64,-32,0</coordinates></Point></Placemark></Folder></Document></kml>";
  const parsed = parseKml(kml);
  assert.deepEqual(parsed.duplicates, [2]);
  assert.deepEqual(parsed.invalid, ["Sin prefijo"]);
  assert.equal(parsed.cameras.length, 1);
  assert.throws(() =>
    parseKml('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///secret">]><kml/>'),
  );
  assert.throws(() => parseKml("<kml><broken>"));
});

test("CSV neutraliza fórmulas y escapa comillas", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("normal;texto"), '"normal;texto"');
  assert.equal(csvCell("  +cmd"), '"\'  +cmd"');
});

test("ruteo respeta manos, detecta contramano y rechaza puntos fuera de cobertura", () => {
  const graph = new RoadGraph({
    origin: [0, 0],
    N: [0, 0, 100, 0, 200, 0],
    names: ["Calle"],
    W: [[3, 0, 1, [0, 1, 2]]],
  });
  const forward = graph.route([0.0002, 0], [0.0018, 0]);
  assert.ok(forward);
  assert.equal(forward.contra, false);
  assert.ok(forward.distance > 140 && forward.distance < 180);
  assert.equal(graph.route([0.0018, 0], [0.0002, 0]), null);
  assert.equal(graph.route([0.0018, 0], [0.0002, 0], true)?.contra, true);
  assert.equal(
    graph.route([0.0018, 0], [0.0002, 0], false, true)?.contra,
    false,
  );
  assert.equal(graph.route([1, 1], [0.0018, 0]), null);
});

test("las capturas dudosas no se unen al recorrido", () => {
  const target = {
    id: "a",
    kind: "vehiculo",
    color: "#ffffff",
    description: "Vehículo",
  };
  const capture = (certainty: string) => ({
    id: certainty,
    kind: "captura",
    payload: {
      at: "2026-10-20T15:00:00Z",
      target_ids: ["a"],
      certainty,
      cameras: [{ lon: -64.1, lat: -32.17 }],
    },
  });
  assert.equal(
    buildRoutes([target], [capture("confirmado"), capture("dudoso")])[0].legs
      .length,
    0,
  );
});

test("búsqueda de cámaras por número y nombre sin acentos", () => {
  const cam = { number: 27, name: "CAM-027_Av_San_Martín" };
  for (const query of [
    "27",
    "027",
    "CAM-27",
    "martin",
    "san martín",
    "27 martin",
    "",
  ])
    assert.ok(matchesCamera(cam, query), query);
  assert.equal(matchesCamera(cam, "28"), false);
  assert.equal(matchesCamera(cam, "plaza"), false);
  assert.ok(
    matchesCamera({ number: 123, name: "CAM-123_25_de_Mayo" }, "25 de mayo"),
  );
});

test("hora escrita admite minutos o segundos y rechaza horas inválidas", () => {
  assert.equal(normalizeClock("09:31"), "09:31:00");
  assert.equal(normalizeClock("23:59:59"), "23:59:59");
  for (const clock of ["24:00", "12:60", "12:00:60", "9:1", "", "12:"])
    assert.equal(normalizeClock(clock), "");
});

test("incertidumbre conserva capturas y se aplica a tramos intermedios sin afectar otros objetivos", () => {
  const targets = ["a", "b"].map((id) => ({
    id,
    kind: "vehiculo",
    color: "#ffffff",
    description: id,
  }));
  const capture = (id: string, minutes: string) => ({
    id,
    kind: "captura",
    payload: {
      at: `2026-10-20T15:${minutes}:00Z`,
      target_ids: ["a", "b"],
      certainty: "confirmado",
      cameras: [{ lon: -64.117, lat: -32.175 }],
    },
  });
  const entries = [
    capture("start", "00"),
    capture("middle", "10"),
    capture("end", "20"),
    capture("after", "30"),
  ];
  const note = {
    id: "note",
    active: true,
    target_id: "a",
    from_entry_id: "start",
    to_entry_id: "end",
    starts_at: entries[0].payload.at,
    ends_at: entries[2].payload.at,
    reason: "Demora no explicada",
  };
  const routes = buildRoutes(targets, entries, [note]);
  assert.deepEqual(
    routes[0].legs.map((l) => l.uncertain),
    [true, true, false],
  );
  for (const leg of routes[0].legs.slice(0, 2)) {
    assert.deepEqual(leg.coordinates, []);
    assert.equal(leg.distance, null);
    assert.equal(leg.speed, null);
    assert.equal(leg.elapsed, 600);
    assert.equal(leg.notes[0].reason, note.reason);
  }
  assert.ok(routes[1].legs.every((l) => !l.uncertain));
  assert.ok(
    buildRoutes(targets, entries, [{ ...note, active: false }])[0].legs.every(
      (l) => !l.uncertain,
    ),
  );
  // Removing one of the original endpoints must not silently certify the remaining interval.
  assert.ok(
    buildRoutes(targets, entries.slice(1), [note])[0].legs[0].uncertain,
  );
  assert.equal(entries[0].payload.certainty, "confirmado");
});
