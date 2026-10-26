import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Printer,
  RefreshCw,
  Search,
} from "lucide-react";
import { api, fmt, states } from "./api";
import { reportModel, certaintyLabels } from "./report-model";
import { ReportMap } from "./ReportMap";
import "./reports.css";
type Row = Record<string, any>;
const cameraNames = (entry: Row) =>
  (entry.payload.cameras || [])
    .map((c: Row) =>
      /^CAM[-_ ]?\d+/i.test(c.name)
        ? c.name.replaceAll("_", " ")
        : `CAM-${c.number} · ${c.name}`,
    )
    .join(" / ");
const placeKind = (entry: Row) =>
  entry.payload.place_kind === "hecho"
    ? "Lugar del hecho"
    : entry.payload.place_kind === "camara_particular"
      ? "Avistamiento particular"
      : "Aporte";

export function Reports({
  cases,
  selected,
  select,
  openCase,
}: {
  cases: Row[];
  selected: string | null;
  select: (id: string | null) => void;
  openCase: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const filtered = cases.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      normalize(
        `${c.number} ${c.title} ${c.reference} ${c.department_name}`,
      ).includes(normalize(query)),
  );
  if (selected)
    return (
      <SituationReport
        key={selected}
        id={selected}
        back={() => select(null)}
        openCase={() => openCase(selected)}
      />
    );
  return (
    <section className="reports-home">
      <div className="page-heading">
        <div>
          <span className="eyebrow">REUNIONES Y COMUNICACIÓN</span>
          <h1>Informes</h1>
          <p>
            El estado de cada búsqueda, en un reporte visual listo para
            compartir.
          </p>
        </div>
        <FileText size={36} strokeWidth={1.3} />
      </div>
      <div className="report-intro">
        <strong>Una lectura clara de la situación.</strong>
        <p>
          Elegí una búsqueda para generar su mapa, cronología y resumen. Incluye
          eventos en curso, entregados, archivados y rechazados a los que tenés
          acceso.
        </p>
      </div>
      <div className="toolbar report-filters">
        <label className="search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Número, hecho, expediente o dependencia…"
            aria-label="Buscar búsquedas para informes"
          />
        </label>
        <label className="field">
          <span>Estado</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos los estados</option>
            {Object.entries(states).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="list-title">
        <span>Búsquedas disponibles</span>
        <small>{filtered.length} resultados</small>
      </div>
      {filtered.length ? (
        <div className="report-list">
          {filtered.map((c) => (
            <button
              key={c.id}
              className="report-list-row"
              onClick={() => select(c.id)}
            >
              <div className="report-list-icon">
                <FileText size={23} />
              </div>
              <div className="report-list-main">
                <span className="case-number">{c.number}</span>
                <h2>{c.title}</h2>
                <p>
                  {c.department_name} ·{" "}
                  {c.reference || "Sin expediente informado"}
                </p>
              </div>
              <div className="report-list-meta">
                <span className={`status ${c.status}`}>
                  <i />
                  {states[c.status]}
                </span>
                <small>{fmt(c.starts_at)}</small>
                <span>{c.capture_count} capturas registradas</span>
              </div>
              <span className="report-list-action">
                Generar informe <ArrowRight size={16} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <FileText size={30} />
          <h3>No hay búsquedas para mostrar</h3>
          <p>
            {query || status !== "all"
              ? "Probá otro filtro o término de búsqueda."
              : "Las búsquedas aparecerán acá cuando se registren."}
          </p>
        </div>
      )}
    </section>
  );
}

function ReportImage({ attachment }: { attachment: Row }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="report-image">
      {failed ? (
        <div className="report-image-missing">
          Imagen no disponible. Consultar el adjunto original.
        </div>
      ) : (
        <img
          src={`/api/attachments/${attachment.id}?inline=1`}
          alt={attachment.name}
          onError={() => setFailed(true)}
        />
      )}
      <figcaption>{attachment.name}</figcaption>
    </figure>
  );
}

function SituationReport({
  id,
  back,
  openCase,
}: {
  id: string;
  back: () => void;
  openCase: () => void;
}) {
  const [data, setData] = useState<Row | null>(null);
  const [streets, setStreets] = useState<Row | null>(null);
  const [mapError, setMapError] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [target, setTarget] = useState("all");
  const [images, setImages] = useState(true);
  const [nextSteps, setNextSteps] = useState(true);
  const [conclusion, setConclusion] = useState("");
  const [printing, setPrinting] = useState(false);
  const documentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    setMapError(false);
    Promise.all([api(`/cases/${id}/report`), api("/streets").catch(() => null)])
      .then(([report, map]) => {
        if (alive) {
          setData(report);
          setStreets(map);
          setMapError(!map);
          setTarget((old) =>
            old === "all" || report.targets.some((t: Row) => t.id === old)
              ? old
              : "all",
          );
        }
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [id, version]);
  const model = useMemo(
    () => (data ? reportModel(data, target) : null),
    [data, target],
  );
  useEffect(() => {
    const previous = document.title;
    if (data)
      document.title = `Informe ${data.number} - ${new Date(data.generated_at).toISOString().replaceAll(":", "-")}`;
    return () => {
      document.title = previous;
    };
  }, [data]);
  async function print() {
    setPrinting(true);
    setError("");
    try {
      await document.fonts.ready;
      const imgs = Array.from(
        documentRef.current?.querySelectorAll("img") || [],
      );
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve, reject) => {
                const done = () => {
                  clearTimeout(timer);
                  img.removeEventListener("load", done);
                  img.removeEventListener("error", done);
                  resolve();
                };
                const timer = setTimeout(() => {
                  img.removeEventListener("load", done);
                  img.removeEventListener("error", done);
                  reject(
                    new Error(
                      "Hay imágenes que siguen cargando. Reintentá o desactivá Incluir imágenes.",
                    ),
                  );
                }, 15000);
                img.addEventListener("load", done);
                img.addEventListener("error", done);
              }),
        ),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (documentRef.current) window.print();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPrinting(false);
    }
  }
  return (
    <section className="report-view">
      <div className="report-tools no-print">
        <button className="secondary" onClick={back}>
          <ArrowLeft size={16} /> Todos los informes
        </button>
        <div>
          <button className="secondary" onClick={openCase}>
            Abrir búsqueda
          </button>
          <button
            className="secondary"
            onClick={() => setVersion((v) => v + 1)}
            disabled={!data && !error}
          >
            <RefreshCw size={16} /> Volver a generar
          </button>
          <button
            className="primary"
            onClick={() => void print()}
            disabled={!data || printing}
          >
            <Printer size={17} />
            {printing ? "Preparando…" : "Imprimir / guardar PDF"}
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error no-print" role="alert">
          {error}
        </p>
      )}
      {!data || !model ? (
        <div className="empty">
          <FileText size={30} />
          <h3>
            {error ? "No se pudo generar el informe" : "Preparando el informe…"}
          </h3>
          <p>Se reúnen los registros autorizados de la búsqueda.</p>
        </div>
      ) : (
        <>
          <div className="report-options no-print">
            <label className="field">
              <span>Objetivos incluidos</span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="all">Todos los objetivos</option>
                {data.targets.map((t: Row) => (
                  <option value={t.id} key={t.id}>
                    {t.description}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={images}
                onChange={(e) => setImages(e.target.checked)}
              />{" "}
              Incluir imágenes
            </label>
            {!!data.suggestions.length && (
              <label>
                <input
                  type="checkbox"
                  checked={nextSteps}
                  onChange={(e) => setNextSteps(e.target.checked)}
                />{" "}
                Incluir sugerencias
              </label>
            )}
            <p>
              Corte: {fmt(data.generated_at)} · Para incorporar novedades, volvé
              a generar. En la ventana de impresión elegí «Guardar como PDF» y
              desactivá los encabezados del navegador.
            </p>
          </div>
          <article className="report-document" ref={documentRef}>
            <section className="report-cover">
              <header className="report-masthead">
                <div>
                  <strong>
                    rastreo<span>RÍO TERCERO</span>
                  </strong>
                  <p>Municipalidad de Río Tercero · Centro de monitoreo</p>
                </div>
                <div>
                  <span className="report-kicker">INFORME DE SITUACIÓN</span>
                  <b>{data.number}</b>
                </div>
              </header>
              <div className="report-title">
                <span className={`status ${data.status}`}>
                  <i />
                  {states[data.status]}
                </span>
                <h1>{data.title}</h1>
                <p>
                  {data.department_name} · Expediente:{" "}
                  {data.reference || "Sin informar"}
                </p>
              </div>
              <div className="report-dates">
                <div>
                  <span>PERÍODO DEL EVENTO · HORA ARGENTINA</span>
                  <b>
                    {fmt(data.starts_at)} — {fmt(data.ends_at)}
                  </b>
                </div>
                <div>
                  <span>FECHA DE CORTE</span>
                  <b>{fmt(data.generated_at)}</b>
                </div>
              </div>
              <div className="report-metrics">
                {[
                  [model.targets.length, "Objetivos"],
                  [model.confirmed.length, "Capturas confirmadas"],
                  [model.reviewedCameras, "Cámaras revisadas sin resultado"],
                  [model.notes.length, "Anotaciones de incertidumbre"],
                ].map(([value, label]) => (
                  <div key={String(label)}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <p className="report-lead">
                Se registraron <b>{model.captures.length} capturas</b>:{" "}
                {model.confirmed.length} confirmadas,{" "}
                {
                  model.captures.filter(
                    (e) => e.payload.certainty === "probable",
                  ).length
                }{" "}
                probables y{" "}
                {
                  model.captures.filter((e) => e.payload.certainty === "dudoso")
                    .length
                }{" "}
                dudosas. Hay {model.reviews.length} revisiones sin resultado y{" "}
                {model.timeline.filter((e) => e.kind === "aporte").length}{" "}
                aportes.{" "}
                {target !== "all" &&
                  "El informe está filtrado por objetivo; conserva los aportes generales del evento."}
              </p>
              <div className="report-map-heading">
                <h2>01 / Ubicaciones y recorrido</h2>
                <span>Los números corresponden a la cronología</span>
              </div>
              <ReportMap
                points={model.points}
                routes={model.routes}
                streets={streets}
              />
              {mapError && (
                <p className="report-caution">
                  No se pudo cargar la cartografía base. Se muestran únicamente
                  las ubicaciones y recorridos disponibles.
                </p>
              )}
              <div className="report-map-key">
                <span>
                  <i style={{ background: "#236c60" }} /> Captura confirmada
                </span>
                <span>
                  <i style={{ background: "#73558e" }} /> Probable / dudosa
                </span>
                <span>
                  <i style={{ background: "#ac6928" }} /> Lugar o aporte
                </span>
                <span>┄ Línea: recorrido estimado por calles</span>
              </div>
              <div className="report-targets">
                {model.targets.map((t) => (
                  <span key={t.id}>
                    <i style={{ background: t.color }} />
                    <b>{t.description}</b>
                    {t.plate && ` · ${t.plate}`}
                  </span>
                ))}
              </div>
              <p className="report-footnote">
                Las líneas son estimaciones, no trayectos acreditados. Los
                tramos marcados como inciertos no se dibujan. La conexión actual
                de una cámara no acredita grabación en la fecha del hecho.
              </p>
            </section>

            <section className="report-section report-context">
              <h2>02 / Contexto y hallazgos</h2>
              <p className="report-preserve">{data.description}</p>
              {model.targets.map((t) => {
                const observations = model.timeline.filter(
                  (e) =>
                    e.kind === "captura" &&
                    e.payload.certainty === "confirmado" &&
                    e.payload.target_ids.includes(t.id),
                );
                const first = observations[0],
                  last = observations.at(-1);
                return (
                  <div className="report-finding" key={t.id}>
                    <h3>
                      {t.description}
                      {t.plate && ` · ${t.plate}`}
                    </h3>
                    {first ? (
                      <p>
                        Primera aparición confirmada registrada:{" "}
                        <b>hito {first.sequence}</b>, {fmt(first.payload.at)},
                        en {cameraNames(first)}.
                        {last && last.id !== first.id && (
                          <>
                            {" "}
                            Última aparición confirmada registrada:{" "}
                            <b>hito {last.sequence}</b>, {fmt(last.payload.at)},
                            en {cameraNames(last)}.
                          </>
                        )}
                      </p>
                    ) : (
                      <p>
                        Sin apariciones confirmadas registradas para este
                        objetivo.
                      </p>
                    )}
                  </div>
                );
              })}
              <h3>Dudas y cuestiones a resolver</h3>
              {model.pending.length ? (
                <ul>
                  {model.pending.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  No se detectaron pendientes con estas reglas automáticas. Esto
                  no implica que la investigación esté completa.
                </p>
              )}
              {model.notes.map((n) => (
                <div className="report-caution" key={n.id}>
                  <strong>
                    Recorrido incierto ·{" "}
                    {
                      model.targets.find((t) => t.id === n.target_id)
                        ?.description
                    }
                  </strong>
                  <p>
                    {fmt(n.starts_at)} — {fmt(n.ends_at)} · {n.reason}
                  </p>
                </div>
              ))}
              {model.warnings
                .filter((w) => !w.uncertain)
                .map((w, i) => (
                  <p className="report-caution" key={i}>
                    {w.target} · hitos {w.fromNumber} → {w.toNumber}:{" "}
                    {w.warning}.
                  </p>
                ))}
              <div className="report-conclusion">
                <h3>Conclusión del responsable</h3>
                <label className="no-print">
                  <span className="muted">
                    Se incluye en este PDF. No se guarda en la búsqueda.
                  </span>
                  <textarea
                    aria-label="Conclusión del responsable"
                    rows={4}
                    maxLength={8000}
                    value={conclusion}
                    onChange={(e) => setConclusion(e.target.value)}
                    placeholder="Agregar la valoración y las acciones acordadas para la reunión…"
                  />
                </label>
                <div className="print-only report-preserve">
                  {conclusion.trim() ||
                    "Sin conclusión añadida por el responsable."}
                </div>
              </div>
            </section>

            <section className="report-section">
              <h2>03 / Cronología de observaciones y aportes</h2>
              <p className="muted">
                Ordenada por fecha del hecho. Los aportes sin horario se
                muestran al final. Los aportes particulares conservan su
                condición de fuente externa.
              </p>
              {model.timeline.length ? (
                model.timeline.map((e) => (
                  <div className="report-event" key={e.id}>
                    <div className="report-event-number">{e.sequence}</div>
                    <div className="report-event-body">
                      <div className="report-event-heading">
                        <strong>
                          {e.payload.at
                            ? fmt(e.payload.at)
                            : "Hora del hecho no informada"}
                        </strong>
                        <span
                          className={`report-certainty ${e.payload.certainty || "aporte"}`}
                        >
                          {e.kind === "captura"
                            ? certaintyLabels[e.payload.certainty]
                            : placeKind(e)}
                        </span>
                      </div>
                      <h3>
                        {e.kind === "captura"
                          ? cameraNames(e)
                          : e.payload.place_name || "Aporte al evento"}
                      </h3>
                      {e.kind === "captura" ? (
                        <>
                          <p className="report-objective">
                            {model.targets
                              .filter((t) =>
                                e.payload.target_ids.includes(t.id),
                              )
                              .map((t) => t.description)
                              .join(" · ")}
                          </p>
                          {e.payload.direction && (
                            <p>Sentido observado: {e.payload.direction}</p>
                          )}
                          <p className="report-preserve">
                            {e.payload.note || "Sin observación adicional."}
                          </p>
                        </>
                      ) : (
                        <>
                          <p>{e.payload.address}</p>
                          <p className="report-preserve">{e.payload.text}</p>
                          <p className="muted">
                            Aporte registrado; no equivale a una captura
                            confirmada por la sala.
                          </p>
                        </>
                      )}
                      <small className="muted">
                        Registrado por {e.author} · {fmt(e.created_at)}
                      </small>
                      {images && (
                        <div className="report-images">
                          {model.attachments
                            .filter(
                              (a) =>
                                a.entry_id === e.id &&
                                [
                                  "image/jpeg",
                                  "image/png",
                                  "image/webp",
                                ].includes(a.mime),
                            )
                            .map((a) => (
                              <ReportImage key={a.id} attachment={a} />
                            ))}
                        </div>
                      )}
                      {model.attachments
                        .filter(
                          (a) =>
                            a.entry_id === e.id &&
                            (!images ||
                              ![
                                "image/jpeg",
                                "image/png",
                                "image/webp",
                              ].includes(a.mime)),
                        )
                        .map((a) => (
                          <p className="report-attachment" key={a.id}>
                            Adjunto: {a.name} · disponible en la búsqueda
                            {a.mime.startsWith("video/")
                              ? " (video no incorporado al PDF)"
                              : ""}
                            .
                          </p>
                        ))}
                    </div>
                  </div>
                ))
              ) : (
                <p>No hay observaciones ni aportes registrados.</p>
              )}
            </section>

            <section className="report-section">
              <h2>04 / Revisiones sin resultado</h2>
              {model.reviews.length ? (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Cámara</th>
                      <th>Franja revisada</th>
                      <th>Objetivo / operador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.reviews.map((r) => (
                      <tr key={r.id}>
                        <td>{cameraNames(r)}</td>
                        <td>
                          {fmt(r.payload.from)}
                          <br />
                          {fmt(r.payload.to)}
                        </td>
                        <td>
                          {model.targets.find(
                            (t) => t.id === r.payload.target_id,
                          )?.description || "Todos los objetivos"}
                          <br />
                          <small>{r.author}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>No hay revisiones sin resultado registradas.</p>
              )}
              <p className="report-footnote">
                Una revisión sin resultado no demuestra que el objetivo no haya
                pasado por el lugar.
              </p>
            </section>

            {nextSteps && model.suggestions.length > 0 && (
              <section className="report-section">
                <h2>05 / Próximos pasos sugeridos</h2>
                <p>
                  Prioridades automáticas calculadas al generar este informe,
                  desde la última captura confirmada. No son avistamientos. La
                  disponibilidad histórica de video debe consultarse por
                  separado.
                </p>
                {model.suggestions.map((s) => (
                  <div className="report-suggestion-group" key={s.target_id}>
                    <h3>
                      {
                        model.targets.find((t) => t.id === s.target_id)
                          ?.description
                      }
                    </h3>
                    <p className="muted">
                      {s.message ||
                        "Criterio: dirección y alternativas · horizonte de 15 minutos desde la última captura."}
                    </p>
                    {s.warnings.map((w: string, i: number) => (
                      <p className="report-caution" key={i}>
                        {w}
                      </p>
                    ))}
                    {s.assumptions && (
                      <p className="report-footnote">
                        Supuestos del cálculo: {s.assumptions.speed} km/h ·{" "}
                        {s.assumptions.speed_source}. No representa una
                        velocidad observada acreditada.
                      </p>
                    )}
                    {s.suggestions.length > 0 && (
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Cámara</th>
                            <th>Franja para revisar</th>
                            <th>Fundamento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.suggestions.map((p: Row) => (
                            <tr key={p.camera.id}>
                              <td>
                                CAM-{p.camera.number}
                                <br />
                                {p.camera.name}
                              </td>
                              <td>
                                {fmt(p.from)}
                                <br />
                                {fmt(p.to)}
                              </td>
                              <td>
                                {p.reasons.join(" · ")}
                                <br />
                                <small>Revisión previa: {p.coverage}</small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </section>
            )}
            <footer className="report-footer">
              <b>Rastreo · {data.number}</b>
              <span>
                Generado por {data.generated_by} · {fmt(data.generated_at)} ·
                Hora argentina (UTC−03:00).
              </span>
              <p>
                Informe de situación basado en registros del sistema al corte
                indicado. Los cambios posteriores requieren una nueva emisión.
              </p>
            </footer>
          </article>
        </>
      )}
    </section>
  );
}
