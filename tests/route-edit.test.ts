import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { buildRoutes } from "../server/routing.ts";
import {
  nearestSegment,
  routeLength,
  type RoutePoint,
} from "../shared/route-edit.ts";

test("trazado manual conserva puntos y estilo, respeta incertidumbre y no se hereda a otros eventos", () => {
  const target = {
    id: "target",
    kind: "persona",
    color: "#123456",
    description: "Persona",
  };
  const entry = (id: string, minute: number, point: RoutePoint) => ({
    id,
    kind: "captura",
    payload: {
      at: `2026-10-20T10:${String(minute).padStart(2, "0")}:00-03:00`,
      certainty: "confirmado",
      target_ids: [target.id],
      cameras: [{ lon: point[0], lat: point[1] }],
    },
  });
  const a = entry("a", 0, [-64.117, -32.17]),
    b = entry("b", 10, [-64.114, -32.173]);
  const coords: RoutePoint[] = [
    [-64.117, -32.17],
    [-64.12, -32.171],
    [-64.114, -32.173],
  ];
  const edit = {
    target_id: target.id,
    from_entry_id: "a",
    to_entry_id: "b",
    coordinates: coords,
    line_style: "dotted",
    version: 3,
    note: "Pasó por la paralela",
  };
  const leg = buildRoutes([target], [a, b], [], [edit])[0].legs[0];
  assert.deepEqual(leg.coordinates, coords);
  assert.equal(leg.manual, true);
  assert.equal(leg.line_style, "dotted");
  assert.equal(leg.override_version, 3);
  assert.equal(leg.distance, routeLength(coords));
  const middle = entry("middle", 5, [-64.115, -32.172]);
  assert.ok(
    buildRoutes([target], [a, middle, b], [], [edit])[0].legs.every(
      (l) => !l.manual,
    ),
  );
  const uncertain = buildRoutes(
    [target],
    [a, b],
    [
      {
        active: true,
        target_id: target.id,
        from_entry_id: "a",
        to_entry_id: "b",
        starts_at: a.payload.at,
        ends_at: b.payload.at,
        id: "note",
        reason: "Sin confirmar",
      },
    ],
    [edit],
  )[0].legs[0];
  assert.equal(uncertain.uncertain, true);
  assert.deepEqual(uncertain.coordinates, []);
  assert.equal(
    nearestSegment(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      [1.1, 0.8],
    ),
    2,
  );
});

test("editar título y tramo: permisos, validación, persistencia, informes y conflictos de versión", async (t) => {
  const db = await database(true),
    uploadDir = await mkdtemp(join(tmpdir(), "rastreo-route-test-"));
  const app = await createApp(db, { test: true, uploadDir });
  t.after(async () => {
    await app.close();
    await db.close();
    await rm(uploadDir, { recursive: true, force: true });
  });
  const dep = randomUUID(),
    foreign = randomUUID(),
    cid = randomUUID(),
    target = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  await db.query(
    "INSERT INTO departments(id,name,kind) VALUES($1,'Sala','municipal'),($2,'Otra','municipal')",
    [dep, foreign],
  );
  const users: Record<string, string> = {},
    cookies: Record<string, string> = {};
  for (const [name, role, d] of [
    ["operator", "operador", dep],
    ["requester", "externo", dep],
    ["foreign", "externo", foreign],
  ]) {
    const uid = randomUUID(),
      token = randomUUID();
    users[name] = uid;
    cookies[name] = `rastreo_session=${token}`;
    await db.query(
      "INSERT INTO users(id,name,username,password_hash,role,department_id) VALUES($1,$2,$2,'unused',$3,$4)",
      [uid, name, role, d],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [createHash("sha256").update(token).digest("hex"), uid],
    );
  }
  await db.query(
    "INSERT INTO cases(id,number,department_id,requester_id,title,description,starts_at,ends_at,status) VALUES($1,'TEST-EDIT',$2,$3,'Título original','Prueba','2026-10-20T10:00:00-03:00','2026-10-20T11:00:00-03:00','pedida')",
    [cid, dep, users.requester],
  );
  await db.query(
    "INSERT INTO targets(id,case_id,kind,description,color) VALUES($1,$2,'persona','Persona','#123456')",
    [target, cid],
  );
  const coords: RoutePoint[] = [
    [-64.117, -32.17],
    [-64.12, -32.171],
    [-64.114, -32.173],
  ];
  for (const [eid, at, p] of [
    [a, "10:00", coords[0]],
    [b, "10:10", coords[2]],
  ] as const)
    await db.query(
      "INSERT INTO entries(id,case_id,kind,payload,user_id) VALUES($1,$2,'captura',$3,$4)",
      [
        eid,
        cid,
        JSON.stringify({
          at: `2026-10-20T${at}:00-03:00`,
          certainty: "confirmado",
          camera_ids: [],
          cameras: [
            { id: randomUUID(), number: 1, name: "Demo", lon: p[0], lat: p[1] },
          ],
          target_ids: [target],
        }),
        users.operator,
      ],
    );
  const base = `/api/cases/${cid}`;
  const req = (who: string, path: string, body?: any, method: any = "PUT") =>
    app.inject({
      method,
      url: base + path,
      headers: { cookie: cookies[who], "x-requested-with": "Rastreo" },
      payload: body,
    });
  const title = {
    title: "Título corregido",
    previous_title: "Título original",
  };
  assert.equal(
    (await req("foreign", "/title", title, "PATCH")).statusCode,
    404,
  );
  assert.equal(
    (await req("requester", "/title", title, "PATCH")).statusCode,
    200,
  );
  assert.equal(
    (await req("operator", "/title", title, "PATCH")).statusCode,
    409,
  );
  const input = {
    target_id: target,
    from_entry_id: a,
    to_entry_id: b,
    coordinates: coords,
    line_style: "dotted",
    version: 0,
    note: "Visto por la paralela",
  };
  assert.equal((await req("operator", "/route", input)).statusCode, 409);
  await db.query("UPDATE cases SET status='en_curso' WHERE id=$1", [cid]);
  assert.equal(
    (
      await req(
        "requester",
        "/title",
        { title: "otro", previous_title: title.title },
        "PATCH",
      )
    ).statusCode,
    403,
  );
  assert.equal((await req("requester", "/route", input)).statusCode, 403);
  assert.equal(
    (
      await req("operator", "/route", {
        ...input,
        coordinates: [[0, 0], coords[2]],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await req("operator", "/route", { ...input, to_entry_id: randomUUID() }))
      .statusCode,
    409,
  );
  const saved = await req("operator", "/route", input);
  assert.equal(saved.statusCode, 200, saved.body);
  let report = (await req("requester", "/report", undefined, "GET")).json();
  assert.equal(report.title, title.title);
  assert.deepEqual(report.routes[0].legs[0].coordinates, coords);
  assert.equal(report.routes[0].legs[0].line_style, "dotted");
  assert.equal((await req("operator", "/route", input)).statusCode, 409);
  assert.equal(
    (
      await req("operator", "/route", {
        ...input,
        version: 1,
        line_style: "hidden",
      })
    ).statusCode,
    200,
  );
  const kml = await req("operator", "/export/kml", undefined, "GET");
  assert.equal(kml.statusCode, 200, kml.body);
  assert.ok(!kml.body.includes("<LineString>"));
  assert.equal(
    (await req("operator", "/route", { ...input, version: 2, reset: true }))
      .statusCode,
    200,
  );
  report = (await req("operator", "/report", undefined, "GET")).json();
  assert.equal(report.routes[0].legs[0].manual, false);
  assert.equal(report.routes[0].legs[0].override_version, 3);
  await db.query("UPDATE cases SET status='entregada' WHERE id=$1", [cid]);
  assert.equal(
    (await req("operator", "/route", { ...input, version: 3 })).statusCode,
    409,
  );
  assert.equal(
    (
      await req(
        "operator",
        "/title",
        { title: "Título final", previous_title: title.title },
        "PATCH",
      )
    ).statusCode,
    200,
  );
  const detail = (await req("operator", "", undefined, "GET")).json();
  assert.equal(
    detail.history.filter((h: any) => h.action === "title_updated").length,
    2,
  );
  assert.equal(
    detail.history.filter((h: any) => h.action === "route_updated").length,
    3,
  );
});
