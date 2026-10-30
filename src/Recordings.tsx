import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmt, iso, localTime } from "./api";
import { periodBounds, suggestedWindow } from "../shared/case-period";
import { CameraPicker, DateTimeField } from "./inputs";
import { CameraHealth } from "./CameraHealth";
import {
  recordingColors,
  recordingLabels,
  recordingStatus,
} from "./recording-utils";
type Row = Record<string, any>;

export function RecordingResult({ result }: { result: Row }) {
  const status = recordingStatus(result);
  return (
    <div className="recording-result">
      <strong style={{ color: recordingColors[status] }}>
        {recordingLabels[status]}
      </strong>
      <p className="muted">
        Franja: {fmt(result.from)} — {fmt(result.to)}
      </p>
      {result.reason && <p>{result.reason}</p>}
      {status === "none" && (
        <p>
          HikCentral no informó archivos en el almacenamiento consultado. No
          prueba que la cámara estuviera apagada: pudo no grabar o el video pudo
          haberse eliminado.
        </p>
      )}
      {status === "partial" && (
        <p>
          Hay períodos sin archivos informados. Revisá los intervalos
          disponibles.
        </p>
      )}
      {status !== "unknown" && !!result.intervals?.length && (
        <details>
          <summary>
            Ver {result.intervals.length} intervalo(s) con grabación
          </summary>
          <ul>
            {result.intervals.map((s: Row) => (
              <li key={`${s.from}-${s.to}`}>
                {fmt(s.from)} — {fmt(s.to)}
              </li>
            ))}
          </ul>
          {!!result.gaps?.length && (
            <>
              <b>Sin grabación informada:</b>
              <ul>
                {result.gaps.map((s: Row) => (
                  <li key={`${s.from}-${s.to}`}>
                    {fmt(s.from)} — {fmt(s.to)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
      <small>
        Consultado: {fmt(result.checked_at)} · Grabación{" "}
        {result.record_type === "1" ? "auxiliar" : "principal"}.{" "}
        {status === "unknown" && result.status !== "unknown"
          ? "Resultado vencido; volvé a consultar."
          : ""}
      </small>
    </div>
  );
}

export function RecordingCheck({
  caseId,
  camera,
  from,
  to,
}: {
  caseId: string;
  camera: Row;
  from: string;
  to: string;
}) {
  const [result, setResult] = useState<Row | null>(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setResult(null);
    setError("");
    setBusy(true);
    api(`/cases/${caseId}/recordings`, "POST", {
      queries: [{ camera_id: camera.id, from, to }],
    })
      .then((data) => {
        if (alive) setResult(data.results[0]);
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
  }, [caseId, camera.id, from, to, attempt]);
  return (
    <div className="recording-check">
      {busy && <p role="status">Consultando grabaciones de esta franja…</p>}
      {error && <p role="alert">No verificable: {error}</p>}
      {result && <RecordingResult result={result} />}
      <button
        className="text-button"
        type="button"
        disabled={busy}
        onClick={() => setAttempt((v) => v + 1)}
      >
        Volver a consultar grabaciones
      </button>
    </div>
  );
}

export function RecordingPanel({
  detail,
  cameras,
  onResult,
}: {
  detail: Row;
  cameras: Row[];
  onResult: (rows: Row[]) => void;
}) {
  const [results, setResults] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const serial = useRef(0);
  const invalidate = useCallback(() => {
    serial.current++;
    setResults([]);
    setError("");
    setBusy(false);
    onResult([]);
  }, [onResult]);
  useEffect(
    () => () => {
      serial.current++;
    },
    [],
  );
  const max = localTime(
      new Date(Math.min(periodBounds(detail).to, Date.now())).toISOString(),
    ),
    min = localTime(detail.starts_at),
    window = suggestedWindow(detail, detail.ends_at ? 72 : 24);
  return (
    <section
      className="admin-panel recording-panel"
      aria-label="Grabaciones para la fecha del recorrido"
    >
      <h3>Grabaciones para la fecha del recorrido</h3>
      <p>
        Consultá la fecha y las horas del hecho. El borde del mapa muestra este
        resultado; la conexión actual no determina si hay video histórico.
      </p>
      <form
        onChange={invalidate}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ids = f.getAll("recording_cameras").map(String),
            from = iso(f.get("recording_from")),
            to = iso(f.get("recording_to"));
          invalidate();
          if (ids.length > 20) {
            setError("Seleccioná hasta 20 cámaras por consulta.");
            return;
          }
          if (
            Date.parse(to) <= Date.parse(from) ||
            Date.parse(to) - Date.parse(from) > 72 * 3600000
          ) {
            setError(
              "Seleccioná una franja de hasta 72 horas, con final posterior al inicio.",
            );
            return;
          }
          const request = ++serial.current;
          setBusy(true);
          try {
            const data = await api(`/cases/${detail.id}/recordings`, "POST", {
              queries: ids.map((camera_id) => ({ camera_id, from, to })),
            });
            if (serial.current === request) {
              setResults(data.results);
              onResult(data.results);
            }
          } catch (err) {
            if (serial.current === request) setError((err as Error).message);
          } finally {
            if (serial.current === request) setBusy(false);
          }
        }}
      >
        <DateTimeField
          name="recording_from"
          label="Desde"
          initial={localTime(window.from)}
          required
          min={min}
          max={max}
        />
        <DateTimeField
          name="recording_to"
          label="Hasta"
          initial={localTime(window.to)}
          required
          min={min}
          max={max}
        />
        <CameraPicker
          cameras={cameras}
          name="recording_cameras"
          multiple
          legend="Cámaras a consultar (hasta 20)"
          onSelectionChange={invalidate}
        />
        <button className="primary" disabled={busy}>
          {busy
            ? "Consultando grabaciones…"
            : "Verificar grabaciones de la franja"}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="recording-results" aria-live="polite">
        {results.map((r) => (
          <article key={r.camera_id}>
            <h4>CAM-{cameras.find((c) => c.id === r.camera_id)?.number}</h4>
            <RecordingResult result={r} />
            <CameraHealth
              camera={cameras.find((c) => c.id === r.camera_id) || {}}
            />
          </article>
        ))}
      </div>
      <p className="muted">
        La consulta verifica los intervalos que informa HikCentral; no reproduce
        ni valida la calidad de imagen. Una falla de acceso se muestra como “no
        verificable”, nunca como falta de grabación. Los resultados vencen a los
        cinco minutos.
      </p>
    </section>
  );
}
