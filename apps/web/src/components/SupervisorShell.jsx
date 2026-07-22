import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import {
  Users, CalendarCheck, Inbox, AlertTriangle, User, LogIn, LogOut, Loader2,
  Search, ChevronRight, X, Check, Flame, Mic, ChevronLeft,
} from "lucide-react";

/* ============================================================
   CÓDICE · Supervisor Shell — jefes de área / línea de producción
   Distinto del shell colaborador (datos personales) y del panel admin
   (RH completo): un supervisor solo ve y actúa sobre SU equipo — nunca
   salario/RFC/CURP/bancarios (ver GET /api/supervisor/team/:id/profile).
   Estética "autoridad": azul en vez de verde, sin XP/gamificación,
   incidencias sin animación (ver DESIGN en la spec de la tarea).
   ============================================================ */

// ── API ──────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001`;
const AUTH_SLUG = "gfp";

async function apiFetch(token, path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error de API (${res.status})`);
  return body;
}

async function apiLogin(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: AUTH_SLUG, email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Login falló (${res.status})`);
  return body;
}

function fmtTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}
function fmtDateShort(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}
function initialsFor(name) {
  const parts = (name || "?").trim().split(/\s+/);
  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}
const AVATAR_PALETTE = ["#2563eb", "#4db8ff", "#a78bfa", "#f97316", "#22d3ee", "#f472b6"];
function avatarColorFor(name) {
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/* ---------- toast bus ---------- */
let _supToast = () => {};
const supToast = (msg, kind = "info") => _supToast(msg, kind);

/* ---------- CSS — mismo lenguaje visual que EmpleadoShell.jsx, acento
   azul (autoridad) en vez de verde (colaborador) ---------- */
const CSS = `
:root{
  --sup-bg:#020917; --sup-surface-1:rgba(255,255,255,.045); --sup-surface-2:rgba(255,255,255,.07);
  --sup-border-dim:rgba(255,255,255,.08); --sup-border-glow:rgba(37,99,235,.35);
  --sup-accent:#2563eb; --sup-accent-bright:#4db8ff; --sup-accent-dim:rgba(37,99,235,.15);
  --sup-amber:#f5c518; --sup-red:#ef4444;
  --sup-text-primary:#e8f0fe; --sup-text-secondary:rgba(232,240,254,.62); --sup-text-muted:rgba(232,240,254,.45);
}
.supshell{font-family:'DM Sans',system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--sup-text-primary);min-height:100vh;position:relative;background:var(--sup-bg)}
.supshell .mono{font-family:'DM Mono',ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
.sup-canvas{position:fixed;inset:0;z-index:0}
.sup-app{position:relative;z-index:1;max-width:430px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}

.sup-login{min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:32px 24px;position:relative;z-index:1;max-width:430px;margin:0 auto}
.sup-login-logo{font-size:26px;font-weight:700;letter-spacing:-.01em}
.sup-login-sub{font-size:13px;color:var(--sup-text-secondary);margin-top:4px}
.sup-login-form{margin-top:36px}
.sup-label{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--sup-text-muted);margin-bottom:6px;font-weight:600}
.sup-input{width:100%;font-size:14px;color:var(--sup-text-primary);background:rgba(0,0,0,.3);border:1px solid var(--sup-border-dim);border-radius:10px;padding:13px 14px;outline:none}
.sup-input:focus{border-color:var(--sup-accent)}
.sup-btn-primary{height:52px;border-radius:14px;border:none;color:#fff;font-size:15px;font-weight:700;width:100%;
  display:flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;margin-top:22px;
  background:linear-gradient(135deg,var(--sup-accent),#1d4ed8);box-shadow:0 4px 14px rgba(37,99,235,.4)}
.sup-btn-primary:disabled{opacity:.5;cursor:default}
.sup-login-error{margin-top:14px;font-size:12.5px;color:var(--sup-red);background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:10px 12px}

.sup-topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;background:linear-gradient(180deg,var(--sup-bg) 60%,transparent)}
.sup-topbar-brand{font-weight:700;font-size:14px;letter-spacing:.02em}
.sup-topbar-role{font-size:10.5px;color:var(--sup-accent-bright);background:var(--sup-accent-dim);border:1px solid var(--sup-border-glow);border-radius:999px;padding:3px 10px;font-weight:600}

.sup-main{flex:1;overflow-y:auto;padding:4px 16px 88px}
.sup-h1{font-size:19px;font-weight:700;margin-bottom:14px}
.sup-eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--sup-text-muted);font-weight:600}
.sup-muted{color:var(--sup-text-secondary)}
.sup-muted2{color:var(--sup-text-muted)}

.sup-glass{background:var(--sup-surface-1);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--sup-border-dim);border-radius:16px}
.sup-card{padding:16px;margin-bottom:10px}

.sup-statrow{display:flex;gap:10px;margin-bottom:16px}
.sup-stat{flex:1;padding:14px;border-radius:14px;text-align:center}
.sup-stat-value{font-size:22px;font-weight:700}
.sup-stat-label{font-size:10.5px;color:var(--sup-text-muted);margin-top:3px;text-transform:uppercase;letter-spacing:.06em}

.sup-search{display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.25);border:1px solid var(--sup-border-dim);border-radius:12px;padding:10px 14px;margin-bottom:14px}
.sup-search input{flex:1;background:transparent;border:none;outline:none;color:var(--sup-text-primary);font-size:13.5px}

.sup-empcard{display:flex;align-items:center;gap:12px;min-height:72px;padding:12px 14px;cursor:pointer}
.sup-avatar{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#04060a;flex-shrink:0}
.sup-empcard-name{font-weight:600;font-size:14px}
.sup-empcard-pos{font-size:11.5px;color:var(--sup-text-muted);margin-top:1px}
.sup-chip{font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:999px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.sup-chip.green{color:#00c896;background:rgba(0,200,150,.12)}
.sup-chip.amber{color:var(--sup-amber);background:rgba(245,197,24,.12)}
.sup-chip.red{color:var(--sup-red);background:rgba(239,68,68,.12)}
.sup-chip.blue{color:var(--sup-accent-bright);background:var(--sup-accent-dim)}
.sup-streak{font-size:11px;color:var(--sup-text-muted);display:flex;align-items:center;gap:3px;flex-shrink:0}

.sup-nav{position:fixed;left:50%;transform:translateX(-50%);bottom:0;z-index:8;width:100%;max-width:430px;height:64px;
  display:flex;justify-content:space-around;align-items:center;background:rgba(2,9,23,.96);backdrop-filter:blur(24px);border-top:1px solid var(--sup-border-dim)}
.sup-navitem{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--sup-text-muted);cursor:pointer;padding:6px 8px;border-radius:12px}
.sup-navitem.on{color:var(--sup-accent-bright)}
.sup-navbadge{position:absolute;top:-3px;right:0px;min-width:14px;height:14px;padding:0 3px;border-radius:999px;background:var(--sup-red);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center}
.sup-navlabel{font-size:9.5px;font-weight:600}

.sup-sheet-backdrop{position:fixed;inset:0;z-index:20;background:rgba(2,9,23,.7)}
.sup-sheet{position:fixed;left:0;right:0;bottom:0;z-index:21;max-width:430px;margin:0 auto;background:#0a1424;border-radius:22px 22px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom));max-height:82vh;overflow-y:auto;border-top:1px solid var(--sup-border-glow)}

.sup-btn{height:42px;border-radius:11px;border:1px solid var(--sup-border-dim);background:var(--sup-surface-2);color:var(--sup-text-primary);font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;flex:1}
.sup-btn.primary{background:linear-gradient(135deg,var(--sup-accent),#1d4ed8);border:none;color:#fff}
.sup-btn.approve{background:rgba(0,200,150,.15);border-color:rgba(0,200,150,.35);color:#00c896}
.sup-btn.reject{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.35);color:var(--sup-red)}
.sup-btn:disabled{opacity:.5;cursor:default}

.sup-calendar-dot{width:8px;height:8px;border-radius:50%}
@keyframes supspin{to{transform:rotate(360deg)}}
`;

// ── Fondo — starfield estático y sutil (ver nota de scope en el commit:
// no se replicó el sistema completo de nodos/hover interactivos de
// EmpleadoShell.jsx — la spec pide explícitamente "sin animaciones,
// UI directa" para esta shell) ──────────────────────────────────

function useStarfield(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = window.innerWidth, h = window.innerHeight;
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * w, y: Math.random() * h * 0.7,
      size: 0.4 + Math.random() * 1, opacity: 0.06 + Math.random() * 0.22,
    }));

    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(120,170,255,${s.opacity})`;
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    return () => window.removeEventListener("resize", resize);
  }, [canvasRef]);
}

// ── LOGIN ────────────────────────────────────────────────────

function LoginScreen({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorKey, setErrorKey] = useState(0);

  const submit = async (e) => {
    e.preventDefault();
    if (!email || !password || loading) return;
    setLoading(true); setError(null);
    try {
      const res = await apiLogin(email, password);
      if (res.user.role !== "AREA_MANAGER" && res.user.role !== "SUPER_ADMIN") {
        throw new Error("Esta cuenta no tiene acceso al panel de supervisor.");
      }
      onSuccess(res);
    } catch (err) {
      setError(err.message || "Credenciales incorrectas.");
      setErrorKey((k) => k + 1);
      setLoading(false);
    }
  };

  return (
    <div className="sup-login">
      <div>
        <div className="sup-login-logo">✦ CÓDICE</div>
        <div className="sup-login-sub">Panel de Supervisor</div>
      </div>
      <form className="sup-login-form" onSubmit={submit}>
        <label className="sup-label">Correo</label>
        <input className="sup-input" style={{ marginBottom: 14 }} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="sup-label">Contraseña</label>
        <input className="sup-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className="sup-btn-primary" disabled={loading || !email || !password}>
          {loading ? <Loader2 size={18} style={{ animation: "supspin 1s linear infinite" }} /> : <LogIn size={18} />} Entrar
        </button>
        <AnimatePresence mode="wait">
          {error && (
            <motion.div key={errorKey} className="sup-login-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </div>
  );
}

// ── DATA HOOKS ───────────────────────────────────────────────

function useSupervisorTeam(token, refreshKey) {
  const [state, setState] = useState({ status: "loading", data: [] });
  const reload = useCallback(() => {
    if (!token) return;
    apiFetch(token, "/api/supervisor/team")
      .then((res) => setState({ status: "ready", data: res.employees || [] }))
      .catch((e) => setState({ status: "error", data: [], error: e.message }));
  }, [token]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { ...state, reload };
}

function useAttendanceToday(token, refreshKey) {
  const [state, setState] = useState({ status: "loading", data: null });
  const reload = useCallback(() => {
    if (!token) return;
    apiFetch(token, "/api/supervisor/attendance/today")
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { ...state, reload };
}

function usePendingRequests(token, refreshKey) {
  const [state, setState] = useState({ status: "loading", data: [] });
  const reload = useCallback(() => {
    if (!token) return;
    apiFetch(token, "/api/supervisor/requests/pending")
      .then((res) => setState({ status: "ready", data: res.data || [] }))
      .catch((e) => setState({ status: "error", data: [], error: e.message }));
  }, [token]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { ...state, reload };
}

function useIncidentHistory(token, refreshKey) {
  const [state, setState] = useState({ status: "loading", data: [] });
  const reload = useCallback(() => {
    if (!token) return;
    apiFetch(token, "/api/supervisor/incidents")
      .then((res) => setState({ status: "ready", data: res.data || [] }))
      .catch((e) => setState({ status: "error", data: [], error: e.message }));
  }, [token]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { ...state, reload };
}

function useEmployeeProfile(token, employeeId) {
  const [state, setState] = useState({ status: "loading", data: null });
  useEffect(() => {
    if (!token || !employeeId) return;
    setState({ status: "loading", data: null });
    apiFetch(token, `/api/supervisor/team/${employeeId}/profile`)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token, employeeId]);
  return state;
}

// ── ATOMS ────────────────────────────────────────────────────

function StatusChip({ status }) {
  const map = {
    en_planta:     { cls: "green", label: "● En planta" },
    sin_registrar: { cls: "amber", label: "○ Sin registrar" },
    falta:         { cls: "red",   label: "✕ Falta" },
    vacaciones:    { cls: "blue",  label: "🏖 Vacaciones" },
    retardo:       { cls: "amber", label: "○ Retardo" },
  };
  const m = map[status] || map.sin_registrar;
  return <span className={`sup-chip ${m.cls}`}>{m.label}</span>;
}

function employeeStatus(emp) {
  if (emp.status === "Vacaciones") return "vacaciones";
  if (!emp.lastAttendance) return "sin_registrar";
  return "en_planta";
}

// ── MI EQUIPO ────────────────────────────────────────────────

function EmployeeCard({ emp, onOpen }) {
  const color = avatarColorFor(emp.fullName);
  return (
    <div className="sup-glass sup-empcard" onClick={() => onOpen(emp)}>
      <div className="sup-avatar" style={{ background: color }}>{initialsFor(emp.fullName)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sup-empcard-name">{emp.fullName}</div>
        <div className="sup-empcard-pos">{emp.position || "—"}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
        <StatusChip status={employeeStatus(emp)} />
        {emp.streakDays > 0 && <span className="sup-streak"><Flame size={11} />{emp.streakDays}d</span>}
      </div>
    </div>
  );
}

function EmployeeDetailSheet({ token, employee, onClose, onGoRequests, onGoIncident }) {
  const profile = useEmployeeProfile(token, employee?.id);
  if (!employee) return null;
  const p = profile.data;

  return (
    <>
      <motion.div className="sup-sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div className="sup-sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{employee.fullName}</div>
            <div className="sup-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{employee.position} · {employee.shift || "—"}</div>
          </div>
          <X size={20} className="sup-muted" style={{ cursor: "pointer" }} onClick={onClose} />
        </div>

        {profile.status === "loading" && <div className="sup-muted" style={{ fontSize: 12.5 }}>Cargando…</div>}

        {p && (
          <>
            <div className="sup-eyebrow" style={{ marginBottom: 8 }}>Asistencia · últimos 7 días</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
              {Array.from({ length: 7 }, (_, i) => {
                const day = new Date(); day.setDate(day.getDate() - (6 - i));
                const dayStr = day.toISOString().slice(0, 10);
                const rec = (p.attendanceLast30Days || []).find((a) => String(a.date).slice(0, 10) === dayStr);
                const color = rec ? "#00c896" : "var(--sup-red)";
                return <div key={i} className="sup-calendar-dot" style={{ background: color }} title={dayStr} />;
              })}
            </div>

            <div className="sup-glass sup-card" style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div className="sup-eyebrow">Solicitudes pendientes</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{p.pendingRequests}</div>
              </div>
              <div>
                <div className="sup-eyebrow">Cursos</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{p.coursesStatus.passed}/{p.coursesStatus.total}</div>
              </div>
              <div>
                <div className="sup-eyebrow">Racha</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>🔥{p.streakDays || 0}</div>
              </div>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="sup-btn" onClick={() => onGoRequests(employee)}>Ver solicitudes</button>
          <button className="sup-btn primary" onClick={() => onGoIncident(employee)}>Registrar incidencia</button>
        </div>
      </motion.div>
    </>
  );
}

function MiEquipoView({ token, team, onOpenEmployee }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const norm = q.trim().toLowerCase();
    if (!norm) return team.data;
    return team.data.filter((e) => e.fullName.toLowerCase().includes(norm));
  }, [team.data, q]);

  return (
    <div>
      <div className="sup-h1">Tu equipo · {team.data.length} persona{team.data.length === 1 ? "" : "s"}</div>
      <div className="sup-search">
        <Search size={15} className="sup-muted2" />
        <input placeholder="Buscar por nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {team.status === "loading" && <div className="sup-muted" style={{ fontSize: 12.5 }}>Cargando equipo…</div>}
      {team.status === "ready" && filtered.length === 0 && (
        <div className="sup-muted" style={{ fontSize: 12.5 }}>Sin colaboradores{q ? " que coincidan" : " asignados todavía"}.</div>
      )}
      {filtered.map((emp) => <EmployeeCard key={emp.id} emp={emp} onOpen={onOpenEmployee} />)}
    </div>
  );
}

// ── ASISTENCIA HOY ───────────────────────────────────────────

function AsistenciaView({ attendance, onManualRegister }) {
  const a = attendance.data;
  return (
    <div>
      <div className="sup-h1">Asistencia hoy</div>
      {attendance.status === "loading" && <div className="sup-muted" style={{ fontSize: 12.5 }}>Cargando…</div>}
      {a && (
        <>
          <div className="sup-statrow">
            <div className="sup-glass sup-stat"><div className="sup-stat-value" style={{ color: "#00c896" }}>{a.present}</div><div className="sup-stat-label">En planta</div></div>
            <div className="sup-glass sup-stat"><div className="sup-stat-value" style={{ color: "var(--sup-red)" }}>{a.absent}</div><div className="sup-stat-label">Faltas</div></div>
            <div className="sup-glass sup-stat"><div className="sup-stat-value" style={{ color: "var(--sup-amber)" }}>{a.late}</div><div className="sup-stat-label">Retardos</div></div>
          </div>

          <div className="sup-glass sup-card" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00c896", flexShrink: 0 }} />
            <span style={{ fontSize: 12.5 }}>Checadora activa · ZKTeco · {a.employees[0]?.plant || "Planta"}</span>
          </div>

          <button className="sup-btn primary" style={{ width: "100%", marginBottom: 14 }} onClick={onManualRegister}>
            + Registrar entrada manual
          </button>

          {a.employees.map((e) => (
            <div key={e.employeeId} className="sup-glass sup-empcard">
              <div className="sup-avatar" style={{ background: avatarColorFor(e.name) }}>{initialsFor(e.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sup-empcard-name">{e.name}</div>
                <div className="sup-empcard-pos">{e.checkInAt ? `Entrada ${fmtTime(e.checkInAt)}` : "Sin registrar"}</div>
              </div>
              <StatusChip status={e.status} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ManualRegisterSheet({ token, team, onClose, onDone }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  const filtered = useMemo(() => {
    const norm = q.trim().toLowerCase();
    return team.data.filter((e) => !norm || e.fullName.toLowerCase().includes(norm));
  }, [team.data, q]);

  const register = async (emp) => {
    setBusy(emp.id);
    try {
      await apiFetch(token, "/api/attendance/checkin", {
        method: "POST",
        body: JSON.stringify({ employeeId: emp.id, method: "MANUAL" }),
      });
      supToast(`Entrada registrada · ${emp.fullName}`, "success");
      onDone();
    } catch (e) {
      supToast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <motion.div className="sup-sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div className="sup-sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ duration: 0.25 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Registrar entrada manual</div>
          <X size={20} className="sup-muted" style={{ cursor: "pointer" }} onClick={onClose} />
        </div>
        <div className="sup-search"><Search size={15} className="sup-muted2" /><input placeholder="Buscar colaborador…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
        {filtered.map((emp) => (
          <div key={emp.id} className="sup-glass sup-empcard" style={{ cursor: busy ? "default" : "pointer" }} onClick={() => !busy && register(emp)}>
            <div className="sup-avatar" style={{ background: avatarColorFor(emp.fullName) }}>{initialsFor(emp.fullName)}</div>
            <div style={{ flex: 1 }}><div className="sup-empcard-name">{emp.fullName}</div></div>
            {busy === emp.id ? <Loader2 size={16} style={{ animation: "supspin 1s linear infinite" }} /> : <ChevronRight size={16} className="sup-muted2" />}
          </div>
        ))}
      </motion.div>
    </>
  );
}

// ── SOLICITUDES ──────────────────────────────────────────────

const REQ_TYPE_LABEL = { Vacaciones: "Vacaciones", Permiso: "Permiso", "Cambio de turno": "Cambio de turno" };

function RequestCard({ token, request, onDecided }) {
  const [busy, setBusy] = useState(null);

  const decide = async (action) => {
    setBusy(action);
    try {
      await apiFetch(token, `/api/supervisor/requests/${request.id}/${action}`, { method: "PATCH", body: JSON.stringify({}) });
      supToast(action === "approve" ? "Solicitud aprobada" : "Solicitud rechazada", action === "approve" ? "success" : "warning");
      onDecided();
    } catch (e) {
      supToast(e.message, "error");
      setBusy(null);
    }
  };

  return (
    <div className="sup-glass sup-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div className="sup-avatar" style={{ width: 36, height: 36, fontSize: 12, background: avatarColorFor(request.employee_name) }}>{initialsFor(request.employee_name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{request.employee_name}</div>
          <div className="sup-muted2" style={{ fontSize: 11 }}>{REQ_TYPE_LABEL[request.type] || request.type} · {fmtDateShort(request.created_at)}</div>
        </div>
      </div>
      {request.detail && <div className="sup-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{request.detail}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="sup-btn approve" disabled={!!busy} onClick={() => decide("approve")}>
          {busy === "approve" ? <Loader2 size={14} style={{ animation: "supspin 1s linear infinite" }} /> : <Check size={14} />} Aprobar
        </button>
        <button className="sup-btn reject" disabled={!!busy} onClick={() => decide("reject")}>
          {busy === "reject" ? <Loader2 size={14} style={{ animation: "supspin 1s linear infinite" }} /> : <X size={14} />} Rechazar
        </button>
      </div>
    </div>
  );
}

function SolicitudesView({ token, requests }) {
  return (
    <div>
      <div className="sup-h1">Solicitudes pendientes</div>
      {requests.status === "loading" && <div className="sup-muted" style={{ fontSize: 12.5 }}>Cargando…</div>}
      {requests.status === "ready" && requests.data.length === 0 && (
        <div className="sup-muted" style={{ fontSize: 12.5 }}>No hay solicitudes esperando tu aprobación.</div>
      )}
      {requests.data.map((r) => <RequestCard key={r.id} token={token} request={r} onDecided={requests.reload} />)}
    </div>
  );
}

// ── INCIDENCIAS ──────────────────────────────────────────────
// Sin animaciones, UI directa (ver DESIGN en la spec) — a propósito no
// usa <motion.div> en ninguno de los pasos del formulario.

const INCIDENT_TYPES = ["Retardo", "Falta injustificada", "Accidente leve", "Accidente moderado/grave", "Conducta inapropiada", "Daño a equipo"];
const SEVERITIES = [
  { id: "leve", label: "Leve" },
  { id: "moderado", label: "Moderado" },
  { id: "grave", label: "Grave" },
];

function IncidenciasView({ token, team, incidents }) {
  const [step, setStep] = useState(0); // 0=historial, 1=buscar, 2=tipo, 3=descripcion, 4=severidad
  const [employee, setEmployee] = useState(null);
  const [type, setType] = useState(null);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setStep(0); setEmployee(null); setType(null); setDescription(""); setSeverity(null); setQ(""); };

  const filtered = useMemo(() => {
    const norm = q.trim().toLowerCase();
    return team.data.filter((e) => !norm || e.fullName.toLowerCase().includes(norm));
  }, [team.data, q]);

  const submit = async () => {
    setBusy(true);
    try {
      await apiFetch(token, "/api/supervisor/incidents", {
        method: "POST",
        body: JSON.stringify({ employeeId: employee.id, type, description: description || undefined, severity }),
      });
      supToast("Incidencia registrada", severity === "grave" ? "warning" : "success");
      incidents.reload();
      reset();
    } catch (e) {
      supToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (step === 0) {
    return (
      <div>
        <div className="sup-h1">Incidencias</div>
        <button className="sup-btn primary" style={{ width: "100%", marginBottom: 18 }} onClick={() => setStep(1)}>
          <AlertTriangle size={16} /> Registrar incidencia
        </button>
        <div className="sup-eyebrow" style={{ marginBottom: 10 }}>Tu historial · últimos 30 días</div>
        {incidents.status === "ready" && incidents.data.length === 0 && <div className="sup-muted" style={{ fontSize: 12.5 }}>Sin incidencias registradas.</div>}
        {incidents.data.map((inc) => (
          <div key={inc.id} className="sup-glass sup-card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{inc.type}</span>
              <span className={`sup-chip ${inc.severity === "grave" ? "red" : inc.severity === "moderado" ? "amber" : "green"}`}>{inc.severity}</span>
            </div>
            <div className="sup-muted2" style={{ fontSize: 11.5 }}>{inc.employee_name} · {fmtDateShort(inc.created_at)}</div>
            {inc.description && <div className="sup-muted" style={{ fontSize: 12, marginTop: 6 }}>{inc.description}</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <ChevronLeft size={18} className="sup-muted" style={{ cursor: "pointer" }} onClick={() => (step === 1 ? reset() : setStep(step - 1))} />
        <div style={{ fontSize: 15, fontWeight: 700 }}>Nueva incidencia · Paso {step}/4</div>
      </div>

      {step === 1 && (
        <div>
          <div className="sup-search"><Search size={15} className="sup-muted2" /><input placeholder="Buscar colaborador…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
          {filtered.map((emp) => (
            <div key={emp.id} className="sup-glass sup-empcard" onClick={() => { setEmployee(emp); setStep(2); }}>
              <div className="sup-avatar" style={{ background: avatarColorFor(emp.fullName) }}>{initialsFor(emp.fullName)}</div>
              <div style={{ flex: 1 }}><div className="sup-empcard-name">{emp.fullName}</div></div>
              <ChevronRight size={16} className="sup-muted2" />
            </div>
          ))}
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="sup-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Empleado: <b>{employee.fullName}</b></div>
          {INCIDENT_TYPES.map((t) => (
            <div key={t} className="sup-glass sup-card" style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => { setType(t); setStep(3); }}>
              <span style={{ fontSize: 13.5 }}>{t}</span>
              <ChevronRight size={15} className="sup-muted2" />
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="sup-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{employee.fullName} · {type}</div>
          <label className="sup-label">Descripción</label>
          <textarea
            className="sup-input" rows={5} style={{ resize: "vertical", marginBottom: 14 }}
            placeholder="¿Qué pasó?" value={description} onChange={(e) => setDescription(e.target.value)}
          />
          <div className="sup-muted2" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
            <Mic size={13} /> Entrada por voz próximamente
          </div>
          <button className="sup-btn primary" style={{ width: "100%" }} onClick={() => setStep(4)}>Continuar</button>
        </div>
      )}

      {step === 4 && (
        <div>
          <div className="sup-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{employee.fullName} · {type}</div>
          <label className="sup-label">Severidad</label>
          <div style={{ display: "flex", gap: 8, margin: "8px 0 18px" }}>
            {SEVERITIES.map((s) => (
              <button
                key={s.id}
                className="sup-btn" style={{ borderColor: severity === s.id ? "var(--sup-accent)" : undefined, color: severity === s.id ? "var(--sup-accent-bright)" : undefined }}
                onClick={() => setSeverity(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {severity === "grave" && (
            <div className="sup-chip red" style={{ marginBottom: 14 }}>⚠ Esto notificará a RH por WhatsApp de inmediato</div>
          )}
          <button className="sup-btn primary" style={{ width: "100%" }} disabled={!severity || busy} onClick={submit}>
            {busy ? <Loader2 size={16} style={{ animation: "supspin 1s linear infinite" }} /> : "Registrar incidencia"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── PERFIL ───────────────────────────────────────────────────

function PerfilView({ user, tenant, onLogout }) {
  return (
    <div>
      <div className="sup-h1">Perfil</div>
      <div className="sup-glass sup-card" style={{ textAlign: "center", padding: 28 }}>
        <div className="sup-avatar" style={{ width: 64, height: 64, fontSize: 22, margin: "0 auto 14px", background: "var(--sup-accent)" }}>
          {initialsFor(`${user.firstName} ${user.lastName}`)}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{user.firstName} {user.lastName}</div>
        <div className="sup-muted" style={{ fontSize: 12.5, marginTop: 3 }}>Supervisor · {tenant?.name || ""}</div>
        <div className="sup-chip blue" style={{ marginTop: 10 }}>{user.email}</div>
      </div>
      <button className="sup-btn" style={{ width: "100%", marginTop: 16, color: "var(--sup-red)" }} onClick={onLogout}>
        <LogOut size={15} /> Cerrar sesión
      </button>
    </div>
  );
}

// ── TOAST HOST ───────────────────────────────────────────────

function SupToastHost() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _supToast = (msg, kind = "info") => {
      const id = Math.random();
      setToasts((t) => [...t, { id, msg, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };
    return () => { _supToast = () => {}; };
  }, []);
  return (
    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 999, width: "100%", maxWidth: 390, padding: "0 16px", display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map((t) => (
        <div key={t.id} className="sup-glass" style={{ padding: "11px 15px", fontSize: 13, borderColor: t.kind === "error" ? "var(--sup-red)" : t.kind === "warning" ? "var(--sup-amber)" : "var(--sup-border-glow)" }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── NAV ──────────────────────────────────────────────────────

const NAV = [
  { id: "equipo",      label: "Mi Equipo",     icon: Users },
  { id: "asistencia",  label: "Asistencia",    icon: CalendarCheck },
  { id: "solicitudes", label: "Solicitudes",   icon: Inbox },
  { id: "incidencias", label: "Incidencias",   icon: AlertTriangle },
  { id: "perfil",      label: "Perfil",        icon: User },
];

// ── APP ──────────────────────────────────────────────────────

export default function SupervisorShell() {
  const canvasRef = useRef(null);
  useStarfield(canvasRef);

  const [session, setSession] = useState(null); // { accessToken, user, tenant }
  const [view, setView] = useState("equipo");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [manualRegisterOpen, setManualRegisterOpen] = useState(false);
  const socketRef = useRef(null);

  const token = session?.accessToken;

  const team = useSupervisorTeam(token, refreshKey);
  const attendance = useAttendanceToday(token, refreshKey);
  const requests = usePendingRequests(token, refreshKey);
  const incidents = useIncidentHistory(token, refreshKey);

  useEffect(() => {
    if (!token) return undefined;
    const socket = io(API_BASE);
    socketRef.current = socket;
    socket.emit("join:tenant", session.tenant.id);
    socket.on("attendance:punch", () => setRefreshKey((k) => k + 1));
    socket.on("request:updated", () => setRefreshKey((k) => k + 1));
    socket.on("incident:created", () => setRefreshKey((k) => k + 1));
    return () => { socket.disconnect(); socketRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleLoginSuccess = (res) => setSession({ accessToken: res.accessToken, user: res.user, tenant: res.tenant });
  const handleLogout = () => { socketRef.current?.disconnect(); setSession(null); };

  const openEmployee = useCallback((emp) => setSelectedEmployee(emp), []);
  const closeEmployee = useCallback(() => setSelectedEmployee(null), []);
  const goToRequestsFromSheet = useCallback((emp) => { setSelectedEmployee(null); setView("solicitudes"); void emp; }, []);
  const goToIncidentFromSheet = useCallback((emp) => { setSelectedEmployee(null); setView("incidencias"); void emp; }, []);

  if (!session) {
    return (
      <div className="supshell">
        <style>{CSS}</style>
        <canvas ref={canvasRef} className="sup-canvas" />
        <LoginScreen onSuccess={handleLoginSuccess} />
      </div>
    );
  }

  return (
    <div className="supshell">
      <style>{CSS}</style>
      <canvas ref={canvasRef} className="sup-canvas" />
      <SupToastHost />
      <div className="sup-app">
        <div className="sup-topbar">
          <span className="sup-topbar-brand">✦ CÓDICE</span>
          <span className="sup-topbar-role">SUPERVISOR</span>
        </div>

        <main className="sup-main">
          <AnimatePresence mode="wait">
            {view === "equipo" && <motion.div key="equipo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><MiEquipoView token={token} team={team} onOpenEmployee={openEmployee} /></motion.div>}
            {view === "asistencia" && <motion.div key="asistencia" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><AsistenciaView attendance={attendance} onManualRegister={() => setManualRegisterOpen(true)} /></motion.div>}
            {view === "solicitudes" && <motion.div key="solicitudes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><SolicitudesView token={token} requests={requests} /></motion.div>}
            {view === "incidencias" && <div key="incidencias"><IncidenciasView token={token} team={team} incidents={incidents} /></div>}
            {view === "perfil" && <motion.div key="perfil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><PerfilView user={session.user} tenant={session.tenant} onLogout={handleLogout} /></motion.div>}
          </AnimatePresence>
        </main>

        <nav className="sup-nav">
          {NAV.map((it) => (
            <div key={it.id} className={`sup-navitem ${view === it.id ? "on" : ""}`} onClick={() => setView(it.id)}>
              <div style={{ position: "relative" }}>
                <it.icon size={19} />
                {it.id === "solicitudes" && requests.data.length > 0 && <span className="sup-navbadge">{requests.data.length}</span>}
              </div>
              <span className="sup-navlabel">{it.label}</span>
            </div>
          ))}
        </nav>
      </div>

      <AnimatePresence>
        {selectedEmployee && (
          <EmployeeDetailSheet
            token={token} employee={selectedEmployee} onClose={closeEmployee}
            onGoRequests={goToRequestsFromSheet} onGoIncident={goToIncidentFromSheet}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {manualRegisterOpen && (
          <ManualRegisterSheet
            token={token} team={team} onClose={() => setManualRegisterOpen(false)}
            onDone={() => { setManualRegisterOpen(false); setRefreshKey((k) => k + 1); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
