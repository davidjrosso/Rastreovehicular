import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { caseInput } from "../server/domain.ts";
import { suggestedWindow, withinCasePeriod } from "../shared/case-period.ts";
import { periodLabel, localTime } from "../src/api.ts";

test("períodos abiertos conservan límites opcionales y consultas acotadas", () => {
  const base = {
    title: "Buscado",
    description: "Persona",
    department_id: randomUUID(),
  };
  assert.equal(caseInput.parse(base).starts_at, null);
  assert.ok(
    caseInput.safeParse({
      ...base,
      starts_at: "2026-10-20T10:00:00Z",
      ends_at: null,
    }).success,
  );
  assert.ok(
    !caseInput.safeParse({
      ...base,
      starts_at: null,
      ends_at: "2026-10-20T10:00:00Z",
    }).success,
  );
  assert.ok(
    withinCasePeriod(
      { starts_at: null, ends_at: null },
      "2026-10-20T00:00:00Z",
    ),
  );
  assert.ok(
    !withinCasePeriod(
      { starts_at: "2026-10-21T00:00:00Z", ends_at: null },
      "2026-10-20T00:00:00Z",
    ),
  );
  const window = suggestedWindow(
    { starts_at: null, ends_at: null },
    24,
    Date.parse("2026-10-30T15:00:00Z"),
  );
  assert.deepEqual(window, {
    from: "2026-10-29T15:00:00.000Z",
    to: "2026-10-30T15:00:00.000Z",
  });
  assert.equal(localTime(null), "");
  assert.match(
    periodLabel({ starts_at: null, ends_at: null }),
    /Sin fecha definida/,
  );
});

test("búsquedas sin fecha: crear, consultar, capturar, editar período y exportar sin perder registros", async (t) => {
  const db = await database(true),
    uploadDir = await mkdtemp(join(tmpdir(), "rastreo-period-"));
  let searched = 0,
    framed = 0;
  const app = await createApp(db, {
    test: true,
    uploadDir,
    evidence: {
      async search() {
        searched++;
        return {
          records: [],
          checks: [],
          incomplete: false,
          checked_at: new Date().toISOString(),
        };
      },
      async photo() {
        throw Error("No photo");
      },
      async frame(camera, at, end) {
        framed++;
        assert.ok(Date.parse(end) > Date.parse(at));
        return {
          bytes: Buffer.from([255, 216, 255, 0]),
          mime: "image/jpeg",
          source: { camera_code: camera.code, requested_at: at },
        };
      },
    },
  });
  t.after(async () => {
    await app.close();
    await db.close();
    await rm(uploadDir, { recursive: true, force: true });
  });
  const dep = randomUUID(),
    other = randomUUID(),
    operator = randomUUID(),
    external = randomUUID(),
    camera = randomUUID();
  await db.query(
    "INSERT INTO departments(id,name,kind) VALUES($1,'Sala','municipal'),($2,'Otra','municipal')",
    [dep, other],
  );
  const cookies: Record<string, string> = {};
  for (const [uid, name, role, d] of [
    [operator, "operator", "supervisor", dep],
    [external, "external", "externo", dep],
    [randomUUID(), "foreign", "externo", other],
  ]) {
    await db.query(
      "INSERT INTO users(id,name,username,password_hash,role,department_id) VALUES($1,$2,$2,'unused',$3,$4)",
      [uid, name, role, d],
    );
    const token = randomUUID();
    cookies[name] = `rastreo_session=${token}`;
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [createHash("sha256").update(token).digest("hex"), uid],
    );
  }
  await db.query(
    "INSERT INTO cameras(id,number,name,lon,lat,hik_index_code) VALUES($1,1,'Demo',-64.117,-32.17,'1')",
    [camera],
  );
  const req = (who: string, url: string, payload?: any, method: any = "POST") =>
    app.inject({
      method,
      url,
      headers: { cookie: cookies[who], "x-requested-with": "Rastreo" },
      payload,
    });
  const created = await req("external", "/api/cases", {
    title: "Persona buscada",
    description: "Sin período definido",
    department_id: dep,
    starts_at: null,
    ends_at: null,
  });
  assert.equal(created.statusCode, 200, created.body);
  const cid = created.json().id,
    base = `/api/cases/${cid}`;
  const ongoing = {
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: null,
    previous_starts_at: null,
    previous_ends_at: null,
  };
  assert.equal(
    (await req("foreign", `${base}/period`, ongoing, "PATCH")).statusCode,
    404,
  );
  assert.equal(
    (await req("external", `${base}/period`, ongoing, "PATCH")).statusCode,
    200,
  );
  assert.equal(
    (await req("operator", `${base}/period`, ongoing, "PATCH")).statusCode,
    409,
  );
  const started = await req("operator", `${base}/state`, {
    status: "en_curso",
  });
  assert.equal(started.statusCode, 200, started.body);
  assert.equal(
    (
      await req(
        "external",
        `${base}/period`,
        { ...ongoing, previous_starts_at: ongoing.starts_at },
        "PATCH",
      )
    ).statusCode,
    403,
  );
  const target = (
    await req("operator", `${base}/targets`, {
      kind: "persona",
      description: "Persona buscada",
      plate: "",
      color: "#123456",
    })
  ).json().id;
  const capture = {
    camera_ids: [camera],
    target_ids: [target],
    at: "2026-10-20T13:00:00Z",
    certainty: "confirmado",
    direction: "",
    note: "",
  };
  const saved = await req("operator", `${base}/entries/captura`, capture);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(
    (
      await req("operator", `${base}/entries/captura`, {
        ...capture,
        at: "2026-09-30T13:00:00Z",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req("operator", `${base}/entries/captura`, {
        ...capture,
        at: new Date(Date.now() + 86400000).toISOString(),
      })
    ).statusCode,
    400,
  );
  const query = {
    plate: "AA123BB",
    from: "2026-10-20T12:00:00Z",
    to: "2026-10-20T14:00:00Z",
  };
  assert.equal(
    (await req("operator", `${base}/hik/plates`, query)).statusCode,
    200,
  );
  assert.equal(searched, 1);
  assert.equal(
    (
      await req("operator", `${base}/recordings`, {
        queries: [{ camera_id: camera, from: query.from, to: query.to }],
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await req("operator", `${base}/entries/${saved.json().id}/hik/frame`, {
        camera_id: camera,
      })
    ).statusCode,
    200,
  );
  assert.equal(framed, 1);
  const shrunk = await req(
    "operator",
    `${base}/period`,
    {
      starts_at: "2026-10-21T00:00:00Z",
      ends_at: null,
      previous_starts_at: ongoing.starts_at,
      previous_ends_at: null,
    },
    "PATCH",
  );
  assert.equal(shrunk.statusCode, 409);
  const unbounded = await req(
    "operator",
    `${base}/period`,
    {
      starts_at: null,
      ends_at: null,
      previous_starts_at: ongoing.starts_at,
      previous_ends_at: null,
    },
    "PATCH",
  );
  assert.equal(unbounded.statusCode, 200, unbounded.body);
  const report = await req("external", `${base}/report`, undefined, "GET");
  assert.equal(report.statusCode, 200, report.body);
  assert.equal(report.json().starts_at, null);
  assert.equal(report.json().ends_at, null);
  assert.equal(report.json().entries.length, 1);
  const suggestions = await req("operator", `${base}/suggestions`, {
    target_id: target,
  });
  assert.equal(suggestions.statusCode, 200, suggestions.body);
  assert.ok(!suggestions.body.includes("al final de la franja"));
  for (const format of ["csv", "kml"]) {
    const exported = await req(
      "operator",
      `${base}/export/${format}`,
      undefined,
      "GET",
    );
    assert.equal(exported.statusCode, 200, exported.body);
    assert.ok(!exported.body.includes("Invalid Date"));
  }
});
