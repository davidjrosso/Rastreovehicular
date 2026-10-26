import { createHash, createHmac, randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import { importCameras } from "./cameras.ts";

export type Health = "online" | "offline" | "unknown";
type Source = "mymaps" | "hikcentral";
export type IntegrationConfig = {
  mapId?: string;
  hikUrl?: string;
  key?: string;
  secret?: string;
  mappings?: Record<string, string>;
  mapInterval: number;
  hikInterval: number;
};
export function integrationConfig(env = process.env): IntegrationConfig {
  const seconds = (
    value: string | undefined,
    fallback: number,
    minimum: number,
  ) => {
    const n = Number(value);
    return (
      (Number.isFinite(n) && n >= minimum ? Math.min(n, 86400) : fallback) *
      1000
    );
  };
  let mappings: Record<string, string> | undefined;
  if (env.HIK_CAMERA_MAPPING) {
    try {
      const parsed = JSON.parse(env.HIK_CAMERA_MAPPING);
      if (
        !parsed ||
        Array.isArray(parsed) ||
        typeof parsed !== "object" ||
        Object.entries(parsed).some(
          ([n, code]) =>
            !/^\d+$/.test(n) ||
            typeof code !== "string" ||
            !code ||
            code.length > 64,
        ) ||
        new Set(Object.values(parsed)).size !== Object.keys(parsed).length
      )
        throw new Error();
      mappings = parsed;
    } catch {
      throw new Error(
        "HIK_CAMERA_MAPPING debe ser un objeto JSON con números de cámara e identificadores únicos.",
      );
    }
  }
  return {
    mapId: env.MY_MAPS_ID?.trim(),
    hikUrl: env.HIK_OPENAPI_URL?.trim(),
    key: env.HIK_APP_KEY?.trim(),
    secret: env.HIK_APP_SECRET?.trim(),
    mappings,
    mapInterval: seconds(env.MY_MAPS_INTERVAL_SECONDS, 300, 60),
    hikInterval: seconds(env.HIK_INTERVAL_SECONDS, 60, 30),
  };
}

// Only these messages are returned to the browser; remote bodies and credentials stay private.
class IntegrationError extends Error {}
const problem = (message: string): never => {
  throw new IntegrationError(message);
};

async function boundedText(response: Response, maxBytes = 5 * 1024 * 1024) {
  if (!response.ok) {
    await response.body?.cancel();
    return problem(
      `El servicio respondió HTTP ${response.status}. Revisá la dirección y los permisos.`,
    );
  }
  if (!response.body)
    return problem("El servicio devolvió una respuesta vacía.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes)
        return problem("La respuesta excede el tamaño permitido.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function hikHeaders(
  path: string,
  body: string,
  key: string,
  secret: string,
  timestamp = Date.now(),
  nonce: string = randomUUID(),
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-MD5": createHash("md5").update(body).digest("base64"),
    "Content-Type": "application/json",
    Date: new Date(timestamp).toUTCString(),
    "x-ca-key": key,
    "x-ca-nonce": nonce,
    "x-ca-timestamp": String(timestamp),
  };
  const names = ["x-ca-key", "x-ca-nonce", "x-ca-timestamp"];
  const canonical = [
    "POST",
    headers.Accept,
    headers["Content-MD5"],
    headers["Content-Type"],
    headers.Date,
    ...names.map((n) => `${n}:${headers[n]}`),
    path,
  ].join("\n");
  headers["x-ca-signature-headers"] = names.join(",");
  headers["x-ca-signature"] = createHmac("sha256", secret)
    .update(canonical)
    .digest("base64");
  return headers;
}

export type HikCamera = {
  cameraIndexCode: string;
  cameraName: string;
  status: number;
};
export async function fetchHikCameras(
  config: IntegrationConfig,
  fetcher = fetch,
): Promise<HikCamera[]> {
  let url: URL;
  try {
    url = new URL(config.hikUrl || "");
  } catch {
    return problem("Configurá la dirección HTTPS de OpenAPI.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/artemis", "/artemis/"].includes(url.pathname)
  )
    return problem(
      "OpenAPI requiere una dirección HTTPS, con puerto si corresponde, sin usuario ni rutas del portal.",
    );
  const path = "/artemis/api/resource/v1/cameras";
  url.pathname = path;
  const signal = AbortSignal.timeout(45000);
  const cameras: HikCamera[] = [];
  const codes = new Set<string>();
  let expectedTotal: number | undefined;
  for (let pageNo = 1; pageNo <= 100; pageNo++) {
    const body = JSON.stringify({ pageNo, pageSize: 500, bRecordSetting: 0 });
    const response = await fetcher(url, {
      method: "POST",
      redirect: "error",
      signal,
      body,
      headers: hikHeaders(path, body, config.key!, config.secret!),
    });
    let result: any;
    try {
      result = JSON.parse(await boundedText(response));
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      return problem("OpenAPI no devolvió JSON válido.");
    }
    if (result?.code !== "0")
      return problem(
        "OpenAPI rechazó la consulta. Revisá AppKey, AppSecret y permisos del usuario asociado.",
      );
    const data = result.data;
    if (
      !data ||
      !Number.isInteger(data.total) ||
      data.total < 0 ||
      data.total > 50000 ||
      data.pageNo !== pageNo ||
      data.pageSize !== 500 ||
      !Array.isArray(data.list) ||
      data.list.length > 500 ||
      (expectedTotal !== undefined && expectedTotal !== data.total)
    )
      return problem(
        "OpenAPI devolvió un catálogo incompleto o inconsistente; se conservan los estados anteriores.",
      );
    expectedTotal = data.total as number;
    for (const camera of data.list) {
      if (
        !camera ||
        typeof camera.cameraIndexCode !== "string" ||
        !camera.cameraIndexCode ||
        camera.cameraIndexCode.length > 64 ||
        typeof camera.cameraName !== "string" ||
        ![0, 1, 2].includes(camera.status) ||
        codes.has(camera.cameraIndexCode)
      )
        return problem(
          "OpenAPI devolvió cámaras inválidas o repetidas; se conservan los estados anteriores.",
        );
      codes.add(camera.cameraIndexCode);
      cameras.push({
        cameraIndexCode: camera.cameraIndexCode,
        cameraName: camera.cameraName,
        status: camera.status,
      });
    }
    if (cameras.length === expectedTotal) return cameras;
    if (!data.list.length || cameras.length > expectedTotal)
      return problem(
        "OpenAPI devolvió una página incompleta; se conservan los estados anteriores.",
      );
  }
  return problem("El catálogo supera el límite de páginas permitido.");
}

export async function applyHikSnapshot(
  db: DB,
  remote: HikCamera[],
  mappings: Record<string, string> = {},
) {
  const byNumber = new Map<number, HikCamera[]>();
  const byCode = new Map(remote.map((c) => [c.cameraIndexCode, c]));
  for (const camera of remote) {
    const match = camera.cameraName.match(/^CAM[-_ ]?(\d+)(?!\d)/i);
    if (!match) continue;
    const n = Number(match[1]);
    byNumber.set(n, [...(byNumber.get(n) || []), camera]);
  }
  const reserved = new Set(Object.values(mappings));
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(20261022)");
    const cameras = (
      await tx.query("SELECT id,number FROM cameras WHERE active=true")
    ).rows;
    const summary = {
      total: remote.length,
      matched: 0,
      online: 0,
      offline: 0,
      unknown: 0,
      unmapped: 0,
      ambiguous: [] as number[],
    };
    for (const camera of cameras) {
      const matches = byNumber.get(camera.number) || [];
      const explicit = mappings[String(camera.number)];
      const match = explicit
        ? byCode.get(explicit)
        : matches.length === 1 && !reserved.has(matches[0].cameraIndexCode)
          ? matches[0]
          : undefined;
      if (!explicit && matches.length > 1)
        summary.ambiguous.push(camera.number);
      const health: Health =
        match?.status === 1
          ? "online"
          : match?.status === 2
            ? "offline"
            : "unknown";
      summary[health]++;
      if (match) summary.matched++;
      else summary.unmapped++;
      await tx.query(
        "UPDATE cameras SET health_status=$2,health_checked_at=now(),hik_index_code=$3 WHERE id=$1",
        [camera.id, health, match?.cameraIndexCode || null],
      );
    }
    return summary;
  });
}

export function cameraHealth(
  camera: Record<string, any>,
  ttl: number,
  enabled: boolean,
  now = Date.now(),
) {
  const checked = camera.health_checked_at
    ? new Date(camera.health_checked_at).getTime()
    : NaN;
  const fresh =
    enabled &&
    Number.isFinite(checked) &&
    now - checked <= ttl &&
    checked <= now + 5000;
  return {
    ...camera,
    health_status: fresh ? camera.health_status : "unknown",
    health_expires_at: fresh ? new Date(checked + ttl).toISOString() : null,
  };
}

export function cameraIntegrations(
  db: DB,
  config: IntegrationConfig,
  changed: () => void,
  fetcher = fetch,
) {
  const configured = {
    mymaps: !!config.mapId,
    hikcentral: !!(config.hikUrl && config.key && config.secret),
  };
  const intervals = {
    mymaps: config.mapInterval,
    hikcentral: config.hikInterval,
  };
  const running = new Map<Source, Promise<void>>();
  const timers: ReturnType<typeof setInterval>[] = [];
  let closed = false;
  async function sync(source: Source) {
    await db.query(
      `INSERT INTO camera_integrations(source,last_attempt) VALUES($1,now())
      ON CONFLICT(source) DO UPDATE SET last_attempt=now()`,
      [source],
    );
    try {
      let summary: unknown;
      if (source === "mymaps") {
        if (!/^[\w-]{10,200}$/.test(config.mapId!))
          problem("El identificador de My Maps no es válido.");
        const response = await fetcher(
          `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(config.mapId!)}&forcekml=1`,
          { signal: AbortSignal.timeout(20000), redirect: "error" },
        );
        const kml = await boundedText(response);
        try {
          summary = await importCameras(db, kml, null, true, true);
        } catch (error) {
          // Import errors are authored locally, never include the remote XML.
          if ((error as any).statusCode === 400)
            problem((error as Error).message);
          throw error;
        }
      } else
        summary = await applyHikSnapshot(
          db,
          await fetchHikCameras(config, fetcher),
          config.mappings,
        );
      await db.query(
        "UPDATE camera_integrations SET last_success=now(),last_error=NULL,summary=$2 WHERE source=$1",
        [source, JSON.stringify(summary)],
      );
    } catch (error) {
      const message =
        error instanceof IntegrationError
          ? error.message
          : "No se pudo completar la consulta. Revisá conectividad, certificado y configuración del servicio. Se conserva la última información.";
      await db.query(
        "UPDATE camera_integrations SET last_error=$2 WHERE source=$1",
        [source, message],
      );
    } finally {
      changed();
    }
  }
  function run(source: Source) {
    if (closed || !configured[source]) return Promise.resolve();
    const existing = running.get(source);
    if (existing) return existing;
    const job = sync(source).finally(() => {
      running.delete(source);
    });
    running.set(source, job);
    return job;
  }
  return {
    configured,
    health: (camera: Record<string, any>) =>
      cameraHealth(
        camera,
        Math.max(180000, config.hikInterval * 3),
        configured.hikcentral,
      ),
    run,
    async status() {
      const rows = (await db.query("SELECT * FROM camera_integrations")).rows;
      return (["mymaps", "hikcentral"] as Source[]).map((source) => {
        const row = rows.find((row) => row.source === source);
        return {
          source,
          last_attempt: row?.last_attempt || null,
          last_success: row?.last_success || null,
          last_error: row?.last_error || null,
          summary: row?.summary || {},
          configured: configured[source],
          running: running.has(source),
          interval_seconds: intervals[source] / 1000,
        };
      });
    },
    start() {
      for (const source of ["mymaps", "hikcentral"] as Source[])
        if (configured[source]) {
          const trigger = () => {
            void run(source).catch(() => {
              /* Database unavailable: retry next interval. */
            });
          };
          trigger();
          const timer = setInterval(trigger, intervals[source]);
          timer.unref();
          timers.push(timer);
        }
    },
    async close() {
      closed = true;
      timers.forEach(clearInterval);
      await Promise.allSettled(running.values());
    },
  };
}
