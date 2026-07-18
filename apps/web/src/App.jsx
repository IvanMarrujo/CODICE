import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, RadialBarChart, RadialBar, AreaChart, Area,
} from "recharts";
import {
  LayoutDashboard, Users, FileSignature, Scale, Filter, MessageSquareText,
  Bot, Search, Download, Plus, X, GripVertical, RotateCcw,
  ChevronRight, AlertTriangle, CircleCheck, Clock, Send, Sparkles,
  CalendarDays, FileText, RefreshCw, Check, Inbox, Factory,
  GraduationCap, Monitor, Activity, Award, Maximize, ChevronLeft, Megaphone,
  ClipboardCheck, UserCheck, Zap, Plug, QrCode, DollarSign, Upload,
  Pause, Play, Trash2, Unplug, Pencil, CheckSquare, Square, Lock, FileHeart, MessageSquare, Copy,
  Radar as RadarIcon, ChevronDown, ExternalLink, Tag,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import {
  login, fetchEmployees, mapEmployee, fetchAttendance,
  fetchSyncLogLatest, fetchPayroll, fetchPayrollSummary, fetchPayrollLatestByEmployee, fetchPayrollExplain,
  uploadConnectorFile, fetchSyncLogHistory, previewExcel, previewCfdi,
  fetchConnectedSources, reloadConnectedSource, replaceConnectedSourceFile, setConnectedSourceAutoSync,
  pauseConnectedSource, resumeConnectedSource, deleteConnectedSource, deleteConnectedSourceWithData,
  fetchAgentStatus, downloadAgentZip,
  createEmployee, updateEmployee, deleteEmployee, bulkDeleteEmployees,
  deletePayrollRecord, bulkDeletePayrollRecords,
  fetchEmployeeStatusSummary, fetchEmployeeHealth, updateEmployeeHealth,
  uploadHealthDocument, deleteHealthDocument, downloadHealthDocument, fetchHealthDocumentInsights,
  fetchAdminProfile, updateAdminProfile,
  fetchWhatsAppSettings, updateWhatsAppSettings, fetchWhatsAppMockLog, simulateWhatsAppAgent,
  fetchVacationPolicy, updateVacationPolicy, fetchStorageStatus, downloadNdaPreview,
  fetchRiskSummary, fetchRiskNarrative,
  fetchContractsExpiringSoon, consultAIStream,
  fetchDeptRiskProfiles, updateDeptRiskProfile, logDeptAccidente,
  fetchRadarLatest, refreshRadar,
  fetchEmployeeGamification, fetchGamificationLeaderboard,
  fetchZktecoDevices, registerZktecoDevice, deleteZktecoDevice,
} from "./api.js";

// Credenciales de auto-login del cockpit admin (tenant único GFP). Vienen de
// env vars (VITE_ADMIN_EMAIL/VITE_ADMIN_PASSWORD) en vez de hardcodeadas en
// el código fuente — igual terminan en el bundle público (es un auto-login
// client-side), pero así no quedan pegadas en el historial de git.
const AUTH = {
  slug: "gfp",
  email: import.meta.env.VITE_ADMIN_EMAIL || "admin@gfp.mx",
  password: import.meta.env.VITE_ADMIN_PASSWORD || "",
};

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
:root{
  --bg:#020917;--glass:rgba(255,255,255,0.045);--glass-2:rgba(255,255,255,0.07);
  --glass-hi:rgba(255,255,255,0.10);--border:rgba(255,255,255,0.07);--border-hi:rgba(255,255,255,0.16);
  --text:#e8f0fe;--muted:#8ea0bd;--muted-2:#5d6878;
  --cyan:#4db8ff;--violet:#a78bfa;--emerald:#00c896;--amber:#f5c518;--rose:#fb7185;
  --font:'DM Sans',ui-sans-serif,system-ui,sans-serif;--mono:'DM Mono',ui-monospace,monospace;
  /* Alias explícitos de la identidad CÓDICE — mismos valores que los vars de arriba */
  --codice-ink:#020917;--codice-surface:#06142d;--codice-border:rgba(255,255,255,0.07);
  --codice-signal:#00c896;--codice-alert:#f5c518;--codice-data:#4db8ff;
  --codice-text:#e8f0fe;--codice-muted:rgba(232,240,254,0.45);
}
*{box-sizing:border-box}
body{font-family:var(--font)}
.mono,code,.amount{font-family:var(--mono)}
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
.spin{animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
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
@keyframes pulsedot{0%,100%{opacity:1}50%{opacity:.35}}
.dot.live{animation:pulsedot 1.6s ease-in-out infinite}
.warnbox{background:var(--glass-2);border:1px solid rgba(245,181,68,.25);border-left:3px solid var(--amber);border-radius:12px;padding:12px 14px}
.tabbtn{font-size:11.5px;font-weight:500;padding:6px 11px;border-radius:9px;cursor:pointer;color:var(--muted);border:1px solid transparent;display:inline-flex;align-items:center;gap:6px}
.tabbtn.on{background:var(--glass-2);color:var(--text);border-color:var(--border)}
.drawer-xl{width:min(760px,96vw)}
.stepdot{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;font-weight:700;background:var(--glass-2);border:1px solid var(--border);color:var(--muted);flex-shrink:0}
.stepdot.on{background:linear-gradient(135deg,var(--cyan),var(--violet));color:#04060a;border-color:transparent}
.stepdot.done{background:rgba(79,214,163,.16);border-color:rgba(79,214,163,.4);color:var(--emerald)}
.stepline{flex:1;height:2px;background:var(--border);min-width:10px}
.stepline.done{background:var(--emerald)}

.pagination{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:12px;padding:10px 2px}
.pagination-summary{font-size:11.5px}
.pagination-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pg-nav{padding:6px 8px}
.pg-nav:disabled{opacity:.4;cursor:default;pointer-events:none}
.pagination-pills{display:flex;align-items:center;gap:4px}
.pg-pill{min-width:26px;height:26px;padding:0 6px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;
  font-size:11.5px;font-weight:600;cursor:pointer;background:var(--glass-2);color:var(--muted);border:1px solid transparent;transition:.15s}
.pg-pill:hover{border-color:var(--border-hi)}
.pg-pill.on{background:linear-gradient(180deg,rgba(86,212,240,.28),rgba(86,212,240,.14));color:#cdf3fc;border-color:rgba(86,212,240,.42)}
.pg-ellipsis{color:var(--muted-2);font-size:11.5px;padding:0 2px}
.pg-jump-input{width:64px;padding:5px 8px;font-size:11.5px}
.pg-mobile-label{display:none;font-size:11.5px;color:var(--muted);white-space:nowrap}
@media (max-width: 560px){
  .pagination-pills, .pg-jump{display:none}
  .pg-mobile-label{display:inline}
}

.ai-bubble{position:fixed;bottom:24px;right:24px;z-index:9999;width:52px;height:52px;border-radius:50%;
  background:linear-gradient(135deg,#00c896,#00a67d);display:grid;place-items:center;cursor:pointer;
  box-shadow:0 8px 32px rgba(0,200,150,.25)}
.ai-bubble-dot{position:absolute;top:2px;right:2px;width:11px;height:11px;border-radius:50%;background:var(--rose);
  border:2px solid #04060a}
.ai-panel{position:fixed;bottom:24px;right:24px;z-index:9999;width:360px;height:480px;max-height:calc(100vh - 48px);
  display:flex;flex-direction:column;overflow:hidden;
  background:rgba(6,20,45,.95);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border:1px solid rgba(0,200,150,.3);border-radius:18px;box-shadow:0 8px 32px rgba(0,200,150,.25)}
.typing-inline{display:inline-flex;gap:2px}
.typing-inline span{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--muted);animation:blink 1.2s infinite}
.typing-inline span:nth-child(2){animation-delay:.2s}.typing-inline span:nth-child(3){animation-delay:.4s}
@media (max-width: 480px){.ai-panel{width:calc(100vw - 24px);right:12px;bottom:12px}.ai-bubble{right:16px;bottom:16px}}
`;

/* ---------- helpers ---------- */
const mxn = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Math.round(n));
const mxn2 = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(n);
const todayISO = new Date().toISOString().slice(0, 10);

const STATUS = { Activo: "var(--emerald)", Vacaciones: "var(--cyan)", Incapacidad: "var(--amber)", Permiso: "var(--violet)", "Periodo de prueba": "#9aa6b8", "Baja pendiente": "var(--rose)" };
// Paleta fija para el donut de "Status de plantilla" — colores explícitos
// (no CSS vars) para que coincidan exactamente con el diseño acordado.
const STATUS_DONUT_COLOR = {
  Activo: "#10b981", Vacaciones: "#3b82f6", Incapacidad: "#f59e0b", Permiso: "#a78bfa",
  "Baja pendiente": "#fb7185", "Periodo de prueba": "#56d4f0", Baja: "#4a5568",
};
const STATUS_DONUT_ORDER = ["Activo", "Vacaciones", "Incapacidad", "Permiso", "Baja pendiente", "Periodo de prueba", "Baja"];
const TIPOS_SANGRE = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const CONTRATOS = ["Indeterminado", "Determinado", "Obra/Proyecto", "Periodo de prueba", "Capacitación inicial"];
const TURNOS = ["Matutino", "Vespertino", "Nocturno", "Mixto"];
const TURNO_COLOR = { Matutino: "var(--amber)", Vespertino: "var(--violet)", Nocturno: "var(--cyan)", Mixto: "var(--emerald)" };
const PUESTOS = ["Operador(a) de línea", "Empacador(a)", "Supervisor(a) de turno", "Analista de calidad", "Almacenista", "Técnico de mantenimiento", "Coordinador(a)", "Jefe(a) de área", "Auxiliar administrativo", "Gerente"];

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
const PAGE_SIZE = 25; // tamaño de página estándar para toda lista paginada (Plantilla, Solicitudes, Nómina, Asistencia)

// Componente de paginación reusable — Prev/Next + hasta 5 pills de página
// (con elipsis para el resto) + salto directo a página. En mobile (≤560px,
// ver CSS ".pagination") solo se ven Prev/Next + "página X de Y".
function Pagination({ page, totalPages, total, limit, onPageChange, itemLabel = "resultados" }) {
  const [jump, setJump] = useState("");
  if (total === 0) return null;

  const start = (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);

  const pills = (() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    let lo = Math.max(1, page - 2);
    const hi = Math.min(totalPages, lo + 4);
    lo = Math.max(1, hi - 4);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  })();

  const go = (p) => { const clamped = Math.max(1, Math.min(totalPages, p)); if (clamped !== page) onPageChange(clamped); };

  const submitJump = (e) => {
    e.preventDefault();
    const n = Number(jump);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) go(n);
    setJump("");
  };

  return (
    <div className="pagination">
      <div className="pagination-summary muted2">Mostrando {start}-{end} de {total} {itemLabel}</div>
      <div className="pagination-controls">
        <button className="btn btn-sm pg-nav" onClick={() => go(page - 1)} disabled={page <= 1}><ChevronLeft size={14} /></button>
        <span className="pg-mobile-label">Página {page} de {totalPages}</span>
        <div className="pagination-pills">
          {pills[0] > 1 && (
            <>
              <span className="pg-pill" onClick={() => go(1)}>1</span>
              {pills[0] > 2 && <span className="pg-ellipsis">…</span>}
            </>
          )}
          {pills.map((p) => <span key={p} className={`pg-pill ${p === page ? "on" : ""}`} onClick={() => go(p)}>{p}</span>)}
          {pills[pills.length - 1] < totalPages && (
            <>
              {pills[pills.length - 1] < totalPages - 1 && <span className="pg-ellipsis">…</span>}
              <span className="pg-pill" onClick={() => go(totalPages)}>{totalPages}</span>
            </>
          )}
        </div>
        <button className="btn btn-sm pg-nav" onClick={() => go(page + 1)} disabled={page >= totalPages}><ChevronRight size={14} /></button>
        {totalPages > 5 && (
          <form className="pg-jump" onSubmit={submitJump}>
            <input className="input pg-jump-input" placeholder="Ir a…" value={jump} onChange={(e) => setJump(e.target.value)} />
          </form>
        )}
      </div>
    </div>
  );
}

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
function downloadBlobFile(name, blob) {
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
   NÓMINA · helpers compartidos (Conectores / Cockpit / Expediente)
   ============================================================ */
function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "hace instantes";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}
const SYNC_SOURCE_LABEL = { EXCEL_GENERIC: "Excel", CONTPAQ_XML: "CONTPAQ", NOMIPAQ_DBF: "NOMIPAQ DBF", NOMIPAQ_EXCEL: "NOMIPAQ Excel", MANUAL: "Manual" };

function useSyncLog(token, refreshKey) {
  const [state, setState] = useState({ status: "loading", data: null });
  const reload = useCallback(() => {
    if (!token) return;
    setState((s) => ({ ...s, status: "loading" }));
    fetchSyncLogLatest(token)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { ...state, reload };
}

function SyncStatusCard({ token, compact = false, refreshKey }) {
  const sync = useSyncLog(token, refreshKey);

  if (sync.status === "loading") {
    return compact
      ? <div className="muted" style={{ fontSize: 12 }}>Cargando estado de sincronización…</div>
      : <div className="glass" style={{ padding: 18 }}><div className="muted">Cargando…</div></div>;
  }
  if (!sync.data) {
    return compact
      ? <div className="row" style={{ gap: 8 }}><span className="dot" style={{ background: "var(--muted-2)" }} /><span className="muted" style={{ fontSize: 12.5 }}>Ningún archivo de nómina sincronizado aún</span></div>
      : <div className="glass" style={{ padding: 18, borderLeft: "3px solid var(--muted-2)" }}><Eyebrow>Archivo conectado</Eyebrow><div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Aún no se ha sincronizado ningún archivo de nómina.</div></div>;
  }

  const s = sync.data;
  const failed = s.status === "FAILED";
  const hoursSince = s.finishedAt ? (Date.now() - new Date(s.finishedAt).getTime()) / 3_600_000 : Infinity;
  const color = failed ? "var(--rose)" : hoursSince < 24 ? "var(--emerald)" : "var(--amber)";
  const fileLabel = s.fileName || SYNC_SOURCE_LABEL[s.source] || s.source;

  if (compact) {
    return (
      <div className="row" style={{ gap: 8, cursor: "default" }}>
        <span className="dot" style={{ background: color }} />
        <span style={{ fontSize: 12.5 }}>
          {failed ? "❌ Error de sincronización" : "✅ Nómina sincronizada"} · {s.employeeCount ?? s.processed} empleados · {timeAgo(s.finishedAt)}
        </span>
      </div>
    );
  }

  return (
    <div className="glass" style={{ padding: "16px 20px", borderLeft: `3px solid ${color}` }}>
      <div className="row" style={{ gap: 9, marginBottom: 10 }}>
        <span className="dot" style={{ background: color }} />
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", color }}>{failed ? "ERROR" : "ACTIVO"}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{fileLabel}</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={sync.reload} title="Actualizar"><RefreshCw size={12} /></button>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        {SYNC_SOURCE_LABEL[s.source] || s.source} · Última sync: {timeAgo(s.finishedAt)}
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div className="mono" style={{ fontSize: 12.5, color: "var(--text)" }}>
          {s.employeeCount ?? s.processed} empleados · {s.payrollRecordCount ?? s.processed} recibos · <span style={{ color: s.errors > 0 ? "var(--amber)" : "var(--emerald)" }}>{s.errors} errores</span>
        </div>
      </div>
    </div>
  );
}

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
  { id: "headcount_hoy", x: 0, y: 570, w: 932, h: 560 },
  { id: "sync", x: 0, y: 1146, w: 456, h: 108 },
  { id: "nomina", x: 476, y: 1146, w: 456, h: 430 },
  { id: "status_plantilla", x: 0, y: 1592, w: 932, h: 320 },
];

function NominaWidget({ token, go }) {
  const [state, setState] = useState({ status: "loading", data: null });
  useEffect(() => {
    if (!token) return;
    fetchPayrollSummary(token)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token]);

  if (state.status === "loading") return <div className="muted" style={{ fontSize: 12.5 }}>Cargando nómina…</div>;
  if (state.status === "error" || !state.data || state.data.employeeCount === 0) {
    return <div className="muted" style={{ fontSize: 12.5 }}>Sin datos de nómina para el período actual.</div>;
  }
  const s = state.data;
  const periodLabel = s.period ? new Date(s.period).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—";

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 12 }}>
        <div className="kpi" style={{ fontSize: 24, color: "var(--cyan)" }}>{mxn(s.totalPercepciones)}</div>
        <div className="muted" style={{ fontSize: 11 }}>Total percepciones</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 12 }}>
        <div className="kpi" style={{ fontSize: 20, color: "var(--amber)" }}>{mxn(s.totalDeducciones)}</div>
        <div className="muted" style={{ fontSize: 11 }}>Total deducciones</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 12 }}>
        <div className="kpi" style={{ fontSize: 24, color: "var(--emerald)" }}>{mxn(s.totalNeto)}</div>
        <div className="muted" style={{ fontSize: 11 }}>Total neto a pagar</div>
      </div>
      <div className="muted2" style={{ fontSize: 11, marginBottom: 12 }}>{s.employeeCount} empleados · Período {periodLabel}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, marginBottom: 12 }}>
        <KV k="ISR retenido" v={mxn(s.totalISR)} />
        <KV k="IMSS cuotas" v={mxn(s.totalIMSS)} />
        <KV k="INFONAVIT" v={mxn(s.totalINFONAVIT)} />
      </div>
      <button className="btn btn-sm" onClick={() => go?.("indicadores")}>Ver desglose completo</button>
    </div>
  );
}

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

function StatusPlantillaWidget({ token, onFilterStatus }) {
  const [state, setState] = useState({ status: "loading", data: null });
  useEffect(() => {
    if (!token) return;
    fetchEmployeeStatusSummary(token)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token]);

  if (state.status === "loading") return <div className="muted" style={{ fontSize: 12.5 }}>Cargando…</div>;
  if (state.status === "error") return <div style={{ fontSize: 12.5, color: "var(--rose)" }}>{state.error}</div>;

  const s = state.data;
  const total = s.total || 0;
  const rows = STATUS_DONUT_ORDER.map((name) => ({ name, value: s[name] || 0, fill: STATUS_DONUT_COLOR[name] })).filter((r) => r.value > 0);
  const situacionEspecial = (s["Vacaciones"] || 0) + (s["Incapacidad"] || 0) + (s["Permiso"] || 0) + (s["Baja pendiente"] || 0) + (s["Periodo de prueba"] || 0);

  return (
    <div>
      <div className="row" style={{ gap: 18, alignItems: "center" }}>
        <ResponsiveContainer width={180} height={180}>
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={2} stroke="none">
              {rows.map((r) => <Cell key={r.name} fill={r.fill} cursor="pointer" onClick={() => onFilterStatus?.(r.name)} />)}
            </Pie>
            <Tooltip contentStyle={tipStyle} formatter={(v, n) => [`${v} (${total ? Math.round((v / total) * 100) : 0}%)`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
          {rows.map((r) => (
            <div
              key={r.name} className="row"
              style={{ gap: 9, cursor: "pointer", padding: "3px 6px", borderRadius: 8, transition: ".12s" }}
              onClick={() => onFilterStatus?.(r.name)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--glass-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span className="dot" style={{ background: r.fill }} />
              <span style={{ flex: 1, fontSize: 12.5 }}>{r.name}</span>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{r.value}</span>
              <span className="muted2 mono" style={{ fontSize: 11, width: 36, textAlign: "right" }}>{total ? Math.round((r.value / total) * 100) : 0}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 14, textAlign: "center" }}>
        {s["Activo"] || 0} activos · {situacionEspecial} en situación especial · {s["Baja"] || 0} bajas
      </div>
    </div>
  );
}

function Cockpit({ staff, solicitudes, resolver, go, attendance, openExpediente, token, onFilterPlantillaStatus }) {
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

        <WidgetShell id="headcount_hoy" title="HEADCOUNT HOY" active={activeId === "headcount_hoy"} onStart={onStart} setRef={setRef("headcount_hoy")} {...pos("headcount_hoy")}>
          <HeadcountWidget attendance={attendance} compact staff={staff} openExpediente={openExpediente} go={go} />
        </WidgetShell>

        <WidgetShell id="sync" title="Archivo conectado" active={activeId === "sync"} onStart={onStart} setRef={setRef("sync")} {...pos("sync")}
          badge={<button className="btn btn-sm" onClick={() => go("conectores")}>Ver</button>}>
          <SyncStatusCard token={token} compact />
        </WidgetShell>

        <WidgetShell id="nomina" title="Nómina · período actual" active={activeId === "nomina"} onStart={onStart} setRef={setRef("nomina")} {...pos("nomina")}>
          <NominaWidget token={token} go={go} />
        </WidgetShell>

        <WidgetShell id="status_plantilla" title="STATUS DE PLANTILLA" active={activeId === "status_plantilla"} onStart={onStart} setRef={setRef("status_plantilla")} {...pos("status_plantilla")}>
          <StatusPlantillaWidget token={token} onFilterStatus={onFilterPlantillaStatus} />
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
function netoColor(v) {
  if (v == null) return "var(--muted-2)";
  if (v > 8000) return "var(--emerald)";
  if (v >= 4000) return "var(--amber)";
  return "var(--muted-2)";
}

function usePayrollSummary(token, period) {
  const [state, setState] = useState({ status: "loading", data: null });
  useEffect(() => {
    if (!token) return;
    fetchPayrollSummary(token, period)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token, period]);
  return state;
}

function usePayrollLatestMap(token) {
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!token) return;
    fetchPayrollLatestByEmployee(token)
      .then(({ data }) => {
        const m = {};
        (data || []).forEach((r) => { m[r.employeeId] = r; });
        setMap(m);
      })
      .catch(() => setMap({}));
  }, [token]);
  return map;
}

function useEmployeeGamification(token, employeeId) {
  const [state, setState] = useState({ status: "loading", data: null });
  useEffect(() => {
    if (!token || !employeeId) return;
    fetchEmployeeGamification(token, employeeId)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token, employeeId]);
  return state;
}

function useGamificationLeaderboard(token, limit = 5) {
  const [state, setState] = useState({ status: "loading", data: [] });
  useEffect(() => {
    if (!token) return;
    fetchGamificationLeaderboard(token, limit)
      .then(({ data }) => setState({ status: "ready", data: data || [] }))
      .catch(() => setState({ status: "error", data: [] }));
  }, [token, limit]);
  return state;
}

function Plantilla({ staff, token, openExpediente, socket, refreshStaff, initialStatusFilter }) {
  const [q, setQ] = useState(""); const [fStatus, setFStatus] = useState(initialStatusFilter || "Todos"); const [fDepto, setFDepto] = useState("Todos");
  const [nuevo, setNuevo] = useState(false);
  const [sortNeto, setSortNeto] = useState(null); // null | "asc" | "desc"
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(1);
  // staff ya viene completo en memoria (fetchEmployees trae todo el tenant en
  // un solo fetch, ver api.js) — la paginación de Plantilla es sobre el
  // arreglo ya filtrado, en cliente, no un refetch por página.
  useEffect(() => { setPage(1); }, [q, fStatus, fDepto]);
  const [confirmAction, setConfirmAction] = useState(null); // null | "limpiar" | "bajaSeleccionados" | "eliminarSeleccionados" | { type:"eliminar", emp }
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState(null);
  const netoMap = usePayrollLatestMap(token);
  const deptos = ["Todos", ...ORG.deptos];

  // Otro admin/pestaña puede editar o dar de baja empleados — nos refrescamos
  // solos en vez de mostrar una plantilla obsoleta.
  useEffect(() => {
    if (!socket) return;
    const onChanged = () => refreshStaff?.();
    socket.on("employee:updated", onChanged);
    socket.on("employees:bulk_changed", onChanged);
    return () => { socket.off("employee:updated", onChanged); socket.off("employees:bulk_changed", onChanged); };
  }, [socket, refreshStaff]);

  let rows = staff.filter((e) =>
    (q === "" || e.nombre.toLowerCase().includes(q.toLowerCase()) || e.id.toLowerCase().includes(q.toLowerCase())) &&
    (fStatus === "Todos" || e.status === fStatus) && (fDepto === "Todos" || e.depto === fDepto));
  if (sortNeto) {
    rows = [...rows].sort((a, b) => {
      const av = netoMap[a.dbId]?.netPay != null ? Number(netoMap[a.dbId].netPay) : -1;
      const bv = netoMap[b.dbId]?.netPay != null ? Number(netoMap[b.dbId].netPay) : -1;
      return sortNeto === "asc" ? av - bv : bv - av;
    });
  }
  const toggleSortNeto = () => setSortNeto((s) => (s === "desc" ? "asc" : s === "asc" ? null : "desc"));

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleOne = (dbId) => setSelected((s) => { const next = new Set(s); if (next.has(dbId)) next.delete(dbId); else next.add(dbId); return next; });
  const allVisibleSelected = pageRows.length > 0 && pageRows.every((e) => selected.has(e.dbId));
  const toggleAll = () => setSelected((s) => {
    const next = new Set(s);
    for (const e of pageRows) { if (allVisibleSelected) next.delete(e.dbId); else next.add(e.dbId); }
    return next;
  });

  const exportSelected = () => {
    const chosen = rows.filter((e) => selected.has(e.dbId));
    download(`plantilla_seleccion_${todayISO}.csv`, toCSV(chosen));
    toast(`CSV exportado · ${chosen.length} filas`);
  };

  const closeConfirm = () => { setConfirmAction(null); setConfirmError(null); };

  const runConfirmed = async () => {
    setConfirmBusy(true); setConfirmError(null);
    try {
      if (confirmAction === "limpiar") {
        const res = await bulkDeleteEmployees(token);
        toast(`Plantilla limpiada · ${res.updated} baja(s)`);
      } else if (confirmAction?.type === "eliminar") {
        await deleteEmployee(token, confirmAction.emp.dbId);
        toast(`Baja registrada · ${confirmAction.emp.nombre}`);
      } else if (confirmAction === "bajaSeleccionados" || confirmAction === "eliminarSeleccionados") {
        await Promise.all(Array.from(selected).map((dbId) => deleteEmployee(token, dbId)));
        toast(`${selected.size} colaborador(es) dado(s) de baja`);
        setSelected(new Set());
      }
      setConfirmAction(null);
      await refreshStaff?.();
    } catch (e) {
      setConfirmError(e.message);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="fadein">
      <Eyebrow>Plantilla · {staff.length} colaboradores</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Consulta de personal</h1>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="row glass-2" style={{ padding: "0 11px", flex: 1, minWidth: 220, gap: 8 }}>
          <Search size={15} className="muted" />
          <input className="input" style={{ border: "none", background: "transparent", padding: "10px 0" }} placeholder="Buscar por nombre o ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: 160 }} value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option>Todos</option>{Object.keys(STATUS).map((s) => <option key={s}>{s}</option>)}<option>Baja</option></select>
        <select className="select" style={{ width: 180 }} value={fDepto} onChange={(e) => setFDepto(e.target.value)}>{deptos.map((d) => <option key={d}>{d}</option>)}</select>
        <button className="btn btn-accent" onClick={() => setNuevo(true)}><Plus size={14} />Agregar empleado</button>
        <button className="btn" onClick={() => { download(`plantilla_gfp_${todayISO}.csv`, toCSV(rows)); toast(`CSV exportado · ${rows.length} filas`); }}><Download size={14} />Exportar CSV</button>
        <button className="btn" style={{ color: "var(--rose)" }} onClick={() => setConfirmAction("limpiar")}><Trash2 size={14} />Limpiar plantilla</button>
      </div>

      {selected.size > 0 && (
        <div className="glass-2 row" style={{ padding: "10px 14px", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
          <span className="chip" style={{ color: "var(--cyan)" }}>{selected.size} seleccionado{selected.size > 1 ? "s" : ""}</span>
          <button className="btn btn-sm" onClick={() => setConfirmAction("bajaSeleccionados")}>Dar de baja seleccionados</button>
          <button className="btn btn-sm" style={{ color: "var(--rose)" }} onClick={() => setConfirmAction("eliminarSeleccionados")}>Eliminar seleccionados</button>
          <button className="btn btn-sm" onClick={exportSelected}><Download size={12} />Exportar seleccionados</button>
        </div>
      )}

      <div className="glass" style={{ overflow: "hidden", padding: 0 }}>
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          <table className="tbl">
            <thead style={{ position: "sticky", top: 0, background: "rgba(8,12,20,.92)", backdropFilter: "blur(8px)" }}>
              <tr>
                <th style={{ width: 30 }} onClick={toggleAll}>
                  <span style={{ cursor: "pointer", display: "inline-flex" }}>{allVisibleSelected ? <CheckSquare size={15} color="var(--cyan)" /> : <Square size={15} />}</span>
                </th>
                <th>ID</th><th>Colaborador</th><th>Área</th><th>Turno</th><th>Contrato</th><th>Antig.</th><th>Estatus</th>
                <th style={{ cursor: "pointer", userSelect: "none" }} onClick={toggleSortNeto}>Último neto {sortNeto === "desc" ? "↓" : sortNeto === "asc" ? "↑" : ""}</th>
                <th></th></tr>
            </thead>
            <tbody>
              {pageRows.map((e) => {
                const neto = netoMap[e.dbId]?.netPay != null ? Number(netoMap[e.dbId].netPay) : null;
                const isSel = selected.has(e.dbId);
                return (
                  <tr key={e.id} onClick={() => openExpediente?.(e, "nomina")}>
                    <td onClick={(ev) => { ev.stopPropagation(); toggleOne(e.dbId); }}>
                      <span style={{ cursor: "pointer", display: "inline-flex" }}>{isSel ? <CheckSquare size={15} color="var(--cyan)" /> : <Square size={15} />}</span>
                    </td>
                    <td className="mono muted2">{e.id}</td>
                    <td style={{ fontWeight: 500 }}>{e.nombre}</td>
                    <td className="muted">{e.depto}</td>
                    <td><span className="chip" style={{ color: TURNO_COLOR[e.turno] }}>{e.turno}</span></td>
                    <td><span className="chip">{e.contrato}</span></td>
                    <td className="mono muted">{e.antiguedad}a</td>
                    <td><StatusChip s={e.status} /></td>
                    <td className="mono" style={{ color: netoColor(neto), fontWeight: 500 }}>{neto != null ? mxn2(neto) : "—"}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <button className="btn btn-sm" title="Editar" onClick={() => openExpediente?.(e, "resumen")}><Pencil size={12} /></button>
                        <button className="btn btn-sm" title="Eliminar" style={{ color: "var(--rose)" }} onClick={() => setConfirmAction({ type: "eliminar", emp: e })}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={page} totalPages={totalPages} total={rows.length} limit={PAGE_SIZE} onPageChange={setPage} itemLabel="colaboradores" />

      {nuevo && (
        <NuevoDrawer
          token={token}
          onClose={() => setNuevo(false)}
          onCreated={(nombre) => { setNuevo(false); refreshStaff?.(); toast(`Alta registrada · ${nombre}`); }}
        />
      )}

      {confirmAction === "limpiar" && (
        <ConfirmModal
          title="Limpiar plantilla" tone="danger" confirmLabel="Sí, dar de baja a todos"
          message="⚠️ Esto eliminará TODOS los empleados de esta plantilla. Los recibos de nómina se conservan."
          busy={confirmBusy} error={confirmError} onCancel={closeConfirm} onConfirm={runConfirmed}
        />
      )}
      {confirmAction?.type === "eliminar" && (
        <ConfirmModal
          title="Dar de baja" tone="warn" confirmLabel="Dar de baja"
          message={`¿Dar de baja a ${confirmAction.emp.nombre}?`}
          busy={confirmBusy} error={confirmError} onCancel={closeConfirm} onConfirm={runConfirmed}
        />
      )}
      {(confirmAction === "bajaSeleccionados" || confirmAction === "eliminarSeleccionados") && (
        <ConfirmModal
          title="Dar de baja seleccionados" tone={confirmAction === "eliminarSeleccionados" ? "danger" : "warn"} confirmLabel="Confirmar"
          message={`¿Dar de baja a ${selected.size} colaborador(es) seleccionado(s)?`}
          busy={confirmBusy} error={confirmError} onCancel={closeConfirm} onConfirm={runConfirmed}
        />
      )}
    </div>
  );
}
const Mini = ({ label, v }) => <div className="glass-2" style={{ padding: "9px 12px" }}><div className="muted2" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".12em" }}>{label}</div><div style={{ fontSize: 13.5, fontWeight: 500, marginTop: 3 }}>{v}</div></div>;

function fmtDateShort(d) { return d ? new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—"; }
function fmtBytes(n) { if (!n) return "0 KB"; const kb = n / 1024; return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`; }

function useEmployeePayroll(token, employeeDbId, page) {
  const [state, setState] = useState({ status: "loading", data: [], total: 0, totalPages: 1 });
  const reload = useCallback(() => {
    if (!token || !employeeDbId) { setState({ status: "ready", data: [], total: 0, totalPages: 1 }); return; }
    setState((s) => ({ ...s, status: "loading" }));
    fetchPayroll(token, employeeDbId, { page, limit: PAGE_SIZE })
      .then(({ data, total, totalPages }) => setState({ status: "ready", data: data || [], total: total || 0, totalPages: totalPages || 1 }))
      .catch((e) => setState({ status: "error", data: [], total: 0, totalPages: 1, error: e.message }));
  }, [token, employeeDbId, page]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

// Promedio "últimos 3 períodos" — deliberadamente independiente de la página
// que esté viendo el usuario en la tabla paginada de abajo (si dependiera de
// `payroll.data` de la página actual, navegar a la página 2+ mostraría el
// promedio de recibos viejos como si fueran los "últimos 3").
function useEmployeePayrollLast3(token, employeeDbId) {
  const [state, setState] = useState({ status: "loading", data: [] });
  useEffect(() => {
    if (!token || !employeeDbId) { setState({ status: "ready", data: [] }); return; }
    fetchPayroll(token, employeeDbId, { page: 1, limit: 3 })
      .then(({ data }) => setState({ status: "ready", data: data || [] }))
      .catch(() => setState({ status: "ready", data: [] }));
  }, [token, employeeDbId]);
  return state;
}

function PayrollAICard({ record, token }) {
  const [ai, setAi] = useState({ status: "idle", data: null });
  useEffect(() => {
    const totalDed = Number(record.total_deductions) || 0;
    if (totalDed <= 0) { setAi({ status: "not_applicable", data: null }); return; }
    setAi({ status: "loading", data: null });
    fetchPayrollExplain(token, record.id)
      .then((res) => setAi(res.applicable ? { status: "ready", data: res } : { status: "not_applicable", data: null }))
      .catch((e) => setAi({ status: "error", data: null, error: e.message }));
  }, [record.id, token]);

  if (ai.status === "not_applicable") return null;
  return (
    <div className="glass" style={{ padding: 12, marginTop: 10 }}>
      <div className="row" style={{ gap: 7, marginBottom: 6 }}><Bot size={13} className="muted" /><span style={{ fontWeight: 600, fontSize: 12 }}>Análisis de nómina · IA</span></div>
      {ai.status === "loading" && <div className="muted" style={{ fontSize: 12, animation: "blink 1.4s infinite" }}>Analizando deducciones…</div>}
      {ai.status === "error" && <div style={{ fontSize: 12, color: "var(--rose)" }}>No se pudo generar el análisis.</div>}
      {ai.status === "ready" && (
        <>
          <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{ai.data.text}</div>
          <div className="muted2" style={{ fontSize: 10.5, marginTop: 8 }}>Fuente: {ai.data.sources}</div>
        </>
      )}
    </div>
  );
}

function PayrollRecordRow({ record, token, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const doDelete = async () => {
    setBusy(true); setError(null);
    try {
      await deletePayrollRecord(token, record.id);
      setConfirmOpen(false);
      onDeleted?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-2" style={{ padding: 0, overflow: "hidden", marginBottom: 10 }}>
      <div className="row" style={{ padding: "12px 14px", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{record.payroll_type || "Recibo"} · {fmtDateShort(record.period_start)} – {fmtDateShort(record.period_end)}</div>
          <div className="muted2" style={{ fontSize: 11 }}>Pago: {fmtDateShort(record.payment_date)}</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="mono" style={{ fontWeight: 600, color: netoColor(Number(record.net_pay)) }}>{mxn2(record.net_pay)}</span>
          <button
            className="btn btn-sm" title="Eliminar recibo" style={{ color: "var(--rose)" }}
            onClick={(ev) => { ev.stopPropagation(); setConfirmOpen(true); }}
          ><Trash2 size={12} /></button>
          <ChevronRight size={14} className="muted2" style={{ transform: open ? "rotate(90deg)" : "none", transition: ".15s" }} />
        </div>
      </div>
      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12.5 }}>
            <div>
              <Eyebrow>Percepciones</Eyebrow>
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
                <KV k="Gravado" v={mxn2(record.gross_taxable)} /><KV k="Exento" v={mxn2(record.gross_exempt)} /><KV k="Total" v={mxn2(record.total_income)} />
              </div>
            </div>
            <div>
              <Eyebrow>Deducciones</Eyebrow>
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
                {Number(record.isr) > 0 && <KV k="ISR" v={mxn2(record.isr)} />}
                {Number(record.imss_employee) > 0 && <KV k="IMSS" v={mxn2(record.imss_employee)} />}
                {Number(record.infonavit) > 0 && <KV k="INFONAVIT" v={mxn2(record.infonavit)} />}
                {Number(record.other_deductions) > 0 && <KV k="Otras" v={mxn2(record.other_deductions)} />}
                <KV k="Total deducciones" v={mxn2(record.total_deductions)} />
              </div>
            </div>
          </div>
          {open && <PayrollAICard record={record} token={token} />}
        </div>
      )}
      {confirmOpen && (
        <ConfirmModal
          title="Eliminar recibo" tone="danger" confirmLabel="Eliminar"
          message="¿Eliminar este recibo? Esta acción no se puede deshacer."
          busy={busy} error={error}
          onCancel={() => { setConfirmOpen(false); setError(null); }}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}

function NominaTab({ e, token }) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [e.dbId]);
  const payroll = useEmployeePayroll(token, e.dbId, page);
  const last3 = useEmployeePayrollLast3(token, e.dbId);
  // Si se borra el último recibo de la última página (o "Limpiar historial"
  // deja menos páginas de las que había), evita quedar en una página vacía.
  useEffect(() => { if (payroll.status === "ready" && page > payroll.totalPages) setPage(payroll.totalPages); }, [payroll.status, payroll.totalPages, page]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (payroll.status === "loading" && payroll.data.length === 0) return <div className="muted" style={{ fontSize: 13, padding: "20px 0" }}>Cargando recibos…</div>;
  if (payroll.total === 0) return <div className="glass-2 muted" style={{ padding: 16, fontSize: 13 }}>Sin recibos importados — sincronizar nómina.</div>;

  const avg = last3.data.length ? last3.data.reduce((a, r) => a + Number(r.net_pay), 0) / last3.data.length : null;

  const doClear = async () => {
    setBusy(true); setError(null);
    try {
      await bulkDeletePayrollRecords(token, e.dbId);
      setConfirmClear(false);
      setPage(1);
      payroll.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {avg != null && (
        <div className="glass-2" style={{ padding: 14, marginBottom: 14 }}>
          <Eyebrow>Promedio neto últimos {last3.data.length} período{last3.data.length > 1 ? "s" : ""}</Eyebrow>
          <div className="kpi" style={{ fontSize: 22, color: "var(--emerald)", marginTop: 4 }}>{mxn2(avg)}</div>
        </div>
      )}
      {payroll.data.map((r) => <PayrollRecordRow key={r.id} record={r} token={token} onDeleted={payroll.reload} />)}

      <Pagination page={page} totalPages={payroll.totalPages} total={payroll.total} limit={PAGE_SIZE} onPageChange={setPage} itemLabel="recibos" />

      <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 4, color: "var(--rose)" }} onClick={() => setConfirmClear(true)}>
        <Trash2 size={13} />Limpiar historial de nómina
      </button>

      {confirmClear && (
        <ConfirmModal
          title="Limpiar historial de nómina" tone="danger" confirmLabel="Sí, eliminar todo"
          message={`¿Eliminar los ${payroll.total} recibos de nómina de ${e.nombre}? Esta acción no se puede deshacer.`}
          busy={busy} error={error}
          onCancel={() => { setConfirmClear(false); setError(null); }}
          onConfirm={doClear}
        />
      )}
    </div>
  );
}

function GamificationSummaryCard({ token, employeeId }) {
  const gam = useEmployeeGamification(token, employeeId);
  if (gam.status === "loading") return null;
  if (gam.status === "error" || !gam.data) return null;
  const g = gam.data;
  const unlocked = (g.badges || []).filter((b) => b.unlocked);

  return (
    <div className="glass-2" style={{ padding: 14, marginBottom: 18 }}>
      <Eyebrow>Gamificación</Eyebrow>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 9 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Nivel {g.xp_level} · {g.level_label}</div>
        <span className="chip" style={{ color: "var(--amber)" }}>🔥 {g.streak_days} días</span>
      </div>
      <div className="muted2" style={{ fontSize: 11.5, marginTop: 4 }}>{g.xp_total} XP acumulados</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {unlocked.length === 0
          ? <span className="muted2" style={{ fontSize: 11.5 }}>Sin logros desbloqueados todavía.</span>
          : unlocked.map((b) => <span key={b.id} className="chip">{b.emoji} {b.label}</span>)}
      </div>

      {(g.recent_events || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Eyebrow>Últimos eventos XP</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
            {g.recent_events.slice(0, 5).map((ev, i) => (
              <div key={i} className="row" style={{ justifyContent: "space-between", fontSize: 11.5 }}>
                <span className="muted">{ev.description || ev.type}</span>
                <span className="mono" style={{ color: "var(--emerald)", flexShrink: 0, marginLeft: 8 }}>+{ev.xp_earned} XP</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResumenTab({ e, setStatus, update, token }) {
  const dv = diasVacaciones(e.antiguedad); const sd = e.salario / 30;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
        <Mini label="Planta" v={e.planta} /><Mini label="Turno" v={e.turno} /><Mini label="Ingreso" v={e.ingreso} /><Mini label="Antigüedad" v={`${e.antiguedad} años`} /><Mini label="Salario mensual" v={mxn(e.salario)} /><Mini label="Contrato" v={e.contrato} />
      </div>
      <Eyebrow>Modificar estatus</Eyebrow>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "9px 0 18px" }}>
        {Object.keys(STATUS).map((s) => <button key={s} className={`btn btn-sm ${e.status === s ? "btn-accent" : ""}`} onClick={() => setStatus(e.dbId, s)}><span className="dot" style={{ background: STATUS[s] }} />{s}</button>)}
      </div>
      <Eyebrow>Tipo de contrato</Eyebrow>
      <select className="select" style={{ margin: "9px 0 18px" }} value={e.contrato} onChange={(ev) => update({ contrato: ev.target.value })}>{CONTRATOS.map((c) => <option key={c}>{c}</option>)}</select>
      <GamificationSummaryCard token={token} employeeId={e.dbId} />
      <div className="glass-2" style={{ padding: 14 }}>
        <Eyebrow>Derechos LFT estimados</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9, fontSize: 12.5 }}>
          <KV k="Vacaciones / año" v={`${dv} días`} /><KV k="Prima vacacional (25%)" v={mxn(dv * sd * 0.25)} /><KV k="Aguinaldo (15 días)" v={mxn(sd * 15)} /><KV k="Salario diario base" v={mxn2(sd)} />
        </div>
      </div>
    </>
  );
}

/* ============================================================
   SALUD — perfil de salud confidencial (LFPDPPP Art. 8)
   ============================================================ */

function useEmployeeHealth(token, employeeId) {
  const [state, setState] = useState({ status: "loading", data: null });
  const reload = useCallback(() => {
    if (!token || !employeeId) return;
    setState((s) => ({ ...s, status: "loading" }));
    fetchEmployeeHealth(token, employeeId)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token, employeeId]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

function TagInput({ tags, onChange, placeholder }) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (!v || tags.includes(v)) { setInput(""); return; }
    onChange([...tags, v]);
    setInput("");
  };
  return (
    <div>
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
          {tags.map((t) => (
            <span key={t} className="chip" style={{ gap: 6, background: "var(--glass-2)" }}>
              {t}
              <X size={11} className="muted2" style={{ cursor: "pointer" }} onClick={() => onChange(tags.filter((x) => x !== t))} />
            </span>
          ))}
        </div>
      )}
      <input
        className="input" placeholder={placeholder} value={input}
        onChange={(ev) => setInput(ev.target.value)}
        onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); add(); } }}
      />
    </div>
  );
}

// Campo inline: sin borde/fondo hasta enfocar, guarda al perder foco.
function InlineEditField({ value, placeholder, onSave, type = "text" }) {
  const [v, setV] = useState(value || "");
  useEffect(() => { setV(value || ""); }, [value]);
  const style = {
    fontFamily: "var(--font)", fontSize: 13, color: "var(--text)", background: "transparent",
    border: "none", borderBottom: "1.5px solid transparent", borderRadius: 0, padding: "6px 2px",
    width: "100%", outline: "none", transition: ".15s",
  };
  return (
    <input
      className="inline-edit" type={type} placeholder={placeholder} value={v} style={style}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => (e.target.style.borderBottomColor = "var(--cyan)")}
      onBlur={(e) => { e.target.style.borderBottomColor = "transparent"; if ((v || null) !== (value || null)) onSave(v || null); }}
    />
  );
}

const NIVEL_STYLE = {
  normal:   { color: "var(--emerald)", icon: "✅", label: "NORMAL" },
  "atención": { color: "var(--amber)", icon: "⚠️", label: "ATENCIÓN" },
  urgente:  { color: "var(--rose)", icon: "🔴", label: "URGENTE" },
};

function HealthInsightsCard({ insights }) {
  if (insights.status === "processing") {
    return <div className="muted" style={{ fontSize: 12, marginTop: 8, animation: "blink 1.4s infinite" }}>🔬 Analizando documento…</div>;
  }
  if (insights.status === "error") {
    return <div style={{ fontSize: 12, marginTop: 8, color: "var(--rose)" }}>No se pudo analizar el documento{insights.analysisError ? `: ${insights.analysisError}` : ""}.</div>;
  }
  if (!insights.insights) return null;
  return (
    <div className="glass-2" style={{ padding: "12px 14px", marginTop: 8 }}>
      <div className="row" style={{ gap: 7, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>🔬 {insights.tipo}</span>
        {insights.fecha_documento && <span className="muted2" style={{ fontSize: 11 }}>· {insights.fecha_documento}</span>}
      </div>
      {insights.resumen && <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>{insights.resumen}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(insights.insights || []).map((it, i) => {
          const s = NIVEL_STYLE[it.nivel] || NIVEL_STYLE.normal;
          return (
            <div key={i} className="row" style={{ gap: 8, fontSize: 12 }}>
              <span className="dot" style={{ background: s.color, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{it.categoria}: {it.hallazgo}</span>
              <span className="mono" style={{ fontSize: 10.5, color: s.color, flexShrink: 0 }}>{s.icon} {s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function useHealthDocumentInsights(token, employeeId, doc) {
  const [insights, setInsights] = useState({ status: doc.status || "ready", tipo: doc.tipo, fecha_documento: doc.fecha_documento, insights: doc.insights, resumen: doc.resumen, analysisError: doc.analysisError });
  useEffect(() => {
    if (insights.status !== "processing") return;
    let stopped = false;
    const poll = () => {
      fetchHealthDocumentInsights(token, employeeId, doc.id)
        .then((data) => { if (!stopped) { setInsights(data); if (data.status === "processing") t = setTimeout(poll, 3000); } })
        .catch(() => { if (!stopped) t = setTimeout(poll, 5000); });
    };
    let t = setTimeout(poll, 3000);
    return () => { stopped = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);
  return insights;
}

function HealthDocRow({ doc, token, employeeId, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const insights = useHealthDocumentInsights(token, employeeId, doc);

  const doDownload = async () => {
    try {
      const { blob, filename } = await downloadHealthDocument(token, employeeId, doc.id, doc.filename);
      downloadBlobFile(filename, blob);
    } catch (err) { toast(err.message, "no"); }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await deleteHealthDocument(token, employeeId, doc.id);
      setConfirmOpen(false);
      onDeleted?.();
    } catch (err) { toast(err.message, "no"); } finally { setBusy(false); }
  };

  return (
    <div className="glass-2" style={{ padding: "10px 12px", marginBottom: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <FileHeart size={15} className="muted2" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.filename}</div>
            <div className="muted2" style={{ fontSize: 10.5 }}>{fmtDateShort(doc.uploadedAt)} · {fmtBytes(doc.size)}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <button className="btn btn-sm" title="Descargar" onClick={doDownload}><Download size={12} /></button>
          <button className="btn btn-sm" title="Eliminar" style={{ color: "var(--rose)" }} onClick={() => setConfirmOpen(true)}><Trash2 size={12} /></button>
        </div>
      </div>
      <HealthInsightsCard insights={insights} />
      {confirmOpen && (
        <ConfirmModal
          title="Eliminar documento" tone="danger" confirmLabel="Eliminar"
          message={`¿Eliminar "${doc.filename}"? Esta acción no se puede deshacer.`}
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}

function SaludTab({ e, token, health }) {
  const [uploading, setUploading] = useState(false);

  const save = useCallback((patch) => {
    updateEmployeeHealth(token, e.dbId, patch).then(health.reload).catch((err) => toast(err.message, "no"));
  }, [token, e.dbId, health.reload]);

  const onDropFiles = async (files) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) { toast(`"${file.name}" supera 10MB`, "no"); continue; }
        await uploadHealthDocument(token, e.dbId, file);
      }
      health.reload();
    } catch (err) {
      toast(err.message, "no");
    } finally {
      setUploading(false);
    }
  };

  if (health.status === "loading") return <div className="muted" style={{ fontSize: 13, padding: "20px 0" }}>Cargando perfil de salud…</div>;
  const p = health.data || {};

  return (
    <div>
      <div className="glass-2" style={{ padding: "11px 13px", borderLeft: "3px solid var(--cyan)", marginBottom: 20, display: "flex", gap: 10 }}>
        <Lock size={15} color="var(--cyan)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>🔒 Información confidencial</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
            Solo visible para HR Manager y superior<br />Protegida bajo LFPDPPP Art. 8
          </div>
        </div>
      </div>

      <Eyebrow>Datos médicos básicos</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "9px 0 20px" }}>
        <div>
          <label className="fld">Tipo de sangre</label>
          <select className="select" value={p.tipo_sangre || ""} onChange={(ev) => save({ tipoSangre: ev.target.value || null })}>
            <option value="">Sin especificar</option>
            {TIPOS_SANGRE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="fld">Fecha último examen</label>
          <input className="input" type="date" defaultValue={p.fecha_ultimo_examen ? String(p.fecha_ultimo_examen).slice(0, 10) : ""}
            onBlur={(ev) => save({ fechaUltimoExamen: ev.target.value || null })} />
        </div>
      </div>

      <Eyebrow>Condiciones declaradas</Eyebrow>
      <div style={{ margin: "9px 0 20px" }}>
        <TagInput tags={p.condiciones_declaradas || []} onChange={(tags) => save({ condicionesDeclaradas: tags })} placeholder="Diabetes tipo 2, Hipertensión, Asma…" />
      </div>

      <Eyebrow>Alergias</Eyebrow>
      <div style={{ margin: "9px 0 20px" }}>
        <TagInput tags={p.alergias || []} onChange={(tags) => save({ alergias: tags })} placeholder="Penicilina, Polen, Látex…" />
      </div>

      <Eyebrow>Medicamentos actuales</Eyebrow>
      <div style={{ margin: "9px 0 20px" }}>
        <TagInput tags={p.medicamentos || []} onChange={(tags) => save({ medicamentos: tags })} placeholder="Metformina 500mg, Losartán 50mg…" />
      </div>

      <Eyebrow>Contacto de emergencia</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "9px 0 20px" }}>
        <div>
          <label className="fld">Nombre</label>
          <InlineEditField value={p.contacto_emergencia_nombre} placeholder="Nombre completo" onSave={(v) => save({ contactoEmergenciaNombre: v })} />
        </div>
        <div>
          <label className="fld">Teléfono</label>
          <InlineEditField value={p.contacto_emergencia_telefono} placeholder="10 dígitos" onSave={(v) => save({ contactoEmergenciaTelefono: v })} />
        </div>
        <div>
          <label className="fld">Relación</label>
          <InlineEditField value={p.contacto_emergencia_relacion} placeholder="Esposo(a), madre…" onSave={(v) => save({ contactoEmergenciaRelacion: v })} />
        </div>
      </div>

      <Eyebrow>Documentos médicos</Eyebrow>
      <div style={{ margin: "9px 0 20px" }}>
        <MiniDropzone
          accept=".pdf,.jpg,.jpeg,.png" multiple busy={uploading} onFiles={onDropFiles}
          label="Arrastra estudios, análisis o documentos médicos" busyLabel="Subiendo…"
        />
        {(p.documentos || []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            {p.documentos.map((doc) => <HealthDocRow key={doc.id} doc={doc} token={token} employeeId={e.dbId} onDeleted={health.reload} />)}
          </div>
        )}
      </div>

      <Eyebrow>Notas médicas</Eyebrow>
      <textarea
        className="input" rows={4} style={{ resize: "vertical", marginTop: 9 }}
        placeholder="Observaciones del área de RH…" defaultValue={p.notas_medicas || ""}
        onBlur={(ev) => { if ((ev.target.value || null) !== (p.notas_medicas || null)) save({ notasMedicas: ev.target.value || null }); }}
      />
    </div>
  );
}

function ProfileDrawer({ e, onClose, setStatus, update, token, initialTab }) {
  const [tab, setTab] = useState(initialTab || "resumen");
  const health = useEmployeeHealth(token, e.dbId);
  const urgentCount = (health.data?.documentos || []).filter((d) => (d.insights || []).some((i) => i.nivel === "urgente")).length;
  return (
    <><div className="scrim" onClick={onClose} />
      <div className="drawer" style={{ padding: 22 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 18 }}><Eyebrow>Expediente digital</Eyebrow><X size={18} className="handle" style={{ cursor: "pointer" }} onClick={onClose} /></div>
        <div className="row" style={{ gap: 13, marginBottom: 18 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,var(--cyan),var(--violet))", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 18, color: "#04060a" }}>{e.nombre.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>
          <div><div style={{ fontSize: 17, fontWeight: 600 }}>{e.nombre}</div><div className="muted" style={{ fontSize: 12.5 }}>{e.puesto} · {e.depto}</div><div className="mono muted2" style={{ fontSize: 11, marginTop: 2 }}>{e.id} · {e.email}</div></div>
        </div>
        <div className="row" style={{ gap: 6, marginBottom: 18 }}>
          <span className={`tabbtn ${tab === "resumen" ? "on" : ""}`} onClick={() => setTab("resumen")}>Resumen</span>
          <span className={`tabbtn ${tab === "salud" ? "on" : ""}`} onClick={() => setTab("salud")}>
            <FileHeart size={12} />Salud
            {urgentCount > 0 && <span className="chip" style={{ color: "#fff", background: "var(--rose)", borderColor: "var(--rose)", padding: "1px 6px", fontSize: 10 }}>{urgentCount}</span>}
          </span>
          <span className={`tabbtn ${tab === "nomina" ? "on" : ""}`} onClick={() => setTab("nomina")}><DollarSign size={12} />Nómina</span>
        </div>
        {tab === "resumen" && <ResumenTab e={e} setStatus={setStatus} update={update} token={token} />}
        {tab === "salud" && <SaludTab e={e} token={token} health={health} />}
        {tab === "nomina" && <NominaTab e={e} token={token} />}
      </div></>
  );
}
function NuevoDrawer({ token, onClose, onCreated }) {
  const [f, setF] = useState({ nombre: "", depto: ORG.deptos[0], puesto: PUESTOS[0], turno: "Matutino", contrato: "Periodo de prueba", planta: ORG.plantas[0], salario: 12000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const crear = async () => {
    const nombre = f.nombre.trim();
    if (!nombre) return;
    const lastSpace = nombre.lastIndexOf(" ");
    const firstName = lastSpace === -1 ? nombre : nombre.slice(0, lastSpace);
    const lastName  = lastSpace === -1 ? nombre : nombre.slice(lastSpace + 1);

    setBusy(true); setError(null);
    try {
      await createEmployee(token, {
        firstName, lastName,
        department: f.depto, position: f.puesto, shift: f.turno,
        contractType: f.contrato, plant: f.planta,
        monthlySalary: Number(f.salario) || 0,
        hireDate: todayISO, status: "Periodo de prueba",
      });
      onCreated(nombre);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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
        {error && <div style={{ color: "var(--rose)", fontSize: 12, marginBottom: 14 }}>{error}</div>}
        <button className="btn btn-accent" style={{ width: "100%", justifyContent: "center" }} disabled={!f.nombre.trim() || busy} onClick={crear}>
          <Plus size={15} />{busy ? "Guardando…" : "Registrar alta"}
        </button>
      </div></>
  );
}

/* ============================================================
   CONFIRM MODAL + DROPDOWN MENU — controles compartidos por
   Conectores / Plantilla / Expediente para acciones destructivas.
   ============================================================ */

// tone: "warn" (ámbar — pausar/desconectar sin borrar datos) | "danger" (rojo — borra datos permanentemente)
function ConfirmModal({ title, message, confirmLabel = "Confirmar", tone = "warn", busy, error, onConfirm, onCancel }) {
  const color = tone === "danger" ? "var(--rose)" : "var(--amber)";
  return (
    <div className="modal" onClick={onCancel}>
      <div className="glass" style={{ width: "min(420px,92vw)", padding: 22, border: `1.5px solid ${color}` }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 9, marginBottom: 10 }}>
          <AlertTriangle size={17} color={color} />
          <span style={{ fontWeight: 600, fontSize: 14.5 }}>{title}</span>
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 18 }}>{message}</div>
        {error && <div style={{ color: "var(--rose)", fontSize: 12, marginBottom: 14 }}>{error}</div>}
        <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button
            className="btn"
            style={{
              background: tone === "danger" ? "rgba(251,113,133,.2)" : "rgba(245,181,68,.2)",
              borderColor:  tone === "danger" ? "rgba(251,113,133,.45)" : "rgba(245,181,68,.45)",
              color:        tone === "danger" ? "#fcc4cd" : "#ffe1ad",
            }}
            onClick={onConfirm} disabled={busy}
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// items: [{ label, icon?, danger?, onClick }]
function DropdownMenu({ items, label = "⋯" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div style={{ position: "relative", display: "inline-block" }} ref={ref}>
      <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>{label}</button>
      {open && (
        <div className="glass-2" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", minWidth: 220, padding: 6, zIndex: 30 }}>
          {items.map((it, i) => (
            <div
              key={i}
              className="row"
              style={{ gap: 8, padding: "9px 11px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, color: it.danger ? "var(--rose)" : "var(--text)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--glass-hi)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={() => { setOpen(false); it.onClick(); }}
            >
              {it.icon}{it.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   CONECTORES · Integraciones de nómina
   ============================================================ */

function ConfigPanel({ title, subtitle, onClose, steps, currentStep, children }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer drawer-xl" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "22px 26px 18px", borderBottom: "1px solid var(--border)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: steps ? 16 : 0 }}>
            <div>
              <Eyebrow>{subtitle}</Eyebrow>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 3 }}>{title}</div>
            </div>
            <X size={18} className="handle" style={{ cursor: "pointer" }} onClick={onClose} />
          </div>
          {steps && (
            <div className="row" style={{ gap: 6 }}>
              {steps.map((label, i) => (
                <React.Fragment key={label}>
                  <div className={`stepdot ${i < currentStep ? "done" : i === currentStep ? "on" : ""}`} title={label}>
                    {i < currentStep ? <Check size={12} /> : i + 1}
                  </div>
                  {i < steps.length - 1 && <div className={`stepline ${i < currentStep ? "done" : ""}`} />}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: 26, overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </>
  );
}

const CONNECTION_MODES = [
  {
    id: "A", icon: "📁", subtitle: "MODO A", title: "Exportación manual",
    desc: "El contador exporta el reporte de nómina desde Nomipaq o Contpaq y lo carga aquí cada quincena.",
    compat: ["Nomipaq (Excel/CSV)", "CONTPAQi Nóminas (XML CFDI)", "Cualquier sistema con export"],
    impl: "inmediata", requiere: "acceso al portal RH",
    recomendado: "Recomendado para inicio rápido",
  },
  {
    id: "B", icon: "📂", subtitle: "MODO B", title: "Carpeta compartida",
    desc: "Nomipaq deposita el archivo en una carpeta de red. CÓDICE la monitorea y sincroniza automáticamente al detectar un archivo nuevo.",
    compat: ["Nomipaq DBF (EMPLEA + NOMINA)", "Cualquier sistema con output a carpeta local o de red"],
    impl: "1-2 horas IT", requiere: "acceso carpeta de red",
    recomendado: "Más usado en manufactura",
  },
  {
    id: "C", icon: "🔌", subtitle: "MODO C", title: "Conexión directa",
    desc: "CÓDICE se conecta directamente a Nomipaq o CONTPAQi vía ODBC o SDK. Sync automático cada quincena sin intervención manual.",
    compat: ["CONTPAQi SDK oficial", "Nomipaq ODBC", "ZKTeco / Anviz (asistencia)"],
    impl: "4-8h con IT", requiere: "acceso al servidor donde corre el sistema de nómina",
    recomendado: "Mayor automatización",
  },
];

function ModeCard({ mode, selected, onSelect }) {
  return (
    <div
      className="glass"
      onClick={onSelect}
      style={{
        padding: 20, cursor: "pointer", transition: ".15s", flex: "1 1 300px", minWidth: 280,
        borderLeft: `3px solid ${selected ? "var(--cyan)" : "transparent"}`,
        background: selected ? "rgba(86,212,240,.06)" : undefined,
      }}
    >
      <div className="row" style={{ gap: 9, marginBottom: 10 }}>
        <span style={{ fontSize: 20 }}>{mode.icon}</span>
        <div>
          <div className="muted2" style={{ fontSize: 10, letterSpacing: ".1em" }}>{mode.subtitle}</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{mode.title}</div>
        </div>
      </div>
      <span className="chip" style={{ color: "var(--violet)", marginBottom: 12, display: "inline-flex" }}>{mode.recomendado}</span>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "12px 0" }}>{mode.desc}</div>
      <div className="muted2" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Compatible con</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 14 }}>
        {mode.compat.map((c) => <div key={c} className="muted" style={{ fontSize: 12 }}>· {c}</div>)}
      </div>
      <div style={{ fontSize: 11.5, marginBottom: 16 }}>
        <div className="muted2">Implementación: <span style={{ color: "var(--text)" }}>{mode.impl}</span></div>
        <div className="muted2" style={{ marginTop: 3 }}>Requiere: <span style={{ color: "var(--text)" }}>{mode.requiere}</span></div>
      </div>
      <button className={`btn ${selected ? "btn-accent" : ""}`} style={{ width: "100%", justifyContent: "center" }} onClick={onSelect}>Configurar este modo</button>
    </div>
  );
}

// ── MODO A — wizard ────────────────────────────────────────

const MODO_A_SYSTEMS = [
  { id: "nomipaq_excel", label: "Nomipaq Excel", format: "excel", accept: ".xlsx" },
  { id: "nomipaq_csv", label: "Nomipaq CSV", format: "excel", accept: ".csv" },
  { id: "contpaqi_xml", label: "CONTPAQi XML CFDI", format: "cfdi", accept: ".xml" },
  { id: "excel_generico", label: "Excel genérico", format: "excel", accept: ".xlsx,.csv" },
];

const CODICE_FIELDS = [
  ["full_name", "Nombre completo"], ["rfc", "RFC"], ["curp", "CURP"], ["nss", "NSS (IMSS)"],
  ["employee_code", "Clave de empleado"],
  ["daily_salary", "Salario diario"], ["monthly_salary", "Salario mensual"],
  ["department", "Departamento"], ["position", "Puesto"],
  ["plant", "Planta"], ["shift", "Turno"], ["hire_date", "Fecha de ingreso"],
  ["contract_type", "Tipo de contrato"], ["status", "Estatus"],
  ["bank_name", "Banco"], ["bank_clabe", "CLABE"], ["notes", "Notas"],
];

// RFC o Clave de empleado — al menos uno debe estar mapeado para continuar
// (si no, el import solo puede insertar filas nuevas, nunca actualizar las
// existentes — ver upsertEmployee en routes/connectors.ts).
const REQUIRED_IDENTIFIER_FIELDS = ["rfc", "employee_code"];

// Campos de nómina — mismo Excel genérico, ahora también puede alimentar
// payroll_records (ver connectors/excel/fieldMapper.ts:PAYROLL_FIELDS en el API).
const CODICE_PAYROLL_FIELDS = [
  ["gross_taxable", "Percepciones (gravadas)"], ["gross_exempt", "Percepciones exentas"],
  ["isr", "ISR"], ["imss_employee", "IMSS (cuota obrera)"], ["infonavit", "INFONAVIT"],
  ["other_deductions", "Otras deducciones"], ["total_deductions", "Total deducciones"],
  ["net_pay", "Neto a pagar"], ["days_paid", "Días pagados"], ["payment_date", "Fecha de pago"],
  ["period", "Período / quincena"], ["year", "Año"],
];
const PAYROLL_FIELD_KEYS = new Set(CODICE_PAYROLL_FIELDS.map(([f]) => f));

const MODO_A_STEPS = ["Sistema", "Archivo", "Mapeo", "Vista previa", "Progreso", "Resultado"];

function MiniDropzone({ accept, multiple, onFiles, busy, label, busyLabel }) {
  const ref = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className="glass-2"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) onFiles(e.dataTransfer.files); }}
      onClick={() => !busy && ref.current?.click()}
      style={{
        height: 96, borderRadius: 12, border: `1.5px dashed ${dragOver ? "var(--cyan)" : "var(--border-hi)"}`,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: busy ? "default" : "pointer",
        background: dragOver ? "rgba(86,212,240,.06)" : "var(--glass-2)", padding: "0 16px", textAlign: "center",
      }}
    >
      <input ref={ref} type="file" accept={accept} multiple={multiple} style={{ display: "none" }}
        onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      {busy
        ? <><RefreshCw size={16} className="muted" /><span className="muted" style={{ fontSize: 12.5 }}>{busyLabel || "Analizando archivo…"}</span></>
        : <><Upload size={16} className="muted2" /><span className="muted" style={{ fontSize: 12.5 }}>{label || "Arrastra el archivo aquí o haz clic para buscar"}</span></>}
    </div>
  );
}

function FieldMapperTable({ headers, manualMap, setManualMap }) {
  const applySuggestion = (h) => setManualMap((m) => ({ ...m, [h.index]: h.suggestion.field }));
  return (
    <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
      <table className="tbl">
        <thead><tr><th>Columna en tu archivo</th><th>Campo en CÓDICE</th><th>Status</th></tr></thead>
        <tbody>
          {headers.map((h) => {
            const matched = !!h.field;
            const overridden = manualMap[h.index];
            const suggestion = !matched && !overridden ? h.suggestion : null;
            return (
              <tr key={h.index} style={{ cursor: "default" }}>
                <td className="mono">{h.label}</td>
                <td>
                  {matched ? h.fieldLabel : (
                    <div>
                      <select
                        className="select" style={{ fontSize: 12, padding: "5px 8px", width: 200 }}
                        value={overridden || ""} onChange={(e) => setManualMap((m) => ({ ...m, [h.index]: e.target.value }))}
                      >
                        <option value="">Sin mapear (se ignora)</option>
                        <optgroup label="Empleados">{CODICE_FIELDS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</optgroup>
                        <optgroup label="Nómina">{CODICE_PAYROLL_FIELDS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</optgroup>
                      </select>
                      {suggestion && (
                        <div className="row" style={{ gap: 7, marginTop: 6 }}>
                          <span className="muted2" style={{ fontSize: 11 }}>Sugerido: {suggestion.label}</span>
                          <button className="btn btn-sm" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => applySuggestion(h)}>Aplicar sugerencia</button>
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  {matched
                    ? <span className="chip" style={{ color: "var(--emerald)" }}><CircleCheck size={11} />Detectado</span>
                    : overridden
                      ? <span className="chip" style={{ color: "var(--emerald)" }}><CircleCheck size={11} />Mapeado manualmente</span>
                      : <span className="chip" style={{ color: "var(--amber)" }}><AlertTriangle size={11} />{suggestion ? "Sugerencia disponible" : "Sin mapear"}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldMapperStep({ preview, manualMap, setManualMap, onContinue, onBack }) {
  // Categoriza cada header por el campo YA detectado o el que el usuario
  // mapeó manualmente — así una columna reasignada a mano cambia de sección.
  const fieldFor = (h) => manualMap[h.index] || h.field;
  const isPayroll = (h) => PAYROLL_FIELD_KEYS.has(fieldFor(h));

  const employeeHeaders = preview.headers.filter((h) => !isPayroll(h));
  const payrollHeaders  = preview.headers.filter((h) => isPayroll(h));

  const empDetected     = preview.headers.some((h) => h.field && !PAYROLL_FIELD_KEYS.has(h.field));
  const payrollDetected = preview.headers.some((h) => h.field && PAYROLL_FIELD_KEYS.has(h.field));

  const pendingSuggestions = preview.headers.filter((h) => !h.field && !manualMap[h.index] && h.suggestion);
  const applyAllSuggestions = () => {
    setManualMap((m) => {
      const next = { ...m };
      for (const h of pendingSuggestions) next[h.index] = h.suggestion.field;
      return next;
    });
  };

  const hasRequiredIdentifier = preview.headers.some((h) => REQUIRED_IDENTIFIER_FIELDS.includes(fieldFor(h)));

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Mapeo de columnas</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Confirma que cada columna de tu archivo se interpretó correctamente.</div>

      {preview.usingSavedMapping && (
        <div className="glass-2" style={{ padding: "9px 12px", marginBottom: 14, borderLeft: "3px solid var(--emerald)" }}>
          <span style={{ fontSize: 12, color: "var(--emerald)" }}>Usando mapeo guardado de la última sincronización ✓</span>
        </div>
      )}

      <div className="row" style={{ gap: 8, marginBottom: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip" style={{ color: empDetected ? "var(--emerald)" : "var(--muted-2)" }}>
            Campos detectados: Empleados {empDetected ? "✓" : "—"}
          </span>
          <span className="chip" style={{ color: payrollDetected ? "var(--emerald)" : "var(--muted-2)" }}>
            Nómina {payrollDetected ? "✓" : "—"}
          </span>
        </div>
        {pendingSuggestions.length > 0 && (
          <button className="btn btn-sm" onClick={applyAllSuggestions}>
            <Sparkles size={12} />Aplicar todas las sugerencias ({pendingSuggestions.length})
          </button>
        )}
      </div>

      <Eyebrow>Empleados</Eyebrow>
      <div style={{ marginTop: 8, marginBottom: payrollHeaders.length ? 22 : 0 }}>
        <FieldMapperTable headers={employeeHeaders} manualMap={manualMap} setManualMap={setManualMap} />
      </div>

      {payrollHeaders.length > 0 && (
        <>
          <Eyebrow>Nómina</Eyebrow>
          <div style={{ marginTop: 8 }}>
            <FieldMapperTable headers={payrollHeaders} manualMap={manualMap} setManualMap={setManualMap} />
          </div>
        </>
      )}

      <div className="muted2" style={{ fontSize: 11, marginTop: 10 }}>Las columnas sin mapear se ignoran al importar.</div>
      {!hasRequiredIdentifier && (
        <div style={{ fontSize: 12, color: "var(--rose)", marginTop: 10 }}>
          Necesitas mapear al menos RFC o Clave de empleado para continuar
        </div>
      )}
      <div className="row" style={{ gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onBack}>← Atrás</button>
        <button className="btn btn-accent" disabled={!hasRequiredIdentifier} onClick={onContinue}>Continuar</button>
      </div>
    </div>
  );
}

function PreviewStep({ isExcel, preview, onConfirm, onBack }) {
  const rows = preview.preview || [];
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Vista previa</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{preview.totalRows} registro{preview.totalRows === 1 ? "" : "s"} detectado{preview.totalRows === 1 ? "" : "s"} · mostrando los primeros {rows.length}.</div>
      {preview.errors?.length > 0 && (
        <div className="glass-2" style={{ padding: 10, marginBottom: 10, borderLeft: "3px solid var(--amber)" }}>
          <div className="muted2" style={{ fontSize: 10.5, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".08em" }}>Advertencias ({preview.errors.length})</div>
          {preview.errors.slice(0, 5).map((e, i) => (
            <div key={i} className="muted" style={{ fontSize: 11.5 }}>{e.file ? `${e.file} · ` : ""}{e.row ? `fila ${e.row}: ` : ""}{e.message}</div>
          ))}
        </div>
      )}
      <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
        <table className="tbl">
          <thead>
            {isExcel
              ? <tr><th>Nombre</th><th>Departamento</th><th>Puesto</th><th>Salario diario</th></tr>
              : <tr><th>Nombre</th><th>RFC</th><th>Percepciones</th><th>Neto</th></tr>}
          </thead>
          <tbody>
            {rows.length === 0 && <tr style={{ cursor: "default" }}><td colSpan={4} className="muted" style={{ padding: 16 }}>Sin filas para mostrar.</td></tr>}
            {rows.map((r, i) => isExcel ? (
              <tr key={i} style={{ cursor: "default" }}>
                <td>{r.first_name} {r.last_name}</td><td className="muted">{r.department || "—"}</td><td className="muted">{r.position || "—"}</td>
                <td className="mono">{r.daily_salary ? mxn2(r.daily_salary) : "—"}</td>
              </tr>
            ) : (
              <tr key={i} style={{ cursor: "default" }}>
                <td>{r.employee.first_name} {r.employee.last_name}</td><td className="mono muted2">{r.employee.rfc || "—"}</td>
                <td className="mono">{mxn2(r.payroll.total_income || 0)}</td>
                <td className="mono" style={{ color: "var(--emerald)" }}>{mxn2(r.payroll.net_pay || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 16 }}>¿Los datos se ven correctos?</div>
      <div className="row" style={{ gap: 10, marginTop: 12, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onBack}>Cancelar</button>
        <button className="btn btn-accent" onClick={onConfirm}>Confirmar e importar</button>
      </div>
    </div>
  );
}

function ProgressStep({ progress, systemLabel }) {
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : 0;
  return (
    <div style={{ textAlign: "center", padding: "44px 10px" }}>
      <RefreshCw size={26} className="muted" />
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 16 }}>
        Procesando {progress.total || "…"} {progress.total === 1 ? "registro" : "registros"}...
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{systemLabel}</div>
      <div className="prog" style={{ marginTop: 22, height: 8, maxWidth: 340, margin: "22px auto 0" }}><i style={{ width: `${pct}%` }} /></div>
      <div className="mono muted2" style={{ fontSize: 11, marginTop: 8 }}>{progress.processed} / {progress.total || "?"} · {pct}%</div>
    </div>
  );
}

function ResultStep({ result, err, isExcel, onClose }) {
  if (err) {
    return (
      <div style={{ textAlign: "center", padding: "30px 10px" }}>
        <div style={{ fontSize: 32 }}>❌</div>
        <div style={{ fontWeight: 600, marginTop: 10 }}>Error al importar</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{err}</div>
        <button className="btn" style={{ marginTop: 20 }} onClick={onClose}>Cerrar</button>
      </div>
    );
  }
  const errs = result?.errors || [];
  const b = result?.breakdown;
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {b ? (
          <>
            <div className="row" style={{ gap: 8 }}><CircleCheck size={16} style={{ color: "var(--emerald)" }} /><span>{b.totalRows} fila{b.totalRows === 1 ? "" : "s"} procesada{b.totalRows === 1 ? "" : "s"} · {b.inserted} nuevo{b.inserted === 1 ? "" : "s"} · {b.updated} actualizado{b.updated === 1 ? "" : "s"}</span></div>
            {b.duplicateRFC > 0 && <div className="row" style={{ gap: 8 }}><AlertTriangle size={16} style={{ color: "var(--cyan)" }} /><span>{b.duplicateRFC} fila{b.duplicateRFC === 1 ? "" : "s"} con RFC repetido en el archivo — se combinaron en el mismo empleado</span></div>}
            {b.missingRFC > 0 && <div className="row" style={{ gap: 8 }}><AlertTriangle size={16} style={{ color: "var(--amber)" }} /><span>{b.missingRFC} fila{b.missingRFC === 1 ? "" : "s"} sin RFC — no se pudieron comparar contra empleados existentes</span></div>}
            {b.skipped > 0 && <div className="row" style={{ gap: 8 }}><AlertTriangle size={16} style={{ color: "var(--rose)" }} /><span>{b.skipped} fila{b.skipped === 1 ? "" : "s"} omitida{b.skipped === 1 ? "" : "s"} por error</span></div>}
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 8 }}><CircleCheck size={16} style={{ color: "var(--emerald)" }} /><span>{result.processed} {isExcel ? "empleados" : "recibos"} sincronizados</span></div>
            {!isExcel && <div className="row" style={{ gap: 8 }}><CircleCheck size={16} style={{ color: "var(--emerald)" }} /><span>{result.processed} recibos importados</span></div>}
          </>
        )}
        {errs.length > 0 && <div className="row" style={{ gap: 8 }}><AlertTriangle size={16} style={{ color: "var(--amber)" }} /><span>{errs.length} registro{errs.length === 1 ? "" : "s"} con advertencias</span></div>}
      </div>
      {errs.length > 0 && (
        <div className="glass-2" style={{ padding: 10, marginBottom: 16, maxHeight: 140, overflowY: "auto" }}>
          {errs.slice(0, 10).map((e, i) => (
            <div key={i} className="muted" style={{ fontSize: 11.5 }}>{e.file ? `${e.file} · ` : ""}{e.row ? `fila ${e.row}: ` : ""}{e.message}</div>
          ))}
        </div>
      )}
      <button className="btn btn-accent" style={{ width: "100%", justifyContent: "center" }} onClick={onClose}>Listo</button>
    </div>
  );
}

function ModoAWizard({ token, socket, onClose, onImported }) {
  const [step, setStep] = useState(0);
  const [system, setSystem] = useState(null);
  const [files, setFiles] = useState([]);
  const [manualMap, setManualMap] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState(null);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [commitErr, setCommitErr] = useState(null);

  const isExcel = system?.format !== "cfdi";

  useEffect(() => {
    if (!socket || step !== 4) return;
    const handler = (data) => setProgress(data);
    socket.on("sync:progress", handler);
    return () => socket.off("sync:progress", handler);
  }, [socket, step]);

  const selectSystem = (sys) => { setSystem(sys); setPreviewErr(null); setStep(1); };

  const handleFiles = async (fileList) => {
    const list = Array.from(fileList || []);
    if (list.length === 0) return;
    setFiles(list);
    setPreviewBusy(true);
    setPreviewErr(null);
    try {
      const res = system.format === "cfdi" ? await previewCfdi(token, list) : await previewExcel(token, list[0]);
      setPreview(res);
      setStep(system.format === "cfdi" ? 3 : 2);
    } catch (e) {
      setPreviewErr(e.message);
    } finally {
      setPreviewBusy(false);
    }
  };

  const confirmImport = async () => {
    setStep(4);
    setProgress({ processed: 0, total: preview?.totalRows || files.length });
    setCommitErr(null);
    try {
      const endpoint = system.format === "cfdi" ? "/api/connectors/upload/cfdi" : "/api/connectors/upload/excel";
      // Mapeo COMPLETO confirmado en el Step 3 (auto-detectado + sugerencias
      // aplicadas + overrides manuales), por header de texto — el backend lo
      // usa tal cual para el import real y lo guarda para la próxima subida
      // (ver PART 1/4 del mapeo inteligente).
      let extraFields;
      if (isExcel && preview?.headers) {
        const fieldMap = {};
        for (const h of preview.headers) {
          const field = manualMap[h.index] || h.field;
          if (field) fieldMap[h.label] = field;
        }
        if (Object.keys(fieldMap).length > 0) extraFields = { fieldMap: JSON.stringify(fieldMap) };
      }
      const res = await uploadConnectorFile(token, endpoint, files, undefined, extraFields);
      setResult(res);
      setStep(5);
      onImported?.();
    } catch (e) {
      setCommitErr(e.message);
      setStep(5);
    }
  };

  return (
    <ConfigPanel title="Exportación manual" subtitle="MODO A · Configuración" onClose={onClose} steps={MODO_A_STEPS} currentStep={step}>
      {step === 0 && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>¿Qué sistema exporta el archivo?</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>Selecciona el formato de tu reporte de nómina.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {MODO_A_SYSTEMS.map((s) => (
              <div key={s.id} className="glass-2 row" style={{ padding: "14px 16px", justifyContent: "space-between", cursor: "pointer" }} onClick={() => selectSystem(s)}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.label}</span>
                <ChevronRight size={15} className="muted2" />
              </div>
            ))}
          </div>
        </div>
      )}
      {step === 1 && system && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Sube el archivo de nómina</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>Formato: {system.label}</div>
          <MiniDropzone accept={system.accept} multiple={system.format === "cfdi"} onFiles={handleFiles} busy={previewBusy} />
          <div className="muted2" style={{ fontSize: 11, marginTop: 10 }}>Formato detectado automáticamente al subir.</div>
          {previewErr && <div style={{ color: "var(--rose)", fontSize: 12, marginTop: 10 }}>{previewErr}</div>}
          <button className="btn" style={{ marginTop: 16 }} onClick={() => setStep(0)}>← Atrás</button>
        </div>
      )}
      {step === 2 && preview && (
        <FieldMapperStep preview={preview} manualMap={manualMap} setManualMap={setManualMap} onContinue={() => setStep(3)} onBack={() => setStep(1)} />
      )}
      {step === 3 && preview && (
        <PreviewStep isExcel={isExcel} preview={preview} onConfirm={confirmImport} onBack={() => setStep(isExcel ? 2 : 1)} />
      )}
      {step === 4 && <ProgressStep progress={progress} systemLabel={system?.label} />}
      {step === 5 && <ResultStep result={result} err={commitErr} isExcel={isExcel} onClose={onClose} />}
    </ConfigPanel>
  );
}

// ── MODO B — carpeta compartida (config UI; sin backend de monitoreo real) ──

function ModoBPanel({ onClose }) {
  const [form, setForm] = useState({ path: "\\\\servidor\\nomipaq\\exports\\", fileType: "Nomipaq DBF", freq: "Cada hora" });
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <ConfigPanel title="Carpeta compartida" subtitle="MODO B · Configuración" onClose={onClose}>
      <label className="fld">Ruta de carpeta</label>
      <input className="input" style={{ marginBottom: 14 }} value={form.path} onChange={set("path")} />
      <label className="fld">Tipo de archivo</label>
      <select className="select" style={{ marginBottom: 14 }} value={form.fileType} onChange={set("fileType")}>
        <option>Nomipaq DBF</option><option>Excel</option><option>CSV</option>
      </select>
      <label className="fld">Frecuencia de monitoreo</label>
      <select className="select" style={{ marginBottom: 20 }} value={form.freq} onChange={set("freq")}>
        <option>Cada 15min</option><option>Cada hora</option><option>Diario</option><option>Al detectar cambio</option>
      </select>
      <button className="btn btn-accent" style={{ width: "100%", justifyContent: "center" }} onClick={() => { setSaved(true); toast("Configuración guardada"); }}>
        <Check size={14} />Guardar configuración
      </button>

      {saved && (
        <div className="glass-2" style={{ padding: 14, marginTop: 20 }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="dot" style={{ background: "var(--amber)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>Monitoreando: {form.path}</span>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Último archivo detectado: —</div>
          <span className="chip" style={{ color: "var(--amber)" }}>PENDIENTE CONFIGURACIÓN DE RED</span>
        </div>
      )}

      <div className="muted2" style={{ fontSize: 11, marginTop: 20, lineHeight: 1.6 }}>
        Tu equipo de IT deberá compartir la carpeta de salida de Nomipaq con acceso de lectura para el servidor de CÓDICE. Tiempo estimado: 1-2 horas.
      </div>
    </ConfigPanel>
  );
}

// ── MODO C — conexión directa (config UI; sin backend ODBC/SDK real) ────────

function ConnectionTestButton({ label }) {
  const [state, setState] = useState("idle"); // idle | testing | fail
  const run = () => { setState("testing"); setTimeout(() => setState("fail"), 1400); };
  return (
    <div>
      <button className="btn" onClick={run} disabled={state === "testing"}>
        {state === "testing" ? <RefreshCw size={13} /> : <Zap size={13} />}{label}
      </button>
      {state === "fail" && (
        <div className="row" style={{ gap: 6, marginTop: 8, alignItems: "flex-start" }}>
          <span className="dot" style={{ background: "var(--rose)", marginTop: 4, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: "var(--rose)" }}>No se detectó un servidor accesible en esta red — verifica que el servicio esté expuesto al servidor de CÓDICE.</span>
        </div>
      )}
    </div>
  );
}

function ModoCPanel({ onClose }) {
  const [sub, setSub] = useState("contpaqi");
  const [freq, setFreq] = useState("Cada quincena (automático)");
  const [notify, setNotify] = useState({ ok: true, err: true });

  return (
    <ConfigPanel title="Conexión directa" subtitle="MODO C · Configuración" onClose={onClose}>
      <div className="row" style={{ gap: 6, marginBottom: 18 }}>
        <span className={`tabbtn ${sub === "contpaqi" ? "on" : ""}`} onClick={() => setSub("contpaqi")}>CONTPAQi SDK</span>
        <span className={`tabbtn ${sub === "odbc" ? "on" : ""}`} onClick={() => setSub("odbc")}>Nomipaq ODBC</span>
      </div>

      {sub === "contpaqi" ? (
        <div>
          <label className="fld">RFC de la empresa</label>
          <input className="input" style={{ marginBottom: 14 }} placeholder="XAXX010101000" />
          <label className="fld">Ruta de instalación CONTPAQi</label>
          <input className="input" style={{ marginBottom: 16 }} placeholder="C:\CONTPAQi\Nominas\" />
          <ConnectionTestButton label="Verificar conexión" />
          <div className="muted2" style={{ fontSize: 11, marginTop: 14 }}>Requiere CONTPAQi 10.3.0 o superior con SDK habilitado.</div>
        </div>
      ) : (
        <div>
          <label className="fld">DSN Name</label>
          <input className="input" style={{ marginBottom: 14 }} placeholder="NOMIPAQ_DSN" />
          <label className="fld">Usuario</label>
          <input className="input" style={{ marginBottom: 14 }} placeholder="sa" />
          <label className="fld">Contraseña</label>
          <input className="input" type="password" style={{ marginBottom: 16 }} />
          <ConnectionTestButton label="Verificar conexión" />
          <div className="muted2" style={{ fontSize: 11, marginTop: 14 }}>Requiere driver ODBC de Nomipaq instalado en el servidor.</div>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 22, paddingTop: 18 }}>
        <Eyebrow>Sync schedule</Eyebrow>
        <select className="select" style={{ margin: "9px 0 14px" }} value={freq} onChange={(e) => setFreq(e.target.value)}>
          <option>Cada quincena (automático)</option><option>Manual</option><option>Personalizado</option>
        </select>
        <label className="fld">Notificar por email cuando</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <label className="row" style={{ gap: 8, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={notify.ok} onChange={(e) => setNotify((n) => ({ ...n, ok: e.target.checked }))} />Sync exitoso
          </label>
          <label className="row" style={{ gap: 8, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={notify.err} onChange={(e) => setNotify((n) => ({ ...n, err: e.target.checked }))} />Errores
          </label>
        </div>
      </div>
    </ConfigPanel>
  );
}

// ── HISTORIAL DE SINCRONIZACIONES ───────────────────────────

function useSyncHistory(token, refreshKey) {
  const [state, setState] = useState({ status: "loading", data: [] });
  useEffect(() => {
    if (!token) return;
    setState((s) => ({ ...s, status: "loading" }));
    fetchSyncLogHistory(token)
      .then(({ data }) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: [], error: e.message }));
  }, [token, refreshKey]);
  return state;
}

const SYNC_STATUS_COLOR = { COMPLETED: "var(--emerald)", PARTIAL: "var(--amber)", FAILED: "var(--rose)", RUNNING: "var(--cyan)", PENDING: "var(--muted-2)" };

function HistorialSync({ token, refreshKey }) {
  const hist = useSyncHistory(token, refreshKey);
  return (
    <div>
      <Eyebrow>Historial de sincronizaciones</Eyebrow>
      <div className="glass" style={{ padding: 0, overflow: "hidden", marginTop: 10 }}>
        <table className="tbl">
          <thead><tr><th>Fecha</th><th>Fuente</th><th>Empleados</th><th>Recibos</th><th>Errores</th><th>Duración</th><th>Status</th></tr></thead>
          <tbody>
            {hist.status === "loading" && <tr style={{ cursor: "default" }}><td colSpan={7} className="muted" style={{ padding: 16 }}>Cargando…</td></tr>}
            {hist.status === "ready" && hist.data.length === 0 && <tr style={{ cursor: "default" }}><td colSpan={7} className="muted" style={{ padding: 16 }}>Sin sincronizaciones registradas.</td></tr>}
            {hist.data.map((h) => (
              <tr key={h.id} style={{ cursor: "default" }}>
                <td className="mono muted2" style={{ fontSize: 11.5 }}>{new Date(h.startedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{h.fileName || SYNC_SOURCE_LABEL[h.source] || h.source}</td>
                <td className="mono">{h.employeesProcessed ?? h.processed}</td>
                <td className="mono">{h.payrollProcessed ?? "—"}</td>
                <td className="mono" style={{ color: h.errors > 0 ? "var(--amber)" : "var(--emerald)" }}>{h.errors}</td>
                <td className="mono muted">{h.durationMs != null ? `${(h.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                <td><span className="chip" style={{ color: SYNC_STATUS_COLOR[h.status] || "var(--muted)" }}>{h.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── LIVE-WIRE — archivo conectado: recargar / reemplazar / auto-sync ────

const SOURCE_TYPE_LABEL = { EXCEL: "Excel", DBF: "Nomipaq DBF", CFDI: "CFDI CONTPAQ" };
const AUTO_SYNC_INTERVALS = [5, 15, 30, 60];

function sourceStatusMeta(s) {
  if (s.status === "ERROR") return { label: "ERROR", color: "var(--rose)" };
  const hrs = s.lastReadAt ? (Date.now() - new Date(s.lastReadAt).getTime()) / 3_600_000 : Infinity;
  if (hrs > 24) return { label: "DESACTUALIZADO", color: "var(--amber)" };
  return { label: "CONECTADO", color: "var(--emerald)" };
}

function useConnectedSources(token, refreshKey) {
  const [state, setState] = useState({ status: "loading", data: [] });
  const reload = useCallback(() => {
    if (!token) return;
    fetchConnectedSources(token)
      .then(({ data }) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: [], error: e.message }));
  }, [token]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { ...state, reload };
}

function ConnectedSourceCard({ token, socket, source, onChanged, tenantId, agentStatus }) {
  const [busy, setBusy] = useState(null); // null | "reload" | "replace"
  const [progress, setProgress] = useState({ processed: 0, total: 0, uploadPct: 0 });
  const [justUpdated, setJustUpdated] = useState(false);
  const [err, setErr] = useState(null);
  const [showAutoSync, setShowAutoSync] = useState(false);
  const [interval, setIntervalMin] = useState(source.syncIntervalMinutes || 15);
  const [confirmAction, setConfirmAction] = useState(null); // null | "disconnect" | "wipe"
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!socket || !busy) return;
    const onProgress = (data) => setProgress((p) => ({ ...p, ...data }));
    const onComplete = () => {
      setBusy(null);
      setJustUpdated(true);
      setTimeout(() => setJustUpdated(false), 4000);
      onChanged?.();
    };
    socket.on("sync:progress", onProgress);
    socket.on("sync:complete", onComplete);
    return () => { socket.off("sync:progress", onProgress); socket.off("sync:complete", onComplete); };
  }, [socket, busy, onChanged]);

  const meta = sourceStatusMeta(source);
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  const doReload = async () => {
    setErr(null); setBusy("reload"); setProgress({ processed: 0, total: 0, uploadPct: 0 });
    try {
      await reloadConnectedSource(token, source.id);
      setBusy(null); setJustUpdated(true); onChanged?.();
      setTimeout(() => setJustUpdated(false), 4000);
    } catch (e) { setErr(e.message); setBusy(null); }
  };

  const doReplace = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setErr(null); setBusy("replace"); setProgress({ processed: 0, total: files.length, uploadPct: 0 });
    try {
      await replaceConnectedSourceFile(token, source.id, files, (uploadPct) => setProgress((p) => ({ ...p, uploadPct })));
      setBusy(null); setJustUpdated(true); onChanged?.();
      setTimeout(() => setJustUpdated(false), 4000);
    } catch (e) { setErr(e.message); setBusy(null); }
    finally { if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const saveAutoSync = async (autoSync, minutes) => {
    try {
      await setConnectedSourceAutoSync(token, source.id, autoSync, minutes);
      toast(autoSync ? `Auto-sync activado · cada ${minutes} min` : "Auto-sync desactivado");
      onChanged?.();
      setShowAutoSync(false);
    } catch (e) { toast(e.message, "err"); }
  };

  const doPause = async () => {
    try { await pauseConnectedSource(token, source.id); toast("Auto-sync pausado"); onChanged?.(); }
    catch (e) { toast(e.message, "err"); }
  };
  const doResume = async () => {
    try { await resumeConnectedSource(token, source.id); toast("Auto-sync reanudado"); onChanged?.(); }
    catch (e) { toast(e.message, "err"); }
  };

  const runConfirmed = async (action) => {
    setConfirmBusy(true); setConfirmError(null);
    try {
      if (action === "disconnect") {
        await deleteConnectedSource(token, source.id);
        toast("Fuente desconectada · los datos importados se conservan");
      } else {
        const res = await deleteConnectedSourceWithData(token, source.id);
        toast(`Fuente desconectada · ${res.deleted?.payrollRecords ?? 0} recibos eliminados`);
      }
      setConfirmAction(null);
      onChanged?.();
    } catch (e) {
      setConfirmError(e.message);
    } finally {
      setConfirmBusy(false);
    }
  };

  const menuItems = [
    source.autoSync
      ? { label: "Pausar auto-sync", icon: <Pause size={13} />, onClick: doPause }
      : { label: "Reanudar auto-sync", icon: <Play size={13} />, onClick: doResume },
    { label: "Desconectar", icon: <Unplug size={13} />, onClick: () => setConfirmAction("disconnect") },
    { label: "Desconectar y limpiar datos", icon: <Trash2 size={13} />, danger: true, onClick: () => setConfirmAction("wipe") },
  ];

  return (
    <div className="glass" style={{ padding: "16px 20px", borderLeft: `3px solid ${meta.color}`, marginBottom: 12 }}>
      <div className="row" style={{ gap: 9, marginBottom: 8 }}>
        <span className="dot" style={{ background: meta.color }} />
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", color: meta.color }}>{meta.label}</span>
        <span className="chip">{SOURCE_TYPE_LABEL[source.type] || source.type}</span>
        <div style={{ marginLeft: "auto" }}><DropdownMenu items={menuItems} /></div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{source.fileName}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Última lectura: {timeAgo(source.lastReadAt)}</div>
      <div className="mono muted2" style={{ fontSize: 11, marginBottom: 12 }}>Checksum: {source.checksum.slice(0, 8)}…</div>
      {source.lastError && <div style={{ color: "var(--rose)", fontSize: 11.5, marginBottom: 10 }}>{source.lastError}</div>}

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button className="btn btn-sm" disabled={!!busy} onClick={doReload}>
          <RefreshCw size={12} />
          {busy === "reload" ? `Recargando… ${pct}%` : justUpdated ? "✓ Actualizado hace 0 min" : "Recargar ahora"}
        </button>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => fileInputRef.current?.click()}>
          <Upload size={12} />
          {busy === "replace" ? `Subiendo… ${progress.uploadPct ?? 0}%` : "Reemplazar archivo"}
        </button>
        <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => doReplace(e.target.files)} />
      </div>
      {err && <div style={{ color: "var(--rose)", fontSize: 11.5, marginBottom: 10 }}>{err}</div>}

      <div className="row" style={{ gap: 8, fontSize: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <span className="muted">Auto-sync: {source.autoSync ? `cada ${source.syncIntervalMinutes} min` : "desactivado"}</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowAutoSync((v) => !v)}>Configurar</button>
      </div>
      {showAutoSync && (
        <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
          <select className="select" style={{ width: 130 }} value={interval} onChange={(e) => setIntervalMin(+e.target.value)}>
            {AUTO_SYNC_INTERVALS.map((m) => <option key={m} value={m}>cada {m} min</option>)}
          </select>
          {source.autoSync
            ? <button className="btn btn-sm" onClick={() => saveAutoSync(false, interval)}>Desactivar</button>
            : <button className="btn btn-sm btn-accent" onClick={() => saveAutoSync(true, interval)}>Activar</button>}
        </div>
      )}

      <AgentStatusBadge agentStatus={agentStatus} token={token} tenantId={tenantId} />

      {confirmAction === "disconnect" && (
        <ConfirmModal
          title="Desconectar fuente" tone="warn" confirmLabel="Desconectar"
          message="¿Desconectar esta fuente? Los datos importados permanecen en el sistema."
          busy={confirmBusy} error={confirmError}
          onCancel={() => { setConfirmAction(null); setConfirmError(null); }}
          onConfirm={() => runConfirmed("disconnect")}
        />
      )}
      {confirmAction === "wipe" && (
        <ConfirmModal
          title="Desconectar y limpiar datos" tone="danger" confirmLabel="Sí, borrar todo"
          message="⚠️ Esto eliminará todos los recibos importados desde este archivo. ¿Continuar?"
          busy={confirmBusy} error={confirmError}
          onCancel={() => { setConfirmAction(null); setConfirmError(null); }}
          onConfirm={() => runConfirmed("wipe")}
        />
      )}
    </div>
  );
}

// Heartbeat del agente es por-tenant (no por-source) — se pide una sola vez
// aquí y se pasa a cada card, en vez de que cada card lo pida por su cuenta.
function useAgentStatus(token, tenantId) {
  const [status, setStatus] = useState({ status: "loading" });
  useEffect(() => {
    if (!token || !tenantId) return;
    let cancelled = false;
    const load = () => {
      fetchAgentStatus(token, tenantId)
        .then((data) => { if (!cancelled) setStatus(data); })
        .catch(() => { if (!cancelled) setStatus({ status: "OFFLINE" }); });
    };
    load();
    const interval = setInterval(load, 20000); // heartbeat TTL es 90s, 20s alcanza para verse "en vivo"
    return () => { cancelled = true; clearInterval(interval); };
  }, [token, tenantId]);
  return status;
}

function AgentStatusBadge({ agentStatus, token, tenantId }) {
  const [downloading, setDownloading] = useState(false);

  const doDownload = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await downloadAgentZip(token, tenantId);
      downloadBlobFile(filename, blob);
    } catch (e) {
      toast(e.message, "no");
    } finally {
      setDownloading(false);
    }
  };

  if (!agentStatus || agentStatus.status === "loading") return null;

  const isActive = agentStatus.status === "ACTIVE";
  const isWebSocket = agentStatus.mode === "websocket";
  const color = isActive ? "var(--emerald)" : "var(--amber)";
  const paths = agentStatus.watchedPaths?.join(", ") || agentStatus.sourceType || null;

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
      <div className="row" style={{ gap: 8 }}>
        <span className={`dot ${isActive ? "live" : ""}`} style={{ background: color }} />
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color }}>
          {isActive ? `CONECTADO${isWebSocket ? " · WebSocket" : ""}` : "AGENTE SIN CONEXIÓN"}
        </span>
      </div>
      {isActive ? (
        <div className="muted2" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
          Agente v{agentStatus.agentVersion || agentStatus.version || "0.1"}{agentStatus.os ? ` · ${agentStatus.os}` : ""}{paths ? ` · monitoreando ${paths}` : ""}
          <br />
          {isWebSocket ? (
            <>Latencia estimada: {"<"} 1 segundo · Modo: Delta sync · Solo cambios</>
          ) : (
            <>Modo: Archivo completo · Sync manual</>
          )}
          <br />Última verificación: hace {agentStatus.ageSeconds ?? 0}s
          {isWebSocket && agentStatus.deltaCount != null && (
            <><br />Últimas ~24h: {agentStatus.deltaCount} deltas procesados</>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-sm" disabled={downloading} onClick={doDownload}>
            <Download size={12} />{downloading ? "Descargando…" : "Descargar agente"}
          </button>
        </div>
      )}
    </div>
  );
}

function ConnectedSourcesPanel({ token, socket, refreshKey, onChanged, tenantId }) {
  const sources = useConnectedSources(token, refreshKey);
  const agentStatus = useAgentStatus(token, tenantId);

  // Otra pestaña/admin puede pausar/reanudar/desconectar una fuente — nos
  // refrescamos solos en vez de mostrar un estado obsoleto.
  useEffect(() => {
    if (!socket) return;
    const onChangedEvt = () => sources.reload();
    socket.on("connectors:changed", onChangedEvt);
    return () => socket.off("connectors:changed", onChangedEvt);
  }, [socket, sources.reload]);

  if (sources.status === "loading") {
    return <div className="muted" style={{ fontSize: 12 }}>Cargando conexiones…</div>;
  }
  if (sources.data.length === 0) {
    return (
      <div className="glass" style={{ padding: 18, borderLeft: "3px solid var(--muted-2)" }}>
        <Eyebrow>Archivo conectado</Eyebrow>
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Aún no hay ninguna conexión activa. Conecta un archivo abajo para empezar.</div>
      </div>
    );
  }
  return (
    <div>
      {sources.data.map((s) => (
        <ConnectedSourceCard
          key={s.id} token={token} socket={socket} source={s} tenantId={tenantId} agentStatus={agentStatus}
          onChanged={() => { sources.reload(); onChanged?.(); }}
        />
      ))}
    </div>
  );
}

/* ============================================================
   WHATSAPP — notificaciones + agente consultivo
   ============================================================ */

const WHATSAPP_QUERY_EXAMPLES = [
  "¿Cuántos empleados activos tengo?",
  "¿Quién faltó hoy?",
  "¿Cuánto me cuesta la nómina?",
  "¿Qué solicitudes tengo pendientes?",
  "¿Hay contratos por vencer?",
  "¿Cuántos incapacitados?",
  "¿Quién tiene cursos vencidos?",
];

const WHATSAPP_NOTIF_LABELS = [
  ["solicitudes",  "Solicitudes aprobadas o rechazadas"],
  ["nomina",       "Nómina sincronizada"],
  ["salud",        "Alertas de salud"],
  ["capacitacion", "Cursos obligatorios pendientes"],
  ["seguridad",    "Alertas de seguridad ocupacional (Radar)"],
];

function WhatsAppConnectionCard({ settings, onSaved }) {
  const [instanceId, setInstanceId] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const webhookUrl = `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/webhook/whatsapp`;

  const copyUrl = () => {
    navigator.clipboard?.writeText(webhookUrl);
    toast("URL copiada");
  };

  const activar = async () => {
    if (!instanceId.trim() || !tokenInput.trim()) return;
    setBusy(true);
    try {
      await onSaved({ instanceId: instanceId.trim(), token: tokenInput.trim() });
      setInstanceId(""); setTokenInput("");
      toast("Conexión activada");
    } catch (err) {
      toast(err.message, "no");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Notificaciones WhatsApp</div>
      <div className="row" style={{ gap: 7, marginBottom: 16 }}>
        <span className="dot live" style={{ background: settings.connected ? "var(--emerald)" : "var(--muted-2)" }} />
        <span style={{ fontSize: 12.5 }}>{settings.connected ? "Conexión activa · Verificada" : "Sin conexión activa"}</span>
      </div>

      <label className="fld">URL de integración</label>
      <div className="row glass-2" style={{ padding: "8px 10px", marginBottom: 14, gap: 8 }}>
        <span className="mono" style={{ fontSize: 11.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{webhookUrl}</span>
        <button className="btn btn-sm" onClick={copyUrl}><Copy size={11} />Copiar</button>
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="fld">Clave de instancia</label>
          <input className="input" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} placeholder={settings.instanceIdMasked || "Clave de instancia"} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="fld">Token de acceso</label>
          <input className="input" type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="Token de acceso" />
        </div>
      </div>
      <button className="btn btn-accent" disabled={!instanceId.trim() || !tokenInput.trim() || busy} onClick={activar}>
        {busy ? "Activando…" : "Activar conexión"}
      </button>
    </div>
  );
}

function WhatsAppPhoneCard({ profile, onSaved }) {
  const [phone, setPhone] = useState((profile.phone || "").replace(/^\+?52/, ""));
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return;
    setBusy(true);
    try {
      await onSaved(`+52${digits}`);
      toast("Número guardado");
    } catch (err) {
      toast(err.message, "no");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Mi número de WhatsApp</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Las notificaciones llegarán a este número</div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <span className="glass-2" style={{ padding: "9px 12px", fontSize: 13 }}>+52</span>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 dígitos" style={{ flex: 1 }} />
      </div>
      <button className="btn btn-accent" disabled={phone.replace(/\D/g, "").length < 10 || busy} onClick={guardar}>
        {busy ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}

function WhatsAppNotificationsCard({ settings, onToggle }) {
  return (
    <div className="glass" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Notificaciones activas</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {WHATSAPP_NOTIF_LABELS.map(([key, label]) => (
          <label key={key} className="row" style={{ gap: 9, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={!!settings.settings?.[key]} onChange={(e) => onToggle(key, e.target.checked)} />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function WhatsAppAgentTestCard({ token }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const probar = async () => {
    if (!message.trim() || busy) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await simulateWhatsAppAgent(token, message.trim());
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Consulta tu plantilla por WhatsApp</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>
        Cuando la conexión esté activa, envía un mensaje de WhatsApp y el agente responderá con datos reales de tu sistema.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
        {WHATSAPP_QUERY_EXAMPLES.map((q) => (
          <span key={q} className="chip" style={{ cursor: "pointer" }} onClick={() => setMessage(q)}>{q}</span>
        ))}
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 14 }}>
        <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Escribe una consulta…" style={{ flex: 1 }}
          onKeyDown={(e) => e.key === "Enter" && probar()} />
        <button className="btn btn-accent" disabled={!message.trim() || busy} onClick={probar}>
          {busy ? "Consultando…" : "Probar agente"}
        </button>
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--rose)", marginBottom: 10 }}>{error}</div>}

      {result && (
        <>
          <div className="glass-2" style={{ padding: 14, background: "rgba(79,214,163,.06)", borderColor: "rgba(79,214,163,.25)" }}>
            <div className="row" style={{ gap: 7, marginBottom: 8 }}>
              <Bot size={14} color="var(--emerald)" />
              <span style={{ fontWeight: 600, fontSize: 12.5 }}>Agente CÓDICE</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{result.response}</div>
            <div style={{ textAlign: "right", marginTop: 8, fontSize: 11, color: "var(--cyan)" }}>✓✓</div>
          </div>
          <div className="muted2" style={{ fontSize: 11, marginTop: 8 }}>Consulta: {result.intent}</div>
        </>
      )}
    </div>
  );
}

function WhatsAppActivityCard({ token, refreshKey }) {
  const [state, setState] = useState({ status: "loading", data: [] });
  useEffect(() => {
    if (!token) return;
    fetchWhatsAppMockLog(token)
      .then(({ data }) => setState({ status: "ready", data: data || [] }))
      .catch((e) => setState({ status: "error", data: [], error: e.message }));
  }, [token, refreshKey]);

  return (
    <div className="glass" style={{ padding: 18 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Registro de actividad</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>Últimas notificaciones enviadas</div>
      {state.status === "loading" && <div className="muted" style={{ fontSize: 12.5 }}>Cargando…</div>}
      {state.status === "ready" && state.data.length === 0 && (
        <div className="muted" style={{ fontSize: 12.5 }}>Sin actividad registrada aún</div>
      )}
      {state.data.map((entry, i) => (
        <div key={i} className="glass-2 row" style={{ padding: "9px 12px", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
          <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.message}</span>
          <span className="muted2 mono" style={{ fontSize: 10.5, flexShrink: 0 }}>{fmtDateShort(entry.ts)}</span>
        </div>
      ))}
    </div>
  );
}

function WhatsAppPage({ token }) {
  const [settings, setSettings] = useState({ status: "loading" });
  const [profile, setProfile] = useState({ status: "loading" });
  const [logKey, setLogKey] = useState(0);

  const reloadSettings = useCallback(() => {
    fetchWhatsAppSettings(token).then((data) => setSettings({ status: "ready", ...data })).catch((e) => setSettings({ status: "error", error: e.message }));
  }, [token]);
  const reloadProfile = useCallback(() => {
    fetchAdminProfile(token).then((data) => setProfile({ status: "ready", ...data })).catch((e) => setProfile({ status: "error", error: e.message }));
  }, [token]);

  useEffect(() => { reloadSettings(); reloadProfile(); }, [reloadSettings, reloadProfile]);

  const saveConnection = async ({ instanceId, token: instanceToken }) => {
    await updateWhatsAppSettings(token, { instanceId, token: instanceToken });
    reloadSettings();
  };
  const savePhone = async (phone) => {
    await updateAdminProfile(token, { phone });
    reloadProfile();
  };
  const toggleNotif = async (key, value) => {
    await updateWhatsAppSettings(token, { settings: { [key]: value } });
    reloadSettings();
    setLogKey((k) => k + 1);
  };

  if (settings.status === "loading" || profile.status === "loading") {
    return <div className="fadein muted" style={{ fontSize: 13, padding: "20px 0" }}>Cargando…</div>;
  }

  return (
    <div className="fadein">
      <Eyebrow>Integraciones</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 6px" }}>Notificaciones y Agente Consultivo</h1>
      <div className="muted" style={{ fontSize: 13, marginBottom: 22, maxWidth: 640 }}>
        Recibe avisos automáticos y consulta tu plantilla directamente desde WhatsApp.
      </div>

      <WhatsAppConnectionCard settings={settings} onSaved={saveConnection} />
      <WhatsAppPhoneCard profile={profile} onSaved={savePhone} />
      <WhatsAppNotificationsCard settings={settings} onToggle={toggleNotif} />
      <WhatsAppAgentTestCard token={token} />
      <WhatsAppActivityCard token={token} refreshKey={logKey} />
    </div>
  );
}

function StorageWarningBanner({ token }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    fetchStorageStatus(token).then(setStatus).catch(() => {});
  }, [token]);
  if (!status || status.r2Configured) return null;
  return (
    <div className="warnbox" style={{ marginBottom: 18 }}>
      <div className="row" style={{ gap: 9 }}>
        <AlertTriangle size={15} style={{ color: "var(--amber)" }} />
        <span style={{ fontSize: 12.5 }}>{status.warning}</span>
      </div>
    </div>
  );
}

function NdaDownloadButton({ token }) {
  const [busy, setBusy] = useState(false);
  const descargar = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await downloadNdaPreview(token);
      downloadBlobFile(filename, blob);
    } catch (err) {
      toast(err.message, "no");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn-sm" disabled={busy} onClick={descargar}>
      <Download size={12} />{busy ? "Generando…" : "Descargar NDA de piloto"}
    </button>
  );
}

function Conectores({ token, socket, tenantId }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeMode, setActiveMode] = useState(null); // null | "A" | "B" | "C"
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="fadein">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div>
          <Eyebrow>Integraciones de nómina</Eyebrow>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 0" }}>Integraciones de nómina</h1>
        </div>
        <NdaDownloadButton token={token} />
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 18, maxWidth: 640 }}>
        Conecta CÓDICE con tu sistema de nómina actual. Sin reemplazarlo. Sin migrar datos manualmente.
      </div>

      <StorageWarningBanner token={token} />

      <ConnectedSourcesPanel token={token} socket={socket} refreshKey={refreshKey} onChanged={bump} tenantId={tenantId} />

      <div style={{ marginTop: 30 }}>
        <Eyebrow>Modo de conexión</Eyebrow>
        <div className="muted" style={{ fontSize: 12.5, margin: "4px 0 16px" }}>Selecciona el método que corresponde a tu infraestructura actual</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {CONNECTION_MODES.map((m) => (
            <ModeCard key={m.id} mode={m} selected={activeMode === m.id} onSelect={() => setActiveMode(m.id)} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <HistorialSync token={token} refreshKey={refreshKey} />
      </div>

      {activeMode === "A" && <ModoAWizard token={token} socket={socket} onClose={() => setActiveMode(null)} onImported={bump} />}
      {activeMode === "B" && <ModoBPanel onClose={() => setActiveMode(null)} />}
      {activeMode === "C" && <ModoCPanel onClose={() => setActiveMode(null)} />}
    </div>
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
function VacationPolicyPanel({ token }) {
  const [policy, setPolicy] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    fetchVacationPolicy(token).then(setPolicy).catch((e) => setError(e.message));
  }, [token]);
  useEffect(() => { reload(); }, [reload]);

  const set = (k) => (e) => setPolicy((p) => ({ ...p, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value }));

  const guardar = async () => {
    setBusy(true); setError(null);
    try {
      const saved = await updateVacationPolicy(token, {
        year_1_days: policy.year_1_days, year_2_days: policy.year_2_days, year_3_days: policy.year_3_days,
        year_4_days: policy.year_4_days, year_5_days: policy.year_5_days,
        additional_days_per_5_years: policy.additional_days_per_5_years,
        max_days: policy.max_days, notes: policy.notes,
      });
      setPolicy(saved);
      toast("Política de vacaciones guardada.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!policy) return <div className="muted" style={{ fontSize: 13, padding: "20px 0" }}>Cargando política…</div>;

  return (
    <div className="glass" style={{ padding: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <Eyebrow>Política de Vacaciones</Eyebrow>
        <span className="chip" style={{ color: policy.compliant ? "var(--emerald)" : "var(--rose)" }}>
          {policy.compliant ? "Cumple con LFT 2026 ✅" : "⚠️ Revisar — por debajo del mínimo legal"}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>Tu política debe ser igual o superior a la LFT 2026</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div><label className="fld">Año 1 (mín. 12 por LFT)</label><input className="input" type="number" value={policy.year_1_days} onChange={set("year_1_days")} /></div>
        <div><label className="fld">Año 2 (mín. 14)</label><input className="input" type="number" value={policy.year_2_days} onChange={set("year_2_days")} /></div>
        <div><label className="fld">Año 3 (mín. 16)</label><input className="input" type="number" value={policy.year_3_days} onChange={set("year_3_days")} /></div>
        <div><label className="fld">Año 4 (mín. 18)</label><input className="input" type="number" value={policy.year_4_days} onChange={set("year_4_days")} /></div>
        <div><label className="fld">Año 5+ (mín. 20)</label><input className="input" type="number" value={policy.year_5_days} onChange={set("year_5_days")} /></div>
        <div><label className="fld">Días adicionales cada 5 años</label><input className="input" type="number" value={policy.additional_days_per_5_years} onChange={set("additional_days_per_5_years")} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label className="fld">Días máximos acumulables</label><input className="input" type="number" value={policy.max_days} onChange={set("max_days")} /></div>
      </div>
      <label className="fld">Notas internas</label>
      <textarea className="input" rows={3} value={policy.notes || ""} onChange={set("notes")} style={{ marginBottom: 14, resize: "vertical" }} />

      {error && <div style={{ fontSize: 12.5, color: "var(--rose)", marginBottom: 12 }}>{error}</div>}
      <button className="btn btn-accent" disabled={busy} onClick={guardar}>{busy ? "Guardando…" : "Guardar política"}</button>
    </div>
  );
}

/* ============================================================
   CÓDICE RADAR — Occupational Risk Intelligence System
   ============================================================ */

const RADAR_URGENCY_COLOR = { alta: "var(--rose)", media: "var(--amber)", baja: "var(--cyan)" };
const RADAR_URGENCY_LABEL = { alta: "🔴 ALTA", media: "🟡 MEDIA", baja: "🔵 BAJA" };
const EXAMEN_OPCIONES = ["trimestral", "cuatrimestral", "semestral", "anual"];

function nextMonday7am(from) {
  const d = new Date(from || Date.now());
  const day = d.getDay();
  let add = (1 - day + 7) % 7;
  if (add === 0 && d.getHours() >= 7) add = 7;
  d.setDate(d.getDate() + add);
  d.setHours(7, 0, 0, 0);
  return d;
}
function fmtRadarDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  const dia = dt.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const hora = dt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return `${dia} · ${hora}`;
}

function deptComplianceScore(profile) {
  if (!profile) return { score: 0, status: "sin_configurar" };
  const po = profile.perfil_optimo || {};
  let pts = 0;
  if (po.examenRequerido) pts += 25;
  if (Array.isArray(po.condicionesIncompatibles) && po.condicionesIncompatibles.length) pts += 15;
  if (Array.isArray(profile.riesgos_ocupacionales) && profile.riesgos_ocupacionales.length) pts += 30;
  if (Array.isArray(profile.fuentes_normativas) && profile.fuentes_normativas.length) pts += 15;
  const revisionRecent = profile.ultima_revision && (Date.now() - new Date(profile.ultima_revision).getTime()) < 1000 * 60 * 60 * 24 * 180;
  if (revisionRecent) pts += 15;
  let status = "sin_configurar";
  if (pts >= 30) status = "pendiente";
  if (pts >= 80) status = "completo";
  return { score: pts, status };
}

function RadarStatusBar({ generatedAt, onRefresh, busy }) {
  const next = nextMonday7am(generatedAt ? new Date(generatedAt) : new Date());
  return (
    <div className="glass" style={{ padding: 16, marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
      <div>
        <div style={{ fontSize: 13 }}>
          <RefreshCw size={13} className={busy ? "spin" : ""} style={{ marginRight: 7, verticalAlign: -2 }} />
          Última actualización: <b>{generatedAt ? fmtRadarDate(generatedAt) : "aún no se ha corrido"}</b>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>Próxima revisión: {fmtRadarDate(next)}</div>
        <div className="muted2" style={{ fontSize: 11, marginTop: 5 }}>Fuentes verificadas: DOF · STPS · IMSS · OMS</div>
      </div>
      <button className="btn btn-accent" disabled={busy} onClick={onRefresh}>
        <RefreshCw size={14} className={busy ? "spin" : ""} />{busy ? "Actualizando…" : "Actualizar ahora"}
      </button>
    </div>
  );
}

function RadarAlertCard({ item, reviewed, onToggleReviewed }) {
  const color = RADAR_URGENCY_COLOR[item.urgencia] || "var(--cyan)";
  return (
    <div className="glass" style={{ padding: 16, marginBottom: 12, borderLeft: `3px solid ${color}`, opacity: reviewed ? 0.55 : 1 }}>
      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="chip" style={{ color }}>{RADAR_URGENCY_LABEL[item.urgencia] || item.urgencia}{item.norma ? ` · ${item.norma}` : ""}</span>
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 5 }}>{item.titulo}</div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 10 }}>{item.resumen}</div>
      {item.aplicaA?.length > 0 && (
        <div className="muted2" style={{ fontSize: 11.5, marginBottom: 10 }}>Aplica a: {item.aplicaA.join(" · ")}</div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {item.url && (
          <a className="btn btn-sm" href={item.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <ExternalLink size={12} />Ver fuente oficial →
          </a>
        )}
        <button className="btn btn-sm" onClick={onToggleReviewed}>
          {reviewed ? <Check size={12} /> : null}{reviewed ? "Revisado" : "Marcar como revisado"}
        </button>
      </div>
    </div>
  );
}

function DeptRiskAccordion({ token, department, profile, onSaved }) {
  const [open, setOpen] = useState(false);
  const blank = { edadMin: "", edadMax: "", examenRequerido: "anual", condicionesIncompatibles: [] };
  const [perfil, setPerfil] = useState(() => ({ ...blank, ...(profile?.perfil_optimo || {}) }));
  const [riesgos, setRiesgos] = useState(profile?.riesgos_ocupacionales || []);
  const [condInput, setCondInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [accForm, setAccForm] = useState({ fecha: todayISO, tipo: "", severidad: "leve", descripcion: "" });
  const [accBusy, setAccBusy] = useState(false);

  useEffect(() => {
    setPerfil({ ...blank, ...(profile?.perfil_optimo || {}) });
    setRiesgos(profile?.riesgos_ocupacionales || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, profile]);

  const historial = profile?.historial_accidentes || [];
  const fuentes = profile?.fuentes_normativas || [];
  const { score, status } = deptComplianceScore(profile);

  const addRiesgo = () => setRiesgos((r) => [...r, { nombre: "", frecuencia: "Media" }]);
  const setRiesgo = (i, field, val) => setRiesgos((r) => r.map((x, j) => (j === i ? { ...x, [field]: val } : x)));
  const delRiesgo = (i) => setRiesgos((r) => r.filter((_, j) => j !== i));
  const addCondicion = () => {
    const v = condInput.trim();
    if (!v) return;
    setPerfil((p) => ({ ...p, condicionesIncompatibles: [...(p.condicionesIncompatibles || []), v] }));
    setCondInput("");
  };
  const delCondicion = (i) => setPerfil((p) => ({ ...p, condicionesIncompatibles: p.condicionesIncompatibles.filter((_, j) => j !== i) }));

  const guardar = async () => {
    setBusy(true); setError(null);
    try {
      const saved = await updateDeptRiskProfile(token, department, {
        perfilOptimo: perfil,
        riesgosOcupacionales: riesgos,
      });
      onSaved(saved);
      toast(`Perfil de riesgo guardado · ${department}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const registrarAccidente = async () => {
    if (!accForm.tipo || !accForm.descripcion) { setError("Tipo y descripción son obligatorios"); return; }
    setAccBusy(true); setError(null);
    try {
      const saved = await logDeptAccidente(token, department, accForm);
      onSaved(saved);
      setAccForm({ fecha: todayISO, tipo: "", severidad: "leve", descripcion: "" });
      toast("Accidente registrado");
    } catch (e) {
      setError(e.message);
    } finally {
      setAccBusy(false);
    }
  };

  const STATUS_BADGE = {
    completo:        { icon: "✅", label: "Completo", color: "var(--emerald)" },
    pendiente:       { icon: "⚠️", label: "Pendiente revisión", color: "var(--amber)" },
    sin_configurar:  { icon: "🔴", label: "Sin configurar", color: "var(--rose)" },
  }[status];

  return (
    <div className="glass" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
      <div className="row" style={{ padding: "14px 16px", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <div className="row" style={{ gap: 10 }}>
          <ChevronDown size={16} style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .15s", color: "var(--muted2)" }} />
          <span style={{ fontWeight: 700, fontSize: 13.5, textTransform: "uppercase", letterSpacing: ".02em" }}>{department}</span>
        </div>
        <span className="chip" style={{ color: STATUS_BADGE.color }}>{STATUS_BADGE.icon} {STATUS_BADGE.label} · {score}</span>
      </div>

      {open && (
        <div style={{ padding: "4px 16px 18px", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 12, margin: "14px 0 8px", color: "var(--muted)" }}>PERFIL ÓPTIMO DEL PUESTO</div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ flex: "1 1 120px" }}>
              <label className="fld">Edad recomendada — mín.</label>
              <input className="input" type="number" value={perfil.edadMin} onChange={(e) => setPerfil((p) => ({ ...p, edadMin: e.target.value === "" ? "" : Number(e.target.value) }))} />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label className="fld">Edad recomendada — máx.</label>
              <input className="input" type="number" value={perfil.edadMax} onChange={(e) => setPerfil((p) => ({ ...p, edadMax: e.target.value === "" ? "" : Number(e.target.value) }))} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label className="fld">Examen médico</label>
              <select className="select" value={perfil.examenRequerido} onChange={(e) => setPerfil((p) => ({ ...p, examenRequerido: e.target.value }))}>
                {EXAMEN_OPCIONES.map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <label className="fld">Condiciones incompatibles</label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {(perfil.condicionesIncompatibles || []).map((c, i) => (
              <span key={i} className="chip" style={{ color: "var(--rose)" }}>{c}<X size={11} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => delCondicion(i)} /></span>
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginBottom: 18 }}>
            <input className="input" placeholder="Ej. hernias_sin_operar" value={condInput} onChange={(e) => setCondInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCondicion())} />
            <button className="btn btn-sm" onClick={addCondicion}><Plus size={12} />Agregar</button>
          </div>

          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "var(--muted)" }}>RIESGOS OCUPACIONALES</div>
          </div>
          {riesgos.map((r, i) => (
            <div key={i} className="row" style={{ gap: 8, marginTop: 8 }}>
              <input className="input" style={{ flex: 1 }} value={r.nombre} onChange={(e) => setRiesgo(i, "nombre", e.target.value)} placeholder="Nombre del riesgo" />
              <select className="select" style={{ width: 110 }} value={r.frecuencia} onChange={(e) => setRiesgo(i, "frecuencia", e.target.value)}>
                <option>Alta</option><option>Media</option><option>Baja</option>
              </select>
              <X size={15} style={{ cursor: "pointer", color: "var(--muted2)" }} onClick={() => delRiesgo(i)} />
            </div>
          ))}
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={addRiesgo}><Plus size={12} />Agregar riesgo</button>

          <div style={{ fontWeight: 600, fontSize: 12, margin: "20px 0 8px", color: "var(--muted)" }}>HISTORIAL DE ACCIDENTES</div>
          {historial.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Sin accidentes registrados.</div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              {[...historial].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map((a) => (
                <div key={a.id} className="row" style={{ gap: 8, fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span className="mono muted2">{a.fecha}</span>
                  <span className="chip" style={{ color: a.severidad === "grave" ? "var(--rose)" : a.severidad === "moderado" ? "var(--amber)" : "var(--muted)" }}>{a.severidad}</span>
                  <span style={{ fontWeight: 500 }}>{a.tipo}</span>
                  <span className="muted" style={{ flex: 1 }}>{a.descripcion}</span>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="input" type="date" style={{ width: 140 }} value={accForm.fecha} onChange={(e) => setAccForm((f) => ({ ...f, fecha: e.target.value }))} />
            <input className="input" style={{ flex: "1 1 140px" }} placeholder="Tipo (ej. caída, corte)" value={accForm.tipo} onChange={(e) => setAccForm((f) => ({ ...f, tipo: e.target.value }))} />
            <select className="select" style={{ width: 110 }} value={accForm.severidad} onChange={(e) => setAccForm((f) => ({ ...f, severidad: e.target.value }))}>
              <option value="leve">Leve</option><option value="moderado">Moderado</option><option value="grave">Grave</option>
            </select>
            <input className="input" style={{ flex: "2 1 200px" }} placeholder="Descripción" value={accForm.descripcion} onChange={(e) => setAccForm((f) => ({ ...f, descripcion: e.target.value }))} />
            <button className="btn btn-sm" disabled={accBusy} onClick={registrarAccidente}><Plus size={12} />Registrar accidente</button>
          </div>

          <div style={{ fontWeight: 600, fontSize: 12, margin: "20px 0 8px", color: "var(--muted)" }}>FUENTES NORMATIVAS</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {fuentes.length === 0
              ? <span className="muted" style={{ fontSize: 12.5 }}>Sin normas asociadas todavía.</span>
              : fuentes.map((n, i) => (
                <a key={i} href={n.url} target="_blank" rel="noreferrer" className="chip" style={{ color: "var(--cyan)", textDecoration: "none" }}>
                  <Tag size={10} />{n.clave}
                </a>
              ))}
          </div>

          {error && <div style={{ fontSize: 12.5, color: "var(--rose)", marginBottom: 10 }}>{error}</div>}
          <button className="btn btn-accent" disabled={busy} onClick={guardar}>{busy ? "Guardando…" : "Guardar cambios para este departamento"}</button>
          <div className="muted2" style={{ fontSize: 11, marginTop: 10 }}>
            Última revisión: {profile?.ultima_revision ? fmtDate2(profile.ultima_revision) : "—"}{profile?.updated_by ? ` por ${profile.updated_by}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate2(d) {
  return new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function RadarPage({ staff, token }) {
  const [digest, setDigest] = useState({ status: "loading", data: null });
  const [profiles, setProfiles] = useState({ status: "loading", byDept: {} });
  const [refreshing, setRefreshing] = useState(false);
  const [reviewed, setReviewed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("codice_radar_reviewed") || "[]")); } catch { return new Set(); }
  });

  const loadDigest = useCallback(() => {
    fetchRadarLatest(token).then((d) => setDigest({ status: "ready", data: d })).catch((e) => setDigest({ status: "error", data: null, error: e.message }));
  }, [token]);
  const loadProfiles = useCallback(() => {
    fetchDeptRiskProfiles(token)
      .then((d) => setProfiles({ status: "ready", byDept: Object.fromEntries((d.departments || []).map((p) => [p.department, p])) }))
      .catch((e) => setProfiles({ status: "error", byDept: {}, error: e.message }));
  }, [token]);

  useEffect(() => { loadDigest(); loadProfiles(); }, [loadDigest, loadProfiles]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const d = await refreshRadar(token);
      setDigest({ status: "ready", data: d });
      toast("Radar actualizado");
    } catch (e) {
      toast(e.message, "no");
    } finally {
      setRefreshing(false);
    }
  };

  const toggleReviewed = (key) => {
    setReviewed((r) => {
      const next = new Set(r);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem("codice_radar_reviewed", JSON.stringify([...next]));
      return next;
    });
  };

  const departments = useMemo(() => {
    const fromStaff = [...new Set(staff.map((s) => s.depto).filter(Boolean))];
    const fromProfiles = Object.keys(profiles.byDept);
    return [...new Set([...fromProfiles, ...fromStaff])].sort();
  }, [staff, profiles.byDept]);

  const items = digest.data?.items || [];
  const sortedItems = [...items].sort((a, b) => {
    const order = { alta: 0, media: 1, baja: 2 };
    return (order[a.urgencia] ?? 3) - (order[b.urgencia] ?? 3);
  });

  return (
    <div className="fadein">
      <Eyebrow>Cumplimiento · normativo y de industria</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 4px" }}>Radar de Seguridad Ocupacional</h1>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>Actualizado cada lunes · Fuentes: STPS, IMSS, DOF, OMS</div>

      <RadarStatusBar generatedAt={digest.data?.generatedAt} onRefresh={doRefresh} busy={refreshing} />

      {digest.status === "loading" && <div className="muted" style={{ padding: 18 }}>Cargando radar…</div>}
      {digest.status === "ready" && sortedItems.length === 0 && (
        <div className="glass" style={{ padding: 20, textAlign: "center", marginBottom: 20 }}>
          ✅ Sin alertas críticas esta semana. Tu operación cumple con la normativa vigente.
        </div>
      )}
      {digest.status === "ready" && sortedItems.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {sortedItems.map((item, i) => {
            const key = `${item.titulo}::${item.norma || ""}`;
            return <RadarAlertCard key={key + i} item={item} reviewed={reviewed.has(key)} onToggleReviewed={() => toggleReviewed(key)} />;
          })}
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "24px 0 10px" }}>Perfiles de riesgo por departamento</h2>
      {profiles.status === "loading" && <div className="muted" style={{ padding: 12 }}>Cargando perfiles…</div>}
      {profiles.status === "error" && <div className="muted" style={{ padding: 12, color: "var(--rose)" }}>No se pudieron cargar los perfiles de riesgo ({profiles.error}).</div>}
      {profiles.status === "ready" && departments.map((dept) => (
        <DeptRiskAccordion
          key={dept} token={token} department={dept} profile={profiles.byDept[dept]}
          onSaved={(saved) => setProfiles((p) => ({ ...p, byDept: { ...p.byDept, [dept]: saved } }))}
        />
      ))}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "24px 0 10px" }}>Score de cumplimiento por departamento</h2>
      <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
        <table className="tbl">
          <thead><tr><th>Depto</th><th>Perfil configurado</th><th>Última revisión</th><th>Score</th><th>Status</th></tr></thead>
          <tbody>
            {departments.map((dept) => {
              const profile = profiles.byDept[dept];
              const { score, status } = deptComplianceScore(profile);
              const STATUS_LABEL = { completo: "✅ Completo", pendiente: "⚠️ Pendiente revisión", sin_configurar: "🔴 Sin configurar" };
              return (
                <tr key={dept} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 500 }}>{dept}</td>
                  <td className="muted">{profile ? "Sí" : "No"}</td>
                  <td className="muted">{profile?.ultima_revision ? fmtDate2(profile.ultima_revision) : "—"}</td>
                  <td className="mono">{score}</td>
                  <td>{STATUS_LABEL[status]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="muted2" style={{ fontSize: 11, marginTop: 14, fontStyle: "italic" }}>
        Referencial — no sustituye asesoría legal o médica profesional. El análisis de IA puede contener imprecisiones; verifica siempre contra la fuente oficial antes de actuar.
      </div>
    </div>
  );
}

function LFT({ token }) {
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
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}><Tab id="aguinaldo" label="Aguinaldo" /><Tab id="vacaciones" label="Vacaciones" /><Tab id="politica" label="Política de Vacaciones" /><Tab id="finiquito" label="Finiquito" /><Tab id="indemniz" label="Indemnización" /><Tab id="articulos" label="Artículos" /></div>
          {tab === "aguinaldo" && <div className="glass" style={{ padding: 20 }}><Eyebrow>Aguinaldo · Art. 87</Eyebrow><div className="kpi" style={{ fontSize: 38, color: "var(--cyan)", margin: "10px 0" }}>{mxn(c.ag)}</div><div className="muted" style={{ fontSize: 13 }}>15 días sobre salario diario de {mxn2(sd)}.</div><div className="glass-2" style={{ padding: 13, marginTop: 14 }}><KV k="Proporcional por días trabajados" v={mxn(c.agProp)} /></div><div className="muted2" style={{ fontSize: 11, marginTop: 12 }}>La propuesta de "aguinaldo digno" (30 días) sigue en discusión; aún no es ley.</div></div>}
          {tab === "vacaciones" && <div className="glass" style={{ padding: 20 }}><Eyebrow>Vacaciones · Art. 76 + Prima Art. 80</Eyebrow><div className="row" style={{ gap: 16, margin: "12px 0", flexWrap: "wrap" }}><Stat label="Días por año" value={`${c.dv}`} /><Stat label="Prima vacacional 25%" value={mxn(c.pv)} accent="var(--violet)" /></div><ResponsiveContainer width="100%" height={150}><AreaChart data={[1, 2, 3, 4, 5, 6, 10, 15].map((y) => ({ y: `${y}a`, d: diasVacaciones(y) }))}><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--cyan)" stopOpacity={.5} /><stop offset="100%" stopColor="var(--cyan)" stopOpacity={0} /></linearGradient></defs><XAxis dataKey="y" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={tipStyle} /><Area dataKey="d" stroke="var(--cyan)" fill="url(#g)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div>}
          {tab === "politica" && <VacationPolicyPanel token={token} />}
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
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [tab]);
  const jefe = solicitudes.filter((s) => s.estado === "jefe").length;
  const wkf = solicitudes.filter((s) => s.estado === "wkf").length;
  const list = tab === "activas" ? solicitudes : resueltas;
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const pageList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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
            {tab === "activas" && pageList.map((s) => (
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
            {tab === "historial" && pageList.map((s, i) => (
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
      <Pagination page={page} totalPages={totalPages} total={list.length} limit={PAGE_SIZE} onPageChange={setPage} itemLabel="solicitudes" />
      <div className="muted2" style={{ fontSize: 11, marginTop: 10 }}>Flujo: el jefe directo autoriza → pasa a Workforce para aprobación final. El colaborador ve el avance en su portal de autoservicio.</div>
    </div>
  );
}

/* ============================================================
   INDICADORES WKF — ausentismo, rotación, incapacidades
   ============================================================ */
function useRiskSummary(token) {
  const [state, setState] = useState({ status: "loading", data: null });
  const reload = useCallback(() => {
    if (!token) return;
    setState((s) => ({ ...s, status: "loading" }));
    fetchRiskSummary(token)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", data: null, error: e.message }));
  }, [token]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

const RISK_COLOR = { BAJO: "var(--emerald)", MEDIO: "var(--amber)", ALTO: "var(--rose)" };

function RiskLevelBadge({ level }) {
  return <span className="chip" style={{ color: RISK_COLOR[level] }}><span className="dot" style={{ background: RISK_COLOR[level] }} />{level}</span>;
}

function RiskNarrativeCard({ token }) {
  const [narrative, setNarrative] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error | idle
  const [generatedAt, setGeneratedAt] = useState(null);

  const generate = useCallback((refresh) => {
    setStatus("loading");
    fetchRiskNarrative(token, { refresh })
      .then(({ narrative }) => { setNarrative(narrative); setGeneratedAt(new Date()); setStatus("ready"); })
      .catch((e) => { setStatus("error"); toast(e.message, "error"); });
  }, [token]);

  useEffect(() => { if (token) generate(false); }, [token, generate]);

  return (
    <div className="glass" style={{ padding: 18, marginBottom: 16, border: "1px solid rgba(167,139,250,.28)" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}><Bot size={16} style={{ color: "var(--violet)" }} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Análisis ejecutivo · IA</span></div>
        <button className="btn btn-sm" disabled={status === "loading"} onClick={() => generate(true)}>
          <RefreshCw size={12} className={status === "loading" ? "spin" : ""} />Actualizar análisis
        </button>
      </div>
      {status === "loading" && <div className="muted" style={{ fontSize: 13 }}>Generando análisis…</div>}
      {status === "error" && <div className="muted" style={{ fontSize: 13 }}>No se pudo generar el análisis.</div>}
      {status === "ready" && (
        <>
          <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{narrative}</div>
          <div className="muted2" style={{ fontSize: 11, marginTop: 10 }}>Generado {generatedAt ? generatedAt.toLocaleDateString("es-MX") : "hoy"}</div>
        </>
      )}
    </div>
  );
}

function RiskAlertsCard({ alerts, staff, openExpediente }) {
  if (!alerts || alerts.length === 0) return null;
  return (
    <div className="glass" style={{ padding: 0, overflow: "hidden", marginBottom: 16, border: "1px solid rgba(245,181,68,.3)" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }} className="row">
        <AlertTriangle size={15} style={{ color: "var(--amber)" }} />
        <span style={{ fontWeight: 600, fontSize: 13, marginLeft: 8 }}>⚠️ {alerts.length} colaborador{alerts.length === 1 ? "" : "es"} requiere{alerts.length === 1 ? "" : "n"} atención</span>
      </div>
      <div>
        {alerts.map((a) => (
          <div key={a.employeeId} className="row" style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", justifyContent: "space-between", cursor: "pointer" }}
            onClick={() => openExpediente?.(staff.find((s) => s.dbId === a.employeeId), "salud")}>
            <div className="row" style={{ gap: 9 }}>
              <span className="chip" style={{ color: a.urgency === "alta" ? "var(--rose)" : "var(--amber)" }}>{a.urgency === "alta" ? "Urgente" : "Atención"}</span>
              <span style={{ fontWeight: 500, fontSize: 13 }}>{a.fullName}</span>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{a.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiesgoSalud({ staff, token, openExpediente }) {
  const { status, data, reload } = useRiskSummary(token);
  if (status === "loading" && !data) return <div className="muted" style={{ padding: 18 }}>Calculando riesgo de salud…</div>;
  if (status === "error" || !data) return <div className="muted" style={{ padding: 18 }}>No se pudo cargar el análisis de riesgo.</div>;

  const { summary, byDepartment, topRisk, alerts } = data;

  return (
    <div style={{ marginTop: 28 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <Eyebrow>Análisis de riesgo de salud</Eyebrow>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: "6px 0 4px" }}>ANÁLISIS DE RIESGO DE SALUD</h2>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Basado en ausentismo, incapacidades y perfil de salud</div>
        </div>
        <button className="btn btn-sm" onClick={reload}><RefreshCw size={12} />Refrescar</button>
      </div>

      <RiskNarrativeCard token={token} />
      <RiskAlertsCard alerts={alerts} staff={staff} openExpediente={openExpediente} />

      <div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Riesgo bajo" value={summary.bajo} sub={`de ${summary.total} colaboradores`} accent="var(--emerald)" />
        <Stat label="Riesgo medio" value={summary.medio} sub={`de ${summary.total} colaboradores`} accent="var(--amber)" />
        <Stat label="Riesgo alto" value={summary.alto} sub={`de ${summary.total} colaboradores`} accent="var(--rose)" />
      </div>

      <div className="glass" style={{ padding: 18, marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>Riesgo por área</span>
        <ResponsiveContainer width="100%" height={Math.max(180, byDepartment.length * 34)}>
          <BarChart data={byDepartment} layout="vertical" margin={{ left: 10, right: 20, top: 8 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="department" width={150} tick={{ fill: "var(--muted)", fontSize: 10.5 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,.04)" }} />
            <Bar dataKey="bajo" name="Bajo" stackId="risk" fill="var(--emerald)" />
            <Bar dataKey="medio" name="Medio" stackId="risk" fill="var(--amber)" />
            <Bar dataKey="alto" name="Alto" stackId="risk" fill="var(--rose)" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Colaboradores con mayor riesgo</div>
        <table className="tbl">
          <thead><tr><th>Empleado</th><th>Depto</th><th>Score</th><th>Nivel</th><th>Factores</th></tr></thead>
          <tbody>
            {topRisk.length === 0 ? (
              <tr style={{ cursor: "default" }}><td colSpan={5} className="muted" style={{ padding: 18 }}>Sin colaboradores en riesgo.</td></tr>
            ) : topRisk.map((r) => (
              <tr key={r.employeeId} onClick={() => openExpediente?.(staff.find((s) => s.dbId === r.employeeId), "salud")}>
                <td style={{ fontWeight: 500 }}>{r.fullName}</td>
                <td className="muted">{r.department}</td>
                <td style={{ minWidth: 90 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="prog" style={{ width: 60 }}><i style={{ width: `${r.score}%`, background: RISK_COLOR[r.level] }} /></div>
                    <span className="mono muted2" style={{ fontSize: 11 }}>{r.score}</span>
                  </div>
                </td>
                <td><RiskLevelBadge level={r.level} /></td>
                <td>
                  <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
                    {r.factors.map((f, i) => <span key={i} className="chip" style={{ fontSize: 10 }}>{f}</span>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="muted2" style={{ fontSize: 11, marginTop: 10, fontStyle: "italic" }}>
        Este análisis es referencial. No sustituye evaluación médica profesional.
      </div>
    </div>
  );
}

function IndicadoresWKF({ staff, token, openExpediente }) {
  const incap = staff.filter((e) => e.status === "Incapacidad");
  const permiso = staff.filter((e) => e.status === "Permiso").length;
  const ausByArea = useMemo(() => ORG.deptos.map((d) => {
    const n = staff.filter((e) => e.depto === d).length || 1;
    const aus = staff.filter((e) => e.depto === d && (e.status === "Incapacidad" || e.status === "Permiso")).length;
    return { name: d, value: +((aus / n) * 100).toFixed(1) };
  }).sort((a, b) => b.value - a.value), [staff]);
  const cur = AUSENTISMO[AUSENTISMO.length - 1];

  const summary = usePayrollSummary(token);
  const netoMap = usePayrollLatestMap(token);
  const staffByDbId = useMemo(() => Object.fromEntries(staff.map((s) => [s.dbId, s])), [staff]);

  const costoPromedio = summary.data && summary.data.employeeCount > 0 ? summary.data.totalNeto / summary.data.employeeCount : null;
  const pctDeducciones = summary.data && summary.data.totalPercepciones > 0 ? (summary.data.totalDeducciones / summary.data.totalPercepciones) * 100 : null;

  const top5 = useMemo(() => Object.entries(netoMap)
    .map(([dbId, r]) => ({ emp: staffByDbId[dbId], netPay: Number(r.netPay) }))
    .filter((x) => x.emp)
    .sort((a, b) => b.netPay - a.netPay)
    .slice(0, 5), [netoMap, staffByDbId]);

  const masaPorDepto = useMemo(() => {
    const m = {};
    Object.entries(netoMap).forEach(([dbId, r]) => {
      const emp = staffByDbId[dbId];
      if (!emp) return;
      m[emp.depto] = (m[emp.depto] || 0) + Number(r.netPay);
    });
    const entries = Object.entries(m).sort((a, b) => b[1] - a[1]);
    return entries[0] || null;
  }, [netoMap, staffByDbId]);

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
      <div className="glass" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Incapacidades activas</div>
        <table className="tbl"><thead><tr><th>ID</th><th>Colaborador</th><th>Área</th><th>Planta</th><th>Turno</th></tr></thead>
          <tbody>{incap.length === 0 ? <tr style={{ cursor: "default" }}><td colSpan={5} className="muted" style={{ padding: 18 }}>Sin incapacidades activas.</td></tr> : incap.map((e) => (
            <tr key={e.id} style={{ cursor: "default" }}><td className="mono muted2">{e.id}</td><td style={{ fontWeight: 500 }}>{e.nombre}</td><td className="muted">{e.depto}</td><td className="muted">{e.planta}</td><td><span className="chip" style={{ color: TURNO_COLOR[e.turno] }}>{e.turno}</span></td></tr>
          ))}</tbody>
        </table>
      </div>

      <Eyebrow>Nómina · KPIs</Eyebrow>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "6px 0 12px" }}>Costo y distribución de nómina</h2>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Costo promedio / empleado" value={costoPromedio != null ? mxn(costoPromedio) : "—"} sub="neto último período" accent="var(--emerald)" />
        <Stat label="% deducciones / percepciones" value={pctDeducciones != null ? `${pctDeducciones.toFixed(1)}%` : "—"} accent="var(--amber)" />
        <Stat label="Depto. mayor masa salarial" value={masaPorDepto ? masaPorDepto[0] : "—"} sub={masaPorDepto ? mxn(masaPorDepto[1]) : ""} accent="var(--cyan)" />
      </div>
      <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Top 5 empleados por neto más alto</div>
        <table className="tbl"><thead><tr><th>ID</th><th>Colaborador</th><th>Área</th><th style={{ textAlign: "right" }}>Neto</th></tr></thead>
          <tbody>{top5.length === 0 ? <tr style={{ cursor: "default" }}><td colSpan={4} className="muted" style={{ padding: 18 }}>Sin datos de nómina.</td></tr> : top5.map(({ emp, netPay }) => (
            <tr key={emp.id} style={{ cursor: "default" }}><td className="mono muted2">{emp.id}</td><td style={{ fontWeight: 500 }}>{emp.nombre}</td><td className="muted">{emp.depto}</td><td className="mono" style={{ textAlign: "right", fontWeight: 600, color: "var(--emerald)" }}>{mxn2(netPay)}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <Eyebrow>Gamificación</Eyebrow>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "6px 0 12px" }}>Top colaboradores · XP</h2>
      <GamificationLeaderboardWidget token={token} staff={staff} openExpediente={openExpediente} />

      <RiesgoSalud staff={staff} token={token} openExpediente={openExpediente} />
    </div>
  );
}

function GamificationLeaderboardWidget({ token, staff, openExpediente }) {
  const board = useGamificationLeaderboard(token, 5);
  const staffByDbId = useMemo(() => Object.fromEntries(staff.map((s) => [s.dbId, s])), [staff]);

  return (
    <div className="glass" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Top 5 colaboradores por XP</div>
      <table className="tbl">
        <thead><tr><th>#</th><th>Colaborador</th><th>Nivel</th><th style={{ textAlign: "right" }}>XP</th><th style={{ textAlign: "right" }}>Racha</th></tr></thead>
        <tbody>
          {board.data.length === 0 ? (
            <tr style={{ cursor: "default" }}><td colSpan={5} className="muted" style={{ padding: 18 }}>Sin datos de gamificación todavía.</td></tr>
          ) : board.data.map((row, i) => (
            <tr key={row.id} onClick={() => openExpediente?.(staffByDbId[row.id], "resumen")}>
              <td className="mono muted2">{i + 1}</td>
              <td style={{ fontWeight: 500 }}>{row.firstName} {row.lastName}</td>
              <td className="muted">Nivel {row.xpLevel} · {row.levelLabel}</td>
              <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: "var(--emerald)" }}>{row.xpTotal}</td>
              <td className="mono muted2" style={{ textAlign: "right" }}>🔥 {row.streakDays}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
   ASISTENCIA — headcount mock (checadora simulada, datos reales
   guardados en Postgres — solo el "hardware" es de mentiras)
   ============================================================ */

const SHIFT_START = { Matutino: "08:00", Vespertino: "15:00", Nocturno: "23:00", Mixto: "08:00" };
const SHIFT_END = { Matutino: "16:00", Vespertino: "23:00", Nocturno: "07:00", Mixto: "16:00" };

function shiftMoment(shift, map, base = new Date()) {
  const [h, m] = (map[shift] || map.Matutino).split(":").map(Number);
  const d = new Date(base); d.setHours(h, m, 0, 0);
  return d;
}
function fmtTime(d) { return d ? new Date(d).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—"; }
function fmtHM(mins) { return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}min`; }

// Clasifica el estado de asistencia del día para un colaborador — usado
// tanto en las filas de la lista como en el status de la tabla de registro.
function attendanceStatus(row, now = new Date()) {
  if (row.checkInAt && row.checkOutAt) return "completo";
  if (row.checkInAt) return "en_planta";
  const retardoAt = new Date(shiftMoment(row.shift, SHIFT_START, now).getTime() + 30 * 60000);
  const end = shiftMoment(row.shift, SHIFT_END, now);
  if (now > end) return "falta";
  if (now > retardoAt) return "retardo";
  return "pendiente";
}

function useAttendance(token, socket) {
  const [state, setState] = useState({ status: "loading", data: [], totalActive: 0, checkedIn: 0, checkedOut: 0, noRecord: 0, date: null, updatedAt: null });
  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetchAttendance(token, todayISO);
      setState({ status: "ready", ...r, updatedAt: Date.now() });
    } catch {
      setState((s) => ({ ...s, status: "error" }));
    }
  }, [token]);
  useEffect(() => { reload(); const t = setInterval(reload, 30000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    if (!socket) return;
    const onEvt = () => reload();
    socket.on("attendance:checkin", onEvt);
    socket.on("attendance:checkout", onEvt);
    return () => { socket.off("attendance:checkin", onEvt); socket.off("attendance:checkout", onEvt); };
  }, [socket, reload]);
  return { ...state, reload };
}

function ChecadoraWarning({ variant = "pill" }) {
  if (variant === "pill") {
    return (
      <span className="chip" style={{ color: "var(--amber)", borderColor: "rgba(245,181,68,.3)", background: "rgba(245,181,68,.08)" }}>
        <Zap size={11} />Checadora
      </span>
    );
  }
  return (
    <div className="warnbox" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 9 }}>
        <Zap size={16} style={{ color: "var(--amber)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Checadora · Sin conexión</span>
      </div>
      <div className="muted2" style={{ fontSize: 10.5, marginTop: 6 }}>ZKTeco / Anviz / RFID</div>
    </div>
  );
}

const FILTER_TABS = [
  { id: "todos", label: "TODOS" },
  { id: "planta", label: "EN PLANTA" },
  { id: "salieron", label: "SALIERON" },
  { id: "sin_registro", label: "SIN REGISTRO" },
];

function AttendanceRow({ row, openExpediente, staff }) {
  const status = attendanceStatus(row);
  const initials = (row.name || "").split(" ").map((x) => x[0]).slice(0, 2).join("");
  return (
    <div className="row glass-2" style={{ height: 48, padding: "0 12px", justifyContent: "space-between", gap: 10, cursor: "pointer", flexShrink: 0 }}
      onClick={() => openExpediente?.(staff.find((s) => s.id === row.employeeCode))}>
      <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,var(--cyan),var(--violet))", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "#04060a", flexShrink: 0 }}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
          <div className="muted2" style={{ fontSize: 10.5 }}>{row.department}</div>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 12, color: row.checkInAt ? "var(--emerald)" : "var(--muted-2)", flexShrink: 0 }}>{fmtTime(row.checkInAt)}</div>
      <div style={{ flexShrink: 0, textAlign: "right" }}>
        {row.checkInAt && !row.checkOutAt && <span className="chip" style={{ color: "var(--emerald)" }}>En planta</span>}
        {row.checkOutAt && <span className="chip muted2">Salió · {fmtTime(row.checkOutAt)}</span>}
        {!row.checkInAt && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span className="chip" style={{ color: "var(--rose)" }}><span className="dot" style={{ background: "var(--rose)" }} />Falta / No checó</span>
            {status === "retardo" && <span className="muted2" style={{ fontSize: 9.5, display: "flex", alignItems: "center", gap: 3 }}><AlertTriangle size={10} style={{ color: "var(--amber)" }} />Retardo probable</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function HeadcountWidget({ attendance, compact = true, staff, openExpediente, go }) {
  const [tab, setTab] = useState("todos");
  useEffect(() => { const t = setInterval(() => attendance.reload(), 30000); return () => clearInterval(t); }, [attendance]);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  const rows = attendance.data || [];
  const counts = {
    todos: rows.length,
    planta: rows.filter((r) => r.checkInAt && !r.checkOutAt).length,
    salieron: rows.filter((r) => r.checkOutAt).length,
    sin_registro: rows.filter((r) => !r.checkInAt).length,
  };
  const filtered = rows.filter((r) => {
    if (tab === "planta") return r.checkInAt && !r.checkOutAt;
    if (tab === "salieron") return !!r.checkOutAt;
    if (tab === "sin_registro") return !r.checkInAt;
    return true;
  });
  const secsAgo = attendance.updatedAt ? Math.max(0, Math.round((Date.now() - attendance.updatedAt) / 1000)) : null;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <span className="eyebrow">HEADCOUNT HOY</span>
        <div className="row" style={{ gap: 6 }}>
          <span className="dot live" style={{ background: "var(--emerald)" }} />
          <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{attendance.checkedIn} / {attendance.totalActive} en planta</span>
        </div>
      </div>

      <ChecadoraWarning variant="banner" />

      <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {FILTER_TABS.map((t) => (
          <div key={t.id} className={`tabbtn ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}<span className="mono muted2">{counts[t.id]}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: compact ? 6 * 54 : 620, overflowY: "auto" }}>
        {attendance.status === "loading" && <div className="muted" style={{ fontSize: 12, padding: 8 }}>Cargando…</div>}
        {attendance.status === "ready" && filtered.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 8 }}>Sin colaboradores en este filtro.</div>}
        {filtered.map((row) => <AttendanceRow key={row.employeeId} row={row} openExpediente={openExpediente} staff={staff} />)}
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
        <span className="muted2" style={{ fontSize: 10.5 }}>{secsAgo == null ? "" : `Última actualización: hace ${secsAgo}s`}</span>
        {compact && go && <span className="mono" style={{ fontSize: 10.5, color: "var(--cyan)", cursor: "pointer" }} onClick={() => go("asistencia")}>Ver reporte completo →</span>}
      </div>
    </div>
  );
}

// Pseudo-QR determinista — nada en la app lo escanea, es puramente
// decorativo para el mock de la estación QR (finder patterns tipo QR real).
function seededGrid(token, size = 21) {
  let h = 0;
  for (const c of token) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => { h = (h * 1103515245 + 12345) >>> 0; return h / 0xffffffff; };
  return Array.from({ length: size * size }, () => rand() > 0.5);
}
function PseudoQR({ token, size = 180 }) {
  const modules = 21;
  const cell = size / modules;
  const grid = useMemo(() => seededGrid(token, modules), [token]);
  const finder = (x, y, key) => (
    <g key={key}>
      <rect x={x * cell} y={y * cell} width={cell * 7} height={cell * 7} fill="#000" />
      <rect x={(x + 1) * cell} y={(y + 1) * cell} width={cell * 5} height={cell * 5} fill="#fff" />
      <rect x={(x + 2) * cell} y={(y + 2) * cell} width={cell * 3} height={cell * 3} fill="#000" />
    </g>
  );
  return (
    <svg width={size} height={size} style={{ borderRadius: 10 }}>
      <rect width={size} height={size} fill="#fff" />
      {grid.map((on, i) => {
        const gx = i % modules, gy = Math.floor(i / modules);
        if ((gx < 8 && gy < 8) || (gx > modules - 9 && gy < 8) || (gx < 8 && gy > modules - 9)) return null;
        if (!on) return null;
        return <rect key={i} x={gx * cell} y={gy * cell} width={cell} height={cell} fill="#000" />;
      })}
      {finder(0, 0, "f1")}{finder(modules - 7, 0, "f2")}{finder(0, modules - 7, "f3")}
    </svg>
  );
}

// ── ZKTeco ADMS — dispositivos + registro en vivo ──────────────

function useZktecoDevices(token) {
  const [state, setState] = useState({ status: "loading", data: [] });
  const reload = useCallback(() => {
    if (!token) return;
    fetchZktecoDevices(token)
      .then(({ devices }) => setState({ status: "ready", data: devices || [] }))
      .catch((e) => setState({ status: "error", data: [], error: e.message }));
  }, [token]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

function DeviceCard({ device, onDelete }) {
  return (
    <div className="glass-2" style={{ padding: 14, marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="dot" style={{ background: device.status === "ACTIVE" ? "var(--emerald)" : "var(--muted-2)" }} />
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{device.alias || "ZKTeco"} · {device.model}</span>
        </div>
        <X size={14} style={{ cursor: "pointer", color: "var(--muted2)" }} onClick={() => onDelete(device.sn)} />
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Serie: {device.sn}{device.location ? ` · ${device.location}` : ""}</div>
      <div className="muted2" style={{ fontSize: 11, marginTop: 4 }}>Último registro: {timeAgo(device.last_ping)}</div>
      <div className="muted2" style={{ fontSize: 10.5, marginTop: 4 }}>Protocolo: ADMS Push · Puerto 443</div>
    </div>
  );
}

function RegisterDeviceForm({ token, onRegistered, onCancel }) {
  const [form, setForm] = useState({ sn: "", alias: "", location: "", ipAddress: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    if (!form.sn.trim()) { setError("El número de serie es obligatorio"); return; }
    setBusy(true); setError(null);
    try {
      await registerZktecoDevice(token, form);
      toast("Dispositivo registrado");
      onRegistered();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-2" style={{ padding: 14, marginBottom: 12 }}>
      <label className="fld">SN (del dispositivo)</label>
      <input className="input" style={{ marginBottom: 10 }} value={form.sn} onChange={f("sn")} placeholder="Ej. ABC123456" />
      <label className="fld">Alias</label>
      <input className="input" style={{ marginBottom: 10 }} value={form.alias} onChange={f("alias")} placeholder="Ej. Checadora acceso principal" />
      <label className="fld">Ubicación</label>
      <input className="input" style={{ marginBottom: 10 }} value={form.location} onChange={f("location")} placeholder="Ej. Planta Vallejo" />
      <label className="fld">IP</label>
      <input className="input" style={{ marginBottom: 12 }} value={form.ipAddress} onChange={f("ipAddress")} placeholder="Ej. 192.168.1.50" />
      {error && <div style={{ fontSize: 12, color: "var(--rose)", marginBottom: 10 }}>{error}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-accent" disabled={busy} onClick={submit}>{busy ? "Guardando…" : "Guardar dispositivo"}</button>
        <button className="btn" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

function DevicesPanel({ token }) {
  const { status, data, reload } = useZktecoDevices(token);
  const [showForm, setShowForm] = useState(false);
  const serverHost = (import.meta.env.VITE_API_URL || "https://codice-api-production.up.railway.app").replace(/^https?:\/\//, "");

  const copyConfig = () => {
    navigator.clipboard?.writeText(`Server: ${serverHost}\nPort: 443\nProtocolo: ADMS Push`);
    toast("Configuración copiada");
  };

  const remove = async (sn) => {
    try {
      await deleteZktecoDevice(token, sn);
      toast("Dispositivo eliminado");
      reload();
    } catch (e) {
      toast(e.message, "no");
    }
  };

  return (
    <div className="glass" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <Eyebrow>Dispositivos conectados</Eyebrow>
        <button className="btn btn-sm" onClick={() => setShowForm((s) => !s)}><Plus size={12} />Registrar dispositivo</button>
      </div>

      {showForm && <RegisterDeviceForm token={token} onRegistered={() => { setShowForm(false); reload(); }} onCancel={() => setShowForm(false)} />}

      {status === "loading" && <div className="muted" style={{ fontSize: 12.5 }}>Cargando dispositivos…</div>}
      {status === "ready" && data.length === 0 && !showForm && (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Sin checadoras registradas todavía.</div>
      )}
      {status === "ready" && data.map((d) => <DeviceCard key={d.sn} device={d} onDelete={remove} />)}

      <div className="glass-2" style={{ padding: 12, marginTop: 10 }}>
        <div className="muted2" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Configuración para el dispositivo</div>
        <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.8 }}>Server: {serverHost}<br />Port: 443</div>
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={copyConfig}><Copy size={11} />Copiar configuración</button>
      </div>
    </div>
  );
}

const VERIFY_LABEL = { fingerprint: "Huella", card: "Tarjeta", face: "Rostro" };

function LivePunchFeed({ socket }) {
  const [punches, setPunches] = useState([]);
  useEffect(() => {
    if (!socket) return;
    const onPunch = (p) => setPunches((prev) => [p, ...prev].slice(0, 20));
    socket.on("attendance:punch", onPunch);
    return () => socket.off("attendance:punch", onPunch);
  }, [socket]);

  return (
    <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 13 }}>Registro en vivo · checadora</div>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {punches.length === 0 ? (
          <div className="muted" style={{ padding: 18, fontSize: 12.5 }}>Sin checadas en vivo todavía — aparecerán aquí en cuanto llegue un punch de la checadora.</div>
        ) : punches.map((p, i) => (
          <div key={i} className="row" style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", justifyContent: "space-between", gap: 8 }}>
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              <span className="mono muted2" style={{ fontSize: 11.5, flexShrink: 0 }}>{fmtTime(p.timestamp)}</span>
              <span style={{ fontWeight: 500, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.employeeName}</span>
            </div>
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <span className="chip" style={{ color: p.type === "entry" ? "var(--emerald)" : "var(--amber)" }}>{p.type === "entry" ? "Entrada" : "Salida"}</span>
              <span className="muted2" style={{ fontSize: 11 }}>{VERIFY_LABEL[p.verifyMode] || "—"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Asistencia({ staff, attendance, openExpediente, token, socket }) {
  const rows = attendance.data || [];
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [attendance.date]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const STATUS_LABEL = {
    completo: { label: "Completo", color: "var(--emerald)" },
    en_planta: { label: "Sin salida", color: "var(--muted)" },
    retardo: { label: "Retardo", color: "var(--amber)" },
    falta: { label: "Falta", color: "var(--rose)" },
    pendiente: { label: "Sin registro", color: "var(--muted-2)" },
  };

  const toCSVAsistencia = (data) => {
    const head = ["empleado", "depto", "turno", "entrada", "salida", "horas", "status"];
    const body = data.map((r) => {
      const horas = r.checkInAt && r.checkOutAt ? fmtHM((new Date(r.checkOutAt) - new Date(r.checkInAt)) / 60000) : "";
      const vals = { empleado: r.name, depto: r.department, turno: r.shift, entrada: fmtTime(r.checkInAt), salida: fmtTime(r.checkOutAt), horas, status: STATUS_LABEL[attendanceStatus(r)].label };
      return head.map((k) => `"${String(vals[k] ?? "")}"`).join(",");
    });
    return [head.join(","), ...body].join("\n");
  };

  const [qrToken, setQrToken] = useState(null);
  const [qrSecs, setQrSecs] = useState(0);
  const [qrEmployee, setQrEmployee] = useState("");
  useEffect(() => {
    if (!qrToken || qrSecs <= 0) return;
    const t = setTimeout(() => setQrSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [qrToken, qrSecs]);
  const generalQR = () => { setQrToken(`GENERAL:${Date.now()}`); setQrSecs(60); };
  const individualQR = () => { if (!qrEmployee) return; setQrToken(`EMP:${qrEmployee}:${Date.now()}`); setQrSecs(30); };

  return (
    <div className="fadein">
      <Eyebrow>Operación · Asistencia</Eyebrow>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "5px 0 16px" }}>Asistencia</h1>

      <div className="glass" style={{ padding: 16, marginBottom: 20 }}>
        <div style={{ height: 200, background: "rgba(255,255,255,.04)", borderRadius: 14, marginBottom: 16, position: "relative", display: "grid", placeItems: "center", overflow: "hidden" }}>
          <div style={{ textAlign: "center" }}>
            <div className="muted" style={{ fontSize: 12.5 }}>Mapa de ubicaciones</div>
          </div>
          {[{ t: "22%", l: "18%" }, { t: "60%", l: "35%" }, { t: "35%", l: "70%" }, { t: "72%", l: "82%" }].map((p, i) => (
            <span key={i} className="dot" style={{ position: "absolute", top: p.t, left: p.l, background: "var(--cyan)", width: 8, height: 8 }} />
          ))}
        </div>
        <HeadcountWidget attendance={attendance} compact={false} staff={staff} openExpediente={openExpediente} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <LivePunchFeed socket={socket} />
        <DevicesPanel token={token} />
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <Eyebrow>Registro de hoy · {attendance.date}</Eyebrow>
        <button className="btn" onClick={() => { download(`asistencia_${attendance.date}.csv`, toCSVAsistencia(rows)); toast(`CSV exportado · ${rows.length} filas`); }}><Download size={14} />Exportar CSV</button>
      </div>
      <div className="glass" style={{ overflow: "hidden", padding: 0, marginBottom: 20 }}>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className="tbl">
            <thead style={{ position: "sticky", top: 0, background: "rgba(8,12,20,.92)", backdropFilter: "blur(8px)" }}>
              <tr><th>Empleado</th><th>Depto</th><th>Turno</th><th>Entrada</th><th>Salida</th><th>Horas</th><th>Status</th></tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const s = STATUS_LABEL[attendanceStatus(r)];
                const horas = r.checkInAt && r.checkOutAt ? fmtHM((new Date(r.checkOutAt) - new Date(r.checkInAt)) / 60000) : "—";
                return (
                  <tr key={r.employeeId} onClick={() => openExpediente?.(staff.find((x) => x.id === r.employeeCode))}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td className="muted">{r.department}</td>
                    <td><span className="chip">{r.shift}</span></td>
                    <td className="mono">{fmtTime(r.checkInAt)}</td>
                    <td className="mono">{fmtTime(r.checkOutAt)}</td>
                    <td className="mono">{horas}</td>
                    <td><span className="chip" style={{ color: s.color }}><span className="dot" style={{ background: s.color }} />{s.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={page} totalPages={totalPages} total={rows.length} limit={PAGE_SIZE} onPageChange={setPage} itemLabel="registros" />

      <Eyebrow>Estación QR de Asistencia</Eyebrow>
      <div className="glass" style={{ padding: 18, marginTop: 8 }}>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Genera un código QR para que los colaboradores registren su asistencia escaneando desde su celular.</div>

        <ChecadoraWarning variant="banner" />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="glass-2" style={{ padding: 14, textAlign: "center" }}>
            <Eyebrow>QR General de Planta</Eyebrow>
            <div className="muted" style={{ fontSize: 11, margin: "6px 0 12px" }}>Un QR que funciona para cualquier colaborador — se identifica capturando su clave al escanear.</div>
            {qrToken && qrToken.startsWith("GENERAL") && qrSecs > 0 ? (
              <><PseudoQR token={qrToken} /><div className="mono" style={{ marginTop: 8, color: "var(--amber)" }}>{qrSecs}s</div></>
            ) : (
              <button className="btn btn-accent" onClick={generalQR}><QrCode size={14} />Generar QR</button>
            )}
          </div>
          <div className="glass-2" style={{ padding: 14, textAlign: "center" }}>
            <Eyebrow>QR Individual</Eyebrow>
            <select className="select" style={{ margin: "10px 0" }} value={qrEmployee} onChange={(e) => setQrEmployee(e.target.value)}>
              <option value="">Buscar colaborador…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            {qrToken && qrToken.startsWith("EMP") && qrSecs > 0 ? (
              <><PseudoQR token={qrToken} /><div className="mono" style={{ marginTop: 8, color: "var(--amber)" }}>{qrSecs}s</div></>
            ) : (
              <button className="btn btn-accent" disabled={!qrEmployee} onClick={individualQR}><QrCode size={14} />Generar QR</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
/* ============================================================
   ASISTENTE IA FLOTANTE — burbuja global del shell admin.
   Contexto por vista (datos reales de staff/solicitudes/asistencia,
   ya en memoria) + alertas proactivas (contratos/sync/riesgo, vía API).
   ============================================================ */

function computeContextInsight(view, staff, solicitudes, attendance, extra) {
  const activeStaff = staff.filter((s) => s.status === "Activo").length;
  switch (view) {
    case "cockpit": {
      const checked = attendance?.checkedIn ?? 0;
      return `${activeStaff} colaboradores activos, ${solicitudes.length} solicitud${solicitudes.length === 1 ? "" : "es"} en trámite y ${checked} check-ins registrados hoy.`;
    }
    case "plantilla": {
      const porStatus = {};
      for (const s of staff) porStatus[s.status] = (porStatus[s.status] || 0) + 1;
      const top = Object.entries(porStatus).sort((a, b) => b[1] - a[1])[0];
      const contratos = extra.contracts.length;
      return `${staff.length} colaboradores en plantilla · estatus más común: ${top ? `${top[0]} (${top[1]})` : "sin datos"}.${contratos ? ` ${contratos} contrato${contratos === 1 ? "" : "s"} vence${contratos === 1 ? "" : "n"} en los próximos 30 días.` : ""}`;
    }
    case "solicitudes": {
      const now = Date.now();
      const vencidas = solicitudes.filter((s) => now - new Date(s.fecha).getTime() > 48 * 3600 * 1000).length;
      return vencidas > 0
        ? `${vencidas} solicitud${vencidas === 1 ? "" : "es"} llevan más de 48h sin resolverse — revisa la cola antes de que escalen.`
        : `${solicitudes.length} solicitudes en trámite, ninguna lleva más de 48h.`;
    }
    case "indicadores": {
      const ult = AUSENTISMO[AUSENTISMO.length - 1];
      const riesgo = extra.riskAlto;
      return `Ausentismo del mes: ${ult?.v ?? "—"}%, rotación ${ult?.rot ?? "—"}%.${riesgo ? ` ${riesgo} colaborador${riesgo === 1 ? "" : "es"} en riesgo alto de salud.` : ""}`;
    }
    case "asistencia": {
      const total = attendance?.totalActive ?? 0;
      const checked = attendance?.checkedIn ?? 0;
      const pct = total ? Math.round((checked / total) * 100) : 0;
      return `${checked} de ${total} colaboradores han registrado entrada hoy (${pct}%).`;
    }
    case "conectores": {
      if (extra.lastSyncDays == null) return "Aún no hay sincronizaciones registradas para este tenant.";
      return extra.lastSyncDays === 0
        ? "Los datos están al día — última sincronización hoy."
        : `Última sincronización hace ${extra.lastSyncDays} día${extra.lastSyncDays === 1 ? "" : "s"}.`;
    }
    default:
      return `${activeStaff} colaboradores activos en este momento.`;
  }
}

function buildProactiveAlerts({ solicitudes, extra }) {
  const list = [];
  const now = Date.now();
  const vencidas = solicitudes.filter((s) => now - new Date(s.fecha).getTime() > 48 * 3600 * 1000);
  if (vencidas.length > 0) {
    list.push({ id: "solicitudes", icon: "⚠️", text: `${vencidas.length} solicitud${vencidas.length === 1 ? "" : "es"} sin respuesta hace más de 48h`, view: "solicitudes" });
  }
  if (extra.contracts.length > 0) {
    const first = extra.contracts[0];
    list.push({
      id: "contratos", icon: "⚠️",
      text: extra.contracts.length === 1 ? `1 contrato vence en ${first.daysLeft} día${first.daysLeft === 1 ? "" : "s"}` : `${extra.contracts.length} contratos vencen en los próximos 30 días`,
      view: "contratos",
    });
  }
  if (extra.lastSyncDays != null && extra.lastSyncDays > 7) {
    list.push({ id: "sync", icon: "⚠️", text: `Nómina sin actualizar hace ${extra.lastSyncDays} días`, view: "conectores" });
  }
  if (extra.riskAlto > 0) {
    list.push({ id: "riesgo", icon: "🔴", text: `${extra.riskAlto} colaborador${extra.riskAlto === 1 ? "" : "es"} en riesgo alto de salud`, view: "indicadores" });
  }
  return list;
}

function FloatingAIAssistant({ view, staff, solicitudes, attendance, token, go }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [extra, setExtra] = useState({ contracts: [], lastSyncDays: null, riskAlto: 0 });
  const [dismissedAlerts, setDismissedAlerts] = useState(() => new Set());
  const end = useRef(null);

  useEffect(() => {
    if (!token) return;
    fetchContractsExpiringSoon(token).then((d) => setExtra((e) => ({ ...e, contracts: d.contracts || [] }))).catch(() => {});
    fetchSyncLogLatest(token).then((d) => {
      const last = d?.finishedAt || d?.startedAt;
      const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
      setExtra((e) => ({ ...e, lastSyncDays: days }));
    }).catch(() => {});
    fetchRiskSummary(token).then((d) => setExtra((e) => ({ ...e, riskAlto: d?.summary?.alto || 0 }))).catch(() => {});
  }, [token]);

  const contextInsight = useMemo(() => computeContextInsight(view, staff, solicitudes, attendance, extra), [view, staff, solicitudes, attendance, extra]);
  const alerts = useMemo(() => buildProactiveAlerts({ solicitudes, extra }).filter((a) => !dismissedAlerts.has(a.id)), [solicitudes, extra, dismissedAlerts]);
  const hasUnread = alerts.length > 0;

  useEffect(() => { if (open) end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, streaming, open]);

  const send = async (text) => {
    const t = (text ?? input).trim();
    if (!t || busy || !token) return;
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setInput("");
    setBusy(true);
    setStreaming("");
    const context = `Vista actual: ${view}. Insight de contexto: ${contextInsight}`;
    try {
      const full = await consultAIStream(token, { question: t, context }, setStreaming);
      setMsgs((m) => [...m, { role: "assistant", content: full || "No obtuve respuesta." }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "No pude conectar con la IA. Intenta de nuevo." }]);
    } finally {
      setBusy(false);
      setStreaming("");
    }
  };

  const visibleMsgs = msgs.slice(-5);

  return (
    <>
      <motion.div
        className="ai-bubble"
        onClick={() => setOpen(true)}
        whileTap={{ scale: 0.92 }}
        animate={{ scale: open ? 0 : 1, opacity: open ? 0 : 1 }}
        transition={{ type: "spring", stiffness: 340, damping: 26 }}
        style={{ pointerEvents: open ? "none" : "auto" }}
      >
        <Sparkles size={22} color="#04060a" />
        {hasUnread && <span className="ai-bubble-dot" />}
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="ai-panel"
            initial={{ opacity: 0, scale: 0.85, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 30 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <div className="row" style={{ justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>✦ Asistente CÓDICE</span>
              <X size={16} style={{ cursor: "pointer" }} onClick={() => setOpen(false)} />
            </div>

            <div style={{ padding: "10px 14px 0", flexShrink: 0, maxHeight: 190, overflowY: "auto" }}>
              <div className="glass-2" style={{ padding: 10, marginBottom: 8 }}>
                <div className="muted2" style={{ fontSize: 10, marginBottom: 3, textTransform: "uppercase", letterSpacing: ".08em" }}>💡 Contexto actual</div>
                <div style={{ fontSize: 12, lineHeight: 1.4 }}>{contextInsight}</div>
              </div>

              {alerts.map((a) => (
                <div key={a.id} className="row" style={{ gap: 7, padding: "7px 9px", marginBottom: 8, borderRadius: 9, background: "rgba(245,181,68,.1)", border: "1px solid rgba(245,181,68,.25)", cursor: "pointer" }}
                  onClick={() => { go?.(a.view); setOpen(false); }}>
                  <span style={{ fontSize: 12, flex: 1 }}>{a.icon} {a.text}</span>
                  <X size={12} style={{ cursor: "pointer", flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); setDismissedAlerts((s) => new Set(s).add(a.id)); }} />
                </div>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border)", minHeight: 0 }}>
              {visibleMsgs.length === 0 && <div className="muted2" style={{ fontSize: 11.5, textAlign: "center", marginTop: 20 }}>Pregúntame sobre lo que ves en pantalla.</div>}
              {visibleMsgs.map((m, i) => <div key={i} className={`bubble ${m.role === "user" ? "u" : "a"}`}>{m.content}</div>)}
              {busy && (
                <div className="bubble a">
                  {streaming || <span className="typing-inline"><span></span><span></span><span></span></span>}
                </div>
              )}
              <div ref={end} />
            </div>

            <div className="row" style={{ gap: 8, padding: 10, borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              <input className="input" style={{ fontSize: 12.5 }} placeholder="Pregunta a la IA…" value={input}
                onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} disabled={busy} />
              <button className="btn btn-accent" onClick={() => send()} disabled={busy}><Send size={14} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const NAV = [
  ["_s", "Operación"],
  ["cockpit", "Cockpit", LayoutDashboard], ["plantilla", "Plantilla", Users],
  ["solicitudes", "Solicitudes", Inbox], ["indicadores", "Indicadores WKF", Activity],
  ["asistencia", "Asistencia", UserCheck],
  ["_s", "Cumplimiento"],
  ["contratos", "Contratos", FileSignature], ["lft", "Módulo LFT", Scale], ["filtro", "Filtro → Tablero", Filter],
  ["radar", "Radar", RadarIcon],
  ["_s", "Integraciones"],
  ["conectores", "Conectores", Plug], ["whatsapp", "WhatsApp", MessageSquare],
  ["_s", "Personas"],
  ["capacitacion", "Capacitación", GraduationCap], ["senalizacion", "Señalización", Monitor],
  ["autoservicio", "Autoservicio", MessageSquareText], ["consultor", "Consultor IA", Bot],
];

export default function App() {
  const [view, setView] = useState("cockpit");
  const [staff, setStaff] = useState([]);
  const [boot, setBoot] = useState({ status: "loading", error: null });
  const [solicitudes, setSolicitudes] = useState(SOLICITUDES_SEED);
  const [resueltas, setResueltas] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [token, setToken] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [socket, setSocket] = useState(null);
  const [expedienteEmp, setExpedienteEmp] = useState(null);
  const [expedienteTab, setExpedienteTab] = useState("resumen");
  const openExpediente = useCallback((e, tab) => { if (e) { setExpedienteEmp(e); setExpedienteTab(tab || "resumen"); } }, []);
  const [plantillaFilter, setPlantillaFilter] = useState(null);
  const goToPlantillaStatus = useCallback((status) => { setPlantillaFilter(status); setView("plantilla"); }, []);
  useEffect(() => { _toast = (msg, kind = "ok") => { const id = Math.random(); setToasts((t) => [...t, { id, msg, kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600); }; }, []);

  const loadFromApi = useCallback(async () => {
    setBoot({ status: "loading", error: null });
    try {
      const { accessToken, tenant } = await login(AUTH);
      const { data } = await fetchEmployees(accessToken);
      setStaff(data.map(mapEmployee));
      setToken(accessToken);
      setTenantId(tenant?.id ?? null);
      setBoot({ status: "ready", error: null });
    } catch (e) {
      setBoot({ status: "error", error: e.message });
    }
  }, []);
  useEffect(() => { loadFromApi(); }, [loadFromApi]);

  // Refetch ligero de la plantilla tras crear/editar/dar de baja — a
  // diferencia de loadFromApi() no vuelve a hacer login, solo relee employees.
  const refreshStaff = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await fetchEmployees(token);
      setStaff(data.map(mapEmployee));
    } catch (e) {
      toast(e.message, "no");
    }
  }, [token]);

  // Socket.io — un único socket para toda la app, usado por el widget de
  // asistencia (y cualquier otro consumidor futuro de eventos en tiempo real).
  useEffect(() => {
    if (!tenantId) return;
    const s = io(import.meta.env.VITE_API_URL || "http://localhost:3001");
    s.emit("join:tenant", tenantId);
    setSocket(s);
    return () => { s.disconnect(); setSocket(null); };
  }, [tenantId]);

  // Alerta de salud urgente detectada por el análisis de IA de un documento
  // médico — ver routes/health.ts (analyzeHealthDocument).
  useEffect(() => {
    if (!socket) return;
    const onAlert = (data) => toast(`⚠️ Hallazgo urgente en documento médico (${data.filename})`, "no");
    socket.on("health:alert", onAlert);
    return () => socket.off("health:alert", onAlert);
  }, [socket]);

  const attendance = useAttendance(token, socket);

  if (boot.status === "loading") {
    return (
      <div className="codice"><style>{CSS}</style>
        <div className="bgfield"><div className="blob b1" /><div className="blob b2" /><div className="blob b3" /><div className="gridov" /></div>
        <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "grid", placeItems: "center" }}>
          <div className="glass" style={{ padding: 28, textAlign: "center" }}>
            <Eyebrow>CÓDICE · GFP</Eyebrow>
            <div style={{ marginTop: 10 }}>Iniciando sesión y cargando plantilla…</div>
          </div>
        </div>
      </div>
    );
  }
  if (boot.status === "error") {
    return (
      <div className="codice"><style>{CSS}</style>
        <div className="bgfield"><div className="blob b1" /><div className="blob b2" /><div className="blob b3" /><div className="gridov" /></div>
        <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "grid", placeItems: "center" }}>
          <div className="glass" style={{ padding: 28, textAlign: "center", maxWidth: 420 }}>
            <Eyebrow>Error de conexión</Eyebrow>
            <div style={{ marginTop: 10, color: "var(--rose)" }}>{boot.error}</div>
            <button className="btn btn-accent" style={{ marginTop: 16 }} onClick={loadFromApi}><RefreshCw size={14} />Reintentar</button>
          </div>
        </div>
      </div>
    );
  }

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
          <button className="btn" style={{ justifyContent: "center" }} onClick={() => loadFromApi().then(() => toast("Datos sincronizados"))}><RefreshCw size={14} />Sincronizar</button>
        </aside>
        <main style={{ flex: 1, padding: "20px 26px 40px", minWidth: 0, overflowX: "hidden" }}>
          {view === "cockpit" && <Cockpit staff={staff} solicitudes={solicitudes} resolver={resolver} go={setView} attendance={attendance} openExpediente={openExpediente} token={token} onFilterPlantillaStatus={goToPlantillaStatus} />}
          {view === "plantilla" && <Plantilla staff={staff} token={token} openExpediente={openExpediente} socket={socket} refreshStaff={refreshStaff} initialStatusFilter={plantillaFilter} />}
          {view === "solicitudes" && <Solicitudes solicitudes={solicitudes} resueltas={resueltas} resolver={resolver} />}
          {view === "indicadores" && <IndicadoresWKF staff={staff} token={token} openExpediente={openExpediente} />}
          {view === "conectores" && <Conectores token={token} socket={socket} tenantId={tenantId} />}
          {view === "whatsapp" && <WhatsAppPage token={token} />}
          {view === "asistencia" && <Asistencia staff={staff} attendance={attendance} openExpediente={openExpediente} token={token} socket={socket} />}
          {view === "contratos" && <Contratos staff={staff} />}
          {view === "lft" && <LFT token={token} />}
          {view === "filtro" && <FiltroDash staff={staff} />}
          {view === "radar" && <RadarPage staff={staff} token={token} />}
          {view === "capacitacion" && <Capacitacion staff={staff} />}
          {view === "senalizacion" && <Senalizacion />}
          {view === "autoservicio" && <Autoservicio staff={staff} />}
          {view === "consultor" && <Consultor />}
        </main>
      </div>
      <FloatingAIAssistant view={view} staff={staff} solicitudes={solicitudes} attendance={attendance} token={token} go={setView} />
      {expedienteEmp && (
        <ProfileDrawer
          e={expedienteEmp}
          onClose={() => setExpedienteEmp(null)}
          setStatus={async (dbId, status) => {
            try {
              await updateEmployee(token, dbId, { status });
              toast(`Estatus → ${status}`);
              setExpedienteEmp((prev) => (prev ? { ...prev, status } : prev));
              await refreshStaff();
            } catch (e) { toast(e.message, "no"); }
          }}
          update={async (p) => {
            try {
              const payload = {};
              if (p.contrato !== undefined) payload.contractType = p.contrato;
              await updateEmployee(token, expedienteEmp.dbId, payload);
              toast("Expediente actualizado");
              setExpedienteEmp((prev) => (prev ? { ...prev, ...p } : prev));
              await refreshStaff();
            } catch (e) { toast(e.message, "no"); }
          }}
          token={token}
          initialTab={expedienteTab}
        />
      )}
      <div className="toastwrap">{toasts.map((t) => <div key={t.id} className="toast">{t.kind === "no" ? <X size={15} style={{ color: "var(--rose)" }} /> : <CircleCheck size={15} style={{ color: "var(--emerald)" }} />}{t.msg}</div>)}</div>
    </div>
  );
}
