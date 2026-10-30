import { useRef, useState, useEffect } from "react";
import { CityMap } from "./Map";
import { api, fmt } from "./api";
import {
  captureCenter,
  lineStyles,
  type LineStyle,
  type RoutePoint,
} from "../shared/route-edit";
type Row = Record<string, any>;
export function RouteEditor({
  detail,
  route,
  leg,
  close,
  saved,
}: {
  detail: Row;
  route: Row;
  leg: Row;
  close: () => void;
  saved: () => void;
}) {
  const from = detail.entries.find((e: Row) => e.id === leg.from),
    to = detail.entries.find((e: Row) => e.id === leg.to);
  const start = captureCenter(from),
    end = captureCenter(to);
  const initial: RoutePoint[] =
    leg.coordinates.length > 1
      ? [start, ...leg.coordinates.slice(1, -1), end]
      : [start, end];
  const [points, setPoints] = useState<RoutePoint[]>(initial),
    [manual, setManual] = useState(!!leg.manual);
  const [style, setStyle] = useState<LineStyle>(leg.line_style || "dashed"),
    [note, setNote] = useState(leg.route_note || "");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ points: RoutePoint[]; manual: boolean }[]>(
    [],
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const update = (next: RoutePoint[]) => {
    setUndo((prev) => [...prev.slice(-29), { points, manual }]);
    setPoints(next);
    setManual(true);
  };
  const save = async (reset = false) => {
    setBusy(true);
    setError("");
    try {
      await api(`/cases/${detail.id}/route`, "PUT", {
        target_id: route.target_id,
        from_entry_id: leg.from,
        to_entry_id: leg.to,
        coordinates: manual ? points : null,
        line_style: style,
        note,
        version: leg.override_version || 0,
        reset,
      });
      saved();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mapDetail = {
    id: detail.id,
    entries: [from, to],
    targets: [route],
    routes: [],
  };
  return (
    <dialog
      ref={dialog}
      className="route-editor"
      aria-labelledby="route-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <div>
          <h2 id="route-editor-title">Editar tramo · {route.description}</h2>
          <p>
            {fmt(from.payload.at)} → {fmt(to.payload.at)}
          </p>
        </div>
        <button className="secondary" onClick={close} disabled={busy}>
          Cancelar
        </button>
      </header>
      <p>
        Arrastrá la línea hacia la calle elegida para crear un punto. Mové los
        puntos blancos para ajustar el trazado; clic derecho o Supr los elimina.
        A y B permanecen en las capturas.
      </p>
      <p className="muted">
        El trazado manual admite contramano y pasos fuera de las calles. No
        cambia la certeza de las capturas.
      </p>
      <div className="route-editor-tools">
        <label>
          Tipo de línea
          <select
            aria-label="Tipo de línea"
            value={style}
            disabled={busy}
            onChange={(e) => setStyle(e.target.value as LineStyle)}
          >
            {Object.entries(lineStyles).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={busy || !undo.length}
          onClick={() => {
            setPoints(undo.at(-1)!.points);
            setManual(undo.at(-1)!.manual);
            setUndo(undo.slice(0, -1));
          }}
        >
          Deshacer punto
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => update([start, end])}
        >
          Empezar con línea directa
        </button>
      </div>
      {style === "hidden" && (
        <p className="route-notice">
          La guía azul sigue visible para editar; al guardar no se mostrará esta
          línea en el mapa ni en el informe.
        </p>
      )}
      <div className={busy ? "route-editor-busy" : ""}>
        <CityMap
          cameras={[]}
          detail={mapDetail}
          edit={{ coordinates: points, style, onChange: update }}
        />
      </div>
      <label className="field">
        <span>Observación del tramo</span>
        <textarea
          value={note}
          maxLength={2000}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej.: se observa que camina por la calle paralela, en contramano…"
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void save(true)}
        >
          Restablecer cálculo automático
        </button>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Guardando…" : "Guardar tramo"}
        </button>
      </footer>
    </dialog>
  );
}
