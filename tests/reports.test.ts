import { test } from "node:test";
import assert from "node:assert/strict";
import { reportModel } from "../src/report-model.ts";

const at = (hour: string) => `2026-10-20T${hour}:00-03:00`;
const camera = {
  id: "camera-a",
  number: 1,
  name: "Ubicación histórica",
  lon: -64.12,
  lat: -32.17,
};
const capture = (
  id: string,
  time: string,
  certainty: string,
  target = "a",
) => ({
  id,
  kind: "captura",
  payload: { at: at(time), certainty, target_ids: [target], cameras: [camera] },
});
test("informe distingue certeza, ordena por hora del hecho y usa posiciones históricas", () => {
  const data = {
    targets: [
      { id: "a", description: "Vehículo" },
      { id: "b", description: "Peatón" },
    ],
    entries: [
      capture("late", "11:00", "probable"),
      capture("first", "10:00", "confirmado"),
      capture("doubt", "10:30", "dudoso"),
      { ...capture("deleted", "09:00", "confirmado"), deleted_at: at("12:00") },
      capture("other", "09:50", "confirmado", "b"),
      { id: "note", kind: "aporte", payload: { text: "Sin hora" } },
      {
        id: "place",
        kind: "aporte",
        payload: {
          text: "Cámara particular",
          place_kind: "camara_particular",
          at: at("10:20"),
          lon: -64.11,
          lat: -32.18,
        },
      },
      { id: "chat", kind: "mensaje", payload: { text: "No incluir chat" } },
      {
        id: "review",
        kind: "revision",
        payload: {
          camera_id: camera.id,
          target_id: null,
          from: at("09:00"),
          to: at("09:20"),
        },
      },
    ],
    route_notes: [
      { id: "uncertain", target_id: "a", active: true, reason: "Demora" },
      { id: "inactive", target_id: "a", active: false },
    ],
    routes: [
      {
        target_id: "a",
        legs: [
          {
            from: "first",
            to: "late",
            uncertain: true,
            coordinates: [],
            warning: "Demora",
          },
        ],
      },
    ],
    attachments: [
      { id: "photo", entry_id: "first" },
      { id: "deleted-photo", entry_id: "deleted" },
    ],
  };
  const m = reportModel(data, "a");
  assert.equal(m.confirmed.length, 1);
  assert.equal(m.captures.length, 3);
  assert.deepEqual(
    m.timeline.map((e) => e.id),
    ["first", "place", "doubt", "late", "note"],
  );
  assert.equal(m.points[0].lon, camera.lon);
  assert.equal(m.points[0].sequence, 1);
  assert.equal(m.points[1].sequence, 2);
  assert.equal(m.reviewedCameras, 1);
  assert.equal(m.notes.length, 1);
  assert.equal(m.warnings[0].fromNumber, 1);
  assert.equal(m.warnings[0].toNumber, 4);
  assert.deepEqual(
    m.attachments.map((a) => a.id),
    ["photo"],
  );
  assert.equal(m.pending.length, 3);
  assert.equal(reportModel(data).confirmed.length, 2);
});

test("informe vacío y filtro por objetivo no inventan hallazgos ni revisiones", () => {
  const data = {
    targets: [
      { id: "a", description: "Auto" },
      { id: "b", description: "Persona" },
    ],
    entries: [
      {
        id: "review-b",
        kind: "revision",
        payload: {
          camera_id: "c",
          target_id: "b",
          from: at("09:00"),
          to: at("10:00"),
        },
      },
    ],
  };
  const m = reportModel(data, "a");
  assert.equal(m.confirmed.length, 0);
  assert.equal(m.reviews.length, 0);
  assert.equal(m.points.length, 0);
  assert.deepEqual(m.pending, [
    "Auto: sin apariciones confirmadas registradas.",
  ]);
});
