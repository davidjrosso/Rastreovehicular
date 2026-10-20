import { useEffect, useState } from "react";
import { Compass, RefreshCw } from "lucide-react";
import { api, fmt } from "./api";
type Row = Record<string, any>;

export function Suggestions({
  detail,
  cameras,
  onResult,
  onChoose,
  working,
}: {
  detail: Row;
  cameras: Row[];
  onResult: (rows: Row[]) => void;
  onChoose: (row: Row, kind: "captura" | "revision") => void;
  working: boolean;
}) {
  const [options, setOptions] = useState<Row | null>(null);
  const [result, setResult] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const context = JSON.stringify({
    id: detail.id,
    status: detail.status,
    targets: detail.targets,
    entries: detail.entries.filter((e: Row) =>
      ["captura", "revision"].includes(e.kind),
    ),
    notes: detail.route_notes,
    cameras,
  });
  useEffect(() => {
    let alive = true;
    setResult(null);
    setError("");
    onResult([]);
    if (!options) {
      setBusy(false);
      return;
    }
    setBusy(true);
    api(`/cases/${detail.id}/suggestions`, "POST", options)
      .then((data) => {
        if (alive) {
          setResult(data);
          onResult(data.suggestions);
        }
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [context, options, onResult]);
  return (
    <section
      className="suggestions-panel"
      aria-label="Sugerencias de próximas cámaras"
    >
      <div className="section-heading">
        <h3>
          <Compass size={18} /> ¿Dónde seguir buscando?
        </h3>
        <span className="suggestion-tag">Ayuda para la sala</span>
      </div>
      <p className="muted">
        Hasta cinco cámaras desde la última aparición confirmada. Son
        prioridades de revisión, no avistamientos ni probabilidades.
      </p>
      <form
        onChange={() => {
          setOptions(null);
          setResult(null);
          onResult([]);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setOptions({
            target_id: f.get("target_id"),
            mode: f.get("mode"),
            heading: f.get("heading"),
            horizon_minutes: Number(f.get("horizon_minutes")),
            delay_minutes: Number(f.get("delay_minutes")),
            ...(f.get("speed") ? { speed: Number(f.get("speed")) } : {}),
          });
        }}
      >
        <div className="suggestion-controls">
          <label className="field">
            <span>Objetivo a seguir</span>
            <select
              name="target_id"
              required
              defaultValue={detail.targets[0]?.id || ""}
            >
              <option value="" disabled>
                Seleccionar objetivo
              </option>
              {detail.targets.map((t: Row) => (
                <option value={t.id} key={t.id}>
                  {t.description}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Criterio</span>
            <select name="mode">
              <option value="direccion">Dirección y alternativas</option>
              <option value="cercania">Cercanía por calles</option>
            </select>
          </label>
          <label className="field">
            <span>Sentido preferido</span>
            <select name="heading">
              <option value="auto">Deducir del último tramo</option>
              <option value="ninguno">Sin preferencia</option>
              {["N", "NE", "E", "SE", "S", "SO", "O", "NO"].map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Velocidad de referencia (km/h)</span>
            <input
              type="number"
              name="speed"
              min="1"
              max="130"
              step="0.1"
              placeholder="Automática / supuesto inicial"
            />
          </label>
          <label className="field">
            <span>Minutos desde la última captura</span>
            <input
              name="horizon_minutes"
              type="number"
              min="1"
              max="120"
              defaultValue="15"
              required
            />
          </label>
          <label className="field">
            <span>Margen por posible demora (min)</span>
            <input
              name="delay_minutes"
              type="number"
              min="0"
              max="60"
              defaultValue="0"
              required
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={busy || !detail.targets.length || !cameras.length}
        >
          {busy ? (
            <RefreshCw size={16} className="spinning" />
          ) : (
            <Compass size={16} />
          )}
          {busy ? "Calculando…" : "Sugerir próximas cámaras"}
        </button>
        <small className="suggestion-help">
          El horizonte se cuenta desde la captura, incluso en búsquedas
          históricas. La franja se limita al horario del pedido. En modo
          cercanía no se usa el sentido preferido. El cálculo usa la ubicación
          de las cámaras; su orientación y campo visual deben verificarse.
        </small>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {result && (
        <div aria-live="polite">
          {result.origin && (
            <p className="suggestion-origin">
              <b>Origen:</b>{" "}
              {result.origin.cameras
                .map((c: Row) => `CAM-${c.number}`)
                .join(" / ")}{" "}
              · {fmt(result.origin.at)}
            </p>
          )}
          {result.assumptions && (
            <p className="muted">
              <b>{result.assumptions.speed} km/h</b> ·{" "}
              {result.assumptions.speed_source}.{" "}
              {result.assumptions.heading_source}. Margen por demora:{" "}
              {result.assumptions.delay_minutes} min. Hasta{" "}
              {fmt(result.assumptions.until)}.
            </p>
          )}
          {result.warnings.map((w: string) => (
            <p className="suggestion-warning" key={w}>
              {w}
            </p>
          ))}
          {result.message && (
            <p className="suggestion-warning">{result.message}</p>
          )}
          <div className="suggestion-list">
            {result.suggestions.map((s: Row) => (
              <article className="suggestion-card" key={s.camera.id}>
                <header>
                  <span className="suggestion-rank">{s.rank}</span>
                  <strong>
                    CAM-{s.camera.number} ·{" "}
                    {s.camera.name
                      .replace(/^CAM[-_ ]?\d+[_ ]?/i, "")
                      .replaceAll("_", " ")}
                  </strong>
                  <span className={`suggestion-priority ${s.priority}`}>
                    Prioridad {s.priority}
                  </span>
                </header>
                <p>
                  <b>Revisar:</b> {fmt(s.from)} — {fmt(s.to)}
                </p>
                <ul>
                  {s.reasons.map((r: string) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {working && (
                  <div className="action-row">
                    <button
                      className="secondary"
                      onClick={() => onChoose(s, "captura")}
                    >
                      Registrar captura
                    </button>
                    <button
                      className="secondary"
                      onClick={() => onChoose(s, "revision")}
                    >
                      Revisada sin resultado
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!!result.suggestions.length && (
            <p className="muted">
              Las sugerencias se recalculan cuando cambian las capturas,
              revisiones o incertidumbres. Confirmá el horario real del video al
              registrar un hallazgo.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
