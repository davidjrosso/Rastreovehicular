export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "Rastreo",
      ...(body instanceof FormData
        ? {}
        : body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      data.error || `Error ${response.status}`,
      response.status,
    );
  }
  return response.json();
}
export const states: Record<string, string> = {
  pedida: "Pedida",
  en_curso: "En curso",
  en_revision: "En revisión",
  entregada: "Entregada",
  archivada: "Archivada",
  rechazada: "Rechazada",
};
export const roles: Record<string, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  operador: "Operador",
  externo: "Externo",
};
export const fmt = (value: string | null | undefined) =>
  !value
    ? "Sin fecha"
    : new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: "America/Argentina/Cordoba",
      }).format(new Date(value));
export const time = (value: string) =>
  new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Cordoba",
  }).format(new Date(value));
export const iso = (local: FormDataEntryValue | null) =>
  new Date(`${local}-03:00`).toISOString();
export const localTime = (s: string | null | undefined) => {
  if (!s) return "";
  const d = new Date(new Date(s).getTime() - 3 * 3600000);
  return d.toISOString().slice(0, 19);
};
export const periodLabel = (c: {
  starts_at?: string | null;
  ends_at?: string | null;
}) =>
  !c.starts_at
    ? "Sin fecha definida"
    : !c.ends_at
      ? `Desde ${fmt(c.starts_at)} · sin fecha de cierre`
      : `${fmt(c.starts_at)} — ${fmt(c.ends_at)}`;
