import { z } from "zod";

export const id = z.uuid();
export const text = z.string().trim().min(1).max(4000);
export const date = z.iso.datetime({ offset: true });
export const roles = z.enum(["admin", "supervisor", "operador", "externo"]);
export const states = z.enum([
  "pedida",
  "en_curso",
  "en_revision",
  "entregada",
  "archivada",
  "rechazada",
]);
export type User = {
  id: string;
  name: string;
  username: string;
  role: z.infer<typeof roles>;
  department_id: string | null;
  active: boolean;
};
export const isStaff = (u: User) => u.role !== "externo";
export const isSupervisor = (u: User) =>
  ["admin", "supervisor"].includes(u.role);
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
const periodFields = {
  starts_at: date.nullable().default(null),
  ends_at: date.nullable().default(null),
};
const validPeriod = (v: { starts_at: string | null; ends_at: string | null }) =>
  !v.ends_at ||
  (!!v.starts_at && Date.parse(v.starts_at) <= Date.parse(v.ends_at));
export const periodInput = z
  .object({
    ...periodFields,
    previous_starts_at: date.nullable(),
    previous_ends_at: date.nullable(),
  })
  .refine(
    validPeriod,
    "Indicá un inicio anterior al final, o dejá la búsqueda abierta.",
  );
export const caseInput = z
  .object({
    title: text.max(180),
    description: text,
    reference: z.string().trim().max(200).default(""),
    department_id: id,
    ...periodFields,
  })
  .refine(validPeriod, "La franja horaria está invertida");
export const targetInput = z.object({
  kind: z.enum(["vehiculo", "persona", "otro"]),
  description: text.max(500),
  plate: z.string().trim().max(30).default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const entryInputs = {
  captura: z.object({
    camera_ids: z.array(id).min(1).max(10),
    target_ids: z.array(id).min(1).max(10),
    at: date,
    direction: z.string().trim().max(150).default(""),
    certainty: z.enum(["confirmado", "probable", "dudoso"]),
    note: z.string().trim().max(4000).default(""),
  }),
  revision: z
    .object({
      camera_id: id,
      target_id: id.nullable().default(null),
      from: date,
      to: date,
    })
    .refine(
      (v) => Date.parse(v.from) <= Date.parse(v.to),
      "La franja horaria está invertida",
    ),
  aporte: z
    .object({
      text,
      at: date.nullable().optional(),
      lon: z.number().min(-180).max(180).optional(),
      lat: z.number().min(-90).max(90).optional(),
      place_kind: z
        .enum(["general", "hecho", "camara_particular"])
        .default("general"),
      place_name: z.string().trim().max(180).default(""),
      address: z.string().trim().max(300).default(""),
    })
    .refine(
      (v) => (v.lon === undefined) === (v.lat === undefined),
      "Indicar ambas coordenadas",
    )
    .refine(
      (v) =>
        v.place_kind === "general" ||
        (!!v.place_name && v.lon !== undefined && v.lat !== undefined),
      "El lugar requiere nombre y ubicación",
    )
    .refine(
      (v) => v.place_kind !== "camara_particular" || !!v.at,
      "Indicá la fecha y hora del avistamiento",
    ),
  mensaje: z.object({ text, mentions: z.array(id).max(15).default([]) }),
};
export function canTransition(user: User, from: string, to: string) {
  if (isSupervisor(user))
    return (
      (
        {
          pedida: ["en_curso", "rechazada"],
          en_curso: ["en_revision"],
          en_revision: ["entregada", "en_curso"],
          entregada: ["archivada", "en_curso"],
          archivada: ["en_curso"],
          rechazada: ["en_curso"],
        } as Record<string, string[]>
      )[from]?.includes(to) || false
    );
  return (
    user.role === "operador" && from === "en_curso" && to === "en_revision"
  );
}
export function editable(status: string, kind: string) {
  return ["mensaje", "aporte"].includes(kind)
    ? ["pedida", "en_curso", "en_revision"].includes(status)
    : status === "en_curso";
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
}
export const xml = (v: unknown) =>
  String(v ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
