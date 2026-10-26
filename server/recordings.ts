import { z } from "zod";
import {
  IntegrationError,
  hikRequest,
  type IntegrationConfig,
} from "./integrations.ts";

const date = z.iso.datetime({ offset: true });
export const recordingInput = z.object({
  queries: z
    .array(
      z
        .object({
          camera_id: z.uuid(),
          from: date,
          to: date,
        })
        .refine(
          (q) =>
            Date.parse(q.to) > Date.parse(q.from) &&
            Date.parse(q.to) - Date.parse(q.from) <= 72 * 3600000,
          "Seleccioná una franja de hasta 72 horas, con el final posterior al inicio.",
        ),
    )
    .min(1)
    .max(20),
});
export type RecordingQuery = z.infer<typeof recordingInput>["queries"][number];
export type RecordingInterval = { from: string; to: string };
export type RecordingResult = RecordingQuery & {
  status: "complete" | "partial" | "none" | "unknown";
  intervals: RecordingInterval[];
  gaps: RecordingInterval[];
  checked_at: string;
  reason?: string;
  record_type: "0" | "1";
};

export function recordingCoverage(
  from: string,
  to: string,
  segments: RecordingInterval[],
) {
  const start = Date.parse(from),
    end = Date.parse(to);
  const sorted = segments
    .map((s) => [
      Math.max(start, Date.parse(s.from)),
      Math.min(end, Date.parse(s.to)),
    ])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [a, b] of sorted) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const gaps: number[][] = [];
  let cursor = start;
  for (const [a, b] of merged) {
    if (a > cursor) gaps.push([cursor, a]);
    cursor = b;
  }
  if (cursor < end) gaps.push([cursor, end]);
  const interval = ([a, b]: number[]) => ({
    from: new Date(a).toISOString(),
    to: new Date(b).toISOString(),
  });
  return {
    status: (!merged.length
      ? "none"
      : gaps.length
        ? "partial"
        : "complete") as RecordingResult["status"],
    intervals: merged.map(interval),
    gaps: gaps.map(interval),
  };
}

export async function fetchRecordingIntervals(
  config: IntegrationConfig,
  cameraCode: string,
  from: string,
  to: string,
  fetcher = fetch,
) {
  // Some HCP installations reject Z and milliseconds despite accepting ISO offsets.
  // Expand to whole seconds for the request; coverage is clipped to the original interval.
  const hikTime = (value: string, end = false) =>
    new Date((end ? Math.ceil : Math.floor)(Date.parse(value) / 1000) * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "+00:00");
  const segments: RecordingInterval[] = [];
  const pages = new Set<string>();
  let uuid: string | undefined;
  const signal = AbortSignal.timeout(25000);
  for (let page = 0; page < 50; page++) {
    const data = await hikRequest(
      config,
      "/artemis/api/video/v1/cameras/playbackURLs",
      {
        cameraIndexCode: cameraCode,
        recordType: config.recordType || "0",
        protocol: "rtsp",
        transmode: 1,
        beginTime: hikTime(from),
        endTime: hikTime(to, true),
        mergeSegment: 0,
        ...(uuid ? { uuid } : {}),
      },
      signal,
      fetcher,
    );
    // A URL alone does not prove recording coverage. Never retain URLs or streaming authentication.
    if (
      !data ||
      !Array.isArray(data.list) ||
      data.list.length > 10000 ||
      (data.uuid != null &&
        (typeof data.uuid !== "string" || data.uuid.length > 64))
    )
      throw new IntegrationError(
        "HikCentral no devolvió intervalos verificables de grabación.",
      );
    const current: RecordingInterval[] = [];
    for (const segment of data.list) {
      if (
        !segment ||
        !date.safeParse(segment.beginTime).success ||
        !date.safeParse(segment.endTime).success ||
        Date.parse(segment.endTime) <= Date.parse(segment.beginTime)
      )
        throw new IntegrationError(
          "HikCentral devolvió intervalos inválidos; no se puede confirmar la cobertura.",
        );
      current.push({ from: segment.beginTime, to: segment.endTime });
    }
    if (!current.length) return segments;
    const fingerprint = JSON.stringify(current);
    if (pages.has(fingerprint))
      throw new IntegrationError(
        "La búsqueda de grabaciones repitió una página; la cobertura no está verificada.",
      );
    pages.add(fingerprint);
    segments.push(...current);
    if (segments.length > 10000)
      throw new IntegrationError(
        "Demasiados fragmentos. Consultá una franja más corta.",
      );
    uuid = data.uuid && data.uuid !== "null" ? data.uuid : undefined;
    if (!uuid) return segments;
  }
  throw new IntegrationError(
    "La búsqueda de grabaciones quedó incompleta. Consultá una franja más corta.",
  );
}

export function recordingService(config: IntegrationConfig, fetcher = fetch) {
  // Bounded queue and concurrency protect HikCentral when several operators check cameras together.
  let active = 0;
  const queue: (() => void)[] = [];
  const cache = new Map<string, { expires: number; result: RecordingResult }>();
  const pending = new Map<string, Promise<RecordingResult>>();
  async function acquire() {
    if (active >= 3) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
  }
  function release() {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
  function unknown(query: RecordingQuery, reason: string): RecordingResult {
    return {
      ...query,
      status: "unknown",
      intervals: [],
      gaps: [],
      checked_at: new Date().toISOString(),
      reason,
      record_type: config.recordType || "0",
    };
  }
  return {
    async check(
      query: RecordingQuery,
      camera: Record<string, any>,
    ): Promise<RecordingResult> {
      if (!(config.hikUrl && config.key && config.secret))
        return unknown(query, "OpenAPI todavía no está configurada.");
      const code =
        config.mappings?.[String(camera.number)] || camera.hik_index_code;
      if (!code)
        return unknown(
          query,
          "La cámara todavía no tiene una correspondencia verificada en HikCentral.",
        );
      if (Date.parse(query.to) > Date.now())
        return unknown(
          query,
          "La franja incluye horas futuras. Elegí un período ya transcurrido.",
        );
      const key = JSON.stringify([query, code]);
      const hit = cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.result;
      const existing = pending.get(key);
      if (existing) return existing;
      if (pending.size >= 60)
        return unknown(
          query,
          "Hay muchas consultas en curso. Volvé a intentar en unos segundos.",
        );
      const job = (async () => {
        const queuedAt = Date.now();
        await acquire();
        let result: RecordingResult;
        try {
          if (Date.now() - queuedAt > 20000)
            throw new IntegrationError(
              "La consulta quedó en espera. Volvé a intentar con menos cámaras.",
            );
          const segments = await fetchRecordingIntervals(
            config,
            code,
            query.from,
            query.to,
            fetcher,
          );
          result = {
            ...query,
            ...recordingCoverage(query.from, query.to, segments),
            checked_at: new Date().toISOString(),
            record_type: config.recordType || "0",
          };
        } catch (error) {
          result = unknown(
            query,
            error instanceof IntegrationError
              ? error.message
              : "No se pudo consultar el almacenamiento. Esto no demuestra que no haya grabación.",
          );
        } finally {
          release();
        }
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(key, {
          expires: Date.now() + (result.status === "unknown" ? 10000 : 30000),
          result,
        });
        return result;
      })().finally(() => pending.delete(key));
      pending.set(key, job);
      return job;
    },
  };
}
