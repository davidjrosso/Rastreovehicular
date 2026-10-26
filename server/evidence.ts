import { z } from "zod";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import {
  hikRequest,
  hikHeaders,
  IntegrationError,
  type IntegrationConfig,
} from "./integrations.ts";
import { recordingCoverage } from "./recordings.ts";

const date = z.iso.datetime({ offset: true });
export const normalizePlate = (s: string) =>
  s.toUpperCase().replace(/[\s-]/g, "");
export const plateInput = z
  .object({
    plate: z
      .string()
      .trim()
      .transform(normalizePlate)
      .pipe(
        z
          .string()
          .regex(
            /^[A-Z0-9]{3,16}$/,
            "Escribí una patente completa, sin comodines.",
          ),
      ),
    from: date,
    to: date,
  })
  .refine(
    (v) =>
      Date.parse(v.to) > Date.parse(v.from) &&
      Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
    "Consultá un período de hasta 31 días.",
  );
export type PlateInput = z.infer<typeof plateInput>;
export type PlateRecord = {
  event_id: string;
  camera_code: string;
  camera_name: string;
  plate: string;
  at: string;
  pic_uri?: string;
};
export type EvidenceImage = {
  bytes: Buffer;
  mime: string;
  source: Record<string, any>;
};
export const hikTime = (s: string) =>
  new Date(Math.floor(Date.parse(s) / 1000) * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
const problem = (message: string): never => {
  throw new IntegrationError(message);
};

export async function boundedBytes(response: Response, limit: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return problem(
      `No se pudo descargar el archivo (HTTP ${response.status}).`,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        return problem(
          "El archivo supera el tamaño permitido. Probá otra hora.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
export function imageMime(bytes: Buffer) {
  if (
    bytes.length > 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  return problem(
    "HikCentral no devolvió una imagen JPEG o PNG válida. Revisá los permisos de imágenes y su retención.",
  );
}

// Never follow the host, credentials, query or redirects of a returned download URL.
// HCP can return https://:443/download/video/... with an empty host. The download
// endpoint is served on the configured OpenAPI host, so only its bounded path is used.
export function downloadLocation(raw: unknown, origin: string) {
  if (typeof raw !== "string")
    return problem("HikCentral no entregó la dirección de la grabación.");
  const match = raw.match(
    /^(?:https?:\/\/[^/?#]*)?(\/download\/(?:video\/)?[A-Za-z0-9_-]{1,180}\.mp4)$/,
  );
  if (!match)
    return problem("La dirección de descarga de HikCentral no es compatible.");
  return new URL(match[1], new URL(origin).origin);
}

export async function extractFrame(video: Buffer) {
  if (!ffmpegPath)
    return problem("FFmpeg no está disponible en este servidor.");
  const dir = await mkdtemp(join(tmpdir(), "rastreo-frame-"));
  try {
    const input = join(dir, "clip.mp4"),
      output = join(dir, "frame.jpg");
    await writeFile(input, video, { mode: 0o600 });
    await promisify(execFile)(
      ffmpegPath,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file",
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        "scale=w='min(1920,iw)':h=-2",
        "-q:v",
        "2",
        output,
      ],
      { timeout: 20000, maxBuffer: 65536, windowsHide: true },
    );
    return await readFile(output);
  } catch {
    return problem(
      "No se pudo extraer una imagen de esa grabación. Probá unos segundos antes o después.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function evidenceService(
  config: IntegrationConfig,
  fetcher = fetch,
  extractor = extractFrame,
) {
  let active = 0;
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (!(config.hikUrl && config.key && config.secret))
      return problem("OpenAPI no está configurada.");
    if (active >= 2)
      return problem(
        "Hay dos consultas de imágenes o patentes en curso. Volvé a intentar en unos segundos.",
      );
    active++;
    try {
      return await fn();
    } catch (e) {
      if (e instanceof IntegrationError) throw e;
      return problem(
        "HikCentral no pudo completar la consulta. Revisá conectividad, permisos y retención; esto no prueba que no haya registros.",
      );
    } finally {
      active--;
    }
  }
  const call = (path: string, body: unknown, signal: AbortSignal) =>
    hikRequest(config, path, body, signal, fetcher);
  return {
    search(input: PlateInput) {
      return run(async () => {
        const signal = AbortSignal.timeout(90000);
        const cameras: { cameraIndexCode: string; cameraName: string }[] = [];
        const seen = new Set<string>();
        for (let page = 1; page <= 20; page++) {
          const d = await call(
            "/artemis/api/resource/v1/cameras",
            { pageNo: page, pageSize: 500 },
            signal,
          );
          if (
            !Array.isArray(d?.list) ||
            !Number.isInteger(d.total) ||
            d.total < 0 ||
            d.list.length > 500
          )
            return problem("El catálogo de cámaras ANPR no es válido.");
          for (const c of d.list) {
            if (
              typeof c.cameraIndexCode !== "string" ||
              seen.has(c.cameraIndexCode)
            )
              return problem(
                "El catálogo de cámaras está incompleto o repite páginas.",
              );
            seen.add(c.cameraIndexCode);
            if (
              /event_veh/.test(String(c.capabilitySet)) &&
              typeof c.cameraName === "string"
            )
              cameras.push(c);
          }
          if (seen.size >= d.total) break;
          if (!d.list.length || page === 20)
            return problem("El catálogo excede el límite de consulta.");
        }
        if (!cameras.length)
          return problem(
            "HikCentral no informó cámaras con lectura de patentes habilitada.",
          );
        const records: PlateRecord[] = [],
          checks: { camera_name: string; status: string; reason?: string }[] =
            [];
        let capped = false;
        for (const camera of cameras.slice(0, 32)) {
          let scanned = 0;
          const ids = new Set<string>();
          let complete = false;
          try {
            for (let page = 1; page <= 5; page++) {
              const d = await call(
                "/artemis/api/pms/v1/crossRecords/page",
                {
                  cameraIndexCode: camera.cameraIndexCode,
                  plateNo: input.plate,
                  startTime: hikTime(input.from),
                  endTime: hikTime(input.to),
                  pageNo: page,
                  pageSize: 100,
                },
                signal,
              );
              if (
                !Number.isInteger(d?.total) ||
                d.total < 0 ||
                (!Array.isArray(d.list) && d.total !== 0)
              )
                throw new Error();
              const list = d.list || [];
              if (list.length > 100) throw new Error();
              for (const r of list) {
                if (
                  typeof r.crossRecordSyscode !== "string" ||
                  r.crossRecordSyscode.length > 128 ||
                  ids.has(r.crossRecordSyscode) ||
                  r.cameraIndexCode !== camera.cameraIndexCode ||
                  !date.safeParse(r.crossTime).success ||
                  typeof r.plateNo !== "string"
                )
                  throw new Error();
                ids.add(r.crossRecordSyscode);
                scanned++;
                // HCP versions may match substrings; the application's search is exact.
                if (
                  normalizePlate(r.plateNo) !== input.plate ||
                  Date.parse(r.crossTime) < Date.parse(input.from) ||
                  Date.parse(r.crossTime) > Date.parse(input.to)
                )
                  continue;
                if (records.length >= 500) {
                  capped = true;
                  break;
                }
                records.push({
                  event_id: r.crossRecordSyscode,
                  camera_code: camera.cameraIndexCode,
                  camera_name: camera.cameraName.slice(0, 250),
                  plate: r.plateNo.slice(0, 30),
                  at: r.crossTime,
                  ...(typeof r.vehiclePicUri === "string" &&
                  r.vehiclePicUri.length <= 1024
                    ? { pic_uri: r.vehiclePicUri }
                    : {}),
                });
              }
              if (scanned >= d.total && !capped) {
                complete = true;
                break;
              }
              if (!list.length || records.length >= 500) break;
            }
            checks.push({
              camera_name: camera.cameraName,
              status: complete ? "complete" : "partial",
              ...(!complete
                ? {
                    reason:
                      "Se alcanzó el límite de resultados; acotá el período.",
                  }
                : {}),
            });
          } catch {
            checks.push({
              camera_name: camera.cameraName,
              status: "error",
              reason: "No se pudo completar la consulta de esta cámara.",
            });
          }
        }
        return {
          records: records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
          checks,
          incomplete:
            capped ||
            cameras.length > 32 ||
            checks.some((c) => c.status !== "complete"),
          checked_at: new Date().toISOString(),
        };
      });
    },
    photo(record: PlateRecord) {
      return run(async (): Promise<EvidenceImage> => {
        if (!record.pic_uri)
          return problem("Esta lectura no tiene una foto disponible.");
        const path = "/artemis/api/pms/v1/image",
          body = JSON.stringify({ picUri: record.pic_uri });
        const response = await fetcher(new URL(path, config.hikUrl), {
          method: "POST",
          body,
          headers: hikHeaders(path, body, config.key!, config.secret!),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        const bytes = await boundedBytes(response, 10 * 1024 * 1024);
        return {
          bytes,
          mime: imageMime(bytes),
          source: {
            kind: "hik_anpr",
            camera_code: record.camera_code,
            camera_name: record.camera_name,
            event_id: record.event_id,
            plate: record.plate,
            at: record.at,
            obtained_at: new Date().toISOString(),
          },
        };
      });
    },
    frame(camera: { code: string; name: string }, at: string, end: string) {
      return run(async (): Promise<EvidenceImage> => {
        const signal = AbortSignal.timeout(110000),
          beginTime = hikTime(at),
          endTime = hikTime(end);
        const d = await call(
          "/artemis/api/video/v1/cameras/playbackURLs",
          {
            cameraIndexCode: camera.code,
            recordType: config.recordType || "0",
            protocol: "rtsp",
            transmode: 1,
            beginTime,
            endTime,
            mergeSegment: 0,
          },
          signal,
        );
        if (
          !Array.isArray(d?.list) ||
          typeof d.url !== "string" ||
          typeof d.authentication !== "string"
        )
          return problem(
            "No se obtuvo una grabación reproducible para esa hora.",
          );
        const coverage = recordingCoverage(
          beginTime,
          new Date(Date.parse(beginTime) + 1000).toISOString(),
          d.list
            .filter(
              (s: any) =>
                date.safeParse(s?.beginTime).success &&
                date.safeParse(s?.endTime).success,
            )
            .map((s: any) => ({ from: s.beginTime, to: s.endTime })),
        );
        if (coverage.status !== "complete")
          return problem(
            "No hay un fragmento verificable que cubra el segundo solicitado. Probá otra hora.",
          );
        const job = await call(
          "/artemis/api/video/v1/download",
          {
            url: d.url,
            authentication: d.authentication,
            beginTime,
            endTime,
            videoType: 1,
          },
          signal,
        );
        if (typeof job?.downloadID !== "string" || job.downloadID.length > 64)
          return problem("HikCentral no pudo preparar la grabación.");
        for (let i = 0; i < 45; i++) {
          const status = await call(
            "/artemis/api/video/v1/downloadURL",
            { downloadID: job.downloadID },
            signal,
          );
          if (Number(status?.percent) >= 100 && status.url) {
            const url = downloadLocation(status.url, config.hikUrl!);
            const response = await fetcher(url, { redirect: "error", signal });
            const video = await boundedBytes(response, 30 * 1024 * 1024);
            const bytes = await extractor(video);
            return {
              bytes,
              mime: imageMime(bytes),
              source: {
                kind: "hik_recording",
                camera_code: camera.code,
                camera_name: camera.name,
                requested_at: beginTime,
                clip_end: endTime,
                record_type: config.recordType || "0",
                timing:
                  "Primer fotograma del fragmento solicitado; verificar la hora sobreimpresa. Puede existir desfase por codificación o reloj de la cámara.",
                obtained_at: new Date().toISOString(),
              },
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        return problem(
          "La grabación sigue preparándose. Volvé a intentar en unos minutos.",
        );
      });
    },
  };
}
