import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bell,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageSquare,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api, fmt, iso, localTime, roles, states } from "./api";
import { CityMap } from "./Map";
import "./style.css";

type Row = Record<string, any>;
const staff = (user: Row) => user.role !== "externo";
const supervisor = (user: Row) => ["admin", "supervisor"].includes(user.role);
const formValue = (form: FormData, key: string) => String(form.get(key) || "");

function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {states[status]}
    </span>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-symbol">
        <MapPin size={22} />
      </div>
      <div>
        rastreo<span>RÍO TERCERO</span>
      </div>
    </div>
  );
}
function Empty({
  title,
  text: description,
  icon: Icon = FolderOpen,
}: {
  title: string;
  text: string;
  icon?: typeof FolderOpen;
}) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Cerrar">
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Form({
  children,
  submit,
  label = "Guardar",
  onDone,
}: {
  children: React.ReactNode;
  submit: (data: FormData) => Promise<any>;
  label?: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await submit(data);
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <span className="muted">Los cambios quedan registrados.</span>
        <button className="primary" disabled={busy}>
          {busy ? "Guardando…" : label}
          <ArrowRight size={16} />
        </button>
      </footer>
    </form>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="login">
      <section className="login-intro">
        <Brand />
        <div>
          <span className="eyebrow">CENTRO DE MONITOREO MUNICIPAL</span>
          <h1>
            Cada captura,
            <br />
            una parte del
            <br />
            <em>recorrido.</em>
          </h1>
          <p>
            Un espacio de trabajo para conectar cámaras, ordenar hallazgos y
            coordinar las búsquedas.
          </p>
        </div>
        <span className="login-footer">
          <ShieldCheck size={16} /> Municipalidad de Río Tercero · Cómputos
        </span>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">ACCESO AL SISTEMA</span>
          <h2>Bienvenido a Rastreo</h2>
          <p className="muted">Ingresá con la cuenta de tu dependencia.</p>
          <Form
            submit={(f) =>
              api("/login", "POST", {
                username: formValue(f, "username"),
                password: formValue(f, "password"),
              })
            }
            label="Ingresar"
            onDone={onLogin}
          >
            <Field label="Usuario">
              <input
                name="username"
                required
                autoComplete="username"
                autoFocus
                placeholder="Tu nombre de usuario"
              />
            </Field>
            <Field label="Contraseña">
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Tu contraseña"
              />
            </Field>
          </Form>
          <p className="login-help">
            <CircleHelp size={16} /> Para solicitar una cuenta, contactá a
            Cómputos.
          </p>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<Row | null>(null),
    [loading, setLoading] = useState(true);
  const [page, setPage] = useState("cases"),
    [selected, setSelected] = useState<string | null>(() =>
      new URLSearchParams(window.location.search).get("busqueda"),
    );
  const [cases, setCases] = useState<Row[]>([]),
    [departments, setDepartments] = useState<Row[]>([]),
    [cameras, setCameras] = useState<Row[]>([]),
    [notices, setNotices] = useState<Row[]>([]);
  const [newCase, setNewCase] = useState(false),
    [noticeOpen, setNoticeOpen] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      selected
        ? `?busqueda=${encodeURIComponent(selected)}`
        : window.location.pathname,
    );
  }, [selected]);
  const me = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await api("/me"));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      const [c, d, cam, n] = await Promise.all([
        api("/cases"),
        api("/departments"),
        api("/cameras"),
        api("/notices"),
      ]);
      setCases(c);
      setDepartments(d);
      setCameras(cam);
      setNotices(n);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void me();
    const expired = () => setUser(null);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, [me]);
  useEffect(() => {
    if (!user) return;
    void refresh();
    const socket = io();
    let timer: ReturnType<typeof setTimeout>;
    socket.on("refresh", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, 150);
    });
    socket.on("connect", () => {
      void refresh();
      setRevision((v) => v + 1);
    });
    return () => {
      clearTimeout(timer);
      socket.disconnect();
    };
  }, [user, refresh]);
  if (loading)
    return (
      <div className="loading">
        <Brand />
        <p>Cargando sala de trabajo…</p>
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={() => {
          setSelected(null);
          void me();
        }}
      />
    );
  const unread = notices.filter((n) => !n.read).length;
  const filtered = cases.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      `${c.number} ${c.title} ${c.reference} ${c.department_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function go(next: string) {
    setPage(next);
    setSelected(null);
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">SALA DE TRABAJO</div>
        <nav>
          <button
            className={page === "cases" ? "active" : ""}
            onClick={() => go("cases")}
          >
            <LayoutDashboard size={19} />
            Búsquedas
            <span>
              {
                cases.filter(
                  (c) => !["archivada", "rechazada"].includes(c.status),
                ).length
              }
            </span>
          </button>
          {staff(user) && (
            <button
              className={page === "cameras" ? "active" : ""}
              onClick={() => go("cameras")}
            >
              <Camera size={19} />
              Cámaras
            </button>
          )}
          {user.role === "admin" && (
            <button
              className={page === "admin" ? "active" : ""}
              onClick={() => go("admin")}
            >
              <Settings size={19} />
              Administración
            </button>
          )}
        </nav>
        <div className="sidebar-note">
          <Activity size={18} />
          <strong>Trabajo compartido</strong>
          <p>Las capturas y novedades se actualizan en tiempo real.</p>
        </div>
        <div className="profile">
          <div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{user.name}</strong>
            <small>{roles[user.role]}</small>
          </div>
          <button
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="icon-button"
            onClick={async () => {
              try {
                await api("/logout", "POST");
                setUser(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Municipalidad de Río Tercero <ChevronRight size={14} />
            <b>
              {page === "admin"
                ? "Administración"
                : page === "cameras"
                  ? "Red de cámaras"
                  : "Búsquedas"}
            </b>
          </span>
          <div className="topbar-actions">
            <span className="private-badge">
              <ShieldCheck size={14} /> Acceso identificado
            </span>
            <button
              className="notice-button"
              aria-label={`Notificaciones: ${unread} sin leer`}
              onClick={() => setNoticeOpen(!noticeOpen)}
            >
              <Bell size={19} />
              {unread > 0 && <i>{unread}</i>}
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="banner">
            {error}
            <button onClick={() => void refresh()}>Reintentar</button>
          </div>
        )}
        {noticeOpen && (
          <div className="notices">
            <header>
              <h3>Novedades</h3>
              <button
                onClick={async () => {
                  try {
                    await api("/notices/read", "POST");
                    void refresh();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                Marcar leídas
              </button>
            </header>
            {notices.length ? (
              notices.map((n) => (
                <button
                  key={n.id}
                  className={n.read ? "" : "unread"}
                  onClick={() => {
                    setSelected(n.case_id);
                    setPage("cases");
                    setNoticeOpen(false);
                  }}
                >
                  {n.text}
                  <small>{fmt(n.created_at)}</small>
                </button>
              ))
            ) : (
              <p className="muted">Todavía no hay avisos.</p>
            )}
          </div>
        )}
        <main>
          {page === "cases" &&
            (selected ? (
              <CaseDetail
                key={selected}
                caseId={selected}
                user={user}
                cameras={cameras}
                revision={revision}
                back={() => {
                  setSelected(null);
                  void refresh();
                }}
              />
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">COORDINACIÓN Y SEGUIMIENTO</span>
                    <h1>Búsquedas</h1>
                    <p>
                      Los pedidos, los hallazgos y el próximo paso. En un solo
                      lugar.
                    </p>
                  </div>
                  <button className="primary" onClick={() => setNewCase(true)}>
                    <Plus size={18} />
                    Nuevo pedido
                  </button>
                </div>
                <div className="stats">
                  {[
                    ["pedida", "Pedidos pendientes", FolderOpen],
                    ["en_curso", "En curso", Activity],
                    ["en_revision", "Para revisión", ShieldCheck],
                    ["entregada", "Entregadas", Check],
                  ].map(([key, label, Icon]: any) => (
                    <button
                      className={`stat ${filter === key ? "selected" : ""}`}
                      key={key}
                      onClick={() => setFilter(filter === key ? "all" : key)}
                    >
                      <div>
                        <span>{label}</span>
                        <strong>
                          {cases
                            .filter((c) => c.status === key)
                            .length.toString()
                            .padStart(2, "0")}
                        </strong>
                      </div>
                      <Icon size={22} strokeWidth={1.5} />
                    </button>
                  ))}
                </div>
                <div className="toolbar">
                  <div className="tabs">
                    <button
                      className={filter === "all" ? "active" : ""}
                      onClick={() => setFilter("all")}
                    >
                      Todas las búsquedas
                    </button>
                    <button
                      className={filter === "archivada" ? "active" : ""}
                      onClick={() => setFilter("archivada")}
                    >
                      Archivadas
                    </button>
                    <button
                      className={filter === "rechazada" ? "active" : ""}
                      onClick={() => setFilter("rechazada")}
                    >
                      Rechazadas
                    </button>
                  </div>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Buscar pedidos"
                      placeholder="Buscar número, hecho o expediente…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                <div className="list-title">
                  <span>
                    {filter === "all" ? "Todos los pedidos" : states[filter]}
                  </span>
                  <small>{filtered.length} búsquedas</small>
                </div>
                {filtered.length ? (
                  <div className="case-grid">
                    {filtered.map((c) => (
                      <button
                        className="case-card"
                        key={c.id}
                        onClick={() => setSelected(c.id)}
                      >
                        <div className="card-top">
                          <span className="case-number">{c.number}</span>
                          <Status status={c.status} />
                        </div>
                        <h2>{c.title}</h2>
                        <p>{c.description}</p>
                        <div className="card-meta">
                          <span>
                            <Users size={14} />
                            {c.department_name}
                          </span>
                          <span>
                            <Clock3 size={14} />
                            {fmt(c.starts_at)}
                          </span>
                        </div>
                        <div className="card-bottom">
                          <span>
                            <Camera size={15} />
                            {c.capture_count} capturas
                          </span>
                          <span>
                            Abrir búsqueda <ArrowRight size={16} />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-dashboard">
                    <Empty
                      title={
                        query
                          ? "No hay coincidencias"
                          : "La próxima búsqueda empieza acá"
                      }
                      text={
                        query
                          ? "Probá con otro número o descripción."
                          : "Creá un pedido para comenzar a registrar capturas y reconstruir el recorrido."
                      }
                    />
                    {!query && (
                      <button
                        className="secondary"
                        onClick={() => setNewCase(true)}
                      >
                        <Plus size={16} />
                        Crear primer pedido
                      </button>
                    )}
                    <div className="workflow">
                      <span>01 · Pedido</span>
                      <ArrowRight size={16} />
                      <span>02 · Seguimiento</span>
                      <ArrowRight size={16} />
                      <span>03 · Revisión y entrega</span>
                    </div>
                  </div>
                )}
                <div className="workspace-footer">
                  <span>
                    <span className="live-dot" /> {cameras.length} cámaras
                    disponibles
                  </span>
                  <span>Herramienta de trabajo · Recorridos estimados</span>
                </div>
              </>
            ))}
          {page === "cameras" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">INFRAESTRUCTURA DE MONITOREO</span>
                  <h1>Red de cámaras</h1>
                  <p>{cameras.length} cámaras activas en Río Tercero.</p>
                </div>
              </div>
              <CityMap
                cameras={cameras}
                onCamera={(c) => {
                  setQuery(String(c.number));
                }}
              />
              <div className="toolbar">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Buscar cámara"
                    placeholder="Número o ubicación…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <div className="camera-list">
                {cameras
                  .filter((c) =>
                    `${c.number} ${c.name}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((c) => (
                    <div key={c.id}>
                      <Camera size={16} />
                      <strong>CAM-{c.number}</strong>
                      <span>
                        {c.name
                          .replace(/^CAM[-_ ]?\d+[_ ]?/i, "")
                          .replaceAll("_", " ")}
                      </span>
                    </div>
                  ))}
              </div>
            </>
          )}
          {page === "admin" && (
            <Admin
              departments={departments}
              currentUser={user}
              refresh={refresh}
            />
          )}
        </main>
      </div>
      {newCase && (
        <Modal title="Nuevo pedido de búsqueda" close={() => setNewCase(false)}>
          <Form
            label="Crear pedido"
            onDone={() => {
              setNewCase(false);
              void refresh();
            }}
            submit={async (f) => {
              const c = await api("/cases", "POST", {
                title: formValue(f, "title"),
                description: formValue(f, "description"),
                reference: formValue(f, "reference"),
                department_id: formValue(f, "department_id"),
                starts_at: iso(f.get("starts_at")),
                ends_at: iso(f.get("ends_at")),
              });
              setSelected(c.id);
            }}
          >
            <Field label="Título del pedido">
              <input
                name="title"
                required
                maxLength={180}
                placeholder="Ej. Vehículo a identificar en zona centro"
              />
            </Field>
            <Field label="Descripción del hecho">
              <textarea
                name="description"
                required
                maxLength={4000}
                placeholder="Qué se busca y qué información tenemos…"
              />
            </Field>
            <div className="form-grid">
              <Field label="Dependencia solicitante">
                <select
                  name="department_id"
                  required
                  defaultValue={user.department_id || ""}
                >
                  <option value="" disabled>
                    Seleccionar dependencia
                  </option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Expediente u oficio">
                <input
                  name="reference"
                  placeholder="Opcional"
                  maxLength={200}
                />
              </Field>
              <Field label="Desde (hora argentina)">
                <input
                  name="starts_at"
                  type="datetime-local"
                  step="1"
                  required
                />
              </Field>
              <Field label="Hasta (hora argentina)">
                <input name="ends_at" type="datetime-local" step="1" required />
              </Field>
            </div>
          </Form>
        </Modal>
      )}
    </div>
  );
}

function CaseDetail({
  caseId,
  user,
  cameras,
  revision,
  back,
}: {
  caseId: string;
  user: Row;
  cameras: Row[];
  revision: number;
  back: () => void;
}) {
  const [detail, setDetail] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("captura");
  const [modal, setModal] = useState(""),
    [cameraId, setCameraId] = useState(""),
    [people, setPeople] = useState<Row[]>([]),
    [connected, setConnected] = useState(false);
  const [nextState, setNextState] = useState(""),
    [deleting, setDeleting] = useState<Row | null>(null);
  const [attachmentEntry, setAttachmentEntry] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setDetail(await api(`/cases/${caseId}`));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [caseId]);
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);
  useEffect(() => {
    const socket = io();
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", caseId);
      void refresh();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("presence", setPeople);
    socket.on("changed", () => void refresh());
    return () => {
      socket.disconnect();
    };
  }, [caseId, refresh]);
  if (!detail)
    return (
      <>
        <button className="back" onClick={back}>
          <ArrowLeft size={16} />
          Volver a búsquedas
        </button>
        {error ? (
          <p className="form-error">{error}</p>
        ) : (
          <p>Cargando búsqueda…</p>
        )}
      </>
    );
  const c = detail,
    working = c.status === "en_curso",
    open = ["pedida", "en_curso", "en_revision"].includes(c.status);
  const transitions: Record<string, string[]> = {
    pedida: ["en_curso", "rechazada"],
    en_curso: ["en_revision"],
    en_revision: ["entregada", "en_curso"],
    entregada: ["archivada", "en_curso"],
    archivada: ["en_curso"],
    rechazada: ["en_curso"],
  };
  const available = supervisor(user)
    ? transitions[c.status]
    : user.role === "operador" && working
      ? ["en_revision"]
      : [];
  const actionName = (s: string) =>
    s === "en_curso"
      ? c.status === "pedida"
        ? "Tomar búsqueda"
        : c.status === "en_revision"
          ? "Devolver a sala"
          : "Reabrir búsqueda"
      : s === "en_revision"
        ? "Enviar a revisión"
        : s === "entregada"
          ? "Entregar búsqueda"
          : s === "archivada"
            ? "Archivar"
            : "Rechazar pedido";
  const entries = c.entries
    .filter((e: Row) => e.kind === tab)
    .sort((a: Row, b: Row) =>
      tab === "captura"
        ? Date.parse(a.payload.at) - Date.parse(b.payload.at)
        : Date.parse(a.created_at) - Date.parse(b.created_at),
    );
  const done = () => {
    setModal("");
    setNextState("");
    setDeleting(null);
    setAttachmentEntry(null);
    void refresh();
  };
  const loadAttachment = async (f: FormData) => {
    const data = new FormData();
    data.append("file", f.get("file")!);
    await api(
      `/cases/${caseId}/entries/${attachmentEntry}/attachments`,
      "POST",
      data,
    );
  };
  return (
    <div className="case-detail">
      <button className="back" onClick={back}>
        <ArrowLeft size={16} />
        Todas las búsquedas
      </button>
      <div className="page-heading">
        <div>
          <div className="detail-kicker">
            <span className="case-number">{c.number}</span>
            <Status status={c.status} />
          </div>
          <h1>{c.title}</h1>
          <p>
            {c.reference ? `Expediente ${c.reference} · ` : ""}
            {fmt(c.starts_at)} — {fmt(c.ends_at)}
          </p>
        </div>
        <div className="action-row">
          {available.map((s) => (
            <button
              key={s}
              className={
                ["en_curso", "en_revision", "entregada"].includes(s)
                  ? "primary"
                  : "secondary"
              }
              onClick={() => setNextState(s)}
            >
              {actionName(s)}
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="case-workbench">
        <aside className="case-info">
          <span className="eyebrow">EL PEDIDO</span>
          <p className="case-description">{c.description}</p>
          <div className="section-heading">
            <h3>
              Objetivos <span>{c.targets.length}</span>
            </h3>
            {staff(user) && working && (
              <button
                className="icon-button"
                aria-label="Agregar objetivo"
                onClick={() => setModal("target")}
              >
                <Plus size={18} />
              </button>
            )}
          </div>
          {c.targets.length ? (
            c.targets.map((t: Row) => (
              <div key={t.id} className="target">
                <i style={{ background: t.color }} />
                <div>
                  <strong>{t.description}</strong>
                  <small>
                    {t.kind === "vehiculo"
                      ? "Vehículo"
                      : t.kind === "persona"
                        ? "Persona"
                        : "Otro"}
                    {t.plate ? ` · ${t.plate}` : ""}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">
              Cuando la sala tome el pedido, podrá agregar los objetivos a
              seguir.
            </p>
          )}
          {staff(user) && working && (
            <div className="case-tools">
              <button
                className="primary"
                onClick={() => {
                  setCameraId("");
                  setModal("captura");
                }}
                disabled={!c.targets.length || !cameras.length}
              >
                <Plus size={17} />
                Registrar captura
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setCameraId("");
                  setModal("revision");
                }}
                disabled={!cameras.length}
              >
                <Check size={17} />
                Revisada sin resultado
              </button>
            </div>
          )}
          <div className="collaborators">
            <span>
              <i className={connected ? "live-dot" : "offline-dot"} />
              {connected ? "En vivo" : "Reconectando…"}
            </span>
            {people.map((p) => (
              <small key={p.id}>{p.name}</small>
            ))}
          </div>
          <div className="exports">
            <h4>Exportar búsqueda</h4>
            <a href={`/api/cases/${caseId}/export/csv`}>
              <Download size={15} />
              Planilla CSV
            </a>
            <a href={`/api/cases/${caseId}/export/kml`}>
              <MapPin size={15} />
              Mapa KML
            </a>
          </div>
        </aside>
        <div>
          <CityMap
            cameras={cameras}
            detail={c}
            onCamera={(camera) => {
              if (staff(user) && working) {
                setCameraId(camera.id);
                setModal("captura");
              }
            }}
          />
          <div className="route-summary">
            <span>
              <Activity size={16} />
              Recorrido probable por objetivo
            </span>
            <small>Las capturas dudosas se muestran sin unir.</small>
          </div>
          {c.routes.flatMap((r: Row) =>
            r.legs
              .filter((l: Row) => l.warning)
              .map((l: Row, i: number) => (
                <div key={`${r.target_id}-${i}`} className="route-warning">
                  <CircleHelp size={16} />
                  {r.description}: {l.warning}
                  {l.speed !== null ? ` (${l.speed.toFixed(1)} km/h)` : ""}
                </div>
              )),
          )}
        </div>
      </div>
      <section className="activity-panel">
        <div className="activity-header">
          <div className="tabs">
            {[
              ["captura", "Cronología", Camera],
              ["revision", "Revisiones", Check],
              ["aporte", "Aportes", MapPin],
              ["mensaje", "Chat", MessageSquare],
              ["history", "Historial", Clock3],
            ].map(([key, label, Icon]: any) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                <Icon size={16} />
                {label}
                {key !== "history" && (
                  <span>
                    {c.entries.filter((e: Row) => e.kind === key).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          {tab === "aporte" && open && (
            <button className="secondary" onClick={() => setModal("aporte")}>
              <Plus size={15} />
              Aportar información
            </button>
          )}
        </div>
        {tab === "history" ? (
          <div className="history">
            {c.history.map((h: Row) => (
              <div key={h.id}>
                <span className="history-dot" />
                <div>
                  <strong>
                    {h.action === "state"
                      ? `${states[h.detail.from]} → ${states[h.detail.to]}`
                      : h.action === "created"
                        ? "Pedido creado"
                        : h.action === "target_created"
                          ? "Objetivo agregado"
                          : h.action === "entry_deleted"
                            ? "Registro eliminado"
                            : h.action === "attachment_created"
                              ? "Adjunto agregado"
                              : h.action
                                  .replace("_created", " agregado")
                                  .replace("captura", "Captura")
                                  .replace("revision", "Revisión")
                                  .replace("mensaje", "Mensaje")
                                  .replace("aporte", "Aporte")}
                  </strong>
                  {h.detail.observation && <p>{h.detail.observation}</p>}
                  <small>
                    {h.author} · {fmt(h.created_at)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={tab === "mensaje" ? "chat-list" : "entry-list"}>
            {entries.length ? (
              entries.map((e: Row) => {
                const p = e.payload;
                return (
                  <article
                    key={e.id}
                    className={`entry ${tab === "mensaje" && e.user_id === user.id ? "own" : ""}`}
                  >
                    <div className="entry-icon">
                      {tab === "captura" ? (
                        <Camera size={18} />
                      ) : tab === "mensaje" ? (
                        <MessageSquare size={18} />
                      ) : tab === "revision" ? (
                        <Check size={18} />
                      ) : (
                        <MapPin size={18} />
                      )}
                    </div>
                    <div className="entry-body">
                      <header>
                        <strong>
                          {tab === "captura"
                            ? fmt(p.at)
                            : tab === "revision"
                              ? `CAM-${p.cameras[0].number} · sin resultado`
                              : e.author}
                        </strong>
                        {tab === "captura" && (
                          <span className={`certainty ${p.certainty}`}>
                            {p.certainty}
                          </span>
                        )}
                      </header>
                      {tab === "captura" && (
                        <>
                          <p>
                            {p.cameras
                              .map((cam: Row) => `CAM-${cam.number}`)
                              .join(" / ")}{" "}
                            ·{" "}
                            {c.targets
                              .filter((t: Row) => p.target_ids.includes(t.id))
                              .map((t: Row) => t.description)
                              .join(" + ")}
                          </p>
                          {p.direction && (
                            <p className="muted">Sentido: {p.direction}</p>
                          )}
                          {p.note && <p>{p.note}</p>}
                        </>
                      )}
                      {tab === "revision" && (
                        <p>
                          {fmt(p.from)} — {fmt(p.to)}
                          {p.target_id
                            ? ` · ${c.targets.find((t: Row) => t.id === p.target_id)?.description}`
                            : " · Todos los objetivos"}
                        </p>
                      )}
                      {p.text && <p className="preserve">{p.text}</p>}
                      {p.at && tab === "aporte" && (
                        <p className="muted">Referencia: {fmt(p.at)}</p>
                      )}
                      <small>
                        {e.author} · Cargado {fmt(e.created_at)}
                      </small>
                      <div className="attachment-links">
                        {c.attachments
                          .filter((a: Row) => a.entry_id === e.id)
                          .map((a: Row) => (
                            <a key={a.id} href={`/api/attachments/${a.id}`}>
                              <FileText size={14} />
                              {a.name} · {(a.size / 1024 / 1024).toFixed(1)} MB
                            </a>
                          ))}
                      </div>
                    </div>
                    <div className="entry-actions">
                      {["captura", "aporte"].includes(tab) &&
                        ((tab === "captura" && working && staff(user)) ||
                          (tab === "aporte" &&
                            open &&
                            (staff(user) || e.user_id === user.id))) && (
                          <button
                            title="Adjuntar archivo"
                            aria-label="Adjuntar archivo"
                            className="icon-button"
                            onClick={() => setAttachmentEntry(e.id)}
                          >
                            <Upload size={16} />
                          </button>
                        )}
                      {(supervisor(user) || e.user_id === user.id) &&
                        (["mensaje", "aporte"].includes(tab)
                          ? open
                          : working) && (
                          <button
                            title="Eliminar registro"
                            aria-label="Eliminar registro"
                            className="icon-button"
                            onClick={() => setDeleting(e)}
                          >
                            <X size={15} />
                          </button>
                        )}
                    </div>
                  </article>
                );
              })
            ) : (
              <Empty
                title={
                  tab === "captura"
                    ? "Todavía no hay capturas"
                    : tab === "mensaje"
                      ? "La conversación empieza acá"
                      : tab === "revision"
                        ? "Sin revisiones registradas"
                        : "Sin aportes todavía"
                }
                text={
                  tab === "captura"
                    ? "Agregá un objetivo y registrá su primera aparición en una cámara."
                    : tab === "mensaje"
                      ? "Compartí hallazgos y coordiná el trabajo de la búsqueda."
                      : tab === "revision"
                        ? "Registrá qué cámaras y horarios ya se revisaron."
                        : "Sumá datos, horarios o ubicaciones que ayuden a la búsqueda."
                }
              />
            )}
          </div>
        )}
        {tab === "mensaje" && open && (
          <ChatComposer
            caseId={caseId}
            people={people}
            user={user}
            refresh={refresh}
          />
        )}
      </section>
      {nextState && (
        <Modal title={actionName(nextState)} close={() => setNextState("")}>
          <Form
            onDone={done}
            label="Confirmar cambio"
            submit={(f) =>
              api(`/cases/${caseId}/state`, "POST", {
                status: nextState,
                observation: formValue(f, "observation"),
              })
            }
          >
            <p>
              El pedido pasará de <b>{states[c.status]}</b> a{" "}
              <b>{states[nextState]}</b>.
            </p>
            <Field label="Observaciones">
              <textarea
                name="observation"
                maxLength={2000}
                required={
                  nextState === "rechazada" ||
                  (nextState === "en_curso" && c.status !== "pedida")
                }
                placeholder="Motivo u observaciones para el equipo"
              />
            </Field>
          </Form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Eliminar registro" close={() => setDeleting(null)}>
          <Form
            onDone={done}
            label="Eliminar registro"
            submit={() =>
              api(`/cases/${caseId}/entries/${deleting.id}`, "DELETE")
            }
          >
            <p>
              Se ocultará este registro. Su contenido y la acción quedarán
              conservados en el sistema.
            </p>
          </Form>
        </Modal>
      )}
      {attachmentEntry && (
        <Modal
          title="Adjuntar foto o clip"
          close={() => setAttachmentEntry(null)}
        >
          <Form onDone={done} label="Subir archivo" submit={loadAttachment}>
            <Field label="Archivo (máximo 50 MB)">
              <input type="file" name="file" required />
            </Field>
            <p className="muted">
              Se guardará junto al registro y estará disponible para quienes
              pueden consultar esta búsqueda.
            </p>
          </Form>
        </Modal>
      )}
      {modal && (
        <Modal
          title={
            modal === "target"
              ? "Agregar objetivo"
              : modal === "captura"
                ? "Registrar captura"
                : modal === "revision"
                  ? "Revisión sin resultado"
                  : "Aportar información"
          }
          close={() => setModal("")}
        >
          <Form
            onDone={done}
            submit={async (f) => {
              if (modal === "target")
                return api(`/cases/${caseId}/targets`, "POST", {
                  kind: formValue(f, "kind"),
                  description: formValue(f, "description"),
                  plate: formValue(f, "plate"),
                  color: formValue(f, "color"),
                });
              const payload =
                modal === "captura"
                  ? {
                      camera_ids: f.getAll("camera_ids"),
                      target_ids: f.getAll("target_ids"),
                      at: iso(f.get("at")),
                      direction: formValue(f, "direction"),
                      certainty: formValue(f, "certainty"),
                      note: formValue(f, "note"),
                    }
                  : modal === "revision"
                    ? {
                        camera_id: formValue(f, "camera_id"),
                        target_id: formValue(f, "target_id") || null,
                        from: iso(f.get("from")),
                        to: iso(f.get("to")),
                      }
                    : {
                        text: formValue(f, "text"),
                        ...(f.get("at") ? { at: iso(f.get("at")) } : {}),
                        ...(f.get("lon") !== "" && f.get("lon") !== null
                          ? {
                              lon: Number(f.get("lon")),
                              lat: Number(f.get("lat")),
                            }
                          : {}),
                      };
              return api(`/cases/${caseId}/entries/${modal}`, "POST", payload);
            }}
          >
            {modal === "target" && (
              <>
                <Field label="Descripción del objetivo">
                  <input
                    name="description"
                    required
                    maxLength={500}
                    placeholder="Ej. VW Gol gris, dos ocupantes"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Tipo">
                    <select name="kind">
                      <option value="vehiculo">Vehículo</option>
                      <option value="persona">Persona</option>
                      <option value="otro">Otro</option>
                    </select>
                  </Field>
                  <Field label="Patente, si se conoce">
                    <input name="plate" maxLength={30} />
                  </Field>
                </div>
                <Field label="Color en el mapa">
                  <input
                    name="color"
                    type="color"
                    defaultValue={
                      ["#cf772f", "#326db6", "#8e5eab", "#277f69"][
                        c.targets.length % 4
                      ]
                    }
                  />
                </Field>
              </>
            )}
            {modal === "captura" && (
              <>
                <Field label="Cámara(s) · Ctrl o ⌘ para seleccionar varias">
                  <select
                    name="camera_ids"
                    multiple
                    required
                    defaultValue={cameraId ? [cameraId] : []}
                    size={6}
                  >
                    {cameras.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.name.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <fieldset>
                  <legend>Objetivos presentes</legend>
                  {c.targets.map((t: Row) => (
                    <label className="checkbox" key={t.id}>
                      <input
                        type="checkbox"
                        name="target_ids"
                        value={t.id}
                        defaultChecked={c.targets.length === 1}
                      />
                      <i style={{ background: t.color }} />
                      {t.description}
                    </label>
                  ))}
                </fieldset>
                <div className="form-grid">
                  <Field label="Fecha y hora (Argentina)">
                    <input
                      type="datetime-local"
                      name="at"
                      step="1"
                      required
                      defaultValue={localTime(c.starts_at)}
                      min={localTime(c.starts_at)}
                      max={localTime(c.ends_at)}
                    />
                  </Field>
                  <Field label="Certeza">
                    <select name="certainty">
                      <option value="confirmado">Confirmado</option>
                      <option value="probable">Probable</option>
                      <option value="dudoso">Dudoso</option>
                    </select>
                  </Field>
                </div>
                <Field label="Sentido observado">
                  <input
                    name="direction"
                    maxLength={150}
                    placeholder="Ej. hacia el norte o hacia calle X"
                  />
                </Field>
                <Field label="Observaciones">
                  <textarea name="note" maxLength={4000} />
                </Field>
                <p className="muted">
                  Podés agregar fotos o clips al registro después de guardarlo.
                </p>
              </>
            )}
            {modal === "revision" && (
              <>
                <Field label="Cámara">
                  <select name="camera_id" required defaultValue={cameraId}>
                    {!cameraId && <option value="">Seleccionar cámara</option>}
                    {cameras.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.name.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Objetivo">
                  <select name="target_id">
                    <option value="">Todos los objetivos</option>
                    {c.targets.map((t: Row) => (
                      <option key={t.id} value={t.id}>
                        {t.description}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="Revisada desde (Argentina)">
                    <input
                      type="datetime-local"
                      name="from"
                      step="1"
                      required
                      defaultValue={localTime(c.starts_at)}
                    />
                  </Field>
                  <Field label="Hasta (Argentina)">
                    <input
                      type="datetime-local"
                      name="to"
                      step="1"
                      required
                      defaultValue={localTime(c.ends_at)}
                    />
                  </Field>
                </div>
              </>
            )}
            {modal === "aporte" && (
              <>
                <Field label="Información para la búsqueda">
                  <textarea
                    name="text"
                    required
                    maxLength={4000}
                    placeholder="Describí el dato y su procedencia…"
                  />
                </Field>
                <Field label="Fecha y hora de referencia (opcional, Argentina)">
                  <input type="datetime-local" step="1" name="at" />
                </Field>
                <div className="form-grid">
                  <Field label="Longitud (opcional)">
                    <input
                      type="number"
                      name="lon"
                      step="any"
                      min="-180"
                      max="180"
                      placeholder="-64.11"
                    />
                  </Field>
                  <Field label="Latitud (opcional)">
                    <input
                      type="number"
                      name="lat"
                      step="any"
                      min="-90"
                      max="90"
                      placeholder="-32.17"
                    />
                  </Field>
                </div>
                <p className="muted">
                  Si indicás una ubicación, completá ambas coordenadas.
                </p>
              </>
            )}
          </Form>
        </Modal>
      )}
    </div>
  );
}

function ChatComposer({
  caseId,
  people,
  user,
  refresh,
}: {
  caseId: string;
  people: Row[];
  user: Row;
  refresh: () => Promise<void>;
}) {
  const [message, setMessage] = useState(""),
    [mention, setMention] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="chat-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(`/cases/${caseId}/entries/mensaje`, "POST", {
            text: message,
            mentions: mention ? [mention] : [],
          });
          setMessage("");
          setMention("");
          await refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        required
        maxLength={4000}
        aria-label="Mensaje"
        placeholder="Escribí un mensaje para el equipo…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <select
        aria-label="Mencionar a un usuario conectado"
        value={mention}
        onChange={(e) => setMention(e.target.value)}
      >
        <option value="">Mencionar…</option>
        {people
          .filter((p) => p.id !== user.id)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <button className="primary" disabled={busy}>
        Enviar
        <ArrowRight size={16} />
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}

function Admin({
  departments,
  currentUser,
  refresh,
}: {
  departments: Row[];
  currentUser: Row;
  refresh: () => Promise<void>;
}) {
  const [users, setUsers] = useState<Row[]>([]),
    [history, setHistory] = useState<Row[]>([]),
    [modal, setModal] = useState(""),
    [error, setError] = useState(""),
    [result, setResult] = useState(""),
    [selectedUser, setSelectedUser] = useState<Row | null>(null);
  const load = useCallback(async () => {
    try {
      const [u, h] = await Promise.all([
        api("/users"),
        api("/cameras/history"),
      ]);
      setUsers(u);
      setHistory(h);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const done = () => {
    setModal("");
    setSelectedUser(null);
    void load();
    void refresh();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONFIGURACIÓN DEL SISTEMA</span>
          <h1>Administración</h1>
          <p>Usuarios, dependencias y actualización del registro de cámaras.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="success">
          {result}
        </p>
      )}
      <section className="admin-panel">
        <div className="section-heading">
          <h2>Usuarios</h2>
          <button className="primary" onClick={() => setModal("user")}>
            <Plus size={16} />
            Crear usuario
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.username}</td>
                  <td>{roles[u.role]}</td>
                  <td>{u.active ? "Activo" : "Inactivo"}</td>
                  <td>
                    <div className="action-row">
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelectedUser(u);
                          setModal("password");
                        }}
                      >
                        Cambiar clave
                      </button>
                      {u.id !== currentUser.id && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setSelectedUser(u);
                            setModal("active");
                          }}
                        >
                          {u.active ? "Desactivar" : "Activar"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="admin-grid">
        <section className="admin-panel">
          <div className="section-heading">
            <h2>Dependencias</h2>
            <button
              className="secondary"
              onClick={() => setModal("department")}
            >
              <Plus size={16} />
              Agregar
            </button>
          </div>
          {departments.map((d) => (
            <div className="department-row" key={d.id}>
              <Users size={17} />
              <span>
                {d.name}
                <small>{d.kind}</small>
              </span>
            </div>
          ))}
        </section>
        <section className="admin-panel">
          <div className="section-heading">
            <h2>Cámaras desde KML</h2>
            <Upload size={20} />
          </div>
          <p className="muted">
            Importá la exportación completa de My Maps. Las cámaras ausentes se
            desactivan y las capturas conservan su posición original.
          </p>
          <button className="secondary" onClick={() => setModal("kml")}>
            <Upload size={16} />
            Importar KML
          </button>
          <h4>Últimas sincronizaciones</h4>
          {history.length ? (
            history.map((h) => (
              <div className="sync-row" key={h.id}>
                <strong>{fmt(h.created_at)}</strong>
                <span>
                  {h.detail.total} cámaras · {h.detail.added} altas ·{" "}
                  {h.detail.moved} movimientos · {h.detail.removed} bajas
                </span>
                {!!h.detail.duplicates?.length && (
                  <small className="warning-text">
                    Duplicados excluidos: {h.detail.duplicates.join(", ")}
                  </small>
                )}
              </div>
            ))
          ) : (
            <p className="muted">Todavía no se importaron cámaras.</p>
          )}
        </section>
      </div>
      {modal && (
        <Modal
          title={
            modal === "user"
              ? "Crear usuario"
              : modal === "department"
                ? "Agregar dependencia"
                : modal === "password"
                  ? `Cambiar clave de ${selectedUser?.name}`
                  : modal === "active"
                    ? `${selectedUser?.active ? "Desactivar" : "Activar"} usuario`
                    : "Importar cámaras"
          }
          close={() => setModal("")}
        >
          <Form
            onDone={done}
            submit={async (f) => {
              if (modal === "department")
                return api("/departments", "POST", {
                  name: formValue(f, "name"),
                  kind: formValue(f, "kind"),
                });
              if (modal === "user")
                return api("/users", "POST", {
                  name: formValue(f, "name"),
                  username: formValue(f, "username").toLowerCase(),
                  password: formValue(f, "password"),
                  role: formValue(f, "role"),
                  department_id: formValue(f, "department_id") || null,
                });
              if (modal === "password")
                return api(`/users/${selectedUser!.id}`, "PATCH", {
                  password: formValue(f, "password"),
                });
              if (modal === "active")
                return api(`/users/${selectedUser!.id}`, "PATCH", {
                  active: !selectedUser!.active,
                });
              const file = f.get("file") as File;
              const r = await api("/cameras/import", "POST", {
                kml: await file.text(),
              });
              setResult(
                `Importación completa: ${r.total} cámaras, ${r.added} altas, ${r.moved} movimientos y ${r.removed} bajas.`,
              );
            }}
          >
            {modal === "user" && (
              <>
                <Field label="Nombre completo">
                  <input name="name" required maxLength={120} />
                </Field>
                <div className="form-grid">
                  <Field label="Usuario">
                    <input
                      name="username"
                      pattern="[a-z0-9._-]{3,80}"
                      required
                      autoComplete="off"
                      placeholder="nombre.apellido"
                    />
                  </Field>
                  <Field label="Rol">
                    <select name="role">
                      <option value="operador">Operador</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="externo">Externo</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </Field>
                </div>
                <Field label="Dependencia (obligatoria para externos)">
                  <select name="department_id">
                    <option value="">Sin dependencia</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {["user", "password"].includes(modal) && (
              <Field label="Contraseña (mínimo 12 caracteres)">
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={200}
                  required
                  autoComplete="new-password"
                />
              </Field>
            )}
            {modal === "department" && (
              <>
                <Field label="Nombre">
                  <input name="name" required maxLength={120} />
                </Field>
                <Field label="Tipo">
                  <select name="kind">
                    <option value="policia">Policía</option>
                    <option value="fiscalia">Fiscalía</option>
                    <option value="municipal">Municipal</option>
                  </select>
                </Field>
              </>
            )}
            {modal === "active" && (
              <p>
                {selectedUser?.active
                  ? "Se cerrarán las sesiones abiertas y se impedirá el acceso a esta cuenta."
                  : "La cuenta podrá volver a iniciar sesión."}
              </p>
            )}
            {modal === "kml" && (
              <>
                <Field label="Archivo KML completo">
                  <input name="file" type="file" accept=".kml" required />
                </Field>
                <p className="muted">
                  Si hay números duplicados o nombres inválidos, se cancelará
                  toda la importación para que puedas corregir el archivo.
                </p>
              </>
            )}
          </Form>
        </Modal>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
