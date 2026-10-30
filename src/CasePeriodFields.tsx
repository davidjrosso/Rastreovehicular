import { useState } from "react";
import { DateTimeField } from "./inputs";
import { iso, localTime } from "./api";
export function periodForm(f: FormData) {
  return {
    starts_at: f.get("starts_at") ? iso(f.get("starts_at")) : null,
    ends_at: f.get("ends_at") ? iso(f.get("ends_at")) : null,
  };
}
export function CasePeriodFields({
  initial,
}: {
  initial?: { starts_at?: string | null; ends_at?: string | null };
}) {
  const [mode, setMode] = useState(
    initial
      ? !initial.starts_at
        ? "undated"
        : !initial.ends_at
          ? "ongoing"
          : "period"
      : "period",
  );
  return (
    <fieldset className="case-period-fields">
      <legend>Fecha de la búsqueda</legend>
      <label className="field">
        <span>Modalidad</span>
        <select
          aria-label="Modalidad de la búsqueda"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="period">Hecho con fecha y hora de inicio y fin</option>
          <option value="ongoing">
            Búsqueda abierta · sin fecha de cierre
          </option>
          <option value="undated">Sin fecha definida</option>
        </select>
      </label>
      <p className="muted">
        {mode === "period"
          ? "Para investigar un hecho dentro de un período conocido."
          : "Para personas o vehículos que siguen siendo buscados. Cada captura conserva su fecha y hora. El estado del pedido se gestiona por separado."}
      </p>
      {mode !== "undated" && (
        <DateTimeField
          name="starts_at"
          label="Desde (hora argentina)"
          initial={localTime(initial?.starts_at)}
          required
        />
      )}
      {mode === "period" && (
        <DateTimeField
          name="ends_at"
          label="Hasta (hora argentina)"
          initial={localTime(initial?.ends_at)}
          required
        />
      )}
    </fieldset>
  );
}
