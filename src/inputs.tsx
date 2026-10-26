import { useEffect, useId, useState } from "react";
import { CityMap } from "./Map";
import { matchesCamera, normalizeClock } from "./form-utils";
import { CameraHealth } from "./CameraHealth";

export function CameraPicker({
  cameras,
  name,
  multiple = false,
  initial = "",
  legend,
  onSelectionChange,
}: {
  cameras: any[];
  name: string;
  multiple?: boolean;
  initial?: string;
  legend?: string;
  onSelectionChange?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(initial ? [initial] : []);
  const filtered = cameras.filter((c) => matchesCamera(c, query));
  useEffect(() => {
    onSelectionChange?.();
  }, [selected, onSelectionChange]);
  return (
    <fieldset className="camera-picker">
      <legend>
        {legend || (multiple ? "Cámaras de la captura" : "Cámara revisada")}
      </legend>
      <input
        aria-label="Buscar cámara por número o nombre"
        placeholder="Escribí el número o el nombre…"
        type="search"
        ref={(element) =>
          element?.setCustomValidity(
            selected.length
              ? ""
              : "Seleccioná al menos una cámara de la lista.",
          )
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="selected-cameras">
        {selected.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSelected(selected.filter((s) => s !== id))}
          >
            CAM-{cameras.find((c) => c.id === id)?.number} ×
          </button>
        ))}
      </div>
      <div className="camera-options">
        {filtered.map((camera) => (
          <label key={camera.id}>
            <input
              type={multiple ? "checkbox" : "radio"}
              checked={selected.includes(camera.id)}
              name={`${name}-choice`}
              onChange={() =>
                setSelected(
                  multiple
                    ? selected.includes(camera.id)
                      ? selected.filter((s) => s !== camera.id)
                      : [...selected, camera.id]
                    : [camera.id],
                )
              }
            />
            <strong>CAM-{camera.number}</strong>
            <CameraHealth camera={camera} />
            <span>
              {camera.name
                .replace(/^CAM[-_ ]?\d+[_ ]?/i, "")
                .replaceAll("_", " ")}
            </span>
          </label>
        ))}
      </div>
      {!filtered.length && (
        <p role="status" className="muted">
          No hay cámaras con ese número o nombre.
        </p>
      )}
      <small>
        {filtered.length} coincidencias · {selected.length} seleccionadas
      </small>
      {selected.map((value) => (
        <input type="hidden" name={name} value={value} key={value} />
      ))}
    </fieldset>
  );
}

// Two native controls and a plain-text clock share one submitted local datetime.
export function DateTimeField({
  name,
  label,
  initial = "",
  required = false,
  min,
  max,
}: {
  name: string;
  label: string;
  initial?: string;
  required?: boolean;
  min?: string;
  max?: string;
}) {
  const uid = useId();
  const [day, setDay] = useState(initial.slice(0, 10));
  const [clock, setClock] = useState(initial.slice(11) || "");
  const time = normalizeClock(clock);
  const value = day && time ? `${day}T${time}` : "";
  const boundary = (s: string) =>
    `${s.slice(0, 10)}T${normalizeClock(s.slice(11, 19))}`;
  const constraint =
    !required && !day && !clock
      ? ""
      : !value
        ? "Completá fecha y hora (HH:MM o HH:MM:SS)."
        : min && value < boundary(min)
          ? "La hora está antes de la franja del pedido."
          : max && value > boundary(max)
            ? "La hora está después de la franja del pedido."
            : "";
  return (
    <fieldset className="datetime-field">
      <legend>{label}</legend>
      <label htmlFor={`${uid}-date`}>
        Fecha
        <input
          id={`${uid}-date`}
          type="date"
          value={day}
          required={required || !!clock}
          min={min?.slice(0, 10)}
          max={max?.slice(0, 10)}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      <label htmlFor={`${uid}-manual`}>
        Hora escrita
        <input
          id={`${uid}-manual`}
          type="text"
          inputMode="numeric"
          placeholder="HH:MM:SS"
          value={clock}
          required={required || !!day}
          ref={(element) => {
            element?.setCustomValidity(constraint);
          }}
          onChange={(e) => setClock(e.target.value)}
          aria-describedby={`${uid}-hint`}
        />
      </label>
      <label htmlFor={`${uid}-picker`}>
        Selector de hora
        <input
          id={`${uid}-picker`}
          type="time"
          step="1"
          value={time}
          onChange={(e) => setClock(e.target.value)}
        />
      </label>
      <small id={`${uid}-hint`}>
        Hora argentina · Podés escribir 19:36 o 19:36:10.
      </small>
      <input type="hidden" name={name} value={value} />
    </fieldset>
  );
}

export function PlaceFields({
  initialKind = "general",
}: {
  initialKind?: string;
}) {
  const [kind, setKind] = useState(initialKind);
  const [point, setPoint] = useState<{ lon: string; lat: string }>({
    lon: "",
    lat: "",
  });
  const located = kind !== "general";
  const validPoint =
    point.lon !== "" &&
    point.lat !== "" &&
    Number.isFinite(Number(point.lon)) &&
    Number.isFinite(Number(point.lat)) &&
    Math.abs(Number(point.lon)) <= 180 &&
    Math.abs(Number(point.lat)) <= 90;
  const marker = validPoint
    ? {
        entries: [
          {
            kind: "aporte",
            payload: {
              lon: Number(point.lon),
              lat: Number(point.lat),
              place_kind: kind,
              text: "Ubicación elegida",
            },
          },
        ],
        targets: [],
        routes: [],
      }
    : undefined;
  return (
    <>
      <label className="field">
        <span>Tipo de información</span>
        <select
          name="place_kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="general">Aporte general</option>
          <option value="hecho">Lugar del hecho</option>
          <option value="camara_particular">
            Avistamiento en cámara particular
          </option>
        </select>
      </label>
      {located && (
        <>
          <label className="field">
            <span>Nombre del lugar o cámara particular</span>
            <input
              name="place_name"
              required
              maxLength={180}
              placeholder="Ej. Comercio de la esquina"
            />
          </label>
          <label className="field">
            <span>Dirección o referencia</span>
            <input
              name="address"
              maxLength={300}
              placeholder="Calle, número o intersección"
            />
          </label>
        </>
      )}
      <label className="field">
        <span>
          {kind === "camara_particular"
            ? "Qué se vio y de dónde proviene la información"
            : "Información para la búsqueda"}
        </span>
        <textarea name="text" required maxLength={4000} />
      </label>
      <DateTimeField
        name="at"
        label={
          kind === "camara_particular"
            ? "Fecha y hora del avistamiento (Argentina)"
            : "Fecha y hora de referencia (opcional, Argentina)"
        }
        required={kind === "camara_particular"}
      />
      <p className="muted">
        Marcá la ubicación con un clic en el mapa o escribí sus coordenadas.
        {located ? " La ubicación es obligatoria." : ""}
      </p>
      <div className="place-map">
        <CityMap
          cameras={[]}
          detail={marker}
          onPoint={(p) =>
            setPoint({ lon: p.lon.toFixed(6), lat: p.lat.toFixed(6) })
          }
        />
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Longitud</span>
          <input
            name="lon"
            type="number"
            step="any"
            min="-180"
            max="180"
            required={located || !!point.lat}
            value={point.lon}
            onChange={(e) => setPoint({ ...point, lon: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Latitud</span>
          <input
            name="lat"
            type="number"
            step="any"
            min="-90"
            max="90"
            required={located || !!point.lon}
            value={point.lat}
            onChange={(e) => setPoint({ ...point, lat: e.target.value })}
          />
        </label>
      </div>
      <p className="muted">
        Se guarda como un aporte con su procedencia, separado de las capturas de
        la sala. Podés adjuntar imágenes o clips después.
      </p>
    </>
  );
}
