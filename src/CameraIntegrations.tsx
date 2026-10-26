import { useCallback, useEffect, useState } from "react";
import { api, fmt } from "./api";

export function CameraIntegrations() {
  const [sources, setSources] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      setSources(await api("/integrations/cameras"));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);
  async function run(source: string) {
    setBusy(source);
    setError("");
    try {
      setSources(await api(`/integrations/cameras/${source}/run`, "POST"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="admin-panel camera-integrations">
      <h2>Sincronización de cámaras</h2>
      <p>
        My Maps mantiene el registro y las ubicaciones. HikCentral informa el
        estado actual de conexión.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="integration-grid">
        {sources.map((s) => (
          <article key={s.source}>
            <div className="section-heading">
              <h3>{s.source === "mymaps" ? "Google My Maps" : "HikCentral"}</h3>
              <span
                className={`integration-state ${s.last_error && s.configured ? "warning" : ""}`}
              >
                {!s.configured
                  ? "Pendiente de configurar"
                  : s.running || busy === s.source
                    ? "Consultando…"
                    : s.last_error
                      ? "Requiere atención"
                      : s.last_success
                        ? "Conectado"
                        : "Esperando primera consulta"}
              </span>
            </div>
            {s.configured ? (
              <>
                <p>
                  Consulta automática cada{" "}
                  {s.interval_seconds >= 60
                    ? `${Math.round(s.interval_seconds / 60)} min`
                    : `${s.interval_seconds} s`}
                  .
                </p>
                <p>
                  Última consulta correcta:{" "}
                  <strong>
                    {s.last_success
                      ? fmt(s.last_success)
                      : "Todavía no se completó"}
                  </strong>
                </p>
                {s.last_attempt && s.last_error && (
                  <p>Último intento: {fmt(s.last_attempt)}</p>
                )}
                {s.last_error && (
                  <p role="alert" className="form-error">
                    {s.last_error}
                  </p>
                )}
                {s.summary?.total !== undefined && (
                  <p>
                    {s.source === "mymaps"
                      ? `${s.summary.total} cámaras sin conflictos · ${s.summary.added} altas · ${s.summary.moved} cambios de ubicación · ${s.summary.removed} bajas en la última sincronización.`
                      : `${s.summary.matched} vinculadas · ${s.summary.online} en línea · ${s.summary.offline} fuera de línea · ${s.summary.unknown} sin estado conocido.`}
                  </p>
                )}
                {!!s.summary?.duplicates?.length && (
                  <p className="integration-warning">
                    Números duplicados en My Maps:{" "}
                    {s.summary.duplicates.join(", ")}. Se conserva su ubicación
                    anterior si existía; no se elige entre ubicaciones en
                    conflicto. Corregí los números en My Maps.
                  </p>
                )}
                {!!s.summary?.unmapped && (
                  <p className="integration-warning">
                    {s.summary.unmapped} cámaras del mapa sin correspondencia
                    única en HikCentral. Se muestran sin información.
                  </p>
                )}
                {!!s.summary?.ambiguous?.length && (
                  <p className="integration-warning">
                    Números repetidos en HikCentral:{" "}
                    {s.summary.ambiguous.join(", ")}.
                  </p>
                )}
                <button
                  className="secondary"
                  disabled={!!busy || s.running}
                  onClick={() => void run(s.source)}
                >
                  {s.source === "mymaps"
                    ? "Sincronizar ahora"
                    : "Consultar estados"}
                </button>
              </>
            ) : (
              <p>
                {s.source === "mymaps"
                  ? "Configurá el identificador del mapa compartido en el servidor."
                  : "Habilitá OpenAPI en HikCentral y configurá su dirección, AppKey y AppSecret localmente en el servidor. Las claves no se cargan desde esta pantalla."}
              </p>
            )}
          </article>
        ))}
      </div>
      <p className="muted">
        El estado describe la conexión actual, no garantiza imagen ni grabación.
        Si la información vence, pasa a “sin información reciente”. Las
        sugerencias para búsquedas históricas conservan todas las cámaras.
      </p>
    </section>
  );
}
