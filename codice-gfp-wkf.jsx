import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, RadialBarChart, RadialBar, AreaChart, Area,
} from "recharts";
import {
  LayoutDashboard, Users, FileSignature, Scale, Filter, MessageSquareText,
  Bot, Search, Download, Plus, X, GripVertical, RotateCcw, Boxes,
  ChevronRight, AlertTriangle, CircleCheck, Clock, Send, Sparkles,
  ShieldCheck, CalendarDays, FileText, RefreshCw, Check, Inbox, Factory,
  GraduationCap, Monitor, Activity, Award, Maximize, ChevronLeft, Megaphone,
  TrendingUp, ClipboardCheck,
} from "lucide-react";

/* ============================================================
   CÓDICE · Control de personal con LFT en línea
   Tenant único: Grupo Food Packing Co. (CDMX)
   Draggable real (mutación DOM + commit, snap a rejilla).
   AI chat conectado al endpoint Anthropic del artefacto.
   ============================================================ */

const ORG = {
  name: "Grupo Food Packing Co.",
  short: "GFP",
  kind: "Empaque y procesamiento de alimentos",
  city: "Ciudad de México",
  domain: "gfp.mx",
  deptos: ["Producción", "Empaque", "Calidad e Inocuidad", "Almacén y Logística", "Mantenimiento", "Compras", "Administración", "Recursos Humanos", "Ventas", "Sistemas"],
  plantas: ["Planta Vallejo", "Planta Iztapalapa", "CEDIS Tláhuac", "Corporativo Polanco"],
  n: 150,
};

/* ---------- toast bus ---------- */
let _toast = () => {};
const toast = (msg, kind = "ok") => _toast(msg, kind);

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
:root{
  --bg:#04060a;--glass:rgba(255,255,255,0.045);--glass-2:rgba(255,255,255,0.07);
  --glass-hi:rgba(255,255,255,0.10);--border:rgba(255,255,255,0.09);--border-hi:rgba(255,255,255,0.16);
  --text:#eaf0f7;--muted:#8794a6;--muted-2:#5d6878;
  --cyan:#56d4f0;--violet:#a78bfa;--emerald:#4fd6a3;--amber:#f5b544;--rose:#fb7185;
  --font:'Space Grotesk',ui-sans-serif,system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,monospace;
}
*{box-sizing:border-box}
.codice{font-family:var(--font);color:var(--text);background:var(--bg);min-height:100vh;position:relative;overflow:hidden;letter-spacing:-.01em}
.codice ::-webkit-scrollbar{width:9px;height:9px}
.codice ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:9px}
.bgfield{position:fixed;inset:0;z-index:0;overflow:hidden;background:radial-gradient(120% 120% at 50% -10%,#0b1422 0%,var(--bg) 55%)}
.blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:.45;mix-blend-mode:screen}
.b1{width:560px;height:560px;left:-120px;top:-140px;background:radial-gradient(circle,#1d6fa0,transparent 70%);animation:d1 26s ease-in-out infinite}
.b2{width:520px;height:520px;right:-160px;top:120px;background:radial-gradient(circle,#6d4ba8,transparent 70%);animation:d2 32s ease-in-out infinite}
.b3{width:480px;height:480px;left:30%;bottom:-200px;background:radial-gradient(circle,#1f8f6e,transparent 72%);animation:d3 38s ease-in-out infinite}
.gridov{position:absolute;inset:0;opacity:.25;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:46px 46px;mask-image:radial-gradient(80% 80% at 50% 30%,#000,transparent)}
@keyframes d1{0%,100%{transform:translate(0,0)}50%{transform:translate(80px,60px)}}
@keyframes d2{0%,100%{transform:translate(0,0)}50%{transform:translate(-70px,40px)}}
@keyframes d3{0%,100%{transform:translate(0,0)}50%{transform:translate(50px,-60px)}}
.glass{background:var(--glass);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border:1px solid var(--border);border-radius:18px;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 18px 50px -20px rgba(0,0,0,.75)}
.glass-2{background:var(--glass-2);border:1px solid var(--border);border-radius:14px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.muted2{color:var(--muted-2)}
.eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted-2)}
.btn{font-family:var(--font);font-size:13px;font-weight:500;color:var(--text);background:var(--glass-2);border:1px solid var(--border);border-radius:11px;padding:8px 13px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:.18s;white-space:nowrap}
.btn:hover{background:var(--glass-hi);border-color:var(--border-hi)}
.btn:active{transform:translateY(1px)}
.btn-accent{background:linear-gradient(180deg,rgba(86,212,240,.22),rgba(86,212,240,.10));border-color:rgba(86,212,240,.42);color:#cdf3fc}
.btn-accent:hover{background:linear-gradient(180deg,rgba(86,212,240,.32),rgba(86,212,240,.16))}
.btn-ok{background:linear-gradient(180deg,rgba(79,214,163,.22),rgba(79,214,163,.10));border-color:rgba(79,214,163,.4);color:#bff0dc}
.btn-no{background:linear-gradient(180deg,rgba(251,113,133,.18),rgba(251,113,133,.08));border-color:rgba(251,113,133,.36);color:#fcc4cd}
.btn-sm{padding:5px 9px;font-size:12px;border-radius:9px}
.input,.select,textarea.input{font-family:var(--font);font-size:13px;color:var(--text);background:rgba(0,0,0,.28);border:1px solid var(--border);border-radius:10px;padding:9px 11px;width:100%;outline:none;transition:.15s}
.input:focus,.select:focus{border-color:rgba(86,212,240,.55);box-shadow:0 0 0 3px rgba(86,212,240,.12)}
.select{appearance:none;cursor:pointer;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%238794a6' stroke-width='2'><path d='M2 4l4 4 4-4'/></svg>");background-repeat:no-repeat;background-position:right 11px center;padding-right:30px}
label.fld{display:block;font-size:11px;color:var(--muted);margin-bottom:5px;font-weight:500}
.chip{font-family:var(--mono);font-size:10.5px;font-weight:500;padding:3px 9px;border-radius:999px;border:1px solid var(--border);display:inline-flex;align-items:center;gap:5px;background:var(--glass-2);white-space:nowrap}
.dot{width:6px;height:6px;border-radius:50%;display:inline-block}
.kpi{font-family:var(--mono);font-weight:600;line-height:1;letter-spacing:-.02em}
.row{display:flex;align-items:center}
.navitem{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:12px;cursor:pointer;color:var(--muted);font-size:13.5px;font-weight:500;transition:.15s;border:1px solid transparent}
.navitem:hover{background:var(--glass);color:var(--text)}
.navitem.on{background:var(--glass-2);color:var(--text);border-color:var(--border);box-shadow:inset 2px 0 0 var(--cyan)}
.tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.tbl th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted-2);font-weight:500;padding:9px 12px;border-bottom:1px solid var(--border)}
.tbl td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:middle}
.tbl tbody tr{cursor:pointer;transition:.12s}
.tbl tbody tr:hover{background:var(--glass)}
.drawer{position:fixed;top:0;right:0;height:100%;width:min(460px,94vw);z-index:60;background:rgba(8,12,20,.88);backdrop-filter:blur(26px);border-left:1px solid var(--border-hi);box-shadow:-30px 0 80px -30px rgba(0,0,0,.9);animation:slide .28s cubic-bezier(.2,.8,.2,1);overflow-y:auto}
@keyframes slide{from{transform:translateX(40px);opacity:0}to{transform:translateX(0);opacity:1}}
.scrim{position:fixed;inset:0;background:rgba(2,4,8,.5);z-index:55;animation:fade .2s}
@keyframes fade{from{opacity:0}to{opacity:1}}
.widget{position:absolute;will-change:left,top}
.widget.dragging{z-index:50;box-shadow:0 34px 80px -28px rgba(0,0,0,.95);cursor:grabbing}
.widget.dragging .glasscard{border-color:rgba(86,212,240,.5)}
.handle{cursor:grab;color:var(--muted-2);touch-action:none}
.handle:active{cursor:grabbing}
.bubble{max-width:84%;padding:10px 13px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap}
.bubble.u{align-self:flex-end;background:linear-gradient(180deg,rgba(86,212,240,.20),rgba(86,212,240,.10));border:1px solid rgba(86,212,240,.32)}
.bubble.a{align-self:flex-start;background:var(--glass-2);border:1px solid var(--border)}
.typing span{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--muted);margin:0 1px;animation:blink 1.2s infinite}
.typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,60%,100%{opacity:.25}30%{opacity:1}}
.fadein{animation:fade .3s ease}
.toastwrap{position:fixed;bottom:18px;right:18px;z-index:90;display:flex;flex-direction:column;gap:9px}
.toast{background:rgba(8,12,20,.94);border:1px solid var(--border-hi);border-radius:12px;padding:11px 15px;font-size:13px;display:flex;align-items:center;gap:9px;animation:toastin .25s;backdrop-filter:blur(14px);box-shadow:0 14px 40px -16px rgba(0,0,0,.9)}
@keyframes toastin{from{transform:translateX(30px);opacity:0}to{transform:translateX(0);opacity:1}}
.sec{font-family:var(--mono);font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted-2);padding:14px 12px 5px}
.prog{height:6px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden}
.prog>i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,var(--cyan),var(--violet))}
.modal{position:fixed;inset:0;z-index:70;display:grid;place-items:center;background:rgba(2,4,8,.6);backdrop-filter:blur(6px);animation:fade .2s;padding:20px}
.qopt{border:1px solid var(--border);border-radius:11px;padding:11px 13px;cursor:pointer;font-size:13px;transition:.15s;background:var(--glass-2)}
.qopt:hover{border-color:var(--border-hi)}
.qopt.on{border-color:rgba(86,212,240,.6);background:linear-gradient(180deg,rgba(86,212,240,.18),rgba(86,212,240,.06))}
.signage{border-radius:20px;overflow:hidden;position:relative;min-height:420px;display:flex;flex-direction:column;justify-content:center;padding:48px;background:radial-gradient(120% 120% at 20% 0%,#0e1a2b,#05070c)}
.signage:fullscreen{min-height:100vh;padding:8vw}
.sgdot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.25);cursor:pointer;transition:.2s}
.sgdot.on{background:var(--cyan);width:22px;border-radius:6px}
`;

/* ---------- helpers ---------- */
const mxn = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Math.round(n));
const mxn2 = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(n);
const todayISO = new Date().toISOString().slice(0, 10);
const rng = (s) => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const STATUS = { Activo: "var(--emerald)", Vacaciones: "var(--cyan)", Incapacidad: "var(--amber)", Permiso: "var(--violet)", "Periodo de prueba": "#9aa6b8", "Baja pendiente": "var(--rose)" };
const CONTRATOS = ["Indeterminado", "Determinado", "Obra/Proyecto", "Periodo de prueba", "Capacitación inicial"];
const TURNOS = ["Matutino", "Vespertino", "Nocturno", "Mixto"];
const TURNO_COLOR = { Matutino: "var(--amber)", Vespertino: "var(--violet)", Nocturno: "var(--cyan)", Mixto: "var(--emerald)" };
const PUESTOS = ["Operador(a) de línea", "Empacador(a)", "Supervisor(a) de turno", "Analista de calidad", "Almacenista", "Técnico de mantenimiento", "Coordinador(a)", "Jefe(a) de área", "Auxiliar administrativo", "Gerente"];
const FIRST = ["Sofía", "Mateo", "Valentina", "Diego", "Regina", "Emiliano", "Ximena", "Santiago", "Camila", "Leonardo", "Renata", "Aldo", "Andrea", "Bruno", "Daniela", "Tadeo", "Fernanda", "Aarón", "Mariana", "Carlos", "Lucía", "Alan", "Paola", "Hugo", "Karla", "Néstor", "Montserrat", "Rodrigo", "Itzel", "Sergio", "Brenda", "Omar", "Citlali", "Gerardo", "Yael"];
const LAST = ["López", "Hernández", "García", "Martínez", "Ramírez", "Torres", "Flores", "Vega", "Castro", "Ríos", "Mendoza", "Salazar", "Cruz", "Domínguez", "Navarro", "Cervantes", "Ibarra", "Quintero", "Ochoa", "Aguilar", "Beltrán", "Galindo", "Rosales"];

function buildStaff() {
  const r = rng(74); const statuses = Object.keys(STATUS); const arr = [];
  for (let i = 0; i < ORG.n; i++) {
    const fn = FIRST[Math.floor(r() * FIRST.length)];
    const ln = `${LAST[Math.floor(r() * LAST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
    const years = Math.floor(r() * 12);
    const hire = new Date(); hire.setFullYear(hire.getFullYear() - years); hire.setMonth(Math.floor(r() * 12));
    const status = r() > 0.86 ? statuses[2 + Math.floor(r() * 4)] : "Activo";
    arr.push({
      id: `GFP-${String(1000 + i)}`,
      nombre: `${fn} ${ln}`,
      depto: ORG.deptos[Math.floor(r() * ORG.deptos.length)],
      puesto: PUESTOS[Math.floor(r() * PUESTOS.length)],
      status, contrato: CONTRATOS[Math.floor(r() * CONTRATOS.length)],
      planta: ORG.plantas[Math.floor(r() * ORG.plantas.length)],
      turno: TURNOS[Math.floor(r() * TURNOS.length)],
      ingreso: hire.toISOString().slice(0, 10), antiguedad: years,
      salario: 8500 + Math.floor(r() * 48000),
      email: `${fn.toLowerCase()}.${ln.split(" ")[0].toLowerCase()}@${ORG.domain}`,
    });
  }
  return arr;
}

/* estado del flujo: 'jefe' (pend. jefe directo) → 'wkf' (pend. Workforce) → 'aprobada' */
const SOLICITUDES_SEED = [
  { id: "S-2041", who: "Mariana Torres Vega", depto: "Empaque", jefe: "Supervisor de Empaque", tipo: "Vacaciones", detalle: "5 días · 12–16 jun", fecha: "2026-06-08", estado: "jefe" },
  { id: "S-2042", who: "Omar Galindo Ríos", depto: "Producción", jefe: "Jefe de Producción", tipo: "Cambio de turno", detalle: "Nocturno → Matutino", fecha: "2026-06-08", estado: "jefe" },
  { id: "S-2043", who: "Citlali Mendoza Cruz", depto: "Calidad e Inocuidad", jefe: "Coordinador de Calidad", tipo: "Constancia laboral", detalle: "Para trámite bancario", fecha: "2026-06-07", estado: "wkf" },
  { id: "S-2044", who: "Gerardo Beltrán López", depto: "Mantenimiento", jefe: "Jefe de Mantenimiento", tipo: "Permiso", detalle: "1 día con goce", fecha: "2026-06-07", estado: "wkf" },
  { id: "S-2045", who: "Brenda Aguilar Flores", depto: "Almacén y Logística", jefe: "Jefe de Almacén", tipo: "Vacaciones", detalle: "3 días · 20–22 jun", fecha: "2026-06-06", estado: "jefe" },
  { id: "S-2046", who: "Néstor Quintero Castro", depto: "Producción", jefe: "Jefe de Producción", tipo: "Anticipo de nómina", detalle: "Quincena en curso", fecha: "2026-06-06", estado: "wkf" },
];
const ESTADO_FLUJO = { jefe: { label: "Pend. jefe directo", color: "var(--amber)" }, wkf: { label: "Pend. Workforce", color: "var(--cyan)" }, aprobada: { label: "Aprobada", color: "var(--emerald)" } };

const CAT_COLOR = { Inocuidad: "var(--emerald)", Calidad: "var(--cyan)", Seguridad: "var(--amber)", Onboarding: "var(--violet)" };
const CURSOS_SEED = [
  { id: "C-01", titulo: "Inocuidad Alimentaria (HACCP)", cat: "Inocuidad", dur: "3h", oblig: true, progreso: 100, calif: 94, fechaCompl: "2026-03-11", vence: "2026-12-01" },
  { id: "C-02", titulo: "Buenas Prácticas de Manufactura (BPM)", cat: "Calidad", dur: "2h", oblig: true, progreso: 100, calif: 88, fechaCompl: "2026-02-02", vence: "2026-10-15" },
  { id: "C-03", titulo: "Seguridad en piso y uso de EPP", cat: "Seguridad", dur: "1.5h", oblig: true, progreso: 60, calif: null },
  { id: "C-04", titulo: "Manejo de alérgenos", cat: "Inocuidad", dur: "1h", oblig: true, progreso: 0, calif: null },
  { id: "C-05", titulo: "Inducción CÓDICE / Onboarding", cat: "Onboarding", dur: "45m", oblig: false, progreso: 100, calif: 100, fechaCompl: "2026-01-20", vence: null },
  { id: "C-06", titulo: "Control de plagas y limpieza (POES)", cat: "Calidad", dur: "1h", oblig: false, progreso: 30, calif: null },
];
const QUIZ = [
  { q: "¿Qué significa PCC en un sistema HACCP?", opts: ["Punto Crítico de Control", "Proceso Correctivo Central", "Plan de Control de Calidad"], ok: 0 },
  { q: "El lavado de manos en planta de alimentos debe hacerse…", opts: ["Solo al iniciar el turno", "Al ingresar y cada vez que se contaminen", "Únicamente después de comer"], ok: 1 },
  { q: "Ante un alérgeno no declarado en línea, lo correcto es…", opts: ["Continuar la producción", "Detener y notificar a Calidad", "Mezclar el lote"], ok: 1 },
];
const SLIDES = [
  { type: "kpi", titulo: "Seguridad", items: [{ k: "Días sin accidentes", v: "47", c: "var(--emerald)" }, { k: "Casi-accidentes reportados", v: "3", c: "var(--amber)" }, { k: "EPP en cumplimiento", v: "98%", c: "var(--cyan)" }] },
  { type: "kpi", titulo: "Calidad e Inocuidad", items: [{ k: "Cumplimiento inocuidad", v: "99.1%", c: "var(--emerald)" }, { k: "No conformidades (sem)", v: "2", c: "var(--amber)" }, { k: "Auditoría interna", v: "A", c: "var(--cyan)" }] },
  { type: "kpi", titulo: "Producción", items: [{ k: "OEE planta", v: "91%", c: "var(--cyan)" }, { k: "Cumplimiento de plan", v: "104%", c: "var(--emerald)" }, { k: "Merma", v: "1.8%", c: "var(--amber)" }] },
  { type: "comunicado", titulo: "Comunicado interno", cuerpo: "Campaña de vacunación estacional el viernes 20 de junio en el comedor de Planta Vallejo, de 9:00 a 14:00. Acércate con tu credencial GFP." },
  { type: "reconocimiento", nombre: "Mariana Torres", area: "Empaque · Matutino", motivo: "Colaboradora del mes por cero paros de línea y liderazgo en 5S." },
  { type: "capacitacion", cursos: ["Manejo de alérgenos — obligatorio, vence pronto", "Seguridad en piso y uso de EPP", "Control de plagas y limpieza (POES)"] },
];
const AUSENTISMO = [{ m: "Ene", v: 4.1, rot: 2.2 }, { m: "Feb", v: 3.7, rot: 1.9 }, { m: "Mar", v: 4.6, rot: 2.6 }, { m: "Abr", v: 3.9, rot: 2.1 }, { m: "May", v: 3.4, rot: 1.7 }, { m: "Jun", v: 3.1, rot: 1.5 }];

/* ---------- atoms ---------- */
const StatusChip = ({ s }) => <span className="chip"><span className="dot" style={{ background: STATUS[s] }} />{s}</span>;
const Eyebrow = ({ children }) => <div className="eyebrow">{children}</div>;
const tipStyle = { background: "rgba(8,12,20,.95)", border: "1px solid var(--border-hi)", borderRadius: 10, fontSize: 12, color: "#eaf0f7" };
const KV = ({ k, v }) => <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">{k}</span><span className="mono">{v}</span></div>;
function Stat({ label, value, sub, accent = "var(--cyan)" }) {
  return (
    <div className="glass-2" style={{ padding: "13px 15px", flex: 1, minWidth: 120 }}>
      <Eyebrow>{label}</Eyebrow>
      <div className="kpi" style={{ fontSize: 26, marginTop: 7, color: accent }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
function download(name, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function askClaude(systemPrompt, history) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: systemPrompt, messages: history }),
  });
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}
function diasVacaciones(a) { if (a < 1) return 6; if (a === 1) return 12; if (a <= 5) return 12 + (a - 1) * 2; return 22 + Math.floor((a - 6) / 5) * 2; }
const JORNADA = { 2026: 48, 2027: 46, 2028: 44, 2029: 42, 2030: 40 };

/* ============================================================
   COCKPIT — smooth draggable (DOM-mutation + commit)
   ============================================================ */
const COCKPIT_DEFAULT = [
  { id: "headcount", x: 0, y: 0, w: 300, h: 244 },
  { id: "turnos", x: 316, y: 0, w: 300, h: 244 },
  { id: "compliance", x: 632, y: 0, w: 300, h: 244 },
  { id: "deptos", x: 0, y: 258, w: 460, h: 296 },
  { id: "jornada", x: 476, y: 258, w: 456, h: 138 },
  { id: "solicitudes", x: 476, y: 408, w: 456, h: 146 },
];

function WidgetShell({ id, title, badge, active, onStart, setRef, x, y, w, h, children }) {
  return (
    <div ref={setRef} className={`widget ${active ? "dragging" : ""}`} style={{ left: x, top: y, width: w, height: h }}>
      <div className="glass glasscard" style={{ width: "100%", height: "100%", padding: 14, overflow: "hidden" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <GripVertical size={14} className="handle" onPointerDown={(e) => onStart(e, id)} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
          </div>
          {badge}
        </div>
        {children}
      </div>
    </div>
  );
}

function Cockpit({ staff, solicitudes, resolver, go }) {
  const total = staff.length;
  const byStatus = useMemo(() => { const m = {}; staff.forEach((e) => (m[e.status] = (m[e.status] || 0) + 1)); return Object.entries(m).map(([name, value]) => ({ name, value, fill: STATUS[name] })); }, [staff]);
  const byTurno = useMemo(() => TURNOS.map((t) => ({ name: t, value: staff.filter((e) => e.turno === t).length, fill: TURNO_COLOR[t] })), [staff]);
  const byDepto = useMemo(() => { const m = {}; staff.forEach((e) => (m[e.depto] = (m[e.depto] || 0) + 1)); return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); }, [staff]);
  const activos = staff.filter((e) => e.status === "Activo").length;
  const bajas = staff.filter((e) => e.status === "Baja pendiente").length;
  const nomina = staff.reduce((a, e) => a + e.salario, 0);
  const compliance = Math.round((activos / total) * 100);
  const pendientes = solicitudes.length;

  const [layout, setLayout] = useState(COCKPIT_DEFAULT);
  const [activeId, setActiveId] = useState(null);
  const wrapRef = useRef(null);
  const els = useRef({});
  const drag = useRef(null);

  const onStart = useCallback((e, id) => {
    const item = layout.find((l) => l.id === id);
    drag.current = { id, sx: e.clientX, sy: e.clientY, ox: item.x, oy: item.y, w: item.w, cx: item.x, cy: item.y };
    setActiveId(id);
    e.target.setPointerCapture?.(e.pointerId);
  }, [layout]);

  useEffect(() => {
    const move = (e) => {
      const d = drag.current; if (!d) return;
      const maxW = wrapRef.current?.clientWidth || 940;
      let nx = Math.max(0, Math.min(d.ox + (e.clientX - d.sx), maxW - d.w));
      let ny = Math.max(0, d.oy + (e.clientY - d.sy));
      d.cx = nx; d.cy = ny;
      const el = els.current[d.id];
      if (el) { el.style.left = nx + "px"; el.style.top = ny + "px"; }
    };
    const up = () => {
      const d = drag.current; if (!d) return;
      const snap = (v) => Math.round(v / 8) * 8;
      setLayout((L) => L.map((l) => (l.id === d.id ? { ...l, x: snap(d.cx), y: snap(d.cy) } : l)));
      drag.current = null; setActiveId(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  const reset = () => { setLayout(COCKPIT_DEFAULT.map((x) => ({ ...x }))); toast("Tablero restablecido"); };
  const pos = (id) => layout.find((l) => l.id === id);
  const maxBottom = Math.max(...layout.map((l) => l.y + l.h)) + 16;
  const setRef = (id) => (el) => { if (el) els.current[id] = el; };

  return (
    <div className="fadein">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <Eyebrow>Cockpit · {ORG.kind}</Eyebrow>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 0" }}>Panel de control de personal</h1>
        </div>
        <button className="btn" onClick={reset}><RotateCcw size={14} />Reacomodar tablero</button>
      </div>

      <div ref={wrapRef} style={{ position: "relative", height: maxBottom, minHeight: 560 }}>
        <WidgetShell id="headcount" title="Plantilla total" active={activeId === "headcount"} onStart={onStart} setRef={setRef("headcount")} {...pos("headcount")}
          badge={<span className="chip"><Users size={11} />{total}</span>}>
          <div className="kpi" style={{ fontSize: 50, color: "var(--cyan)" }}>{total}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>colaboradores en {ORG.short}</div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="chip" style={{ color: "var(--emerald)" }}>{activos} activos</span>
            <span className="chip" style={{ color: "var(--rose)" }}>{bajas} bajas pend.</span>
          </div>
          <div className="mono muted2" style={{ fontSize: 11, marginTop: 12 }}>Nómina mensual ≈ {mxn(nomina)}</div>
        </WidgetShell>

        <WidgetShell id="turnos" title="Distribución por turno" active={activeId === "turnos"} onStart={onStart} setRef={setRef("turnos")} {...pos("turnos")}>
          <div className="row" style={{ height: 168, gap: 4 }}>
            <ResponsiveContainer width="54%" height="100%">
              <PieChart><Pie data={byTurno} dataKey="value" innerRadius={40} outerRadius={66} paddingAngle={2} stroke="none">{byTurno.map((e, i) => <Cell key={i} fill={e.fill} />)}</Pie><Tooltip contentStyle={tipStyle} /></PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5 }}>
              {byTurno.map((e) => <div key={e.name} className="row" style={{ gap: 7 }}><span className="dot" style={{ background: e.fill }} /><span className="muted" style={{ flex: 1 }}>{e.name}</span><span className="mono">{e.value}</span></div>)}
            </div>
          </div>
        </WidgetShell>

        <WidgetShell id="compliance" title="Índice de cumplimiento" active={activeId === "compliance"} onStart={onStart} setRef={setRef("compliance")} {...pos("compliance")}>
          <ResponsiveContainer width="100%" height={144}>
            <RadialBarChart innerRadius="68%" outerRadius="100%" data={[{ v: compliance, fill: "var(--emerald)" }]} startAngle={90} endAngle={90 - (compliance / 100) * 360}>
              <RadialBar background={{ fill: "rgba(255,255,255,.07)" }} dataKey="v" cornerRadius={20} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div style={{ textAlign: "center", marginTop: -92 }}><div className="kpi" style={{ fontSize: 32, color: "var(--emerald)" }}>{compliance}%</div></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 60, textAlign: "center" }}>plantilla en situación regular</div>
        </WidgetShell>

        <WidgetShell id="deptos" title="Distribución por área" active={activeId === "deptos"} onStart={onStart} setRef={setRef("deptos")} {...pos("deptos")}
          badge={<button className="btn btn-sm" onClick={() => go("filtro")}>Abrir en Filtro→Tablero</button>}>
          <ResponsiveContainer width="100%" height={232}>
            <BarChart data={byDepto} layout="vertical" margin={{ left: 8, right: 18 }}>
              <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={120} tick={{ fill: "var(--muted)", fontSize: 10.5 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,.04)" }} />
              <Bar dataKey="value" fill="var(--cyan)" radius={[0, 6, 6, 0]} barSize={13} />
            </BarChart>
          </ResponsiveContainer>
        </WidgetShell>

        <WidgetShell id="jornada" title="Transición jornada 40h (LFT 2026)" active={activeId === "jornada"} onStart={onStart} setRef={setRef("jornada")} {...pos("jornada")}
          badge={<span className="chip" style={{ color: "var(--amber)" }}><Clock size={11} />vigente</span>}>
          <div className="row" style={{ gap: 6, marginTop: 2 }}>
            {Object.entries(JORNADA).map(([y, h]) => { const cur = y === "2026"; return (
              <div key={y} className="glass-2" style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderColor: cur ? "rgba(245,181,68,.5)" : "var(--border)" }}>
                <div className="mono" style={{ fontSize: 17, color: cur ? "var(--amber)" : "var(--text)" }}>{h}h</div><div className="muted2" style={{ fontSize: 10 }}>{y}</div>
              </div>); })}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 9 }}>Reducción gradual 48→40h/semana sin afectar salario. Registro electrónico de jornada obligatorio.</div>
        </WidgetShell>

        <WidgetShell id="solicitudes" title="Solicitudes pendientes" active={activeId === "solicitudes"} onStart={onStart} setRef={setRef("solicitudes")} {...pos("solicitudes")}
          badge={<span className="chip" style={{ color: pendientes ? "var(--amber)" : "var(--emerald)" }}><Inbox size={11} />{pendientes}</span>}>
          <div style={{ overflowY: "auto", height: 96, display: "flex", flexDirection: "column", gap: 7 }}>
            {pendientes === 0 && <div className="muted" style={{ fontSize: 12, padding: "8px 2px" }}>Bandeja al día. Sin solicitudes pendientes.</div>}
            {solicitudes.slice(0, 6).map((s) => (
              <div key={s.id} className="glass-2 row" style={{ padding: "7px 10px", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.tipo} · {s.who.split(" ")[0]}</div>
                  <div className="row" style={{ gap: 5 }}><span className="dot" style={{ background: ESTADO_FLUJO[s.estado].color }} /><span className="muted2" style={{ fontSize: 10 }}>{ESTADO_FLUJO[s.estado].label}</span></div>
                </div>
                <div className="row" style={{ gap: 5, flexShrink: 0 }}>
                  <button className="btn btn-sm btn-ok" onClick={() => resolver(s.id, true)} title={s.estado === "jefe" ? "Autorizar (jefe)" : "Aprobar (WKF)"}><Check size={13} /></button>
                  <button className="btn btn-sm btn-no" onClick={() => resolver(s.id, false)} title="Rechazar"><X size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </WidgetShell>
      </div>
    </div>
  );
}

/* ============================================================
   PLANTILLA
   ============================================================ */
function toCSV(rows) {
  const head = ["id", "nombre", "depto", "puesto", "contrato", "planta", "turno", "ingreso", "antiguedad", "salario", "status"];
  return [head.join(","), ...rows.map((r) => head.map((k) => `"${String(r[k] ?? "")}"`).join(","))].join("\n");
}
function Plantilla({ staff, setStaff }) {
  const [q, setQ] = useState(""); const [fStatus, setFStatus] = useState("Todos"); const [fDepto, setFDepto] = useState("Todos");
  const [sel, setSel] = useState(null); const [nuevo, setNuevo] = useState(false);
  const deptos = ["Todos", ...ORG.deptos];
  const rows = staff.filter((e) =>
    (q === "" || e.nombre.toLowerCase().includes(q.toLowerCase()) || e.id.toLowerCase().includes(q.toLowerCase())) &&
    (fStatus === "Todos" || e.status === fStatus) && (fDepto === "Todos" || e.depto === fDepto));
  const setStatus = (id, status) => { setStaff((S) => S.map((e) => (e.id === id ? { ...e, status } : e))); toast(`Estatus → ${status}`); };

  return (
    <div className="fadein">
      <Eyebrow>Plantilla · {staff.length} colaboradores</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Consulta de personal</h1>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="row glass-2" style={{ padding: "0 11px", flex: 1, minWidth: 220, gap: 8 }}>
          <Search size={15} className="muted" />
          <input className="input" style={{ border: "none", background: "transparent", padding: "10px 0" }} placeholder="Buscar por nombre o ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: 160 }} value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option>Todos</option>{Object.keys(STATUS).map((s) => <option key={s}>{s}</option>)}</select>
        <select className="select" style={{ width: 180 }} value={fDepto} onChange={(e) => setFDepto(e.target.value)}>{deptos.map((d) => <option key={d}>{d}</option>)}</select>
        <button className="btn btn-accent" onClick={() => setNuevo(true)}><Plus size={14} />Nuevo</button>
        <button className="btn" onClick={() => { download(`plantilla_gfp_${todayISO}.csv`, toCSV(rows)); toast(`CSV exportado · ${rows.length} filas`); }}><Download size={14} />CSV</button>
      </div>

      <div className="glass" style={{ overflow: "hidden", padding: 0 }}>
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          <table className="tbl">
            <thead style={{ position: "sticky", top: 0, background: "rgba(8,12,20,.92)", backdropFilter: "blur(8px)" }}>
              <tr><th>ID</th><th>Colaborador</th><th>Área</th><th>Turno</th><th>Contrato</th><th>Antig.</th><th>Estatus</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} onClick={() => setSel(e)}>
                  <td className="mono muted2">{e.id}</td>
                  <td style={{ fontWeight: 500 }}>{e.nombre}</td>
                  <td className="muted">{e.depto}</td>
                  <td><span className="chip" style={{ color: TURNO_COLOR[e.turno] }}>{e.turno}</span></td>
                  <td><span className="chip">{e.contrato}</span></td>
                  <td className="mono muted">{e.antiguedad}a</td>
                  <td><StatusChip s={e.status} /></td>
                  <td><ChevronRight size={15} className="muted2" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="muted2" style={{ fontSize: 11, marginTop: 8 }}>{rows.length} resultados</div>

      {sel && <ProfileDrawer e={sel} onClose={() => setSel(null)} setStatus={setStatus} update={(p) => { setStaff((S) => S.map((x) => x.id === sel.id ? { ...x, ...p } : x)); setSel({ ...sel, ...p }); toast("Expediente actualizado"); }} />}
      {nuevo && <NuevoDrawer onClose={() => setNuevo(false)} onCreate={(emp) => { setStaff((S) => [emp, ...S]); setNuevo(false); toast(`Alta registrada · ${emp.nombre}`); }} count={staff.length} />}
    </div>
  );
}
const Mini = ({ label, v }) => <div className="glass-2" style={{ padding: "9px 12px" }}><div className="muted2" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".12em" }}>{label}</div><div style={{ fontSize: 13.5, fontWeight: 500, marginTop: 3 }}>{v}</div></div>;

function ProfileDrawer({ e, onClose, setStatus, update }) {
  const dv = diasVacaciones(e.antiguedad); const sd = e.salario / 30;
  return (
    <><div className="scrim" onClick={onClose} />
      <div className="drawer" style={{ padding: 22 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 18 }}><Eyebrow>Expediente</Eyebrow><X size={18} className="handle" style={{ cursor: "pointer" }} onClick={onClose} /></div>
        <div className="row" style={{ gap: 13, marginBottom: 18 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,var(--cyan),var(--violet))", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 18, color: "#04060a" }}>{e.nombre.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>
          <div><div style={{ fontSize: 17, fontWeight: 600 }}>{e.nombre}</div><div className="muted" style={{ fontSize: 12.5 }}>{e.puesto} · {e.depto}</div><div className="mono muted2" style={{ fontSize: 11, marginTop: 2 }}>{e.id} · {e.email}</div></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <Mini label="Planta" v={e.planta} /><Mini label="Turno" v={e.turno} /><Mini label="Ingreso" v={e.ingreso} /><Mini label="Antigüedad" v={`${e.antiguedad} años`} /><Mini label="Salario mensual" v={mxn(e.salario)} /><Mini label="Contrato" v={e.contrato} />
        </div>
        <Eyebrow>Modificar estatus</Eyebrow>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "9px 0 18px" }}>
          {Object.keys(STATUS).map((s) => <button key={s} className={`btn btn-sm ${e.status === s ? "btn-accent" : ""}`} onClick={() => setStatus(e.id, s)}><span className="dot" style={{ background: STATUS[s] }} />{s}</button>)}
        </div>
        <Eyebrow>Tipo de contrato</Eyebrow>
        <select className="select" style={{ margin: "9px 0 18px" }} value={e.contrato} onChange={(ev) => update({ contrato: ev.target.value })}>{CONTRATOS.map((c) => <option key={c}>{c}</option>)}</select>
        <div className="glass-2" style={{ padding: 14 }}>
          <Eyebrow>Derechos LFT estimados</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9, fontSize: 12.5 }}>
            <KV k="Vacaciones / año" v={`${dv} días`} /><KV k="Prima vacacional (25%)" v={mxn(dv * sd * 0.25)} /><KV k="Aguinaldo (15 días)" v={mxn(sd * 15)} /><KV k="Salario diario base" v={mxn2(sd)} />
          </div>
        </div>
      </div></>
  );
}
function NuevoDrawer({ onClose, onCreate, count }) {
  const [f, setF] = useState({ nombre: "", depto: ORG.deptos[0], puesto: PUESTOS[0], turno: "Matutino", contrato: "Periodo de prueba", planta: ORG.plantas[0], salario: 12000 });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const crear = () => {
    const emp = { id: `GFP-${1000 + count}`, nombre: f.nombre.trim(), depto: f.depto, puesto: f.puesto, turno: f.turno, contrato: f.contrato, planta: f.planta, status: "Periodo de prueba", antiguedad: 0, ingreso: todayISO, salario: +f.salario, email: `${f.nombre.trim().toLowerCase().replace(/\s+/g, ".")}@${ORG.domain}` };
    onCreate(emp);
  };
  return (
    <><div className="scrim" onClick={onClose} />
      <div className="drawer" style={{ padding: 22 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 18 }}><Eyebrow>Alta de colaborador</Eyebrow><X size={18} className="handle" style={{ cursor: "pointer" }} onClick={onClose} /></div>
        <label className="fld">Nombre completo</label><input className="input" style={{ marginBottom: 12 }} value={f.nombre} onChange={set("nombre")} placeholder="Nombre y apellidos" />
        <div className="row" style={{ gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label className="fld">Área</label><select className="select" value={f.depto} onChange={set("depto")}>{ORG.deptos.map((d) => <option key={d}>{d}</option>)}</select></div>
          <div style={{ flex: 1 }}><label className="fld">Planta</label><select className="select" value={f.planta} onChange={set("planta")}>{ORG.plantas.map((d) => <option key={d}>{d}</option>)}</select></div>
        </div>
        <div className="row" style={{ gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}><label className="fld">Puesto</label><select className="select" value={f.puesto} onChange={set("puesto")}>{PUESTOS.map((d) => <option key={d}>{d}</option>)}</select></div>
          <div style={{ flex: 1 }}><label className="fld">Turno</label><select className="select" value={f.turno} onChange={set("turno")}>{TURNOS.map((d) => <option key={d}>{d}</option>)}</select></div>
        </div>
        <div className="row" style={{ gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1 }}><label className="fld">Contrato</label><select className="select" value={f.contrato} onChange={set("contrato")}>{CONTRATOS.map((d) => <option key={d}>{d}</option>)}</select></div>
          <div style={{ flex: 1 }}><label className="fld">Salario mensual</label><input className="input" type="number" value={f.salario} onChange={set("salario")} /></div>
        </div>
        <button className="btn btn-accent" style={{ width: "100%", justifyContent: "center" }} disabled={!f.nombre.trim()} onClick={crear}><Plus size={15} />Registrar alta</button>
      </div></>
  );
}

/* ============================================================
   CONTRATOS
   ============================================================ */
function Contratos({ staff }) {
  const [tipo, setTipo] = useState("Indeterminado"); const [empId, setEmpId] = useState("");
  const emp = staff.find((e) => e.id === empId);
  const [form, setForm] = useState({ nombre: "", puesto: "", salario: "", duracion: "12 meses", inicio: todayISO });
  useEffect(() => { if (emp) setForm((f) => ({ ...f, nombre: emp.nombre, puesto: emp.puesto, salario: emp.salario })); }, [empId]);
  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const sd = (Number(form.salario) || 0) / 30;
  const doc = buildContract({ tipo, form, sd, planta: emp?.planta || ORG.plantas[0] });
  return (
    <div className="fadein">
      <Eyebrow>Contratos · plantilla LFT precargada</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Generación inmediata de contrato</h1>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,360px) 1fr", gap: 16 }}>
        <div className="glass" style={{ padding: 18 }}>
          <label className="fld">Blueprint (tipo de contrato)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>{CONTRATOS.map((c) => <button key={c} className={`btn btn-sm ${tipo === c ? "btn-accent" : ""}`} onClick={() => setTipo(c)}>{c}</button>)}</div>
          <label className="fld">Cargar colaborador existente</label>
          <select className="select" style={{ marginBottom: 14 }} value={empId} onChange={(e) => setEmpId(e.target.value)}><option value="">— Nuevo / vacío —</option>{staff.slice(0, 80).map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.id}</option>)}</select>
          <label className="fld">Nombre del trabajador</label><input className="input" style={{ marginBottom: 12 }} value={form.nombre} onChange={f("nombre")} />
          <label className="fld">Puesto</label><input className="input" style={{ marginBottom: 12 }} value={form.puesto} onChange={f("puesto")} />
          <div className="row" style={{ gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}><label className="fld">Salario mensual</label><input className="input" type="number" value={form.salario} onChange={f("salario")} /></div>
            <div style={{ flex: 1 }}><label className="fld">Fecha inicio</label><input className="input" type="date" value={form.inicio} onChange={f("inicio")} /></div>
          </div>
          {(tipo === "Determinado" || tipo === "Obra/Proyecto" || tipo === "Capacitación inicial") && (<><label className="fld">Duración / objeto</label><input className="input" style={{ marginBottom: 12 }} value={form.duracion} onChange={f("duracion")} /></>)}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn btn-accent" style={{ flex: 1 }} onClick={() => { download(`contrato_${(form.nombre || "trabajador").replace(/\s/g, "_")}.html`, doc, "text/html"); toast("Contrato generado (.html)"); }}><Download size={14} />Descargar</button>
            <button className="btn" onClick={() => { const w = window.open("", "_blank"); if (w) { w.document.write(doc); w.document.close(); w.print(); } toast("Abriendo impresión…"); }}><FileText size={14} />Imprimir / PDF</button>
          </div>
        </div>
        <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row" style={{ justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><span style={{ fontWeight: 600, fontSize: 13 }}>Vista previa</span><span className="chip"><FileSignature size={11} />{tipo}</span></div>
          <div style={{ padding: 22, maxHeight: 560, overflowY: "auto", background: "rgba(255,255,255,.97)", color: "#16202e" }} dangerouslySetInnerHTML={{ __html: doc.replace(/<\/?(html|head|body)[^>]*>/g, "").replace(/<style[\s\S]*?<\/style>/g, "") }} />
        </div>
      </div>
    </div>
  );
}
function buildContract({ tipo, form, sd, planta }) {
  const dur = {
    "Indeterminado": "El presente contrato se celebra por <b>tiempo indeterminado</b>, en términos del artículo 35 de la LFT.",
    "Determinado": `El presente contrato se celebra por <b>tiempo determinado</b> con vigencia de <b>${form.duracion}</b> (art. 37 LFT), justificándose la temporalidad por la naturaleza del trabajo.`,
    "Obra/Proyecto": `El presente contrato se celebra <b>por obra o proyecto determinado</b> (${form.duracion}), conforme al artículo 36 de la LFT.`,
    "Periodo de prueba": "El presente contrato incluye un <b>periodo de prueba</b> que no excederá de 30 días (180 para dirección/técnicos), conforme al artículo 39-A de la LFT.",
    "Capacitación inicial": `El presente contrato es <b>de capacitación inicial</b> por ${form.duracion} (máx. 3 meses; 6 para dirección/técnicos), conforme al artículo 39-B de la LFT.`,
  }[tipo];
  return `<html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;color:#16202e;max-width:720px;margin:0 auto;padding:36px;line-height:1.65;font-size:13.5px}h1{font-size:17px;text-align:center;text-transform:uppercase}h2{font-size:13px;margin-top:22px;border-bottom:1px solid #ccc;padding-bottom:5px}.meta{font-size:12px;color:#555}.sign{margin-top:54px;display:flex;justify-content:space-between;gap:40px}.sign div{flex:1;text-align:center;border-top:1px solid #16202e;padding-top:8px;font-size:11px}</style></head><body>
  <h1>Contrato Individual de Trabajo</h1>
  <p class="meta">Que celebran por una parte <b>${ORG.name}</b>, con domicilio en ${ORG.city} (el "Patrón"), y por la otra <b>${form.nombre || "[Nombre del trabajador]"}</b> (el "Trabajador"), al amparo de la Ley Federal del Trabajo (LFT).</p>
  <h2>Primera — Objeto y puesto</h2><p>El Trabajador desempeñará el puesto de <b>${form.puesto || "[puesto]"}</b>, con centro de trabajo en <b>${planta}</b>.</p>
  <h2>Segunda — Duración</h2><p>${dur} Inicio: <b>${form.inicio}</b>.</p>
  <h2>Tercera — Jornada</h2><p>La jornada se sujeta a la reforma 2026: máximo <b>48h semanales en 2026</b>, disminuyendo hasta <b>40h en 2030</b> (8h diarias máximo), sin reducción de salario, con <b>registro electrónico de jornada</b>. El tiempo extraordinario se cubre conforme a los arts. 66–68 LFT.</p>
  <h2>Cuarta — Salario</h2><p>Salario mensual de <b>${mxn(Number(form.salario) || 0)}</b> (diario ${mxn2(sd)}), pagadero conforme al art. 88 LFT.</p>
  <h2>Quinta — Prestaciones de ley</h2><p>Aguinaldo de 15 días (art. 87); vacaciones (art. 76: 12 días el primer año, hasta 20 al quinto); prima vacacional del 25% (art. 80); descanso semanal y obligatorios (arts. 69 y 74); IMSS, INFONAVIT y SAR.</p>
  <h2>Sexta — Inocuidad y confidencialidad</h2><p>El Trabajador observará las normas de inocuidad alimentaria, seguridad e higiene aplicables y guardará reserva de la información del Patrón.</p>
  <h2>Séptima — Disposiciones finales</h2><p>En lo no previsto se estará a la LFT. Las partes firman de conformidad.</p>
  <div class="sign"><div>El Patrón<br>${ORG.name}</div><div>El Trabajador<br>${form.nombre || "[Nombre]"}</div></div>
  <p style="margin-top:30px;font-size:10px;color:#888">Generado por CÓDICE · Plantilla referencial. Validar con asesoría jurídica antes de su uso.</p></body></html>`;
}

/* ============================================================
   LFT
   ============================================================ */
function LFT() {
  const [tab, setTab] = useState("aguinaldo");
  const [sal, setSal] = useState(15000); const [anios, setAnios] = useState(3); const [diasTrab, setDiasTrab] = useState(220); const [salMin, setSalMin] = useState(278.8);
  const sd = sal / 30;
  const c = useMemo(() => {
    const dv = diasVacaciones(anios); const agProp = sd * 15 * (diasTrab / 365); const pv = dv * sd * 0.25;
    const sdT = Math.min(sd, salMin * 2); const pa = 12 * sdT * anios; const fin = agProp + dv * sd + pv;
    return { dv, ag: sd * 15, agProp, pv, pa, fin, ind: sal * 3 + sd * 20 * anios + pa + agProp + dv * sd + pv };
  }, [sal, anios, diasTrab, salMin, sd]);
  const arts = [
    ["Art. 76", "Vacaciones", "12 días el primer año; +2 por año hasta 20 al quinto; luego +2 cada 5 años."],
    ["Art. 80", "Prima vacacional", "Mínimo 25% sobre los salarios de los días de vacaciones."],
    ["Art. 87", "Aguinaldo", "Mínimo 15 días de salario, antes del 20 de diciembre."],
    ["Reforma 2026", "Jornada", "Reducción gradual 48→40h/sem (2026–2030); máx. 8h diarias; registro electrónico."],
    ["Art. 162", "Prima de antigüedad", "12 días por año, con salario topado a 2× el mínimo."],
    ["Art. 48–50", "Despido injustificado", "3 meses + 20 días por año + prima de antigüedad + salarios vencidos."],
  ];
  const expCalc = () => { download(`calculo_lft_${tab}_${todayISO}.csv`, `Concepto,Monto\nSalario mensual,${sal}\nAntigüedad (años),${anios}\nVacaciones (días),${c.dv}\nAguinaldo,${Math.round(c.ag)}\nPrima vacacional,${Math.round(c.pv)}\nFiniquito,${Math.round(c.fin)}\nIndemnización,${Math.round(c.ind)}`, "text/csv"); toast("Cálculo exportado (.csv)"); };
  const Tab = ({ id, label }) => <button className={`btn btn-sm ${tab === id ? "btn-accent" : ""}`} onClick={() => setTab(id)}>{label}</button>;
  return (
    <div className="fadein">
      <Eyebrow>Ley Federal del Trabajo · en línea</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Módulo legal y calculadoras</h1>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,380px) 1fr", gap: 16 }}>
        <div className="glass" style={{ padding: 18 }}>
          <Eyebrow>Parámetros</Eyebrow>
          <div style={{ marginTop: 12 }}>
            <label className="fld">Salario mensual</label><input className="input" type="number" value={sal} onChange={(e) => setSal(+e.target.value)} style={{ marginBottom: 12 }} />
            <label className="fld">Años de antigüedad</label><input className="input" type="number" value={anios} onChange={(e) => setAnios(+e.target.value)} style={{ marginBottom: 12 }} />
            <label className="fld">Días trabajados en el año</label><input className="input" type="number" value={diasTrab} onChange={(e) => setDiasTrab(+e.target.value)} style={{ marginBottom: 12 }} />
            <label className="fld">Salario mínimo diario <span className="muted2">(verificar zona/año)</span></label><input className="input" type="number" value={salMin} onChange={(e) => setSalMin(+e.target.value)} />
          </div>
          <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} onClick={expCalc}><Download size={14} />Descargar cálculo (.csv)</button>
          <div className="muted2" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>Cálculos referenciales basados en la LFT. No sustituyen asesoría jurídica.</div>
        </div>
        <div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}><Tab id="aguinaldo" label="Aguinaldo" /><Tab id="vacaciones" label="Vacaciones" /><Tab id="finiquito" label="Finiquito" /><Tab id="indemniz" label="Indemnización" /><Tab id="articulos" label="Artículos" /></div>
          {tab === "aguinaldo" && <div className="glass" style={{ padding: 20 }}><Eyebrow>Aguinaldo · Art. 87</Eyebrow><div className="kpi" style={{ fontSize: 38, color: "var(--cyan)", margin: "10px 0" }}>{mxn(c.ag)}</div><div className="muted" style={{ fontSize: 13 }}>15 días sobre salario diario de {mxn2(sd)}.</div><div className="glass-2" style={{ padding: 13, marginTop: 14 }}><KV k="Proporcional por días trabajados" v={mxn(c.agProp)} /></div><div className="muted2" style={{ fontSize: 11, marginTop: 12 }}>La propuesta de "aguinaldo digno" (30 días) sigue en discusión; aún no es ley.</div></div>}
          {tab === "vacaciones" && <div className="glass" style={{ padding: 20 }}><Eyebrow>Vacaciones · Art. 76 + Prima Art. 80</Eyebrow><div className="row" style={{ gap: 16, margin: "12px 0", flexWrap: "wrap" }}><Stat label="Días por año" value={`${c.dv}`} /><Stat label="Prima vacacional 25%" value={mxn(c.pv)} accent="var(--violet)" /></div><ResponsiveContainer width="100%" height={150}><AreaChart data={[1, 2, 3, 4, 5, 6, 10, 15].map((y) => ({ y: `${y}a`, d: diasVacaciones(y) }))}><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--cyan)" stopOpacity={.5} /><stop offset="100%" stopColor="var(--cyan)" stopOpacity={0} /></linearGradient></defs><XAxis dataKey="y" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={tipStyle} /><Area dataKey="d" stroke="var(--cyan)" fill="url(#g)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div>}
          {tab === "finiquito" && <div className="glass" style={{ padding: 20 }}><Eyebrow>Finiquito (renuncia / término normal)</Eyebrow><div className="kpi" style={{ fontSize: 34, color: "var(--emerald)", margin: "10px 0" }}>{mxn(c.fin)}</div><div className="glass-2" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}><KV k="Aguinaldo proporcional" v={mxn(c.agProp)} /><KV k={`Vacaciones (${c.dv} días)`} v={mxn(c.dv * sd)} /><KV k="Prima vacacional 25%" v={mxn(c.pv)} /></div></div>}
          {tab === "indemniz" && <div className="glass" style={{ padding: 20 }}><Eyebrow>Indemnización por despido injustificado · Art. 48–50</Eyebrow><div className="kpi" style={{ fontSize: 34, color: "var(--amber)", margin: "10px 0" }}>{mxn(c.ind)}</div><div className="glass-2" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}><KV k="3 meses de salario" v={mxn(sal * 3)} /><KV k={`20 días × año (${anios})`} v={mxn(sd * 20 * anios)} /><KV k="Prima de antigüedad (topada)" v={mxn(c.pa)} /><KV k="+ Finiquito" v={mxn(c.fin)} /></div></div>}
          {tab === "articulos" && <div className="glass" style={{ padding: 6 }}><table className="tbl"><thead><tr><th>Artículo</th><th>Tema</th><th>Resumen</th></tr></thead><tbody>{arts.map((a) => <tr key={a[0]} style={{ cursor: "default" }}><td className="mono" style={{ color: "var(--cyan)", whiteSpace: "nowrap" }}>{a[0]}</td><td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{a[1]}</td><td className="muted">{a[2]}</td></tr>)}</tbody></table></div>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   FILTRO → TABLERO
   ============================================================ */
const DIMS = { depto: "Área", status: "Estatus", contrato: "Contrato", planta: "Planta", turno: "Turno" };
function FiltroDash({ staff }) {
  const [dim, setDim] = useState("depto"); const [chart, setChart] = useState("bar"); const [fecha, setFecha] = useState(todayISO);
  const [cmpMode, setCmpMode] = useState(false); const [a, setA] = useState(""); const [b, setB] = useState("");
  const data = useMemo(() => { const m = {}; staff.forEach((e) => (m[e[dim]] = (m[e[dim]] || 0) + 1)); return Object.entries(m).map(([name, value]) => ({ name, value })).sort((x, y) => y.value - x.value); }, [staff, dim]);
  const opts = data.map((d) => d.name);
  useEffect(() => { setA(opts[0] || ""); setB(opts[1] || ""); }, [dim]);
  const cmp = cmpMode ? data.filter((d) => d.name === a || d.name === b) : data;
  const colors = ["var(--cyan)", "var(--violet)", "var(--emerald)", "var(--amber)", "var(--rose)", "#9aa6b8", "#6d8bb8", "#c98bd9"];
  const total = staff.length;
  const narrative = cmpMode && a && b
    ? `Al ${fecha}, ${DIMS[dim]} "${a}" agrupa ${(data.find((d) => d.name === a)?.value) || 0} colaboradores frente a ${(data.find((d) => d.name === b)?.value) || 0} de "${b}".`
    : `Al ${fecha}, la plantilla de ${total} colaboradores se distribuye en ${data.length} ${DIMS[dim].toLowerCase()}(s). Mayor concentración: "${data[0]?.name}" (${data[0]?.value}).`;
  const gen = () => { const rows = cmp.map((d) => `"${d.name}",${d.value},"${((d.value / total) * 100).toFixed(1)}%"`).join("\n"); download(`reporte_${dim}_${fecha}.csv`, `Reporte CÓDICE — ${ORG.name}\nDimensión:,${DIMS[dim]}\nFecha de corte:,${fecha}\nTotal:,${total}\n\n${DIMS[dim]},Conteo,Porcentaje\n${rows}\n\nResumen,"${narrative}"`, "text/csv"); toast("Reporte descargado (.csv)"); };
  return (
    <div className="fadein">
      <Eyebrow>Filtro → Tablero · reportes al instante</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 8px" }}>¿Cuántos (X) hay en (Y) vs (Z)?</h1>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16, maxWidth: 620 }}>Arma una pregunta, obtén gráfico + narrativa, y descarga el reporte.</p>
      <div className="glass" style={{ padding: 16, marginBottom: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 150 }}><label className="fld">Agrupar por (X)</label><select className="select" value={dim} onChange={(e) => setDim(e.target.value)}>{Object.entries(DIMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div style={{ minWidth: 140 }}><label className="fld">Fecha de corte</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div style={{ minWidth: 130 }}><label className="fld">Gráfico</label><select className="select" value={chart} onChange={(e) => setChart(e.target.value)}><option value="bar">Barras</option><option value="pie">Dona</option></select></div>
          <button className={`btn ${cmpMode ? "btn-accent" : ""}`} onClick={() => setCmpMode((v) => !v)}><Filter size={14} />Comparar Y vs Z</button>
          {cmpMode && <><div style={{ minWidth: 130 }}><label className="fld">Valor Y</label><select className="select" value={a} onChange={(e) => setA(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></div><div style={{ minWidth: 130 }}><label className="fld">Valor Z</label><select className="select" value={b} onChange={(e) => setB(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></div></>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(240px,300px)", gap: 16 }}>
        <div className="glass" style={{ padding: 18 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}><span style={{ fontWeight: 600, fontSize: 13.5 }}>Plantilla por {DIMS[dim]} · corte {fecha}</span><span className="chip"><CalendarDays size={11} />{cmp.reduce((s, d) => s + d.value, 0)} en vista</span></div>
          <ResponsiveContainer width="100%" height={300}>
            {chart === "bar" ? (
              <BarChart data={cmp} margin={{ top: 8, right: 12 }}><XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={-12} textAnchor="end" height={54} /><YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={28} /><Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,.04)" }} /><Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={cmp.length > 6 ? 22 : 44}>{cmp.map((e, i) => <Cell key={i} fill={colors[i % colors.length]} />)}</Bar></BarChart>
            ) : (
              <PieChart><Pie data={cmp} dataKey="value" nameKey="name" innerRadius={60} outerRadius={110} paddingAngle={2} stroke="none">{cmp.map((e, i) => <Cell key={i} fill={colors[i % colors.length]} />)}</Pie><Tooltip contentStyle={tipStyle} /></PieChart>
            )}
          </ResponsiveContainer>
        </div>
        <div className="glass" style={{ padding: 18, display: "flex", flexDirection: "column" }}>
          <Eyebrow>Lectura automática</Eyebrow>
          <p style={{ fontSize: 13, lineHeight: 1.55, margin: "10px 0 14px" }}>{narrative}</p>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 180 }}><table className="tbl"><tbody>{cmp.map((d, i) => <tr key={d.name} style={{ cursor: "default" }}><td><span className="dot" style={{ background: colors[i % colors.length], marginRight: 8 }} />{d.name}</td><td className="mono" style={{ textAlign: "right" }}>{d.value}</td><td className="mono muted2" style={{ textAlign: "right" }}>{((d.value / total) * 100).toFixed(0)}%</td></tr>)}</tbody></table></div>
          <button className="btn btn-accent" style={{ marginTop: 14 }} onClick={gen}><Download size={14} />Descargar reporte (.csv)</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CHAT (Consultor + Autoservicio)
   ============================================================ */
function ChatPanel({ systemPrompt, intro, quick, placeholder }) {
  const [msgs, setMsgs] = useState([{ role: "assistant", content: intro }]); const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  const send = async (text) => {
    const t = (text ?? input).trim(); if (!t || busy) return;
    const next = [...msgs, { role: "user", content: t }]; setMsgs(next); setInput(""); setBusy(true);
    try { const reply = await askClaude(systemPrompt, next.map((m) => ({ role: m.role, content: m.content }))); setMsgs((M) => [...M, { role: "assistant", content: reply || "No obtuve respuesta." }]); }
    catch { setMsgs((M) => [...M, { role: "assistant", content: "No pude conectar con el modelo. (La IA funciona en la vista previa; en producción se enruta a tu backend o IA local.)" }]); }
    finally { setBusy(false); }
  };
  return (
    <div className="glass" style={{ display: "flex", flexDirection: "column", height: 560, padding: 0, overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 11 }}>
        {msgs.map((m, i) => <div key={i} className={`bubble ${m.role === "user" ? "u" : "a"}`}>{m.content}</div>)}
        {busy && <div className="bubble a typing"><span></span><span></span><span></span></div>}
        <div ref={end} />
      </div>
      {quick && <div className="row" style={{ gap: 7, padding: "0 16px 10px", flexWrap: "wrap" }}>{quick.map((q) => <button key={q} className="btn btn-sm" onClick={() => send(q)} disabled={busy}>{q}</button>)}</div>}
      <div className="row" style={{ gap: 9, padding: 14, borderTop: "1px solid var(--border)" }}>
        <input className="input" placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn btn-accent" onClick={() => send()} disabled={busy}><Send size={15} /></button>
      </div>
    </div>
  );
}
function Consultor() {
  return (
    <div className="fadein">
      <Eyebrow>Consultor IA · LFT y gestión de personal</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 6px" }}>Consultoría avanzada</h1>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16, maxWidth: 640 }}>Asistente conectado a IA. Orientación sobre LFT, contratos, finiquitos y procesos de RH. No constituye asesoría legal formal.</p>
      <ChatPanel placeholder="Pregunta sobre LFT, contratos, finiquitos, jornada 40h…"
        intro={`Soy el consultor de CÓDICE para ${ORG.name}. Puedo orientarte sobre la LFT, tipos de contrato, cálculo de prestaciones y la transición de la jornada de 40 horas (reforma 2026). ¿Qué necesitas resolver?`}
        quick={["¿Cómo calculo un finiquito?", "Finiquito vs liquidación", "¿Cómo aplica la jornada de 40 horas en 2026?", "Inocuidad y obligaciones del trabajador"]}
        systemPrompt={`Eres un consultor experto en Recursos Humanos y en la Ley Federal del Trabajo (LFT) de México, integrado en el software CÓDICE para ${ORG.name}, una empresa de empaque y procesamiento de alimentos en CDMX. Responde en español, claro y práctico. Cuando cites la LFT menciona el artículo aproximado. Para jornada usa la reforma 2026: reducción gradual de 48h (2026) a 40h (2030), ~2h/año, sin reducir salario, con registro electrónico obligatorio. Aclara que el "aguinaldo digno" (30 días) sigue siendo propuesta. Sé conciso y cierra recordando que es orientación general, no asesoría jurídica formal.`} />
    </div>
  );
}
function Autoservicio({ staff }) {
  const me = staff.find((e) => e.status === "Activo") || staff[0]; const dv = diasVacaciones(me.antiguedad);
  return (
    <div className="fadein">
      <Eyebrow>Autoservicio del colaborador · shell conversacional</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Portal del empleado</h1>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,300px) 1fr", gap: 16 }}>
        <div>
          <div className="glass" style={{ padding: 18, marginBottom: 14 }}>
            <div className="row" style={{ gap: 12 }}><div style={{ width: 46, height: 46, borderRadius: 13, background: "linear-gradient(135deg,var(--violet),var(--cyan))", display: "grid", placeItems: "center", fontWeight: 700, color: "#04060a" }}>{me.nombre.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div><div><div style={{ fontWeight: 600 }}>{me.nombre}</div><div className="muted" style={{ fontSize: 12 }}>{me.puesto}</div></div></div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 9 }}><KV k="Estatus" v={<StatusChip s={me.status} />} /><KV k="Vacaciones disponibles" v={`${dv} días`} /><KV k="Turno" v={me.turno} /><KV k="Planta" v={me.planta} /></div>
          </div>
          <div className="glass-2" style={{ padding: 14 }}><Eyebrow>Editable por el colaborador</Eyebrow><p className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>Teléfono, contacto de emergencia, datos bancarios y domicilio. Cambios de puesto, salario o turno se envían a RH para aprobación.</p></div>
        </div>
        <ChatPanel placeholder="Solicita vacaciones, una constancia, o actualiza tus datos…"
          intro={`Hola ${me.nombre.split(" ")[0]}. Soy tu asistente de RH en ${ORG.name}. Puedo ayudarte a solicitar vacaciones, pedir constancias, revisar prestaciones o canalizar una solicitud a Recursos Humanos. ¿Qué necesitas?`}
          quick={["Solicitar vacaciones", "Pedir constancia laboral", "¿Cuántos días de vacaciones tengo?", "Cambio de turno"]}
          systemPrompt={`Eres el asistente de autoservicio de RH en CÓDICE para ${ORG.name} (empaque de alimentos, CDMX), atendiendo al colaborador ${me.nombre} (${me.puesto}, turno ${me.turno}, ${me.antiguedad} años, ${dv} días de vacaciones, estatus ${me.status}). Responde en español, cálido y breve. Puedes explicar prestaciones y guiar para solicitar vacaciones/permisos/constancias/cambios de turno, registrando la solicitud hacia RH. Para cambios sensibles (puesto, salario, turno) explica que generas una solicitud que RH debe aprobar. Si preguntan de LFT, da orientación general (reforma 2026, jornada 40h gradual) y recuerda que no es asesoría legal formal.`} />
      </div>
    </div>
  );
}

/* ============================================================
   SOLICITUDES — flujo Jefe directo → Workforce
   ============================================================ */
function Solicitudes({ solicitudes, resueltas, resolver }) {
  const [tab, setTab] = useState("activas");
  const jefe = solicitudes.filter((s) => s.estado === "jefe").length;
  const wkf = solicitudes.filter((s) => s.estado === "wkf").length;
  return (
    <div className="fadein">
      <Eyebrow>Solicitudes · autorización jefe directo → Workforce</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Bandeja de trámites</h1>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Pendiente jefe directo" value={jefe} accent="var(--amber)" />
        <Stat label="Pendiente Workforce" value={wkf} accent="var(--cyan)" />
        <Stat label="Resueltas" value={resueltas.length} accent="var(--emerald)" />
      </div>
      <div className="row" style={{ gap: 7, marginBottom: 14 }}>
        <button className={`btn btn-sm ${tab === "activas" ? "btn-accent" : ""}`} onClick={() => setTab("activas")}>Activas ({solicitudes.length})</button>
        <button className={`btn btn-sm ${tab === "historial" ? "btn-accent" : ""}`} onClick={() => setTab("historial")}>Historial ({resueltas.length})</button>
      </div>
      <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
        <table className="tbl">
          <thead><tr><th>Folio</th><th>Colaborador</th><th>Trámite</th><th>Jefe directo</th><th>Etapa</th><th style={{ textAlign: "right" }}>Acción</th></tr></thead>
          <tbody>
            {tab === "activas" && solicitudes.map((s) => (
              <tr key={s.id} style={{ cursor: "default" }}>
                <td className="mono muted2">{s.id}</td>
                <td style={{ fontWeight: 500 }}>{s.who}<div className="muted2" style={{ fontSize: 10.5 }}>{s.depto}</div></td>
                <td>{s.tipo}<div className="muted2" style={{ fontSize: 10.5 }}>{s.detalle}</div></td>
                <td className="muted">{s.jefe}</td>
                <td><span className="chip" style={{ color: ESTADO_FLUJO[s.estado].color }}><span className="dot" style={{ background: ESTADO_FLUJO[s.estado].color }} />{ESTADO_FLUJO[s.estado].label}</span></td>
                <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                  <button className="btn btn-sm btn-ok" onClick={() => resolver(s.id, true)}>{s.estado === "jefe" ? "Autorizar" : "Aprobar"}</button>
                  <button className="btn btn-sm btn-no" onClick={() => resolver(s.id, false)}><X size={13} /></button>
                </div></td>
              </tr>
            ))}
            {tab === "historial" && resueltas.map((s, i) => (
              <tr key={i} style={{ cursor: "default" }}>
                <td className="mono muted2">{s.id}</td>
                <td style={{ fontWeight: 500 }}>{s.who}</td>
                <td>{s.tipo}</td>
                <td className="muted">{s.jefe}</td>
                <td><span className="chip" style={{ color: s.estado === "aprobada" ? "var(--emerald)" : "var(--rose)" }}><span className="dot" style={{ background: s.estado === "aprobada" ? "var(--emerald)" : "var(--rose)" }} />{s.estado === "aprobada" ? "Aprobada" : "Rechazada"}</span></td>
                <td></td>
              </tr>
            ))}
            {tab === "activas" && solicitudes.length === 0 && <tr style={{ cursor: "default" }}><td colSpan={6} className="muted" style={{ padding: 20 }}>Bandeja al día.</td></tr>}
            {tab === "historial" && resueltas.length === 0 && <tr style={{ cursor: "default" }}><td colSpan={6} className="muted" style={{ padding: 20 }}>Sin trámites resueltos aún.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="muted2" style={{ fontSize: 11, marginTop: 10 }}>Flujo: el jefe directo autoriza → pasa a Workforce para aprobación final. El colaborador ve el avance en su portal de autoservicio.</div>
    </div>
  );
}

/* ============================================================
   INDICADORES WKF — ausentismo, rotación, incapacidades
   ============================================================ */
function IndicadoresWKF({ staff }) {
  const incap = staff.filter((e) => e.status === "Incapacidad");
  const permiso = staff.filter((e) => e.status === "Permiso").length;
  const ausByArea = useMemo(() => ORG.deptos.map((d) => {
    const n = staff.filter((e) => e.depto === d).length || 1;
    const aus = staff.filter((e) => e.depto === d && (e.status === "Incapacidad" || e.status === "Permiso")).length;
    return { name: d, value: +((aus / n) * 100).toFixed(1) };
  }).sort((a, b) => b.value - a.value), [staff]);
  const cur = AUSENTISMO[AUSENTISMO.length - 1];
  return (
    <div className="fadein">
      <Eyebrow>Indicadores Workforce · sustituye los Excel</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Ausentismo, rotación e incapacidades</h1>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Ausentismo (jun)" value={`${cur.v}%`} sub="↓ vs mes previo" accent="var(--amber)" />
        <Stat label="Rotación (jun)" value={`${cur.rot}%`} sub="mensual" accent="var(--violet)" />
        <Stat label="Incapacidades activas" value={incap.length} sub={`${permiso} permisos vigentes`} accent="var(--cyan)" />
        <Stat label="Plantilla" value={staff.length} sub="tiempo real" accent="var(--emerald)" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="glass" style={{ padding: 18 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>Tendencia · ausentismo vs rotación</span>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={AUSENTISMO} margin={{ top: 14 }}>
              <defs><linearGradient id="au" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--amber)" stopOpacity={.45} /><stop offset="100%" stopColor="var(--amber)" stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="m" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={26} unit="%" />
              <Tooltip contentStyle={tipStyle} formatter={(v) => `${v}%`} />
              <Area dataKey="v" name="Ausentismo" stroke="var(--amber)" fill="url(#au)" strokeWidth={2} />
              <Area dataKey="rot" name="Rotación" stroke="var(--violet)" fill="transparent" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="glass" style={{ padding: 18 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>Ausentismo por área (hoy)</span>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={ausByArea} layout="vertical" margin={{ left: 10, right: 20, top: 8 }}>
              <XAxis type="number" hide unit="%" /><YAxis type="category" dataKey="name" width={120} tick={{ fill: "var(--muted)", fontSize: 10.5 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tipStyle} formatter={(v) => `${v}%`} cursor={{ fill: "rgba(255,255,255,.04)" }} />
              <Bar dataKey="value" fill="var(--amber)" radius={[0, 6, 6, 0]} barSize={13} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Incapacidades activas</div>
        <table className="tbl"><thead><tr><th>ID</th><th>Colaborador</th><th>Área</th><th>Planta</th><th>Turno</th></tr></thead>
          <tbody>{incap.length === 0 ? <tr style={{ cursor: "default" }}><td colSpan={5} className="muted" style={{ padding: 18 }}>Sin incapacidades activas.</td></tr> : incap.map((e) => (
            <tr key={e.id} style={{ cursor: "default" }}><td className="mono muted2">{e.id}</td><td style={{ fontWeight: 500 }}>{e.nombre}</td><td className="muted">{e.depto}</td><td className="muted">{e.planta}</td><td><span className="chip" style={{ color: TURNO_COLOR[e.turno] }}>{e.turno}</span></td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   CAPACITACIÓN (LMS) — cursos, evaluación, constancias
   ============================================================ */
function constanciaDoc(curso, nombre, calif) {
  const folio = `GFP-CAP-${Math.floor(Math.random() * 9000 + 1000)}`;
  return `<html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;color:#16202e;max-width:720px;margin:0 auto;padding:56px;text-align:center}h1{font-size:15px;letter-spacing:.28em;text-transform:uppercase;color:#666}h2{font-size:26px;margin:18px 0}.n{font-size:22px;font-weight:bold;border-bottom:2px solid #16202e;display:inline-block;padding:0 30px 6px;margin:14px 0}.meta{font-size:12px;color:#555;margin-top:30px}.b{margin-top:46px;display:flex;justify-content:space-around;font-size:11px}.b div{border-top:1px solid #16202e;padding-top:6px;width:200px}</style></head><body>
  <h1>${ORG.name}</h1><h2>Constancia de capacitación</h2>
  <p>Se otorga la presente a</p><div class="n">${nombre}</div>
  <p>por haber concluido satisfactoriamente el curso<br><b>"${curso.titulo}"</b> (${curso.cat}, ${curso.dur})</p>
  <p style="margin-top:14px">Calificación obtenida: <b>${calif}/100</b></p>
  <p class="meta">Folio ${folio} · ${ORG.city} · ${todayISO} · Conforme al programa interno de capacitación y adiestramiento (arts. 153-A a 153-X LFT).</p>
  <div class="b"><div>Recursos Humanos / Workforce</div><div>Colaborador</div></div>
  <p style="margin-top:30px;font-size:10px;color:#999">Emitida por CÓDICE · registro digital de capacitación</p></body></html>`;
}
function Capacitacion({ staff }) {
  const [cursos, setCursos] = useState(CURSOS_SEED);
  const [quiz, setQuiz] = useState(null);
  const nombreDemo = (staff.find((e) => e.status === "Activo") || staff[0]).nombre;
  const oblig = cursos.filter((c) => c.oblig);
  const cumpl = Math.round((oblig.filter((c) => c.progreso === 100).length / oblig.length) * 100);
  const pend = cursos.filter((c) => c.progreso < 100).length;
  const horas = cursos.filter((c) => c.progreso === 100).reduce((a, c) => a + (c.dur.includes("h") ? parseFloat(c.dur) : 0), 0);
  const aprobar = (id, calif) => { setCursos((L) => L.map((c) => c.id === id ? { ...c, progreso: 100, calif, fechaCompl: todayISO } : c)); toast(`Curso aprobado · ${calif}/100`); };
  const constancia = (c) => { download(`constancia_${c.id}.html`, constanciaDoc(c, nombreDemo, c.calif || 100), "text/html"); toast("Constancia generada"); };
  return (
    <div className="fadein">
      <Eyebrow>Capacitación y adiestramiento · sin papel</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Plataforma de aprendizaje</h1>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Cumplimiento obligatorios" value={`${cumpl}%`} accent="var(--emerald)" />
        <Stat label="Cursos en progreso" value={pend} accent="var(--amber)" />
        <Stat label="Horas completadas" value={`${horas}h`} accent="var(--cyan)" />
        <Stat label="Catálogo" value={cursos.length} sub="cursos activos" accent="var(--violet)" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
        {cursos.map((c) => (
          <div key={c.id} className="glass" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="chip" style={{ color: CAT_COLOR[c.cat] }}><span className="dot" style={{ background: CAT_COLOR[c.cat] }} />{c.cat}</span>
              {c.oblig && <span className="chip" style={{ color: "var(--rose)" }}>Obligatorio</span>}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, minHeight: 38 }}>{c.titulo}</div>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="muted2" style={{ fontSize: 11 }}>{c.dur}{c.vence ? ` · vence ${c.vence}` : ""}</span><span className="mono" style={{ fontSize: 11, color: c.progreso === 100 ? "var(--emerald)" : "var(--muted)" }}>{c.progreso}%</span></div>
            <div className="prog"><i style={{ width: `${c.progreso}%` }} /></div>
            {c.progreso === 100 ? (
              <button className="btn btn-sm btn-ok" style={{ justifyContent: "center" }} onClick={() => constancia(c)}><Download size={13} />Constancia {c.calif ? `· ${c.calif}` : ""}</button>
            ) : (
              <button className="btn btn-sm btn-accent" style={{ justifyContent: "center" }} onClick={() => setQuiz(c)}><ClipboardCheck size={13} />{c.progreso === 0 ? "Iniciar y evaluar" : "Continuar y evaluar"}</button>
            )}
          </div>
        ))}
      </div>
      <div className="muted2" style={{ fontSize: 11, marginTop: 14 }}>Historial y constancias quedan asociados al expediente de cada colaborador. Las constancias se generan automáticamente al aprobar.</div>
      {quiz && <QuizModal curso={quiz} onClose={() => setQuiz(null)} onPass={(calif) => { aprobar(quiz.id, calif); setQuiz(null); }} />}
    </div>
  );
}
function QuizModal({ curso, onClose, onPass }) {
  const [ans, setAns] = useState({}); const [res, setRes] = useState(null);
  const evaluar = () => { const ok = QUIZ.filter((q, i) => ans[i] === q.ok).length; const calif = Math.round((ok / QUIZ.length) * 100); setRes({ ok, calif, pass: ok >= 2 }); };
  return (
    <div className="modal" onClick={onClose}>
      <div className="glass" style={{ width: "min(520px,94vw)", padding: 22, maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}><div className="row" style={{ gap: 9 }}><ClipboardCheck size={16} className="muted" /><span style={{ fontWeight: 600 }}>Evaluación</span></div><X size={18} className="handle" style={{ cursor: "pointer" }} onClick={onClose} /></div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>{curso.titulo}</div>
        {!res ? (
          <>
            {QUIZ.map((q, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 9 }}>{i + 1}. {q.q}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{q.opts.map((o, j) => <div key={j} className={`qopt ${ans[i] === j ? "on" : ""}`} onClick={() => setAns((a) => ({ ...a, [i]: j }))}>{o}</div>)}</div>
              </div>
            ))}
            <button className="btn btn-accent" style={{ width: "100%", justifyContent: "center" }} disabled={Object.keys(ans).length < QUIZ.length} onClick={evaluar}>Enviar evaluación</button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ width: 60, height: 60, borderRadius: "50%", margin: "0 auto 14px", display: "grid", placeItems: "center", background: res.pass ? "rgba(79,214,163,.16)" : "rgba(251,113,133,.16)" }}>{res.pass ? <Check size={30} style={{ color: "var(--emerald)" }} /> : <X size={30} style={{ color: "var(--rose)" }} />}</div>
            <div className="kpi" style={{ fontSize: 30, color: res.pass ? "var(--emerald)" : "var(--rose)" }}>{res.calif}/100</div>
            <div className="muted" style={{ fontSize: 13, margin: "8px 0 18px" }}>{res.ok} de {QUIZ.length} correctas · {res.pass ? "Aprobado" : "No aprobado (mín. 2)"}</div>
            {res.pass ? <button className="btn btn-ok" style={{ width: "100%", justifyContent: "center" }} onClick={() => onPass(res.calif)}>Registrar y generar constancia</button>
              : <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => { setRes(null); setAns({}); }}>Reintentar</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SEÑALIZACIÓN — pantallas digitales (kiosco)
   ============================================================ */
function Senalizacion() {
  const [i, setI] = useState(0); const [playing, setPlaying] = useState(true); const ref = useRef(null);
  useEffect(() => { if (!playing) return; const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 5000); return () => clearInterval(t); }, [playing]);
  const s = SLIDES[i];
  const full = () => { const el = ref.current; if (el?.requestFullscreen) el.requestFullscreen(); else toast("Pantalla completa no disponible aquí"); };
  return (
    <div className="fadein">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div><Eyebrow>Señalización digital · adiós corcho</Eyebrow><h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 0" }}>Pantallas de piso</h1></div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? "Pausar" : "Reanudar"}</button>
          <button className="btn btn-accent" onClick={full}><Maximize size={14} />Modo pantalla</button>
        </div>
      </div>
      <div ref={ref} className="signage">
        <div style={{ position: "absolute", top: 24, left: 32, right: 32 }} className="row">
          <div className="row" style={{ gap: 9, flex: 1 }}><div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,var(--cyan),var(--violet))", display: "grid", placeItems: "center" }}><Factory size={15} color="#04060a" /></div><span style={{ fontWeight: 700, letterSpacing: ".04em" }}>{ORG.name}</span></div>
          <span className="mono muted" style={{ fontSize: 12 }}>{ORG.city} · {todayISO}</span>
        </div>
        {s.type === "kpi" && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 18, fontSize: 13 }}>{s.titulo}</div>
            <div className="row" style={{ gap: 40, flexWrap: "wrap" }}>{s.items.map((it) => <div key={it.k}><div className="kpi" style={{ fontSize: 66, color: it.c }}>{it.v}</div><div className="muted" style={{ fontSize: 15, marginTop: 6 }}>{it.k}</div></div>)}</div>
          </div>
        )}
        {s.type === "comunicado" && (<div style={{ maxWidth: 640 }}><div className="row" style={{ gap: 11, marginBottom: 16 }}><Megaphone size={26} style={{ color: "var(--amber)" }} /><span className="eyebrow" style={{ fontSize: 13 }}>{s.titulo}</span></div><div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.4 }}>{s.cuerpo}</div></div>)}
        {s.type === "reconocimiento" && (<div><div className="row" style={{ gap: 11, marginBottom: 16 }}><Award size={26} style={{ color: "var(--emerald)" }} /><span className="eyebrow" style={{ fontSize: 13 }}>Reconocimiento</span></div><div className="kpi" style={{ fontSize: 52, color: "var(--emerald)" }}>{s.nombre}</div><div className="muted" style={{ fontSize: 17, margin: "8px 0 18px" }}>{s.area}</div><div style={{ fontSize: 20, fontWeight: 500, maxWidth: 620 }}>{s.motivo}</div></div>)}
        {s.type === "capacitacion" && (<div><div className="row" style={{ gap: 11, marginBottom: 18 }}><GraduationCap size={26} style={{ color: "var(--cyan)" }} /><span className="eyebrow" style={{ fontSize: 13 }}>Próximas capacitaciones</span></div><div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{s.cursos.map((c, k) => <div key={k} className="row" style={{ gap: 12, fontSize: 22, fontWeight: 500 }}><span className="mono" style={{ color: "var(--cyan)" }}>{String(k + 1).padStart(2, "0")}</span>{c}</div>)}</div></div>)}
        <div style={{ position: "absolute", bottom: 22, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
          <ChevronLeft size={18} className="handle" style={{ cursor: "pointer" }} onClick={() => setI((x) => (x - 1 + SLIDES.length) % SLIDES.length)} />
          <div className="row" style={{ gap: 7 }}>{SLIDES.map((_, k) => <span key={k} className={`sgdot ${k === i ? "on" : ""}`} onClick={() => setI(k)} />)}</div>
          <ChevronRight size={18} className="handle" style={{ cursor: "pointer" }} onClick={() => setI((x) => (x + 1) % SLIDES.length)} />
        </div>
      </div>
      <div className="muted2" style={{ fontSize: 11, marginTop: 12 }}>Rota automáticamente cada 5s. En kiosco: abre "Modo pantalla" en la TV de piso. Las fuentes (seguridad, calidad, producción, reconocimientos) se alimentan desde los módulos de CÓDICE.</div>
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
const NAV = [
  ["_s", "Operación"],
  ["cockpit", "Cockpit", LayoutDashboard], ["plantilla", "Plantilla", Users],
  ["solicitudes", "Solicitudes", Inbox], ["indicadores", "Indicadores WKF", Activity],
  ["_s", "Cumplimiento"],
  ["contratos", "Contratos", FileSignature], ["lft", "Módulo LFT", Scale], ["filtro", "Filtro → Tablero", Filter],
  ["_s", "Personas"],
  ["capacitacion", "Capacitación", GraduationCap], ["senalizacion", "Señalización", Monitor],
  ["autoservicio", "Autoservicio", MessageSquareText], ["consultor", "Consultor IA", Bot],
];

export default function App() {
  const [view, setView] = useState("cockpit");
  const [staff, setStaff] = useState(() => buildStaff());
  const [solicitudes, setSolicitudes] = useState(SOLICITUDES_SEED);
  const [resueltas, setResueltas] = useState([]);
  const [toasts, setToasts] = useState([]);
  useEffect(() => { _toast = (msg, kind = "ok") => { const id = Math.random(); setToasts((t) => [...t, { id, msg, kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600); }; }, []);

  const resolver = (id, ok) => {
    setSolicitudes((L) => {
      const s = L.find((x) => x.id === id); if (!s) return L;
      if (!ok) { setResueltas((R) => [{ ...s, estado: "rechazada" }, ...R]); toast(`Rechazada · ${s.tipo} de ${s.who.split(" ")[0]}`, "no"); return L.filter((x) => x.id !== id); }
      if (s.estado === "jefe") { toast(`Autorizada por jefe → Workforce · ${s.tipo}`); return L.map((x) => (x.id === id ? { ...x, estado: "wkf" } : x)); }
      setResueltas((R) => [{ ...s, estado: "aprobada" }, ...R]); toast(`Aprobada por Workforce · ${s.tipo}`); return L.filter((x) => x.id !== id);
    });
  };

  return (
    <div className="codice">
      <style>{CSS}</style>
      <div className="bgfield"><div className="blob b1" /><div className="blob b2" /><div className="blob b3" /><div className="gridov" /></div>
      <div style={{ position: "relative", zIndex: 1, display: "flex", minHeight: "100vh" }}>
        <aside className="glass" style={{ width: 232, margin: 14, padding: 16, borderRadius: 20, display: "flex", flexDirection: "column", position: "sticky", top: 14, height: "calc(100vh - 28px)" }}>
          <div className="row" style={{ gap: 10, marginBottom: 22, padding: "2px 4px" }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,var(--cyan),var(--violet))", display: "grid", placeItems: "center" }}><Sparkles size={18} color="#04060a" /></div>
            <div><div style={{ fontWeight: 700, fontSize: 16, letterSpacing: ".02em" }}>CÓDICE</div><div className="muted2" style={{ fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase" }}>Control · LFT</div></div>
          </div>
          <div className="glass-2" style={{ padding: 12, marginBottom: 18 }}>
            <div className="row" style={{ gap: 9 }}><div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(255,255,255,.06)", display: "grid", placeItems: "center" }}><Factory size={15} className="muted" /></div><div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ORG.name}</div><div className="muted2" style={{ fontSize: 10 }}>{ORG.city} · {staff.length} pers.</div></div></div>
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto", marginRight: -6, paddingRight: 6 }}>
            {NAV.map((it, idx) => it[0] === "_s"
              ? <div key={idx} className="sec">{it[1]}</div>
              : <div key={it[0]} className={`navitem ${view === it[0] ? "on" : ""}`} onClick={() => setView(it[0])}>{React.createElement(it[2], { size: 17 })} {it[1]}</div>)}
          </nav>
          <button className="btn" style={{ justifyContent: "center" }} onClick={() => toast("Datos sincronizados")}><RefreshCw size={14} />Sincronizar</button>
        </aside>
        <main style={{ flex: 1, padding: "20px 26px 40px", minWidth: 0, overflowX: "hidden" }}>
          {view === "cockpit" && <Cockpit staff={staff} solicitudes={solicitudes} resolver={resolver} go={setView} />}
          {view === "plantilla" && <Plantilla staff={staff} setStaff={setStaff} />}
          {view === "solicitudes" && <Solicitudes solicitudes={solicitudes} resueltas={resueltas} resolver={resolver} />}
          {view === "indicadores" && <IndicadoresWKF staff={staff} />}
          {view === "contratos" && <Contratos staff={staff} />}
          {view === "lft" && <LFT />}
          {view === "filtro" && <FiltroDash staff={staff} />}
          {view === "capacitacion" && <Capacitacion staff={staff} />}
          {view === "senalizacion" && <Senalizacion />}
          {view === "autoservicio" && <Autoservicio staff={staff} />}
          {view === "consultor" && <Consultor />}
        </main>
      </div>
      <div className="toastwrap">{toasts.map((t) => <div key={t.id} className="toast">{t.kind === "no" ? <X size={15} style={{ color: "var(--rose)" }} /> : <CircleCheck size={15} style={{ color: "var(--emerald)" }} />}{t.msg}</div>)}</div>
    </div>
  );
}
