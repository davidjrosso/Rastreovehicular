import { XMLParser, XMLValidator } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import { fail } from "./domain.ts";

export type CameraInput = {
  number: number;
  name: string;
  lon: number;
  lat: number;
};
export function parseKml(source: string) {
  if (
    /<!DOCTYPE|<!ENTITY/i.test(source) ||
    XMLValidator.validate(source) !== true
  )
    fail(400, "KML inválido");
  const tree = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    processEntities: false,
  }).parse(source);
  const cameras: CameraInput[] = [],
    invalid: string[] = [],
    duplicates: number[] = [];
  const seen = new Set<number>();
  function visit(node: any) {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "Placemark") {
        for (const mark of (Array.isArray(value) ? value : [value]) as any[]) {
          const name = String(mark.name || "").trim();
          const match = name.match(/^CAM[-_ ]?(\d+)/i);
          const coordinates = String(mark.Point?.coordinates || "")
            .trim()
            .split(",")
            .map(Number);
          if (
            !match ||
            coordinates.length < 2 ||
            !coordinates.every(Number.isFinite) ||
            Math.abs(coordinates[0]) > 180 ||
            Math.abs(coordinates[1]) > 90
          ) {
            invalid.push(name || "(sin nombre)");
            continue;
          }
          const number = Number(match[1]);
          if (seen.has(number)) {
            duplicates.push(number);
            continue;
          }
          seen.add(number);
          cameras.push({
            number,
            name,
            lon: coordinates[0],
            lat: coordinates[1],
          });
        }
      } else if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  }
  visit(tree);
  return { cameras, invalid, duplicates: [...new Set(duplicates)] };
}
export async function importCameras(
  db: DB,
  source: string,
  userId: string,
  skipAmbiguous = false,
) {
  const parsed = parseKml(source);
  if (!parsed.cameras.length) fail(400, "El KML no contiene cámaras válidas");
  if (!skipAmbiguous && (parsed.invalid.length || parsed.duplicates.length)) {
    fail(
      400,
      `Importación cancelada. Duplicados: ${parsed.duplicates.join(", ") || "ninguno"}. Nombres o coordenadas inválidos: ${parsed.invalid.join(", ") || "ninguno"}. Corregir el KML y volver a importar.`,
    );
  }
  // Initial import may explicitly quarantine ambiguous IDs; never choose a duplicate arbitrarily.
  const incoming = parsed.cameras.filter(
    (c) => !parsed.duplicates.includes(c.number),
  );
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(20261021)");
    const previous = (await tx.query("SELECT * FROM cameras")).rows;
    let added = 0,
      moved = 0;
    for (const c of incoming) {
      const old = previous.find((p) => p.number === c.number);
      if (!old) added++;
      else if (old.lat !== c.lat || old.lon !== c.lon) moved++;
      await tx.query(
        `INSERT INTO cameras(id,number,name,lon,lat) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(number) DO UPDATE SET name=$3,lon=$4,lat=$5,active=true,updated_at=now()`,
        [randomUUID(), c.number, c.name, c.lon, c.lat],
      );
    }
    const numbers = incoming.map((c) => c.number);
    const removed = previous.filter(
      (p) => p.active && !numbers.includes(p.number),
    ).length;
    await tx.query(
      "UPDATE cameras SET active=false,updated_at=now() WHERE NOT (number=ANY($1::int[]))",
      [numbers],
    );
    const summary = {
      total: incoming.length,
      added,
      moved,
      removed,
      duplicates: parsed.duplicates,
      invalid: parsed.invalid,
    };
    await tx.query(
      "INSERT INTO audit(id,user_id,action,detail) VALUES($1,$2,$3,$4)",
      [randomUUID(), userId, "camera_sync", JSON.stringify(summary)],
    );
    return summary;
  });
}
