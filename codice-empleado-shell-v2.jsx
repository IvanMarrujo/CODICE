import { useState, useEffect, useRef, useMemo } from "react";

/* ============================================================
   CÓDICE · Shell del Colaborador
   Portal de autoservicio para Grupo Food Packing Co. (CDMX)
   Glassmorphism oscuro · navegable · con search global inferido
   Módulos: Nómina · Vacaciones · Actas · Bonos · Menciones
            Capacitación · Juegos (trivia + streak)
   ============================================================ */

const ME = {
  id: "GFP-1038",
  nombre: "Mariana Torres Vega",
  iniciales: "MT",
  puesto: "Supervisora de turno",
  depto: "Empaque",
  planta: "Planta Vallejo",
  turno: "Matutino",
  ingreso: "2021-03-15",
  antiguedad: 5,
  salario: 18400,
  status: "Activo",
  email: "mariana.torres@gfp.mx",
  streak: 7,
  xp: 1240,
  nivel: 3,
  vacDis: 14,
  vacTom: 6,
};

const SD = ME.salario / 30;

const NOMINA = [
  { id: "N-0624", periodo: "16–30 Jun 2026", fecha: "2026-06-30", neto: 8640, bruto: 9200, isr: 412, imss: 148, tipo: "Quincenal" },
  { id: "N-0614", periodo: "1–15 Jun 2026", fecha: "2026-06-15", neto: 8640, bruto: 9200, isr: 412, imss: 148, tipo: "Quincenal" },
  { id: "N-0524", periodo: "16–31 May 2026", fecha: "2026-05-31", neto: 8640, bruto: 9200, isr: 412, imss: 148, tipo: "Quincenal" },
  { id: "N-0514", periodo: "1–15 May 2026", fecha: "2026-05-15", neto: 8640, bruto: 9200, isr: 412, imss: 148, tipo: "Quincenal" },
  { id: "N-AG25", periodo: "Dic 2025", fecha: "2025-12-19", neto: 9200, bruto: 9200, isr: 0, imss: 0, tipo: "Aguinaldo" },
  { id: "N-VCP25", periodo: "Vacaciones · Sep 2025", fecha: "2025-09-02", neto: 2300, bruto: 2300, isr: 0, imss: 0, tipo: "Prima vacacional" },
];

const VACACIONES = [
  { id: "V-211", inicio: "2025-09-08", fin: "2025-09-19", dias: 10, status: "Aprobada", aprobador: "Jefe de Empaque" },
  { id: "V-189", inicio: "2024-08-12", fin: "2024-08-19", dias: 6, status: "Aprobada", aprobador: "Jefe de Empaque" },
  { id: "V-154", inicio: "2023-07-03", fin: "2023-07-08", dias: 5, status: "Aprobada", aprobador: "Coordinador WKF" },
];

const ACTAS = [
  { id: "A-0031", tipo: "Acta administrativa", motivo: "Retardo injustificado (> 15 min) · turno matutino 18 feb 2026", fecha: "2026-02-20", estado: "Firmada" },
];

const BONOS = [
  { id: "B-041", tipo: "Bono de puntualidad", periodo: "May 2026", monto: 600, status: "Pagado", fecha: "2026-05-31" },
  { id: "B-038", tipo: "Bono de productividad", periodo: "Abr 2026", monto: 1200, status: "Pagado", fecha: "2026-04-30" },
  { id: "B-034", tipo: "Bono de puntualidad", periodo: "Mar 2026", monto: 600, status: "Pagado", fecha: "2026-03-31" },
  { id: "B-012", tipo: "Bono de asistencia perfecta", periodo: "Q1 2026", monto: 800, status: "Pagado", fecha: "2026-03-31" },
  { id: "B-049", tipo: "Bono de puntualidad", periodo: "Jun 2026", monto: 600, status: "Pendiente", fecha: "2026-06-30" },
];

const MENCIONES = [
  { id: "M-007", tipo: "Colaboradora del mes", fecha: "2026-06-01", otorgado: "Gerencia de Empaque", descripcion: "Cero paros de línea y liderazgo 5S durante mayo." },
  { id: "M-004", tipo: "Reconocimiento en Safety Day", fecha: "2026-04-14", otorgado: "Seguridad e Inocuidad", descripcion: "Mejor reporte de casi-accidentes del trimestre." },
  { id: "M-001", tipo: "Bienvenida a GFP", fecha: "2021-03-15", otorgado: "Recursos Humanos", descripcion: "Integración exitosa al equipo de Planta Vallejo." },
];

const CURSOS = [
  { id: "C-01", titulo: "Inocuidad Alimentaria (HACCP)", cat: "Inocuidad", dur: "3h", oblig: true, prog: 100, calif: 94, xp: 300, fecha: "2026-03-11", vence: "2026-12-01" },
  { id: "C-02", titulo: "Buenas Prácticas de Manufactura", cat: "Calidad", dur: "2h", oblig: true, prog: 100, calif: 88, xp: 200, fecha: "2026-02-02", vence: "2026-10-15" },
  { id: "C-05", titulo: "Inducción CÓDICE / Onboarding", cat: "Onboarding", dur: "45m", oblig: false, prog: 100, calif: 100, xp: 150, fecha: "2026-01-20", vence: null },
  { id: "C-03", titulo: "Seguridad en piso y uso de EPP", cat: "Seguridad", dur: "1.5h", oblig: true, prog: 60, calif: null, xp: 250, vence: null },
  { id: "C-04", titulo: "Manejo de alérgenos", cat: "Inocuidad", dur: "1h", oblig: true, prog: 0, calif: null, xp: 200, vence: null },
  { id: "C-06", titulo: "Control de plagas (POES)", cat: "Calidad", dur: "1h", oblig: false, prog: 30, calif: null, xp: 150, vence: null },
];

const TRIVIA = [
  { q: "¿Cuántos días de vacaciones corresponden al cumplir 2 años de antigüedad según la LFT?", ops: ["10 días", "12 días", "14 días", "16 días"], ok: 2 },
  { q: "El aguinaldo mínimo legal son…", ops: ["10 días de salario", "15 días de salario", "20 días de salario", "30 días de salario"], ok: 1 },
  { q: "El registro electrónico de jornada es obligatorio desde la reforma…", ops: ["2018", "2021", "2026", "2030"], ok: 2 },
  { q: "La prima vacacional mínima es del…", ops: ["10%", "15%", "25%", "30%"], ok: 2 },
  { q: "¿Qué significa HACCP?", ops: ["Higiene Alimentaria y Control de Calidad y Procesos", "Análisis de Peligros y Puntos Críticos de Control", "Sistema Holístico de Alimentos Controlados", "Norma de Higiene Alimentaria"], ok: 1 },
  { q: "El periodo de prueba máximo para un puesto técnico es de…", ops: ["30 días", "90 días", "180 días", "360 días"], ok: 2 },
  { q: "La jornada laboral máxima en 2028 será de…", ops: ["48h", "46h", "44h", "40h"], ok: 2 },
  { q: "¿Cuántos días de aguinaldo proporcional corresponden si trabajaste 6 meses?", ops: ["5 días", "7.5 días", "10 días", "15 días"], ok: 1 },
];

const CAT_C = { Inocuidad: "#4fd6a3", Calidad: "#56d4f0", Seguridad: "#f5b544", Onboarding: "#a78bfa" };
const mxn = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Math.round(n));
const mxn2 = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(n);
const daysAgo = (d) => { const diff = Date.now() - new Date(d).getTime(); return Math.round(diff / 86400000); };
const todayISO = new Date().toISOString().slice(0, 10);

/* ─── INFER SEARCH ─── */
function inferSearch(q, ctx) {
  const t = q.toLowerCase().trim();
  if (!t) return null;
  const maps = [
    { kw: ["nomina", "nómina", "pago", "recibo", "quincena", "salario"], target: "nomina", msg: "Mostrando tus recibos de nómina" },
    { kw: ["vacacion", "vacación", "días libre", "descanso", "vacacione"], target: "vacaciones", msg: "Mostrando tus vacaciones" },
    { kw: ["acta", "amonestacion", "sancion", "falta", "llamada de atención"], target: "actas", msg: "Mostrando tu historial de actas" },
    { kw: ["bono", "incentivo", "productividad", "puntualidad", "premio"], target: "bonos", msg: "Mostrando tus bonos" },
    { kw: ["mencion", "mención", "reconocimiento", "empleado del mes", "reconocida"], target: "menciones", msg: "Mostrando tus reconocimientos" },
    { kw: ["curso", "capacitacion", "capacitación", "aprendizaje", "haccp", "bpm", "epp"], target: "capacitacion", msg: "Mostrando tus cursos" },
    { kw: ["juego", "trivia", "reto", "jugar", "puntos", "xp", "nivel", "streak"], target: "juegos", msg: "Abriendo zona de juegos" },
    { kw: ["constancia", "carta laboral", "comprobante"], target: "nomina", msg: "Las constancias laborales están en Nómina" },
    { kw: ["aguinaldo"], target: "nomina", msg: "Tu aguinaldo está registrado en Nómina" },
    { kw: ["prima"], target: "nomina", msg: "Tu prima vacacional está en Nómina" },
  ];
  for (const m of maps) if (m.kw.some((k) => t.includes(k))) return m;
  return { target: null, msg: `Sin resultados exactos para "${q}". Prueba: nómina, vacaciones, bonos, actas, menciones, cursos, juegos.` };
}

/* ─── LEVEL CONFIG ─── */
const LEVELS = [
  { lvl: 1, name: "Colaborador", min: 0, max: 499 },
  { lvl: 2, name: "Comprometido", min: 500, max: 999 },
  { lvl: 3, name: "Referente", min: 1000, max: 1799 },
  { lvl: 4, name: "Embajador", min: 1800, max: 2999 },
  { lvl: 5, name: "Leyenda GFP", min: 3000, max: 9999 },
];
const curLevel = (xp) => LEVELS.find((l) => xp >= l.min && xp <= l.max) || LEVELS[0];

/* ─── GLOBAL CSS — mobile-first, videogame glassmorphism ─── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
:root{
  --bg:#030508;
  --surface:rgba(255,255,255,0.038);
  --s2:rgba(255,255,255,0.062);
  --s3:rgba(255,255,255,0.095);
  --bd:rgba(255,255,255,0.082);
  --bd2:rgba(255,255,255,0.16);
  --tx:#e8eff8;--mu:#6e7f96;--mu2:#3d4f63;
  --cy:#56d4f0;--vi:#a78bfa;--em:#4fd6a3;--am:#f5b544;--ro:#fb7185;
  --font:'Space Grotesk',system-ui,sans-serif;
  --mono:'JetBrains Mono',monospace;
  --r:18px; --r2:13px; --r3:10px;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{background:var(--bg);color:var(--tx);font-family:var(--font);-webkit-font-smoothing:antialiased}

/* ── animated bg ── */
.shell{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;position:relative;overflow-x:hidden}
.bg{position:fixed;inset:0;z-index:0;overflow:hidden;background:radial-gradient(ellipse 110% 80% at 50% 0%,#080e1a,var(--bg) 65%)}
.b1{position:absolute;width:clamp(320px,80vw,700px);height:clamp(320px,80vw,700px);left:-15%;top:-20%;border-radius:50%;background:radial-gradient(circle,rgba(86,212,240,.13),transparent 65%);filter:blur(55px);animation:f1 22s ease-in-out infinite}
.b2{position:absolute;width:clamp(280px,70vw,600px);height:clamp(280px,70vw,600px);right:-15%;bottom:-10%;border-radius:50%;background:radial-gradient(circle,rgba(167,139,250,.11),transparent 65%);filter:blur(55px);animation:f2 28s ease-in-out infinite}
.b3{position:absolute;width:clamp(240px,60vw,500px);height:clamp(240px,60vw,500px);left:35%;top:35%;border-radius:50%;background:radial-gradient(circle,rgba(79,214,163,.08),transparent 65%);filter:blur(65px);animation:f3 35s ease-in-out infinite}
.gridline{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.016) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.016) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse 80% 70% at 50% 40%,#000,transparent)}
/* scanline for videogame feel */
.scanline{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.04) 3px,rgba(0,0,0,.04) 4px);opacity:.6}
@keyframes f1{0%,100%{transform:translate(0,0)}50%{transform:translate(50px,40px)}}
@keyframes f2{0%,100%{transform:translate(0,0)}50%{transform:translate(-40px,-35px)}}
@keyframes f3{0%,100%{transform:translate(0,0)}50%{transform:translate(35px,-50px)}}

.content{position:relative;z-index:1;display:flex;flex-direction:column;flex:1}

/* ── glass panels ── */
.g{
  background:rgba(6,11,20,0.52);
  backdrop-filter:blur(22px) saturate(160%);
  -webkit-backdrop-filter:blur(22px) saturate(160%);
  border:1px solid var(--bd);
  border-radius:var(--r);
  box-shadow:0 1px 0 rgba(255,255,255,.055) inset,0 18px 50px -18px rgba(0,0,0,.85);
  position:relative;
}
/* top edge glow */
.g::before{content:'';position:absolute;top:-1px;left:15%;right:15%;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent);border-radius:2px;pointer-events:none}
.g2{
  background:rgba(8,14,24,0.45);
  border:1px solid var(--bd);
  border-radius:var(--r2);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}

/* ── typography ── */
.mono{font-family:var(--mono)}
.mu{color:var(--mu)} .mu2{color:var(--mu2)}
.ey{font-family:var(--mono);font-size:9.5px;letter-spacing:.24em;text-transform:uppercase;color:var(--mu2);margin-bottom:4px;display:block}

/* ── buttons — larger touch targets ── */
.btn{
  font-family:var(--font);font-size:13.5px;font-weight:600;color:var(--tx);
  background:var(--s2);border:1px solid var(--bd);border-radius:var(--r2);
  padding:11px 16px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
  transition:.18s;white-space:nowrap;-webkit-user-select:none;user-select:none;
  min-height:44px;
}
.btn:active{transform:scale(.97);opacity:.85}
@media(hover:hover){.btn:hover{background:var(--s3);border-color:var(--bd2);transform:translateY(-1px)}}
/* colored variants */
.btn-cy{background:linear-gradient(160deg,rgba(86,212,240,.2),rgba(86,212,240,.08));border-color:rgba(86,212,240,.38);color:#c4f3fc;box-shadow:0 0 18px -8px rgba(86,212,240,.3)}
.btn-em{background:linear-gradient(160deg,rgba(79,214,163,.18),rgba(79,214,163,.07));border-color:rgba(79,214,163,.36);color:#bcefd8;box-shadow:0 0 18px -8px rgba(79,214,163,.25)}
.btn-vi{background:linear-gradient(160deg,rgba(167,139,250,.18),rgba(167,139,250,.07));border-color:rgba(167,139,250,.35);color:#dbd2fd;box-shadow:0 0 18px -8px rgba(167,139,250,.25)}
.btn-am{background:linear-gradient(160deg,rgba(245,181,68,.18),rgba(245,181,68,.07));border-color:rgba(245,181,68,.35);color:#fde8b0;box-shadow:0 0 18px -8px rgba(245,181,68,.2)}
.btn-sm{padding:7px 12px;font-size:12px;border-radius:var(--r3);min-height:36px}
.btn-xsm{padding:5px 10px;font-size:11px;border-radius:8px;min-height:30px}
/* icon-only round */
.btn-icon{width:44px;height:44px;padding:0;border-radius:50%;display:grid;place-items:center;font-size:18px}

/* ── inputs ── */
.inp{font-family:var(--font);font-size:15px;color:var(--tx);background:rgba(0,0,0,.35);border:1px solid var(--bd);border-radius:var(--r2);padding:13px 16px;outline:none;transition:.16s;width:100%;-webkit-appearance:none;min-height:48px}
.inp:focus{border-color:rgba(86,212,240,.5);box-shadow:0 0 0 3px rgba(86,212,240,.1);background:rgba(0,0,0,.5)}
.inp::placeholder{color:var(--mu2)}
textarea.inp{min-height:72px;resize:none}

/* ── chip ── */
.chip{font-family:var(--mono);font-size:10px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid var(--bd);display:inline-flex;align-items:center;gap:5px;background:var(--s2);white-space:nowrap}
.dot{width:5px;height:5px;border-radius:50%;display:inline-block;flex-shrink:0}

/* ── progress ── */
.pb{height:6px;border-radius:6px;background:rgba(255,255,255,.07);overflow:hidden}
.pb>span{display:block;height:100%;border-radius:6px;transition:width .6s cubic-bezier(.2,.9,.3,1)}

/* ── table — scroll on mobile ── */
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--r)}
.tbl{width:100%;border-collapse:collapse;font-size:13px;min-width:520px}
.tbl th{text-align:left;font-family:var(--mono);font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--mu2);padding:10px 14px;border-bottom:1px solid var(--bd)}
.tbl td{padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.044);vertical-align:middle}
.tbl tbody tr{transition:.12s;cursor:pointer}
.tbl tbody tr:active{background:var(--s2)}
@media(hover:hover){.tbl tbody tr:hover{background:var(--s2)}}

/* ── sidebar nav ── */
.npill{font-family:var(--font);font-size:13.5px;font-weight:500;padding:11px 14px;border-radius:var(--r2);cursor:pointer;color:var(--mu);display:flex;align-items:center;gap:10px;transition:.15s;border:1px solid transparent;min-height:46px}
@media(hover:hover){.npill:hover{color:var(--tx);background:var(--s2)}}
.npill:active{background:var(--s2)}
.npill.on{color:var(--cy);background:rgba(86,212,240,.09);border-color:rgba(86,212,240,.2);box-shadow:inset 3px 0 0 var(--cy)}
.npill-emoji{font-size:18px;width:26px;text-align:center;flex-shrink:0}

/* ── card hover ── */
.card-hover{transition:.18s;cursor:pointer}
.card-hover:active{transform:scale(.98)}
@media(hover:hover){.card-hover:hover{transform:translateY(-2px);border-color:var(--bd2)!important}}

/* ── search ── */
.sug{padding:12px 14px;font-size:13.5px;cursor:pointer;border-radius:var(--r3);transition:.13s;display:flex;align-items:center;gap:11px;min-height:46px}
.sug:active{background:var(--s3)}
@media(hover:hover){.sug:hover{background:var(--s3)}}

/* ── quiz options ── */
.qopt{border:1px solid var(--bd);border-radius:var(--r2);padding:13px 15px;cursor:pointer;font-size:14px;transition:.17s;background:var(--s2);width:100%;text-align:left;color:var(--tx);font-family:var(--font);min-height:50px}
.qopt:active{transform:scale(.98)}
@media(hover:hover){.qopt:hover{border-color:var(--bd2);background:var(--s3)}}
.qopt.corr{border-color:rgba(79,214,163,.7);background:rgba(79,214,163,.13);color:#bcefd8}
.qopt.wrong{border-color:rgba(251,113,133,.6);background:rgba(251,113,133,.10);color:#fcc4cd}

/* ── toasts ── */
.tw{position:fixed;bottom:80px;right:14px;z-index:99;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:calc(100vw - 28px)}
@media(min-width:640px){.tw{bottom:20px}}
.toast{background:rgba(6,10,18,.96);border:1px solid var(--bd2);border-radius:14px;padding:12px 16px;font-size:13px;display:flex;align-items:center;gap:10px;animation:tin .25s cubic-bezier(.2,.9,.3,1);backdrop-filter:blur(16px);max-width:340px}
@keyframes tin{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}

/* ── page enter ── */
.pf{animation:pfade .22s cubic-bezier(.2,.9,.3,1)}
@keyframes pfade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* ── XP bar ── */
.xpbar{height:7px;border-radius:7px;background:rgba(255,255,255,.07);overflow:hidden}
.xpbar>span{display:block;height:100%;background:linear-gradient(90deg,var(--vi),var(--cy));border-radius:7px;transition:width .9s cubic-bezier(.2,.9,.3,1)}

/* ── HUD accent lines on header (videogame) ── */
.hud-line{position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(86,212,240,.35),rgba(167,139,250,.25),transparent)}

/* ── bottom mobile nav ── */
.bnav{display:none;position:fixed;bottom:0;left:0;right:0;z-index:50;
  background:rgba(4,7,14,.88);backdrop-filter:blur(22px) saturate(140%);
  -webkit-backdrop-filter:blur(22px) saturate(140%);
  border-top:1px solid rgba(86,212,240,.14);
  padding:6px 4px calc(6px + env(safe-area-inset-bottom));
  grid-template-columns:repeat(5,1fr)}
@media(max-width:640px){.sidebar{display:none!important}.bnav{display:grid!important}}
.bnav-item{display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;
  padding:6px 4px;border-radius:10px;transition:.15s;-webkit-user-select:none;user-select:none;border:1px solid transparent}
.bnav-item.on{background:rgba(86,212,240,.09);border-color:rgba(86,212,240,.18)}
.bnav-emoji{font-size:20px;line-height:1}
.bnav-label{font-family:var(--mono);font-size:9px;letter-spacing:.04em;color:var(--mu2);transition:.15s}
.bnav-item.on .bnav-label{color:var(--cy)}

/* ── stat card glow on hover ── */
.stat-glow{transition:.2s}
@media(hover:hover){.stat-glow:hover{box-shadow:0 0 22px -8px var(--glow,var(--cy)),0 1px 0 rgba(255,255,255,.06) inset}}

/* ── modal backdrop ── */
.modal-bg{position:fixed;inset:0;background:rgba(2,4,8,.72);z-index:60;display:grid;place-items:center;padding:16px;backdrop-filter:blur(8px);animation:pfade .2s}
`;

/* ─── ATOMS ─── */
const Row = ({ style, children, ...p }) => <div style={{ display: "flex", alignItems: "center", ...style }} {...p}>{children}</div>;
const Ey = ({ children }) => <div className="ey" style={{ marginBottom: 4 }}>{children}</div>;
const Kv = ({ k, v, accent }) => <Row style={{ justifyContent: "space-between", fontSize: 13 }}><span className="mu">{k}</span><span className="mono" style={accent ? { color: accent } : {}}>{v}</span></Row>;
function Chip({ color, children }) { return <span className="chip" style={{ color }}><span className="dot" style={{ background: color }} />{children}</span>; }
function Stat({ label, value, sub, accent = "var(--cy)" }) {
  return (
    <div className="g2" style={{ padding: "12px 16px", flex: 1, minWidth: 110 }}>
      <div className="ey">{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: accent, lineHeight: 1, marginTop: 5 }}>{value}</div>
      {sub && <div className="mu" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
function ProgBar({ pct, color = "var(--cy)" }) {
  return <div className="pb" style={{ marginTop: 5 }}><span style={{ width: `${pct}%`, background: color }} /></div>;
}
function Constancia({ cur, nombre }) {
  const folio = `GFP-CAP-${1000 + Math.floor(Math.random() * 999)}`;
  const html = `<html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;color:#16202e;max-width:700px;margin:0 auto;padding:50px;text-align:center}h1{font-size:14px;letter-spacing:.3em;text-transform:uppercase;color:#666}h2{font-size:22px;margin:14px 0}.nom{font-size:24px;font-weight:bold;border-bottom:2px solid #16202e;display:inline-block;padding:0 28px 6px;margin:12px 0}.meta{font-size:11px;color:#666;margin-top:28px}.sigs{margin-top:46px;display:flex;justify-content:space-around;font-size:10.5px}.sigs div{border-top:1px solid #16202e;padding-top:5px;width:200px}</style></head><body><h1>Grupo Food Packing Co. · CDMX</h1><h2>Constancia de capacitación</h2><p>Se otorga la presente a</p><div class="nom">${nombre}</div><p>por haber concluido satisfactoriamente el curso<br><b>"${cur.titulo}"</b> — ${cur.cat} · ${cur.dur}</p><p style="margin-top:12px">Calificación: <b>${cur.calif}/100</b></p><p class="meta">Folio ${folio} · Ciudad de México · ${todayISO}<br>Programa interno de capacitación y adiestramiento (arts. 153-A a 153-X LFT)</p><div class="sigs"><div>Recursos Humanos<br>Grupo Food Packing Co.</div><div>${nombre}<br>Colaboradora</div></div></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `constancia_${cur.id}.html`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

let _addToast = () => {};
const toast = (msg, t = "ok") => _addToast(msg, t);

/* ─── AVATAR ─── */
function Avatar({ size = 44 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.3, background: "linear-gradient(135deg,#56d4f0,#a78bfa)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: size * 0.35, color: "#030508", flexShrink: 0 }}>
      {ME.iniciales}
    </div>
  );
}

/* ─── SEARCH ─── */
const SUGS = [
  { icon: "💳", label: "Ver mis recibos de nómina", t: "nomina" },
  { icon: "🌴", label: "¿Cuántos días de vacaciones tengo?", t: "vacaciones" },
  { icon: "🎁", label: "Mis bonos e incentivos", t: "bonos" },
  { icon: "🏆", label: "Mis reconocimientos", t: "menciones" },
  { icon: "📋", label: "Mis cursos y constancias", t: "capacitacion" },
  { icon: "🎮", label: "Jugar y ganar XP", t: "juegos" },
];
function SearchBar({ onNavigate }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", fn); return () => document.removeEventListener("mousedown", fn); }, []);
  const handle = (v) => {
    const val = v ?? q; const r = inferSearch(val, {}); if (!r) return;
    if (r.target) { onNavigate(r.target); toast(r.msg); } else { toast(r.msg, "warn"); }
    setQ(""); setOpen(false);
  };
  const filtered = q.length > 0 ? SUGS.filter((s) => s.label.toLowerCase().includes(q.toLowerCase())) : SUGS;
  return (
    <div ref={ref} style={{ position: "relative", flex: 1, maxWidth: 520 }}>
      <Row style={{ background: "rgba(0,0,0,.35)", border: "1px solid var(--bd)", borderRadius: 14, padding: "0 14px", gap: 10 }}>
        <span style={{ fontSize: 16 }}>🔍</span>
        <input className="inp" style={{ background: "transparent", border: "none", padding: "11px 0", fontSize: 14 }} placeholder="Busca: nómina, vacaciones, bonos, cursos, juegos…"
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === "Enter" && handle()} />
        {q && <span style={{ cursor: "pointer", fontSize: 16, color: "var(--mu)" }} onClick={() => setQ("")}>✕</span>}
      </Row>
      {open && (
        <div className="g" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, zIndex: 30, padding: 8 }}>
          {filtered.length === 0 && <div className="mu" style={{ padding: "10px 14px", fontSize: 13 }}>Sin sugerencias. Presiona Enter para buscar.</div>}
          {filtered.map((s) => (
            <div key={s.t} className="suggestion" onClick={() => handle(s.label)}>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--cy)", fontFamily: "var(--mono)" }}>ir →</span>
            </div>
          ))}
          {q && <div style={{ padding: "8px 14px 4px", borderTop: "1px solid var(--bd)", marginTop: 4 }}><span className="mu" style={{ fontSize: 12 }}>Presiona Enter para buscar "{q}"</span></div>}
        </div>
      )}
    </div>
  );
}

/* ─── INICIO ─── */
function Inicio({ nav }) {
  const lv = curLevel(ME.xp); const pct = Math.round(((ME.xp - lv.min) / (lv.max - lv.min)) * 100);
  const oblig = CURSOS.filter((c) => c.oblig);
  const cumplCap = Math.round(oblig.filter((c) => c.prog === 100).length / oblig.length * 100);
  const totalBonos = BONOS.filter((b) => b.status === "Pagado").reduce((a, b) => a + b.monto, 0);
  const sigNom = NOMINA[0];
  return (
    <div className="pf">
      <div className="g" style={{ padding: "22px 24px", marginBottom: 16 }}>
        <Row style={{ gap: 16, flexWrap: "wrap" }}>
          <Avatar size={60} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{ME.nombre}</div>
            <Row style={{ gap: 8, marginTop: 5, flexWrap: "wrap" }}>
              <Chip color="var(--em)">{ME.status}</Chip>
              <span className="mu" style={{ fontSize: 13 }}>{ME.puesto} · {ME.depto}</span>
              <span className="mu" style={{ fontSize: 13 }}>·</span>
              <span className="mu" style={{ fontSize: 13 }}>{ME.planta} · Turno {ME.turno}</span>
            </Row>
            <Row style={{ gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 18 }}>🔥</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--am)" }}>{ME.streak} días de racha</span>
              <span style={{ fontSize: 10, color: "var(--mu2)", marginLeft: 4 }}>·</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--vi)" }}>{ME.xp} XP · {lv.name}</span>
            </Row>
            <div style={{ maxWidth: 300, marginTop: 8 }}>
              <Row style={{ justifyContent: "space-between", marginBottom: 3 }}>
                <span className="mu" style={{ fontSize: 11 }}>Nv {lv.lvl}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--vi)" }}>{pct}% → Nv {lv.lvl + 1}</span>
              </Row>
              <div className="xpbar"><span style={{ width: `${pct}%` }} /></div>
            </div>
          </div>
          <button className="btn btn-cy btn-sm" onClick={() => nav("vacaciones")}>🌴 Solicitar vacaciones</button>
        </Row>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 12, marginBottom: 16 }}>
        <Stat label="Vacaciones disponibles" value={`${ME.vacDis}d`} sub={`${ME.vacTom}d tomados`} accent="var(--em)" />
        <Stat label="Último pago" value={mxn(sigNom.neto)} sub={sigNom.periodo} accent="var(--cy)" />
        <Stat label="Bonos acumulados" value={mxn(totalBonos)} sub="año en curso" accent="var(--am)" />
        <Stat label="Capacitación" value={`${cumplCap}%`} sub={`${oblig.filter((c) => c.prog === 100).length}/${oblig.length} oblig.`} accent="var(--vi)" />
        <Stat label="Reconocimientos" value={MENCIONES.length} sub="en GFP" accent="var(--ro)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="g" style={{ padding: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Accesos rápidos</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
            {[["💰","Nómina","nomina"],["🌴","Vacaciones","vacaciones"],["⭐","Bonos","bonos"],["🏅","Menciones","menciones"],["🎓","Capacitación","capacitacion"],["🕹️","Juegos","juegos"]].map(([ic, lb, id]) => (
              <button key={id} className="btn card-hover g2" style={{ justifyContent: "flex-start", padding: "11px 13px", borderRadius: 12 }} onClick={() => nav(id)}>
                <span style={{ fontSize: 20 }}>{ic}</span><span style={{ fontSize: 13, fontWeight: 500 }}>{lb}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="g" style={{ padding: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Actividad reciente</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { ic: "🏅", tx: "Colaboradora del mes · Jun 2026", d: "5 días" },
              { ic: "⭐", tx: `Bono de puntualidad · ${mxn(600)}`, d: "8 días" },
              { ic: "🎓", tx: "Inocuidad HACCP completado · 94/100", d: "14 días" },
              { ic: "💰", tx: `Nómina depositada · ${mxn(sigNom.neto)}`, d: "6 días" },
            ].map((a, i) => (
              <Row key={i} style={{ gap: 11 }}>
                <div className="g2" style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", fontSize: 16, flexShrink: 0 }}>{a.ic}</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{a.tx}</div><div className="mu2" style={{ fontSize: 11 }}>hace {a.d}</div></div>
              </Row>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── NÓMINA ─── */
function Nomina() {
  const [sel, setSel] = useState(null);
  const totalAnio = NOMINA.reduce((a, n) => a + n.neto, 0);
  return (
    <div className="pf">
      <Ey>Nómina · recibos de pago</Ey>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Mis pagos</div>
      <div className="row" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Salario mensual" value={mxn(ME.salario)} sub="bruto" />
        <Stat label="Salario diario" value={mxn2(SD)} sub="base" accent="var(--em)" />
        <Stat label="Total cobrado año" value={mxn(totalAnio)} sub="todos los conceptos" accent="var(--vi)" />
      </div>
      <div className="g" style={{ padding: 0, overflow: "hidden" }}>
        <table className="tbl">
          <thead><tr><th>Folio</th><th>Periodo</th><th>Tipo</th><th>Bruto</th><th>ISR</th><th>IMSS</th><th>Neto</th><th></th></tr></thead>
          <tbody>
            {NOMINA.map((n) => (
              <tr key={n.id} style={{ cursor: "pointer" }} onClick={() => setSel(n)}>
                <td className="mono mu2">{n.id}</td>
                <td style={{ fontWeight: 500 }}>{n.periodo}</td>
                <td><Chip color={n.tipo === "Quincenal" ? "var(--cy)" : n.tipo === "Aguinaldo" ? "var(--am)" : "var(--vi)"}>{n.tipo}</Chip></td>
                <td className="mono">{mxn(n.bruto)}</td>
                <td className="mono mu">{mxn(n.isr)}</td>
                <td className="mono mu">{mxn(n.imss)}</td>
                <td className="mono" style={{ color: "var(--em)", fontWeight: 600 }}>{mxn(n.neto)}</td>
                <td><span className="mu" style={{ fontSize: 15 }}>›</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && (
        <div className="modal-bg" onClick={() => setSel(null)}>
          <div className="g" style={{ width: "min(440px,94vw)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <Row style={{ justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontWeight: 600 }}>Recibo {sel.id}</span>
              <button className="btn btn-sm" onClick={() => setSel(null)}>✕</button>
            </Row>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <Kv k="Periodo" v={sel.periodo} /><Kv k="Tipo" v={sel.tipo} /><Kv k="Fecha de pago" v={sel.fecha} />
              <div style={{ borderTop: "1px solid var(--bd)", margin: "6px 0" }} />
              <Kv k="Salario bruto" v={mxn(sel.bruto)} />
              <Kv k="ISR retenido" v={mxn(sel.isr)} accent="var(--ro)" />
              <Kv k="IMSS retenido" v={mxn(sel.imss)} accent="var(--ro)" />
              <div style={{ borderTop: "1px solid var(--bd)", margin: "6px 0" }} />
              <Kv k="Salario neto" v={mxn(sel.neto)} accent="var(--em)" />
            </div>
            <button className="btn btn-cy" style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
              onClick={() => { toast("Descargando recibo (simulado)"); setSel(null); }}>
              ⬇ Descargar recibo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── VACACIONES ─── */
function Vacaciones() {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ inicio: "", dias: 5, nota: "" });
  const [solicitar, setSolicitar] = useState([]);
  const done = VACACIONES.reduce((a, v) => a + v.dias, 0);
  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const enviar = () => {
    if (!form.inicio) { toast("Elige una fecha de inicio", "warn"); return; }
    setSolicitar((L) => [{ id: `V-TMP${L.length + 1}`, inicio: form.inicio, dias: +form.dias, status: "En revisión", aprobador: "Pendiente jefe directo" }, ...L]);
    toast("Solicitud enviada a tu jefe directo 📤"); setModal(false); setForm({ inicio: "", dias: 5, nota: "" });
  };
  return (
    <div className="pf">
      <Ey>Vacaciones · días disponibles y solicitados</Ey>
      <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Mis vacaciones</div>
        <button className="btn btn-em" onClick={() => setModal(true)}>🌴 Solicitar días</button>
      </Row>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Disponibles" value={`${ME.vacDis}d`} accent="var(--em)" />
        <Stat label="Tomados" value={`${ME.vacTom}d`} accent="var(--mu)" />
        <Stat label="Por antigüedad (5 años)" value="20d" sub="máximo LFT" accent="var(--cy)" />
        <Stat label="Prima vacacional 25%" value={mxn(ME.vacDis * SD * 0.25)} accent="var(--vi)" />
      </div>
      {solicitar.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Solicitudes en progreso</div>
          {solicitar.map((s) => (
            <div key={s.id} className="g2 card-hover" style={{ padding: "13px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontSize: 22 }}>🌴</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>Desde {s.inicio} · {s.dias} días</div><div className="mu2" style={{ fontSize: 11.5 }}>{s.aprobador}</div></div>
              <Chip color="var(--am)">{s.status}</Chip>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Historial de vacaciones</div>
      <div className="g" style={{ padding: 0, overflow: "hidden" }}>
        <table className="tbl">
          <thead><tr><th>Folio</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Aprobado por</th><th>Estado</th></tr></thead>
          <tbody>{VACACIONES.map((v) => (
            <tr key={v.id} style={{ cursor: "default" }}><td className="mono mu2">{v.id}</td><td>{v.inicio}</td><td>{v.fin}</td><td className="mono" style={{ color: "var(--cy)" }}>{v.dias}</td><td className="mu">{v.aprobador}</td><td><Chip color="var(--em)">{v.status}</Chip></td></tr>
          ))}</tbody>
        </table>
      </div>
      {modal && (
        <div className="modal-bg" onClick={() => setModal(false)}>
          <div className="g" style={{ width: "min(400px,94vw)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <Row style={{ justifyContent: "space-between", marginBottom: 18 }}><span style={{ fontWeight: 600 }}>Solicitar vacaciones</span><button className="btn btn-sm" onClick={() => setModal(false)}>✕</button></Row>
            <label className="ey" style={{ marginBottom: 5 }}>Fecha de inicio</label>
            <input type="date" className="inp" style={{ marginBottom: 12 }} value={form.inicio} min={todayISO} onChange={f("inicio")} />
            <label className="ey" style={{ marginBottom: 5 }}>Días solicitados</label>
            <input type="number" className="inp" style={{ marginBottom: 12 }} min={1} max={ME.vacDis} value={form.dias} onChange={f("dias")} />
            <label className="ey" style={{ marginBottom: 5 }}>Nota (opcional)</label>
            <textarea className="inp" rows={2} style={{ marginBottom: 18, resize: "none" }} placeholder="Motivo o comentario…" value={form.nota} onChange={f("nota")} />
            <div className="g2" style={{ padding: 11, marginBottom: 14, fontSize: 12, color: "var(--mu)" }}>El flujo va: <b style={{ color: "var(--am)" }}>tú →</b> <b style={{ color: "var(--cy)" }}>jefe directo →</b> <b style={{ color: "var(--em)" }}>Workforce</b>. Recibirás notificación de cada etapa.</div>
            <button className="btn btn-em" style={{ width: "100%", justifyContent: "center" }} onClick={enviar}>Enviar solicitud</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── ACTAS ─── */
function Actas() {
  return (
    <div className="pf">
      <Ey>Actas administrativas · historial oficial</Ey>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Mis actas</div>
      <div className="g2" style={{ padding: "14px 18px", marginBottom: 18, display: "flex", gap: 12 }}>
        <span style={{ fontSize: 24 }}>{ACTAS.length === 0 ? "✅" : "📋"}</span>
        <div><div style={{ fontWeight: 600 }}>{ACTAS.length === 0 ? "Sin actas registradas" : `${ACTAS.length} acta registrada`}</div><div className="mu" style={{ fontSize: 12.5 }}>Las actas quedan en tu expediente. Tienes derecho a firmar de conformidad o inconformidad.</div></div>
      </div>
      {ACTAS.length > 0 && (
        <div className="g" style={{ padding: 0, overflow: "hidden" }}>
          <table className="tbl">
            <thead><tr><th>Folio</th><th>Tipo</th><th>Motivo</th><th>Fecha</th><th>Estado</th></tr></thead>
            <tbody>{ACTAS.map((a) => (
              <tr key={a.id} style={{ cursor: "default" }}><td className="mono mu2">{a.id}</td><td style={{ fontWeight: 500 }}>{a.tipo}</td><td className="mu" style={{ maxWidth: 280, fontSize: 12.5 }}>{a.motivo}</td><td className="mono mu">{a.fecha}</td><td><Chip color="var(--am)">{a.estado}</Chip></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="g2" style={{ padding: "13px 16px", marginTop: 14, fontSize: 12.5, color: "var(--mu)", lineHeight: 1.6 }}>
        Art. 46-A LFT: el trabajador puede ser escuchado antes de que el patrón tome una decisión disciplinaria. Siempre tienes derecho a presentar tu versión. Si tienes dudas, contáctanos a <b>rh@gfp.mx</b>.
      </div>
    </div>
  );
}

/* ─── BONOS ─── */
function Bonos() {
  const pagados = BONOS.filter((b) => b.status === "Pagado");
  const total = pagados.reduce((a, b) => a + b.monto, 0);
  const pend = BONOS.filter((b) => b.status === "Pendiente");
  return (
    <div className="pf">
      <Ey>Bonos e incentivos · año en curso</Ey>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Mis bonos</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Total cobrado" value={mxn(total)} accent="var(--am)" />
        <Stat label="Bonos pagados" value={pagados.length} accent="var(--em)" />
        <Stat label="Pendientes de pago" value={pend.length} accent="var(--cy)" />
      </div>
      <div className="g" style={{ padding: 0, overflow: "hidden" }}>
        <table className="tbl">
          <thead><tr><th>Folio</th><th>Concepto</th><th>Periodo</th><th>Monto</th><th>Estado</th></tr></thead>
          <tbody>{BONOS.map((b) => (
            <tr key={b.id} style={{ cursor: "default" }}>
              <td className="mono mu2">{b.id}</td>
              <td style={{ fontWeight: 500 }}>{b.tipo}</td>
              <td className="mu">{b.periodo}</td>
              <td className="mono" style={{ color: b.status === "Pagado" ? "var(--em)" : "var(--am)", fontWeight: 600 }}>{mxn(b.monto)}</td>
              <td><Chip color={b.status === "Pagado" ? "var(--em)" : "var(--am)"}>{b.status}</Chip></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="g2" style={{ padding: "13px 16px", marginTop: 14, fontSize: 12.5, color: "var(--mu)" }}>Los bonos de puntualidad se acreditan el último día de cada mes. El bono de productividad requiere cumplimiento de plan ≥ 100%.</div>
    </div>
  );
}

/* ─── MENCIONES ─── */
function Menciones() {
  return (
    <div className="pf">
      <Ey>Menciones y reconocimientos</Ey>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Mis reconocimientos</div>
      <div style={{ display: "grid", gap: 14 }}>
        {MENCIONES.map((m) => (
          <div key={m.id} className="g card-hover" style={{ padding: "18px 20px" }}>
            <Row style={{ gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,rgba(245,181,68,.25),rgba(251,113,133,.15))", display: "grid", placeItems: "center", fontSize: 24, flexShrink: 0 }}>🏆</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: "var(--am)" }}>{m.tipo}</div>
                <div className="mu" style={{ fontSize: 12.5, marginTop: 2 }}>{m.otorgado} · {m.fecha}</div>
                <div style={{ fontSize: 13.5, marginTop: 7, lineHeight: 1.5 }}>{m.descripcion}</div>
              </div>
            </Row>
          </div>
        ))}
      </div>
      <div className="g2" style={{ padding: "13px 18px", marginTop: 16, fontSize: 12.5, color: "var(--mu)" }}>Los reconocimientos quedan en tu expediente oficial y se publican en las pantallas de señalización de planta.</div>
    </div>
  );
}

/* ─── CAPACITACIÓN ─── */
function Capacitacion() {
  const [cursos, setCursos] = useState(CURSOS);
  const [quiz, setQuiz] = useState(null);
  const oblig = cursos.filter((c) => c.oblig);
  const cumpl = Math.round(oblig.filter((c) => c.prog === 100).length / oblig.length * 100);
  const totalXP = cursos.filter((c) => c.prog === 100).reduce((a, c) => a + c.xp, 0);
  const aprobar = (id, calif) => { setCursos((L) => L.map((c) => c.id === id ? { ...c, prog: 100, calif, fechaCompl: todayISO } : c)); toast(`¡Aprobado! +${CURSOS.find((c) => c.id === id)?.xp || 0} XP 🎉`); };
  return (
    <div className="pf">
      <Ey>Capacitación · historial y constancias</Ey>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Mis cursos</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Cumplimiento obligatorios" value={`${cumpl}%`} accent="var(--em)" />
        <Stat label="XP ganados en cursos" value={totalXP} accent="var(--vi)" />
        <Stat label="Cursos completados" value={cursos.filter((c) => c.prog === 100).length} sub={`de ${cursos.length}`} accent="var(--cy)" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", gap: 14 }}>
        {cursos.map((c) => (
          <div key={c.id} className="g" style={{ padding: 16 }}>
            <Row style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <Chip color={CAT_C[c.cat]}>{c.cat}</Chip>
              <Row style={{ gap: 6 }}>
                {c.oblig && <Chip color="var(--ro)">Obligatorio</Chip>}
                <span className="mono mu2" style={{ fontSize: 11 }}>{c.dur}</span>
              </Row>
            </Row>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, minHeight: 38 }}>{c.titulo}</div>
            <Row style={{ justifyContent: "space-between", marginBottom: 5 }}>
              <span className="mu" style={{ fontSize: 11.5 }}>{c.vence ? `Vence ${c.vence}` : "Sin fecha límite"}</span>
              <span className="mono" style={{ fontSize: 12, color: c.prog === 100 ? "var(--em)" : "var(--cy)" }}>{c.prog}%</span>
            </Row>
            <ProgBar pct={c.prog} color={c.prog === 100 ? "var(--em)" : "var(--cy)"} />
            {c.prog === 100 && c.calif && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--mu)" }}>Calificación: <span className="mono" style={{ color: "var(--em)" }}>{c.calif}/100</span> · <span style={{ color: "var(--vi)" }}>+{c.xp} XP</span></div>
            )}
            <div style={{ marginTop: 12 }}>
              {c.prog === 100
                ? <button className="btn btn-em btn-sm" style={{ width: "100%", justifyContent: "center" }} onClick={() => { Constancia({ cur: c, nombre: ME.nombre }); toast("Constancia generada ✅"); }}>⬇ Descargar constancia</button>
                : <button className="btn btn-cy btn-sm" style={{ width: "100%", justifyContent: "center" }} onClick={() => setQuiz(c)}>{c.prog === 0 ? "▶ Iniciar y evaluar" : "↺ Continuar"}</button>}
            </div>
          </div>
        ))}
      </div>
      {quiz && <QuizModal cur={quiz} onClose={() => setQuiz(null)} onPass={(id, ca) => { aprobar(id, ca); setQuiz(null); }} />}
    </div>
  );
}
function QuizModal({ cur, onClose, onPass }) {
  const [idx, setIdx] = useState(0); const [ans, setAns] = useState(null); const [score, setScore] = useState(0); const [done, setDone] = useState(false);
  const q = TRIVIA[idx % TRIVIA.length];
  const pick = (i) => {
    if (ans !== null) return; setAns(i);
    const ok = i === q.ok;
    setTimeout(() => {
      const ns = score + (ok ? 1 : 0);
      if (idx < 4) { setIdx((x) => x + 1); setAns(null); setScore(ns); }
      else { const calif = Math.round((ns / 5) * 100); setDone({ califFinal: calif, ok: ns }); }
    }, 900);
  };
  return (
    <div className="modal-bg" style={{ zIndex: 70 }} onClick={onClose}>
      <div className="g" style={{ width: "min(500px,94vw)", padding: 24, maxHeight: "90dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {!done ? (
          <>
            <Row style={{ justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{cur.titulo}</span>
              <span className="mono mu" style={{ fontSize: 12 }}>Pregunta {idx + 1}/5</span>
            </Row>
            <div style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.5, marginBottom: 18 }}>{q.q}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {q.ops.map((o, i) => (
                <button key={i} className={`qopt ${ans === i ? (i === q.ok ? "corr" : "wrong") : (ans !== null && i === q.ok ? "corr" : "")}`} onClick={() => pick(i)} disabled={ans !== null}>{o}</button>
              ))}
            </div>
            <ProgBar pct={(idx / 5) * 100} />
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 50, marginBottom: 10 }}>{done.califFinal >= 60 ? "🎉" : "😓"}</div>
            <div className="mono" style={{ fontSize: 38, fontWeight: 700, color: done.califFinal >= 60 ? "var(--em)" : "var(--ro)" }}>{done.califFinal}/100</div>
            <div className="mu" style={{ fontSize: 14, margin: "10px 0 20px" }}>{done.ok} de 5 correctas · {done.califFinal >= 60 ? "¡Aprobado!" : "No aprobado"}</div>
            {done.califFinal >= 60
              ? <button className="btn btn-em" style={{ width: "100%", justifyContent: "center" }} onClick={() => onPass(cur.id, done.califFinal)}>Registrar y descargar constancia</button>
              : <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => { setIdx(0); setAns(null); setScore(0); setDone(false); }}>Intentar de nuevo</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── JUEGOS ─── */
function Juegos() {
  const [game, setGame] = useState(null);
  const lv = curLevel(ME.xp); const pct = Math.round(((ME.xp - lv.min) / (lv.max - lv.min)) * 100);
  const [xp, setXp] = useState(ME.xp);
  const addXp = (n) => { setXp((x) => x + n); toast(`+${n} XP ganados 🎯`); };
  if (game === "trivia") return <TriviaGame onBack={() => setGame(null)} onXp={addXp} />;
  if (game === "streak") return <StreakGame onBack={() => setGame(null)} onXp={addXp} />;
  if (game === "word") return <WordGame onBack={() => setGame(null)} onXp={addXp} />;
  const lv2 = curLevel(xp); const pct2 = Math.round(((xp - lv2.min) / (lv2.max - lv2.min)) * 100);
  return (
    <div className="pf">
      <Ey>Zona de juegos · aprende y gana XP</Ey>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Juegos</div>
      <div className="g" style={{ padding: "20px 22px", marginBottom: 18, background: "linear-gradient(135deg,rgba(167,139,250,.12),rgba(86,212,240,.08))" }}>
        <Row style={{ gap: 16, flexWrap: "wrap" }}>
          <Avatar size={52} />
          <div style={{ flex: 1 }}>
            <Row style={{ gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 18 }}>Nivel {lv2.lvl} · {lv2.name}</span>
              <span className="mono" style={{ color: "var(--vi)", fontSize: 14 }}>{xp} XP</span>
              <span style={{ fontSize: 18 }}>🔥</span><span className="mono" style={{ color: "var(--am)", fontSize: 13 }}>{ME.streak} días</span>
            </Row>
            <div style={{ maxWidth: 380, marginTop: 8 }}>
              <Row style={{ justifyContent: "space-between", marginBottom: 4 }}>
                <span className="mu" style={{ fontSize: 12 }}>Progreso a nivel {lv2.lvl + 1}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--vi)" }}>{pct2}%</span>
              </Row>
              <div className="xpbar"><span style={{ width: `${pct2}%` }} /></div>
            </div>
          </div>
        </Row>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
        {[
          { id: "trivia", emoji: "🧠", title: "Trivia LFT & GFP", desc: "Responde 5 preguntas sobre la LFT y las normas de GFP. Gana hasta +150 XP por ronda.", xp: "+150 XP", color: "var(--cy)" },
          { id: "streak", emoji: "🔥", title: "Reto de racha", desc: "Responde 1 pregunta diaria sin fallar. Cada día suma a tu racha y multiplica tus recompensas.", xp: "+20–60 XP", color: "var(--am)" },
          { id: "word", emoji: "🔤", title: "Encuentra la palabra", desc: "Encuentra términos del glosario GFP en un crucigrama interactivo. Rápido = más puntos.", xp: "+80 XP", color: "var(--em)" },
        ].map((g) => (
          <div key={g.id} className="g card-hover" style={{ padding: 20, cursor: "pointer" }} onClick={() => setGame(g.id)}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{g.emoji}</div>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{g.title}</div>
            <div className="mu" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>{g.desc}</div>
            <Row style={{ justifyContent: "space-between" }}>
              <span className="mono" style={{ color: g.color, fontSize: 13 }}>{g.xp}</span>
              <button className="btn btn-sm" style={{ color: g.color, borderColor: `${g.color}44` }}>Jugar →</button>
            </Row>
          </div>
        ))}
      </div>
      <div className="g2" style={{ padding: "14px 18px", marginTop: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Tabla de posiciones · Planta Vallejo</div>
        <table className="tbl"><thead><tr><th>#</th><th>Colaborador</th><th>Nivel</th><th>XP</th><th>Racha</th></tr></thead>
          <tbody>
            {[["🥇","Sofía Hernández","4 · Embajador","2140","12d"],["🥈","Mariana Torres","3 · Referente","1240","7d"],["🥉","Diego Ramírez","3 · Referente","1190","5d"],["4","Andrea Flores","2 · Comprometido","860","3d"],["5","Omar Galindo","2 · Comprometido","710","2d"]].map(([p, n, lv, xp, st], i) => (
              <tr key={i} style={{ cursor: "default", background: i === 1 ? "rgba(86,212,240,.06)" : "" }}>
                <td style={{ fontWeight: 700 }}>{p}</td><td style={{ fontWeight: i === 1 ? 700 : 400 }}>{n}{i === 1 && <span className="mu2" style={{ fontSize: 10, marginLeft: 6 }}>← tú</span>}</td>
                <td className="mu">{lv}</td><td className="mono" style={{ color: "var(--vi)" }}>{xp}</td><td className="mono" style={{ color: "var(--am)" }}>{st}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TriviaGame({ onBack, onXp }) {
  const qs = useMemo(() => [...TRIVIA].sort(() => Math.random() - .5).slice(0, 5), []);
  const [i, setI] = useState(0); const [ans, setAns] = useState(null); const [score, setScore] = useState(0); const [done, setDone] = useState(false);
  const q = qs[i];
  const pick = (j) => {
    if (ans !== null) return; setAns(j);
    const ok = j === q.ok;
    setTimeout(() => {
      const ns = score + (ok ? 1 : 0);
      if (i < qs.length - 1) { setI((x) => x + 1); setAns(null); setScore(ns); }
      else { const gained = ns * 30; onXp(gained); setDone({ ns, gained }); }
    }, 900);
  };
  return (
    <div className="pf">
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={onBack}>← Volver</button>
      <Ey>Trivia LFT & GFP · Pregunta {i + 1}/{qs.length}</Ey>
      {!done ? (
        <>
          <div style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.5, margin: "14px 0 22px", maxWidth: 580 }}>{q.q}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
            {q.ops.map((o, j) => <button key={j} className={`qopt ${ans === j ? (j === q.ok ? "corr" : "wrong") : (ans !== null && j === q.ok ? "corr" : "")}`} onClick={() => pick(j)} disabled={ans !== null}>{o}</button>)}
          </div>
          <div style={{ marginTop: 18, maxWidth: 560 }}><ProgBar pct={(i / qs.length) * 100} /></div>
        </>
      ) : (
        <div style={{ textAlign: "center", maxWidth: 380, margin: "30px auto" }}>
          <div style={{ fontSize: 64 }}>{done.ns >= 4 ? "🎉" : done.ns >= 2 ? "👍" : "😓"}</div>
          <div className="mono" style={{ fontSize: 40, fontWeight: 700, color: "var(--vi)", margin: "14px 0" }}>+{done.gained} XP</div>
          <div className="mu" style={{ fontSize: 15, marginBottom: 22 }}>{done.ns} de {qs.length} correctas</div>
          <button className="btn btn-cy" style={{ justifyContent: "center" }} onClick={onBack}>← Volver a juegos</button>
        </div>
      )}
    </div>
  );
}

function StreakGame({ onBack, onXp }) {
  const [ans, setAns] = useState(null); const [claimed, setClaimed] = useState(false);
  const q = TRIVIA[new Date().getDay() % TRIVIA.length];
  const pick = (j) => {
    if (ans !== null) return; setAns(j);
    if (j === q.ok) { const xp = Math.min(20 + ME.streak * 5, 60); onXp(xp); setClaimed(true); }
  };
  return (
    <div className="pf">
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={onBack}>← Volver</button>
      <Ey>🔥 Reto de racha diaria · día {ME.streak}</Ey>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.5, margin: "14px 0 22px", maxWidth: 580 }}>{q.q}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
        {q.ops.map((o, j) => <button key={j} className={`qopt ${ans === j ? (j === q.ok ? "corr" : "wrong") : (ans !== null && j === q.ok ? "corr" : "")}`} onClick={() => pick(j)} disabled={ans !== null}>{o}</button>)}
      </div>
      {claimed && <div style={{ marginTop: 22, fontSize: 16, color: "var(--em)", fontWeight: 600 }}>¡Racha extendida! +{Math.min(20 + ME.streak * 5, 60)} XP 🔥</div>}
    </div>
  );
}

function WordGame({ onBack, onXp }) {
  const WORDS = ["HACCP", "INOCUIDAD", "JORNADA", "VACACIONES", "AGUINALDO"];
  const HIDDEN = WORDS[Math.floor(Math.random() * WORDS.length)];
  const [guess, setGuess] = useState(""); const [tries, setTries] = useState([]); const [done, setDone] = useState(false); const [win, setWin] = useState(false);
  const attempt = () => {
    const w = guess.trim().toUpperCase(); if (w.length === 0 || tries.includes(w)) return;
    const nt = [...tries, w]; setTries(nt);
    if (w === HIDDEN) { setWin(true); setDone(true); const xp = Math.max(80 - nt.length * 10, 20); onXp(xp); }
    else if (nt.length >= 5) setDone(true);
    setGuess("");
  };
  const hint = (g, h) => g.split("").map((c, i) => ({ c, s: c === h[i] ? "exact" : h.includes(c) ? "close" : "miss" }));
  return (
    <div className="pf">
      <button className="btn btn-sm" style={{ marginBottom: 16 }} onClick={onBack}>← Volver</button>
      <Ey>🔤 Adivina el término GFP · {HIDDEN.length} letras</Ey>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "18px 0", maxWidth: 380 }}>
        {tries.map((g, i) => (
          <Row key={i} style={{ gap: 6 }}>
            {hint(g.padEnd(HIDDEN.length), HIDDEN).map((h, j) => (
              <div key={j} style={{ width: 38, height: 38, borderRadius: 8, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16, background: h.s === "exact" ? "var(--em)" : h.s === "close" ? "var(--am)" : "rgba(255,255,255,.08)", color: h.s === "miss" ? "var(--mu)" : "#030508" }}>{h.c}</div>
            ))}
          </Row>
        ))}
        {Array.from({ length: Math.max(0, 5 - tries.length) }).map((_, i) => (
          <Row key={`e${i}`} style={{ gap: 6 }}>{Array.from({ length: HIDDEN.length }).map((_, j) => <div key={j} style={{ width: 38, height: 38, borderRadius: 8, background: "rgba(255,255,255,.05)", border: "1px solid var(--bd)" }} />)}</Row>
        ))}
      </div>
      {!done ? (
        <Row style={{ gap: 10, maxWidth: 380 }}>
          <input className="inp" value={guess} onChange={(e) => setGuess(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && attempt()} placeholder="Escribe y presiona Enter…" maxLength={HIDDEN.length} />
          <button className="btn btn-em" onClick={attempt}>→</button>
        </Row>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: win ? "var(--em)" : "var(--ro)", marginBottom: 8 }}>{win ? "¡Correcto! 🎉" : `Era: ${HIDDEN}`}</div>
          <button className="btn btn-cy" onClick={onBack}>← Volver a juegos</button>
        </div>
      )}
      <div className="mu" style={{ fontSize: 12, marginTop: 14 }}>🟩 posición exacta · 🟨 letra presente · ⬜ no está</div>
    </div>
  );
}

/* ─── NAV CONFIG ─── */
const PAGES = [
  { id: "inicio",      label: "Inicio",       icon: "⌂",   emoji: "🏠" },
  { id: "nomina",      label: "Nómina",        icon: "₿",   emoji: "💰" },
  { id: "vacaciones",  label: "Vacaciones",    icon: "⛱",   emoji: "🌴" },
  { id: "actas",       label: "Actas",         icon: "⚖",   emoji: "⚖️" },
  { id: "bonos",       label: "Bonos",         icon: "★",   emoji: "⭐" },
  { id: "menciones",   label: "Menciones",     icon: "◈",   emoji: "🏅" },
  { id: "capacitacion",label: "Capacitación",  icon: "⬡",   emoji: "🎓" },
  { id: "juegos",      label: "Juegos",        icon: "◉",   emoji: "🕹️" },
];

/* ─── ROOT APP ─── */
export default function App() {
  const [view, setView] = useState("inicio");
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _addToast = (msg, kind = "ok") => {
      const id = Math.random(); setToasts((t) => [...t, { id, msg, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
    };
  }, []);

  return (
    <div className="shell">
      <style>{CSS}</style>
      <div className="bg"><div className="b1" /><div className="b2" /><div className="b3" /><div className="gridline" /><div className="scanline" /></div>

      <div className="content">
        {/* top bar */}
        <header style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(3,6,12,.8)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", borderBottom: "1px solid rgba(255,255,255,.06)", padding: "0 16px" }}>
          <Row style={{ gap: 12, height: 56 }}>
            <Row style={{ gap: 9, flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,rgba(86,212,240,.2),rgba(167,139,250,.15))", border: "1px solid rgba(86,212,240,.3)", display: "grid", placeItems: "center", boxShadow: "0 0 14px -5px rgba(86,212,240,.5)" }}>
                <svg width="18" height="18" viewBox="0 0 30 30" fill="none">
                  <circle cx="15" cy="15" r="3" fill="#56d4f0"/>
                  <circle cx="15" cy="4" r="1.5" fill="#a78bfa" opacity=".9"/>
                  <circle cx="24" cy="20" r="1.5" fill="#4fd6a3" opacity=".9"/>
                  <circle cx="6" cy="20" r="1.5" fill="#a78bfa" opacity=".9"/>
                  <line x1="15" y1="12" x2="15" y2="5.5" stroke="#56d4f0" strokeWidth="1.2" opacity=".6"/>
                  <line x1="15" y1="18" x2="23" y2="19" stroke="#56d4f0" strokeWidth="1.2" opacity=".6"/>
                  <line x1="15" y1="18" x2="7" y2="19" stroke="#56d4f0" strokeWidth="1.2" opacity=".6"/>
                </svg>
              </div>
              <div style={{ lineHeight: 1 }}>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13, letterSpacing: ".08em", background: "linear-gradient(135deg,var(--cy),var(--vi))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>CÓDICE</div>
                <div className="mu2" style={{ fontSize: 8.5, fontFamily: "var(--mono)", letterSpacing: ".16em", textTransform: "uppercase" }}>portal empleado</div>
              </div>
            </Row>
            <SearchBar onNavigate={(v) => setView(v)} />
            <Row style={{ gap: 8, marginLeft: "auto", flexShrink: 0 }}>
              <div className="g2" style={{ padding: "5px 10px", borderRadius: 9, border: "1px solid rgba(245,181,68,.2)", background: "rgba(245,181,68,.07)" }}>
                <Row style={{ gap: 6 }}><span style={{ fontSize: 14 }}>🔥</span><span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--am)" }}>{ME.streak}</span></Row>
              </div>
              <Avatar size={32} />
            </Row>
          </Row>
          <div className="hud-line" />
        </header>

        <div style={{ display: "flex", flex: 1 }}>
          {/* sidebar */}
          <aside className="sidebar" style={{ width: 210, padding: "16px 10px", borderRight: "1px solid rgba(255,255,255,.05)", position: "sticky", top: 56, height: "calc(100vh - 56px)", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {PAGES.map((p) => (
              <div key={p.id} className={`npill ${view === p.id ? "on" : ""}`} onClick={() => setView(p.id)}>
                <span className="npill-emoji">{p.emoji}</span>{p.label}
              </div>
            ))}
            <div style={{ flex: 1 }} />
            {/* mini stats */}
            <div className="g2" style={{ padding: 13, marginTop: 8, border: "1px solid rgba(79,214,163,.18)", background: "rgba(79,214,163,.05)" }}>
              <span className="ey">🌴 vacaciones</span>
              <div className="mono" style={{ fontSize: 22, color: "var(--em)", fontWeight: 700, marginBottom: 2 }}>{ME.vacDis} días</div>
              <ProgBar pct={(ME.vacDis / 20) * 100} color="var(--em)" />
              <button className="btn btn-em btn-xsm" style={{ width: "100%", justifyContent: "center", marginTop: 9 }} onClick={() => setView("vacaciones")}>Solicitar →</button>
            </div>
            <div className="g2" style={{ padding: 13, marginTop: 6, border: "1px solid rgba(167,139,250,.18)", background: "rgba(167,139,250,.05)" }}>
              <span className="ey">🕹️ nivel</span>
              <div className="mono" style={{ fontSize: 14, color: "var(--vi)", fontWeight: 700, marginBottom: 2 }}>{curLevel(ME.xp).name}</div>
              <div className="mu" style={{ fontSize: 11, marginBottom: 5 }}>{ME.xp} XP</div>
              <div className="xpbar"><span style={{ width: `${Math.round(((ME.xp - curLevel(ME.xp).min) / (curLevel(ME.xp).max - curLevel(ME.xp).min)) * 100)}%` }} /></div>
            </div>
          </aside>

          {/* main */}
          <main style={{ flex: 1, minWidth: 0, maxWidth: 940, padding: "clamp(14px,4vw,28px) clamp(14px,4vw,28px) 90px" }}>
            {view === "inicio" && <Inicio nav={setView} />}
            {view === "nomina" && <Nomina />}
            {view === "vacaciones" && <Vacaciones />}
            {view === "actas" && <Actas />}
            {view === "bonos" && <Bonos />}
            {view === "menciones" && <Menciones />}
            {view === "capacitacion" && <Capacitacion />}
            {view === "juegos" && <Juegos />}
          </main>
        </div>

        {/* mobile bottom nav */}
        <nav className="bnav">
          {PAGES.slice(0, 5).map((p) => (
            <div key={p.id} className={`bnav-item ${view === p.id ? "on" : ""}`} onClick={() => setView(p.id)}>
              <span className="bnav-emoji">{p.emoji}</span>
              <span className="bnav-label">{p.label}</span>
            </div>
          ))}
        </nav>
      </div>

      <div className="tw">
        {toasts.map((t) => <div key={t.id} className="toast">{t.kind === "ok" ? "✅" : t.kind === "warn" ? "⚠️" : "ℹ️"} {t.msg}</div>)}
      </div>
    </div>
  );
}
