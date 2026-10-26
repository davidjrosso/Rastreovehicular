import { useEffect, useRef, useState } from "react";
import { api, fmt, iso, localTime } from "./api";
import { CameraPicker, DateTimeField } from "./inputs";
import { EvidenceSource } from "./evidence-source";
import "./hik-evidence.css";
type Row = Record<string, any>;

export function HikEvidence({
  detail,
  entry,
  cameras,
  close,
  refresh,
}: {
  detail: Row;
  entry?: Row;
  cameras: Row[];
  close: () => void;
  refresh: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [result, setResult] = useState<Row | null>(null),
    [selected, setSelected] = useState<Row | null>(null);
  const [photo, setPhoto] = useState("");
  const [preview, setPreview] = useState<Row | null>(null);
  const [imported, setImported] = useState<string[]>([]);
  const vehicles = detail.targets.filter((t: Row) => t.kind === "vehiculo");
  const [plate, setPlate] = useState(
    vehicles.find((t: Row) => t.plate)?.plate || "",
  );
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const base = `/cases/${detail.id}`;
  const working = detail.status === "en_curso";
  return (
    <dialog
      className="hik-dialog"
      ref={dialog}
      aria-labelledby="hik-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">HIKCENTRAL · {detail.number}</span>
          <h2 id="hik-title">
            {entry ? "Imagen de la grabación" : "Buscar patente"}
          </h2>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={close}
          disabled={busy}
        >
          Cerrar
        </button>
      </header>
      {!working && (
        <p className="hik-notice">
          Podés consultar las imágenes. Para incorporarlas, reabrí la búsqueda.
        </p>
      )}
      {entry ? (
        <>
          <p>
            Captura registrada: <b>{fmt(entry.payload.at)}</b>. Elegí la cámara
            y el segundo a consultar.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                setPreview(null);
                setPreview(
                  await api(`${base}/entries/${entry.id}/hik/frame`, "POST", {
                    camera_id: f.get("camera"),
                    offset_seconds: Number(f.get("offset")),
                  }),
                );
              });
            }}
          >
            <fieldset disabled={busy} className="hik-fields">
              <label>
                Cámara
                <select name="camera" onChange={() => setPreview(null)}>
                  {entry.payload.cameras.map((c: Row) => (
                    <option key={c.id} value={c.id}>
                      CAM-{c.number} · {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Instante
                <select
                  name="offset"
                  defaultValue="0"
                  onChange={() => setPreview(null)}
                >
                  {[-5, -2, 0, 2, 5].map((s) => (
                    <option value={s} key={s}>
                      {s === 0
                        ? "Hora de la captura"
                        : `${Math.abs(s)} segundos ${s < 0 ? "antes" : "después"}`}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" type="submit">
                Obtener imagen
              </button>
            </fieldset>
          </form>
          <p className="muted">
            Se descarga un fragmento breve del archivo histórico. La preparación
            puede demorar hasta dos minutos.
          </p>
          {preview && (
            <div className="hik-preview">
              <img
                src={preview.image}
                alt="Fotograma obtenido de la grabación histórica"
              />
              <EvidenceSource source={preview.source} />
              <p>
                Revisá la hora sobreimpresa y el vehículo antes de guardar. La
                imagen no cambia la certeza ni la hora del registro.
              </p>
              <button
                className="primary"
                disabled={busy || !working}
                onClick={() =>
                  void action(async () => {
                    const r = await api(
                      `${base}/entries/${entry.id}/hik/frame/attach`,
                      "POST",
                      { token: preview.token },
                    );
                    setMessage(
                      r.already_attached
                        ? "Esta imagen ya estaba adjunta."
                        : "Imagen adjunta. Se incluirá al volver a generar el informe.",
                    );
                    refresh();
                  })
                }
              >
                Adjuntar a la captura
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p>
            Busca coincidencias exactas en las cámaras con lectura de patentes.
            Horarios de Argentina. Los resultados dependen de la retención y de
            que HikCentral haya registrado la lectura.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                setResult(null);
                setSelected(null);
                setPhoto("");
                setResult(
                  await api(`${base}/hik/plates`, "POST", {
                    plate: f.get("plate"),
                    from: iso(f.get("from")),
                    to: iso(f.get("to")),
                  }),
                );
              });
            }}
          >
            <fieldset disabled={busy} className="hik-fields">
              {!!vehicles.length && (
                <label>
                  Usar patente del objetivo
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const t = vehicles.find(
                        (t: Row) => t.id === e.target.value,
                      );
                      if (t) setPlate(t.plate);
                    }}
                  >
                    <option value="">Elegir vehículo…</option>
                    {vehicles.map((t: Row) => (
                      <option key={t.id} value={t.id}>
                        {t.description} {t.plate}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Patente
                <input
                  name="plate"
                  required
                  minLength={3}
                  maxLength={20}
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                  placeholder="Ej.: AB123CD"
                />
              </label>
              <DateTimeField
                name="from"
                label="Desde"
                initial={localTime(detail.starts_at)}
                required
                min={localTime(detail.starts_at)}
                max={localTime(detail.ends_at)}
              />
              <DateTimeField
                name="to"
                label="Hasta"
                initial={localTime(
                  new Date(
                    Math.min(new Date(detail.ends_at).getTime(), Date.now()),
                  ).toISOString(),
                )}
                required
                min={localTime(detail.starts_at)}
                max={localTime(detail.ends_at)}
              />
              <button type="submit" className="primary">
                Buscar en HikCentral
              </button>
            </fieldset>
          </form>
          {result && (
            <section className="hik-results">
              <h3>{result.records.length} lecturas encontradas</h3>
              <p className={result.incomplete ? "hik-notice" : "muted"}>
                {result.incomplete
                  ? "Consulta incompleta. Hay cámaras sin consultar por completo; no interpretes esto como ausencia de registros."
                  : "Consulta completada en las cámaras ANPR informadas por HikCentral."}
              </p>
              {!result.records.length && (
                <p>
                  No hubo coincidencias exactas en los resultados consultados.
                  Esto no acredita que el vehículo no haya pasado.
                </p>
              )}
              <details>
                <summary>Estado por cámara · {fmt(result.checked_at)}</summary>
                {result.checks.map((c: Row, i: number) => (
                  <p key={i}>
                    {c.camera_name}:{" "}
                    {c.status === "complete" ? "consultada" : c.reason}
                  </p>
                ))}
              </details>
              <div className="hik-result-list">
                {result.records.map((r: Row) => (
                  <button
                    className={selected?.token === r.token ? "selected" : ""}
                    key={r.token}
                    disabled={busy}
                    onClick={() => {
                      setSelected(r);
                      setPhoto("");
                      setError("");
                      setMessage("");
                    }}
                  >
                    <b>{r.plate}</b>
                    <span>{fmt(r.at)}</span>
                    <span>{r.camera_name}</span>
                    <small>
                      {imported.includes(r.token)
                        ? "Incorporada"
                        : r.camera
                          ? `Mapa: CAM-${r.camera.number}`
                          : "Requiere elegir cámara del mapa"}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}
          {selected && (
            <section className="hik-selected" key={selected.token}>
              <h3>
                {selected.plate} · {fmt(selected.at)}
              </h3>
              <p>{selected.camera_name} · Lectura automática</p>
              {selected.has_photo ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const r = await fetch(
                        `/api${base}/hik/plates/${selected.token}/photo`,
                        {
                          method: "POST",
                          credentials: "same-origin",
                          headers: { "X-Requested-With": "Rastreo" },
                        },
                      );
                      if (!r.ok)
                        throw new Error(
                          (await r.json()).error ||
                            "No se pudo obtener la imagen.",
                        );
                      setPhoto(URL.createObjectURL(await r.blob()));
                    })
                  }
                >
                  Ver foto de la lectura
                </button>
              ) : (
                <p>HikCentral no informó una foto para esta lectura.</p>
              )}
              {photo && (
                <img
                  className="hik-photo"
                  src={photo}
                  alt={`Lectura automática ${selected.plate}`}
                />
              )}
              {working && vehicles.length > 0 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void action(async () => {
                      const r = await api(
                        `${base}/hik/plates/${selected.token}/import`,
                        "POST",
                        {
                          target_id: f.get("target"),
                          camera_id: selected.camera?.id || f.get("camera"),
                          include_photo: f.get("photo") === "on",
                          certainty: f.get("certainty"),
                        },
                      );
                      setImported((v) => [...v, selected.token]);
                      setMessage(
                        r.already_imported
                          ? "Esta lectura ya estaba incorporada a la búsqueda."
                          : "Captura incorporada. Sus imágenes se incluirán en el informe.",
                      );
                      refresh();
                    });
                  }}
                >
                  <fieldset disabled={busy} className="hik-fields">
                    <label>
                      Vehículo de la búsqueda
                      <select
                        name="target"
                        required
                        defaultValue={
                          vehicles.find(
                            (t: Row) =>
                              t.plate.replace(/[\s-]/g, "").toUpperCase() ===
                              selected.plate
                                .replace(/[\s-]/g, "")
                                .toUpperCase(),
                          )?.id || vehicles[0]?.id
                        }
                      >
                        {vehicles.map((t: Row) => (
                          <option key={t.id} value={t.id}>
                            {t.description} · {t.plate || "Sin patente"}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!selected.camera && (
                      <>
                        <p className="hik-notice">
                          No hay vinculación única con el mapa. Elegí la cámara
                          sólo si verificaste que corresponde a{" "}
                          {selected.camera_name}. Quedará registrado como
                          asociación manual.
                        </p>
                        <CameraPicker
                          cameras={cameras}
                          name="camera"
                          legend="Cámara del mapa verificada por el operador"
                        />
                      </>
                    )}
                    <label>
                      Valoración
                      <select name="certainty" defaultValue="probable">
                        <option value="probable">
                          Probable · requiere revisión
                        </option>
                        <option value="dudoso">Dudoso</option>
                        <option value="confirmado">
                          Confirmado · verifiqué visualmente vehículo y patente
                        </option>
                      </select>
                    </label>
                    {selected.has_photo && (
                      <label className="hik-checkbox">
                        <input type="checkbox" name="photo" defaultChecked />{" "}
                        Adjuntar foto de la lectura
                      </label>
                    )}
                    <button
                      type="submit"
                      className="primary"
                      disabled={imported.includes(selected.token)}
                    >
                      Incorporar como captura
                    </button>
                  </fieldset>
                </form>
              )}
              {working && !vehicles.length && (
                <p>
                  Agregá un objetivo de tipo vehículo a la búsqueda para
                  incorporar esta lectura.
                </p>
              )}
            </section>
          )}
        </>
      )}
      {busy && (
        <p role="status" className="hik-notice">
          Consultando HikCentral… La obtención de grabaciones puede demorar
          hasta dos minutos.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="hik-notice">
          {message}
        </p>
      )}
    </dialog>
  );
}
