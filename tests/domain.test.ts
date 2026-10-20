import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, csvCell, type User } from "../server/domain.ts";
import { parseKml } from "../server/cameras.ts";
import { RoadGraph, buildRoutes } from "../server/routing.ts";

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
