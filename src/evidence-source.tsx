import { fmt } from "./api";
export function EvidenceSource({
  source,
}: {
  source?: Record<string, any> | null;
}) {
  if (!source) return null;
  return (
    <small className="evidence-source">
      {source.kind === "hik_anpr" ? (
        <>
          Lectura automática HikCentral · {source.plate} · {source.camera_name}{" "}
          · {fmt(source.at)}
        </>
      ) : (
        <>
          Grabación histórica HikCentral · {source.camera_name} · Hora
          solicitada: {fmt(source.requested_at)} · Almacenamiento{" "}
          {source.record_type === "1" ? "auxiliar" : "principal"}.{" "}
          {source.timing}
        </>
      )}
      {source.obtained_at && <> · Obtenida: {fmt(source.obtained_at)}</>}
    </small>
  );
}
