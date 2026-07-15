import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { io } from "socket.io-client";
import {
  Home, Receipt, CalendarDays, Inbox, Megaphone, Bot, Bell,
  X, Check, ChevronRight, ChevronDown, Send, Loader2,
  Award, Flame, AlertTriangle, DollarSign, Clock, FileText, Lock, LogIn, LogOut, MapPin,
  ArrowUp, ArrowDown,
} from "lucide-react";

/* ---------- toast bus (mismo patrón que App.jsx, con estilos emp-*) ---------- */
// kind: "success" (verde + ↑) | "warning" (ámbar + ↓) | "info" (default, sin ícono de diff)
let _empToast = () => {};
const empToast = (msg, kind = "info") => _empToast(msg, kind);

/* ============================================================
   CÓDICE · Shell Colaborador — Fortune 500 redesign
   Solo colaboradores. IA = árbol guiado (sin chat libre).
   Sin Capacitación, sin reporte de incidentes, sin "cambios y
   actualizaciones" — ver spec de la tarea.
   ============================================================ */

// ── API ──────────────────────────────────────────────────────

// En prod, VITE_API_URL apunta al backend desplegado. Sin esa variable
// (dev), usa el mismo host desde el que se sirvió la página (localhost en
// dev de escritorio, la IP de red al abrir desde un teléfono) — "localhost"
// fijo resolvería al propio teléfono, no a esta máquina.
const API_BASE = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001`;
// Puente de login demo (ver loginFlow más abajo) — mismas env vars que App.jsx.
const AUTH = {
  slug: "gfp",
  email: import.meta.env.VITE_ADMIN_EMAIL || "admin@gfp.mx",
  password: import.meta.env.VITE_ADMIN_PASSWORD || "",
};
const DEMO_PASSWORD = "1234";

async function apiAuthLogin(payload) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  console.log("[auth] POST /api/auth/login", { email: payload.email, status: res.status, ok: res.ok, body });
  if (!res.ok) {
    throw new Error(body.error || `Login falló (${res.status})`);
  }
  return body;
}

async function apiLogin() {
  console.log("[auth] apiLogin() — usando credenciales admin hardcoded", AUTH.email);
  return apiAuthLogin(AUTH);
}

// Login del colaborador: intenta el backend real con lo que haya tecleado
// (identificador + password). El backend solo tiene AdminUsers por email,
// así que un número de empleado/RFC normalmente rebota — si la contraseña
// coincide con la clave demo, entramos con el token admin del tenant como
// puente hasta que exista login real de empleados.
async function loginFlow(identifier, password) {
  console.log("[auth] loginFlow() start", { identifier, password });
  try {
    const real = await apiAuthLogin({ slug: AUTH.slug, email: identifier, password });
    console.log("[auth] login real exitoso");
    return real.accessToken;
  } catch (realErr) {
    console.log("[auth] login real falló:", realErr.message);
    if (password === DEMO_PASSWORD) {
      console.log("[auth] password coincide con DEMO_PASSWORD — intentando fallback demo");
      try {
        const demo = await apiLogin();
        console.log("[auth] login demo exitoso");
        return demo.accessToken;
      } catch (demoErr) {
        console.log("[auth] login demo también falló:", demoErr.message);
      }
    } else {
      console.log("[auth] password NO coincide con DEMO_PASSWORD, no hay fallback");
    }
    throw new Error("Credenciales incorrectas. Contacta a tu área de RH.");
  }
}

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

function yearsSince(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  return Math.max(0, years);
}

const mxn = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n) || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—");
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—");
const todayISO = () => new Date().toISOString().slice(0, 10);

// Cuenta de `from` a `to` en `ms` — usado para animar el monto del hero
// cuando llega un payroll:updated en vivo. Devuelve una función de cleanup
// que cancela el frame pendiente si el componente se desmonta antes.
function animateCountUp(from, to, ms, onTick) {
  const start = performance.now();
  const delta = to - from;
  let raf;
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    onTick(from + delta * eased);
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

// Folio de exhibición — determinista a partir del id real del request,
// no es un campo del backend (la tabla `requests` no tiene folio).
function folioFor(typeCode, id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const num = String(hash % 10000).padStart(4, "0");
  return `GFP-2026-${typeCode}-${num}`;
}

// ── count-up hook ────────────────────────────────────────────

function useCountUp(value, duration = 600) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const target = Number(value) || 0;
    let start = null;
    let raf;
    const step = (ts) => {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

// ── motivational phrase pool ─────────────────────────────────

const PHRASES = [
  "El trabajo de hoy es la reputación de mañana.",
  "Cada turno es una oportunidad de dejar algo mejor de lo que encontraste.",
  "La consistencia hace la diferencia. No la intensidad ocasional.",
  "Lo que haces hoy importa más de lo que planeas hacer algún día.",
  "El talento te lleva a la puerta. El compromiso te mantiene adentro.",
  "Pequeñas mejoras diarias llevan a resultados extraordinarios.",
  "No tienes que ser el mejor. Tienes que ser mejor que ayer.",
  "El orgullo profesional no se hereda — se construye turno a turno.",
  "Tu trabajo tiene impacto aunque no siempre lo veas.",
  "La excelencia no es un acto, es un hábito.",
  "Haz bien lo que haces, aunque nadie esté mirando.",
  "El esfuerzo silencioso es el más poderoso.",
  "Tu nombre está en lo que produces.",
  "Cada día de trabajo honesto suma a algo más grande.",
  "El respeto se gana en los momentos ordinarios, no solo en los extraordinarios.",
  "Lo mejor que puedes dar es tu mejor versión hoy.",
  "El mar en calma no forma marineros expertos.",
  "Trabaja con orgullo o no trabajes.",
  "El carácter se revela en lo que haces cuando nadie te evalúa.",
  "Un paso adelante cada día es suficiente para llegar lejos.",
];

// ── Canvas 2D background — constelación ──────────────────────
// Canvas 2D en vez de WebGL/Three: es más liviano, evita problemas de
// compatibilidad de Three r128 en WebGL de algunos móviles, y esta escena
// (puntos + líneas finas) no necesita nada que solo 3D real resolvería.

const STAR_COUNT = 180;
const NODE_COUNT = 28;
const LINE_DIST = 140; // px — conecta nodos dentro de este radio
const MAX_LINKS_PER_NODE = 3;
const HOVER_RADIUS = 80; // px — radio de detección de nodo bajo el cursor

const NODE_BASE = "#3b82f6";
const NODE_TRANSITION = "#60a5fa"; // tono durante la "respiración" de módulo
const LINE_BASE = "#2563eb";
const LINE_TRANSITION = "#60a5fa";
const SUCCESS_COLOR = "#10b981";

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function lerpHex(hexA, hexB, t) { return lerpRgb(hexToRgb(hexA), hexToRgb(hexB), t); }
function rgba(rgb, alpha) { return `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`; }

class ConstellationField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;

    // Estrellas — estáticas, con sesgo hacia el 60% superior de la pantalla.
    // Se guardan en coordenadas normalizadas [0,1] para reescalar en resize().
    this.stars = Array.from({ length: STAR_COUNT }, () => {
      const upperBias = Math.random() < 0.65;
      return {
        xNorm: Math.random(),
        yNorm: upperBias ? rand(0, 0.6) : Math.random(),
        x: 0, y: 0,
        size: rand(0.4, 1.2),
        opacity: rand(0.08, 0.35),
      };
    });

    // Nodos — derivan con trayectorias tipo Lissajous, muy lentas y orgánicas.
    this.nodes = Array.from({ length: NODE_COUNT }, () => {
      const baseSize = rand(1.2, 2.4), baseOpacity = rand(0.5, 0.7);
      return {
        x: rand(0, this.w), y: rand(0, this.h),
        freqX: (Math.PI * 2) / rand(18, 35),
        freqY: (Math.PI * 2) / rand(18, 35),
        phaseX: rand(0, Math.PI * 2),
        phaseY: rand(0, Math.PI * 2),
        ampX: rand(0.012, 0.028),
        ampY: rand(0.012, 0.028),
        baseSize, baseOpacity,
        dispSize: baseSize, dispOpacity: baseOpacity,
      };
    });

    this.edgeOpacity = new Map(); // "i-j" → opacidad actual (lerpeada, nunca salta)

    this.clock0 = performance.now();
    this.hasMouse = false;
    this.mouse = { x: -9999, y: -9999 };
    this._onMove = (e) => { this.hasMouse = true; this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
    this._onLeave = () => { this.hasMouse = false; };
    window.addEventListener("pointermove", this._onMove);
    window.addEventListener("pointerleave", this._onLeave);

    this.transition = null; // "respiro" al abrir un módulo — nunca un estallido
    this.nodePulse = null;  // pulso breve (éxito / micro-feedback)

    this.resize();
  }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const s of this.stars) { s.x = s.xNorm * this.w; s.y = s.yNorm * this.h; }
  }

  /** Transición de módulo: los nodos derivan hacia el borde más cercano,
   *  se atenúan, y regresan a su deriva natural — un respiro, no un estallido. */
  explode() {
    const edgeOf = (x, y) => {
      const dl = x, dr = this.w - x, dt = y, db = this.h - y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) return { x: -20, y };
      if (m === dr) return { x: this.w + 20, y };
      if (m === dt) return { x, y: -20 };
      return { x, y: this.h + 20 };
    };
    this.transition = { t0: performance.now(), edges: this.nodes.map((n) => edgeOf(n.x, n.y)) };
  }

  /** Pulso genérico breve — micro-feedback (ej. expandir una fila). */
  pulse(colorHex = NODE_TRANSITION) { this._triggerPulse(colorHex, 500); }

  /** Éxito: los 3 nodos más cercanos al centro laten en verde, sutil. */
  success() { this._triggerPulse(SUCCESS_COLOR, 1200); }

  _triggerPulse(colorHex, dur) {
    const cx = this.w / 2, cy = this.h / 2;
    const indices = this.nodes
      .map((n, i) => ({ i, d: Math.hypot(n.x - cx, n.y - cy) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((e) => e.i);
    this.nodePulse = { t0: performance.now(), dur, indices, color: colorHex };
  }

  updateNodes(t) {
    for (const n of this.nodes) {
      n.x += Math.sin(t * n.freqX + n.phaseX) * n.ampX;
      n.y += Math.cos(t * n.freqY + n.phaseY) * n.ampY;
      if (n.x < -5) n.x = this.w + 5; else if (n.x > this.w + 5) n.x = -5;
      if (n.y < -5) n.y = this.h + 5; else if (n.y > this.h + 5) n.y = -5;
    }
  }

  // Nodos cercanos entre sí, máx. 3 conexiones por nodo — se procesa por
  // distancia ascendente para que los pares más cercanos ganen su cupo primero.
  computeEdges() {
    const candidates = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      for (let j = i + 1; j < NODE_COUNT; j++) {
        const dx = this.nodes[i].x - this.nodes[j].x, dy = this.nodes[i].y - this.nodes[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < LINE_DIST) candidates.push({ i, j, d });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const degree = new Array(NODE_COUNT).fill(0);
    const edges = new Map();
    for (const { i, j, d } of candidates) {
      if (degree[i] >= MAX_LINKS_PER_NODE || degree[j] >= MAX_LINKS_PER_NODE) continue;
      degree[i]++; degree[j]++;
      edges.set(`${i}-${j}`, { i, j, opacity: (1 - d / LINE_DIST) * 0.18 });
    }
    return edges;
  }

  draw() {
    const now = performance.now();
    const t = (now - this.clock0) / 1000;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    // nodo más cercano al cursor, dentro del radio de hover
    let hoverIdx = -1;
    if (this.hasMouse) {
      let best = HOVER_RADIUS;
      for (let i = 0; i < NODE_COUNT; i++) {
        const d = Math.hypot(this.nodes[i].x - this.mouse.x, this.nodes[i].y - this.mouse.y);
        if (d < best) { best = d; hoverIdx = i; }
      }
    }

    // transición de módulo (respiro) — ver explode()
    let phase = null;
    if (this.transition) {
      const elapsed = now - this.transition.t0;
      const DISPERSE = 600, DIM = 300, HOLD = 150, RETURN = 800;
      const totalOut = DISPERSE + DIM + HOLD, total = totalOut + RETURN;
      if (elapsed >= total) this.transition = null;
      else phase = { elapsed, DISPERSE, DIM, HOLD, RETURN, totalOut };
    }
    if (!phase || phase.elapsed >= phase.totalOut) this.updateNodes(t);

    const targetEdges = this.computeEdges();
    for (const key of targetEdges.keys()) if (!this.edgeOpacity.has(key)) this.edgeOpacity.set(key, 0);

    // vecinos del nodo en hover, según la conectividad actual
    const hoverNeighbors = new Set();
    if (hoverIdx >= 0) {
      for (const { i, j } of targetEdges.values()) {
        if (i === hoverIdx) hoverNeighbors.add(j);
        if (j === hoverIdx) hoverNeighbors.add(i);
      }
    }

    // pulso activo (éxito / micro-feedback)
    let pulseFactor = 0, pulseSet = null;
    if (this.nodePulse) {
      const p = clamp01((now - this.nodePulse.t0) / this.nodePulse.dur);
      if (p >= 1) { this.nodePulse = null; }
      else { pulseFactor = Math.sin(p * Math.PI); pulseSet = new Set(this.nodePulse.indices); }
    }

    // posiciones y tinte de color según la fase de transición (si hay una)
    const drawX = new Array(NODE_COUNT), drawY = new Array(NODE_COUNT);
    let globalOpacityMul = 1, colorT = 0;
    if (phase) {
      const { elapsed, DISPERSE, DIM, totalOut, RETURN } = phase;
      if (elapsed < DISPERSE) {
        const e = easeInOutCubic(elapsed / DISPERSE);
        for (let i = 0; i < NODE_COUNT; i++) {
          const edge = this.transition.edges[i];
          drawX[i] = this.nodes[i].x + (edge.x - this.nodes[i].x) * e;
          drawY[i] = this.nodes[i].y + (edge.y - this.nodes[i].y) * e;
        }
        globalOpacityMul = 1 - 0.7 * e;
        colorT = e;
      } else if (elapsed < totalOut) {
        for (let i = 0; i < NODE_COUNT; i++) { drawX[i] = this.transition.edges[i].x; drawY[i] = this.transition.edges[i].y; }
        globalOpacityMul = 0.3;
        colorT = 1;
        void DIM;
      } else {
        const e = easeInOutCubic((elapsed - totalOut) / RETURN);
        for (let i = 0; i < NODE_COUNT; i++) {
          const edge = this.transition.edges[i];
          drawX[i] = edge.x + (this.nodes[i].x - edge.x) * e;
          drawY[i] = edge.y + (this.nodes[i].y - edge.y) * e;
        }
        globalOpacityMul = 0.3 + 0.7 * e;
        colorT = 1 - e;
      }
    } else {
      for (let i = 0; i < NODE_COUNT; i++) { drawX[i] = this.nodes[i].x; drawY[i] = this.nodes[i].y; }
    }

    // ── estrellas: estáticas, sin animación ──
    for (const s of this.stars) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${s.opacity})`;
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── líneas: opacidad siempre lerpeada, nunca instantánea ──
    for (const key of this.edgeOpacity.keys()) {
      const edge = targetEdges.get(key);
      const [ni, nj] = key.split("-").map(Number);
      const baseTarget = edge ? edge.opacity : 0;
      const isHoverConnected = hoverIdx === ni || hoverIdx === nj;
      const target = isHoverConnected ? Math.max(baseTarget, 0.35) : baseTarget;
      const current = this.edgeOpacity.get(key);
      const growing = target > current;
      const rate = isHoverConnected ? (growing ? 0.12 : 0.08) : 0.05;
      let next = current + (target - current) * rate;
      if (!edge && next < 0.002) { this.edgeOpacity.delete(key); continue; }
      this.edgeOpacity.set(key, next);

      if (pulseSet && (pulseSet.has(ni) || pulseSet.has(nj))) next += (0.4 - next) * pulseFactor;
      const op = next * globalOpacityMul;
      if (op <= 0.002) continue;

      ctx.strokeStyle = rgba(lerpHex(LINE_BASE, LINE_TRANSITION, colorT), op);
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(drawX[ni], drawY[ni]);
      ctx.lineTo(drawX[nj], drawY[nj]);
      ctx.stroke();
    }

    // ── nodos: tamaño/opacidad lerpeados (hover) + tinte (transición/pulso) ──
    for (let i = 0; i < NODE_COUNT; i++) {
      const n = this.nodes[i];
      let targetOpacity = n.baseOpacity, targetSize = n.baseSize;
      if (hoverIdx === i) { targetOpacity = 0.95; targetSize = 3.5; }
      else if (hoverNeighbors.has(i)) { targetOpacity = 0.8; }
      const growing = targetOpacity > n.dispOpacity || targetSize > n.dispSize;
      const k = growing ? 0.12 : 0.06; // ~400ms al entrar en hover, ~600ms al salir
      n.dispOpacity += (targetOpacity - n.dispOpacity) * k;
      n.dispSize += (targetSize - n.dispSize) * k;

      let size = n.dispSize;
      let rgb = lerpHex(NODE_BASE, NODE_TRANSITION, colorT);
      if (pulseSet && pulseSet.has(i)) {
        size += (4 - n.baseSize) * pulseFactor;
        rgb = lerpRgb(rgb, hexToRgb(this.nodePulse.color), pulseFactor);
      }

      ctx.beginPath();
      ctx.fillStyle = rgba(rgb, n.dispOpacity * globalOpacityMul);
      ctx.arc(drawX[i], drawY[i], size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose() {
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerleave", this._onLeave);
  }
}

function useParticleField(canvasRef) {
  const fieldRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const field = new ConstellationField(canvasRef.current);
    fieldRef.current = field;
    let raf;
    const loop = () => { field.draw(); raf = requestAnimationFrame(loop); };
    loop();
    const onResize = () => field.resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      field.dispose();
      fieldRef.current = null;
    };
  }, [canvasRef]);
  return fieldRef;
}

// ── CSS — enterprise glassmorphism design system ────────────

const CSS = `
:root{
  --bg-base:#020917; --bg-deep:#030d1f;
  --surface-1:rgba(6,20,45,.85); --surface-2:rgba(10,28,60,.70); --surface-3:rgba(15,35,75,.50);
  --border-dim:rgba(255,255,255,.06); --border-glow:rgba(255,255,255,.14);
  --text-primary:#f0f4ff; --text-secondary:rgba(240,244,255,.62); --text-muted:rgba(240,244,255,.35);
  --accent-blue:#2563eb; --accent-blue-bright:#3b82f6;
  --accent-green:#10b981; --accent-green-dim:rgba(16,185,129,.15);
  --accent-amber:#f59e0b; --accent-red:#ef4444; --accent-white:#fff;
}
.empshell{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text-primary);min-height:100vh;position:relative}
.empshell .mono{font-family:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
.emp-canvas{position:fixed;inset:0;z-index:0;width:100vw;height:100vh;pointer-events:none}
.emp-bgwash{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(ellipse at 20% 50%, rgba(37,99,235,.12) 0%, transparent 60%),
    radial-gradient(ellipse at 80% 20%, rgba(16,185,129,.08) 0%, transparent 50%),
    var(--bg-base)}
.emp-app{position:relative;z-index:1;max-width:430px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
.emp-glass{background:var(--surface-1);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);
  border:1px solid var(--border-dim);border-radius:16px;
  box-shadow:0 0 0 1px rgba(255,255,255,.04) inset, 0 4px 24px rgba(0,0,10,.4), 0 1px 0 rgba(255,255,255,.08) inset;
  transition:border-color .18s, transform .18s}
.emp-glass:active{transform:scale(.995)}
.emp-eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
.emp-h1{font-size:22px;font-weight:300;letter-spacing:-.02em;margin:4px 0 16px;color:var(--text-primary)}
.emp-muted{color:var(--text-secondary)}
.emp-body{font-size:14px;line-height:1.6;color:var(--text-secondary)}

.emp-topbar{position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:430px;height:56px;z-index:8;
  display:flex;align-items:center;justify-content:space-between;padding:0 16px;
  background:rgba(2,9,23,.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
.emp-topbar-brand{font-size:13px;font-weight:700;color:var(--accent-blue-bright);letter-spacing:-.01em}
.emp-topbar-name{font-size:14px;font-weight:600;color:var(--text-primary)}
.emp-topbar-bell{position:relative;color:var(--text-secondary);cursor:pointer}
.emp-topbar-dot{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:var(--accent-red);box-shadow:0 0 0 2px rgba(2,9,23,.92)}
.emp-xpbar-track{position:fixed;top:56px;left:50%;transform:translateX(-50%);width:100%;max-width:430px;height:2px;z-index:8;background:rgba(255,255,255,.06)}
.emp-xpbar-fill{height:100%;background:linear-gradient(90deg,var(--accent-blue),var(--accent-blue-bright));transition:width .8s cubic-bezier(.22,1,.36,1)}

.emp-main{flex:1;overflow-y:auto;padding:72px 16px 88px}

.emp-nav{position:fixed;left:50%;transform:translateX(-50%);bottom:0;z-index:8;width:100%;max-width:430px;height:64px;
  display:flex;justify-content:space-around;align-items:center;
  background:rgba(2,9,23,.96);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid var(--border-dim)}
.emp-navitem{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--text-muted);cursor:pointer;
  padding:6px 10px;border-radius:12px;transition:color .15s}
.emp-navitem.on{color:var(--accent-blue-bright)}
.emp-navdot-active{width:3px;height:3px;border-radius:50%;background:var(--accent-blue-bright);position:absolute;bottom:-2px}
.emp-navlabel{font-size:10px;font-weight:600}
.emp-navbadge{position:absolute;top:-3px;right:2px;min-width:14px;height:14px;padding:0 3px;border-radius:999px;background:var(--accent-red);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center}

.emp-statcard{display:flex;align-items:center;justify-content:space-between;height:88px;padding:0 18px;border-left:2px solid var(--accent-green);margin-bottom:12px}
.emp-statcard.amber{border-left-color:var(--accent-amber)}
.emp-statcard-icon{width:40px;height:40px;border-radius:999px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.emp-statvalue{font-size:28px;font-weight:600;color:var(--text-primary);line-height:1}
.emp-card{padding:16px;margin-bottom:12px}

.emp-btn-primary{height:56px;border-radius:14px;border:none;color:#fff;font-size:16px;font-weight:700;width:100%;
  display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;
  background:linear-gradient(135deg,#2563eb,#1d4ed8);box-shadow:0 4px 14px rgba(37,99,235,.4);transition:transform .12s ease-out}
.emp-btn-primary:active{transform:scale(.98);transition:transform .08s ease-out}
.emp-btn-primary:disabled{opacity:.5;cursor:default}
.emp-btn-secondary{height:50px;border-radius:12px;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.4);color:var(--accent-blue-bright);
  font-size:15px;font-weight:600;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:transform .12s ease-out,border-color .15s}
.emp-btn-secondary:hover{border-color:var(--accent-blue-bright)}
.emp-btn-secondary:active{transform:scale(.98);transition:transform .08s ease-out,border-color .15s}

.emp-input,.emp-select,.emp-textarea{width:100%;font-size:13.5px;color:var(--text-primary);background:rgba(0,0,0,.3);
  border:1px solid var(--border-dim);border-radius:10px;padding:11px 12px;outline:none}
.emp-input:focus,.emp-textarea:focus,.emp-select:focus{border-color:var(--accent-blue)}
.emp-label{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;font-weight:600}

.emp-badge{font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;border:1px solid transparent}
.emp-badge.manager{color:var(--accent-amber);background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.3)}
.emp-badge.workforce{color:var(--accent-blue-bright);background:rgba(37,99,235,.14);border-color:rgba(37,99,235,.3)}
.emp-badge.approved{color:var(--accent-green);background:var(--accent-green-dim);border-color:rgba(16,185,129,.3)}
.emp-badge.rejected{color:var(--accent-red);background:rgba(239,68,68,.14);border-color:rgba(239,68,68,.3)}
.emp-badge.cancelled{color:var(--text-muted);background:rgba(74,96,128,.14);border-color:rgba(74,96,128,.3)}

.emp-folio{padding:18px;border-radius:16px;border:1px dashed rgba(16,185,129,.4);background:var(--accent-green-dim);text-align:center;position:relative;overflow:hidden}
.emp-folio-perf{height:6px;margin:14px -18px -18px;background-image:radial-gradient(circle,rgba(2,9,23,.9) 2.5px,transparent 2.6px);background-size:12px 12px;background-position:top}

.emp-row{display:flex;align-items:center}
.emp-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}

.emp-iacard{aspect-ratio:1;border-radius:16px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;cursor:pointer}
.emp-iacard.locked{filter:grayscale(.8);opacity:.75;position:relative}
.emp-premium-badge{position:absolute;top:10px;right:10px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--accent-green);background:var(--accent-green-dim);border:1px solid rgba(16,185,129,.35);border-radius:999px;padding:2px 7px}

.emp-sheet-scrim{position:fixed;inset:0;z-index:20;background:rgba(2,9,23,.7);backdrop-filter:blur(4px)}
.emp-sheet{position:fixed;left:0;right:0;bottom:0;margin:0 auto;width:100%;max-width:430px;z-index:21;
  background:var(--bg-deep);border-top-left-radius:22px;border-top-right-radius:22px;border:1px solid var(--border-dim);
  max-height:82vh;display:flex;flex-direction:column;box-shadow:0 -12px 40px rgba(0,0,10,.6)}
.emp-sheet-handle{width:32px;height:4px;border-radius:999px;background:var(--surface-3);margin:10px auto}
.emp-sheet-body{padding:6px 18px 26px;overflow-y:auto}
.emp-sheetrow{height:56px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-dim);cursor:pointer}
.emp-sheetrow:last-child{border-bottom:none}

.emp-flagscreen{position:fixed;inset:0;z-index:30;background:rgba(2,9,23,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;text-align:center}

.emp-greet{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center}
.emp-greet-content{position:absolute;top:32%;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding:0 30px}
.emp-greet-logo{font-size:15px;font-weight:700;letter-spacing:-.01em;color:var(--accent-blue-bright);margin-bottom:24px}
.emp-greet-name{font-size:36px;font-weight:700;letter-spacing:-.02em;color:var(--text-primary);text-align:center;
  text-shadow:0 0 40px rgba(37,99,235,.5)}
.emp-greet-badge{margin-top:14px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;padding:6px 14px;border-radius:999px;
  background:var(--surface-2);backdrop-filter:blur(20px);border:1px solid rgba(37,99,235,.3);color:var(--text-secondary)}
.emp-greet-divider{margin:20px 0;height:1px;background:rgba(255,255,255,.18)}
.emp-greet-phrase{font-size:18px;font-weight:400;font-style:italic;color:var(--text-secondary);
  max-width:280px;text-align:center;line-height:1.5}
.emp-greet-cta{position:absolute;bottom:48px;left:0;right:0;text-align:center;font-size:11px;color:var(--text-muted);
  opacity:0;animation:emp-cta-in .4s ease 1.8s forwards, emp-cta-pulse 2s ease-in-out 2.2s infinite}
@keyframes emp-cta-in{from{opacity:0}to{opacity:.5}}
@keyframes emp-cta-pulse{0%,100%{opacity:.5}50%{opacity:.3}}

.emp-typing span{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--text-muted);margin:0 1px;animation:empblink 1.2s infinite}
.emp-typing span:nth-child(2){animation-delay:.2s}.emp-typing span:nth-child(3){animation-delay:.4s}
@keyframes empblink{0%,60%,100%{opacity:.25}30%{opacity:1}}
@keyframes empspin{to{transform:rotate(360deg)}}

.emp-login{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 28px}
.emp-login-logo{font-size:24px;font-weight:700;letter-spacing:-.01em;color:var(--accent-blue-bright);text-align:center}
.emp-login-sub{font-size:13px;color:var(--text-muted);text-align:center;margin-top:6px}
.emp-login-form{width:100%;max-width:340px;margin-top:56px}
.emp-login-error{margin-top:16px;text-align:center;font-size:12px;font-weight:600;color:var(--accent-red);
  background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.35);border-radius:999px;padding:9px 16px}
.emp-login-help{margin-top:20px;text-align:center;font-size:11px;color:var(--text-muted)}

.emp-balancehero{padding:22px 4px 26px;text-align:center;border-bottom:1px solid var(--border-dim);margin-bottom:18px}
.emp-balancehero-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
.emp-balancehero-amount{font-size:42px;font-weight:600;letter-spacing:-.03em;color:var(--text-primary);margin-top:8px;line-height:1}
.emp-balancehero-period{font-size:12px;color:var(--text-muted);margin-top:8px}

.emp-payrow{display:flex;align-items:center;justify-content:space-between;padding:14px 2px;border-bottom:1px solid var(--border-dim);cursor:pointer}
.emp-payrow:last-child{border-bottom:none}
.emp-payrow-icon{width:36px;height:36px;border-radius:10px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0}

.emp-iarow-list{display:flex;flex-direction:column}
.emp-iarow{display:flex;align-items:center;gap:14px;height:72px;cursor:pointer;border-bottom:1px solid var(--border-dim)}
.emp-iarow:last-child{border-bottom:none}
.emp-iarow.locked{opacity:.75}
.emp-iarow-icon{width:40px;height:40px;border-radius:50%;background:var(--surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.emp-iarow-title{font-size:15px;font-weight:500;color:var(--text-primary);display:flex;align-items:center}
.emp-iarow-sub{font-size:12px;color:var(--text-muted);margin-top:2px}

.emp-toastwrap{position:fixed;top:64px;left:50%;transform:translateX(-50%);width:100%;max-width:390px;z-index:999;
  display:flex;flex-direction:column;gap:8px;padding:0 16px;pointer-events:none}
.emp-toast{background:var(--surface-1);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border:1px solid var(--border-glow);border-radius:12px;padding:11px 15px;font-size:13px;color:var(--text-primary);
  box-shadow:0 12px 30px -12px rgba(0,0,10,.6);animation:emp-toastin .25s ease;
  display:flex;align-items:center;gap:8px;pointer-events:auto;cursor:pointer}
.emp-toast-success{border-color:var(--accent-green)}
.emp-toast-warning{border-color:var(--accent-amber)}
@keyframes emp-toastin{from{transform:translateY(-8px);opacity:0}to{transform:translateY(0);opacity:1}}
`;

// ── transiciones — editorial: crossfade puro, sin spring ni desplazamiento ──
// "Como pasar la página de una revista de lujo" — sin slides, sin bounce.

const PAGE_EXIT = { duration: 0.18, ease: [0.4, 0, 1, 1] };
const PAGE_ENTER = { duration: 0.28, ease: [0, 0, 0.2, 1], delay: 0.04 };
const PAGE_FADE = { initial: { opacity: 0 }, animate: { opacity: 1, transition: PAGE_ENTER }, exit: { opacity: 0, transition: PAGE_EXIT } };

function cardAppear(index) {
  return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.24, ease: [0, 0, 0.2, 1], delay: index * 0.06 } };
}

// ── atoms ────────────────────────────────────────────────────

function Eyebrow({ children }) { return <div className="emp-eyebrow">{children}</div>; }

function StatCard({ label, value, icon: Icon, sub, accent = "green" }) {
  const display = useCountUp(value);
  return (
    <div className={`emp-glass emp-statcard ${accent}`}>
      <div>
        <Eyebrow>{label}</Eyebrow>
        <div className="mono emp-statvalue" style={{ marginTop: 6 }}>{display}</div>
        {sub && <div className="emp-muted" style={{ fontSize: 11, marginTop: 3 }}>{sub}</div>}
      </div>
      <div className="emp-statcard-icon"><Icon size={18} color={accent === "amber" ? "var(--accent-amber)" : "var(--accent-green)"} /></div>
    </div>
  );
}

function StatusBadge({ stage }) {
  const map = {
    MANAGER: { cls: "manager", label: "Con tu jefe" },
    WORKFORCE: { cls: "workforce", label: "Con RH" },
    APPROVED: { cls: "approved", label: "Aprobada" },
    REJECTED: { cls: "rejected", label: "Rechazada" },
    CANCELLED: { cls: "cancelled", label: "Cancelada" },
  };
  const s = map[stage] || map.MANAGER;
  return <span className={`emp-badge ${s.cls}`}>{s.label}</span>;
}

function FolioReceipt({ folio, note }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.1 }} className="emp-folio">
      <Eyebrow>Solicitud registrada</Eyebrow>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--accent-green)", marginTop: 10 }}>{folio}</div>
      {note && <div className="emp-muted" style={{ fontSize: 12, marginTop: 8 }}>{note}</div>}
      <div className="emp-folio-perf" />
    </motion.div>
  );
}

// Overlays sobre el shell ya montado (canvas + fondo) — nunca reemplazan el
// árbol raíz, para que el canvas del ParticleField exista desde el primer
// render y su efecto de montaje (atado a la identidad estable de canvasRef,
// no a canvasRef.current) capture el elemento real.
function LoadingScreen({ text }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", position: "relative", zIndex: 1 }}>
      <div className="emp-glass emp-card" style={{ textAlign: "center" }}>
        <Loader2 size={22} className="mono" style={{ animation: "empspin 1s linear infinite" }} />
        <div style={{ marginTop: 10 }}>{text}</div>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", position: "relative", zIndex: 1, padding: 20 }}>
      <div className="emp-glass emp-card" style={{ textAlign: "center", maxWidth: 340 }}>
        <AlertTriangle size={22} color="var(--accent-red)" />
        <div style={{ marginTop: 10, color: "var(--accent-red)" }}>{message}</div>
        <button className="emp-btn-primary" style={{ marginTop: 14 }} onClick={onRetry}>Reintentar</button>
      </div>
    </div>
  );
}

// Hook genérico: pide confirmación antes de disparar una acción que hace
// POST — la app siente que autoriza algo, no que le da "enviar" a ciegas.
function useConfirmedAction(action) {
  const [confirm, setConfirm] = useState(null); // { title, detail }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ask = (title, detail) => { setError(null); setConfirm({ title, detail }); };
  const cancel = () => { if (!busy) setConfirm(null); };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirm(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return { confirm, ask, cancel, run, busy, error };
}

function ConfirmSheet({ confirm, busy, error, onConfirm, onCancel, extra }) {
  return (
    <BottomSheet title={confirm.title} onClose={onCancel}>
      {confirm.detail && <div className="emp-body" style={{ marginBottom: extra ? 10 : 20 }}>{confirm.detail}</div>}
      {extra && <div style={{ marginBottom: 20 }}>{extra}</div>}
      <button className="emp-btn-primary" disabled={busy} onClick={onConfirm}>
        {busy ? <Loader2 size={20} style={{ animation: "empspin 1s linear infinite" }} /> : <Check size={20} />} Confirmar y enviar
      </button>
      <button className="emp-btn-secondary" style={{ marginTop: 10 }} onClick={onCancel}>Cancelar</button>
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--accent-red)", textAlign: "center" }}>{error}</div>}
    </BottomSheet>
  );
}

// ── LOGIN SCREEN ─────────────────────────────────────────────

function LoginScreen({ onSuccess }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorKey, setErrorKey] = useState(0);

  const submit = async (e) => {
    e.preventDefault();
    if (!identifier || !password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const token = await loginFlow(identifier, password);
      onSuccess(token);
    } catch (err) {
      setError(err.message || "Credenciales incorrectas. Contacta a tu área de RH.");
      setErrorKey((k) => k + 1);
      setLoading(false);
    }
  };

  return (
    <div className="emp-login">
      <div>
        <div className="emp-login-logo">✦ CÓDICE</div>
        <div className="emp-login-sub">Portal del Colaborador</div>
      </div>
      <form className="emp-login-form" onSubmit={submit}>
        <label className="emp-label">Número de empleado o RFC</label>
        <input
          className="emp-input" style={{ marginBottom: 14 }} autoComplete="username"
          value={identifier} onChange={(e) => setIdentifier(e.target.value)}
        />
        <label className="emp-label">Contraseña</label>
        <input
          className="emp-input" style={{ marginBottom: 24 }} type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="emp-btn-primary" style={{ opacity: loading ? 0.7 : undefined }} disabled={loading || !identifier || !password}>
          {loading ? <Loader2 size={20} style={{ animation: "empspin 1s linear infinite" }} /> : <LogIn size={20} />} Entrar
        </button>
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              key={errorKey}
              className="emp-login-error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="emp-login-help">¿Olvidaste tu acceso? Contacta a tu área de RH</div>
      </form>
    </div>
  );
}

// ── GREET SCREEN ─────────────────────────────────────────────

function GreetScreen({ employee, onDismiss }) {
  const [phrase] = useState(() => PHRASES[Math.floor(Math.random() * PHRASES.length)]);

  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <motion.div
      className="emp-greet"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      onClick={onDismiss}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.3}
      onDragEnd={(_, info) => { if (info.offset.y < -60) onDismiss(); }}
    >
      <div className="emp-greet-content">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.2 }} className="emp-greet-logo">
          ✦ CÓDICE
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.5 }} className="emp-greet-name">
          {employee.first_name} {employee.last_name}
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.8 }} className="emp-greet-badge">
          {employee.department || "Colaborador"}
        </motion.div>
        <motion.div initial={{ width: 0 }} animate={{ width: 40 }} transition={{ duration: 0.4, delay: 0.9 }} className="emp-greet-divider" />
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 1.1 }} className="emp-greet-phrase">
          “{phrase}”
        </motion.div>
      </div>
      <div className="emp-greet-cta">Toca para continuar</div>
    </motion.div>
  );
}

// ── bottom sheet ─────────────────────────────────────────────

function BottomSheet({ title, onClose, children }) {
  return (
    <>
      <motion.div
        className="emp-sheet-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.6, transition: { duration: 0.34 } }}
        exit={{ opacity: 0, transition: { duration: 0.26 } }}
        onClick={onClose}
      />
      <motion.div
        className="emp-sheet"
        initial={{ y: "100%" }}
        animate={{ y: 0, transition: { duration: 0.34, ease: [0.32, 0.72, 0, 1] } }}
        exit={{ y: "100%", transition: { duration: 0.26, ease: [0.4, 0, 1, 1] } }}
      >
        <div className="emp-sheet-handle" />
        <div className="emp-row" style={{ justifyContent: "space-between", padding: "0 18px 10px" }}>
          <div style={{ fontWeight: 500, fontSize: 15 }}>{title}</div>
          <X size={18} style={{ cursor: "pointer", color: "var(--text-muted)" }} onClick={onClose} />
        </div>
        <div className="emp-sheet-body">{children}</div>
      </motion.div>
    </>
  );
}

// ── HOME ─────────────────────────────────────────────────────

function HomeView({ token, employee, unreadCount, onGoAvisos, onGoRecibos, refreshKey }) {
  const payroll = useLatestPayroll(token, employee.id, refreshKey);
  const p = payroll.data;
  const attendance = useTodayAttendance(token, employee.id);
  const a = attendance.data;

  // Cuenta hacia el nuevo neto cuando payroll:updated dispara un refetch —
  // en la primera carga se muestra directo, sin animación.
  const [displayNeto, setDisplayNeto] = useState(null);
  const prevNetoRef = useRef(null);
  useEffect(() => {
    if (p?.net_pay == null) return;
    const next = Number(p.net_pay);
    const prev = prevNetoRef.current;
    prevNetoRef.current = next;
    if (prev == null || prev === next) { setDisplayNeto(next); return; }
    return animateCountUp(prev, next, 800, setDisplayNeto);
  }, [p?.net_pay]);

  const checkin = useConfirmedAction(async () => {
    await apiFetch(token, "/api/attendance/checkin", {
      method: "POST",
      body: JSON.stringify({ employeeId: employee.id, plant: "Planta Vallejo · Acceso principal" }),
    });
    attendance.reload();
  });
  const checkout = useConfirmedAction(async () => {
    await apiFetch(token, "/api/attendance/checkout", { method: "POST", body: JSON.stringify({ employeeId: employee.id }) });
    attendance.reload();
  });

  const workedMin = a?.checkInAt && a?.checkOutAt ? Math.round((new Date(a.checkOutAt) - new Date(a.checkInAt)) / 60000) : null;

  return (
    <motion.div {...PAGE_FADE}>
      <div className="emp-balancehero">
        <div className="emp-balancehero-label">Tu próximo pago</div>
        <div className="mono emp-balancehero-amount">
          {payroll.status === "loading" ? "…" : mxn(displayNeto ?? p?.net_pay)}
        </div>
        <div className="emp-balancehero-period">
          {p ? `Período ${fmtDate(p.period_start)} — ${fmtDate(p.period_end)}` : "Aún no tienes recibos de nómina cargados"}
        </div>
      </div>

      <button className="emp-btn-primary" style={{ marginBottom: 20 }} onClick={onGoRecibos}>
        <Receipt size={20} /> Ver mis recibos de pago
      </button>

      <div className="emp-grid2" style={{ marginBottom: a?.checkInAt ? 8 : 20 }}>
        <button
          className="emp-btn-primary" disabled={!!a?.checkInAt}
          onClick={() => checkin.ask("Registrar entrada", `Hoy · ${fmtTime(new Date())}`)}
        >
          <LogIn size={20} /> Registrar entrada
        </button>
        <button
          className="emp-btn-secondary" disabled={!a?.checkInAt || !!a?.checkOutAt}
          onClick={() => checkout.ask("Registrar salida", `Hoy · ${fmtTime(new Date())}`)}
        >
          <LogOut size={20} /> Registrar salida
        </button>
      </div>
      {a?.checkInAt && !a?.checkOutAt && (
        <div className="emp-row" style={{ gap: 6, marginBottom: 20, fontSize: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-green)", flexShrink: 0 }} />
          <span style={{ color: "var(--accent-green)" }}>En planta desde las {fmtTime(a.checkInAt)}</span>
        </div>
      )}
      {a?.checkOutAt && (
        <div className="emp-row" style={{ gap: 6, marginBottom: 20, fontSize: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", flexShrink: 0 }} />
          <span className="emp-muted">Salida registrada · {Math.floor(workedMin / 60)}h {workedMin % 60}min trabajados</span>
        </div>
      )}

      <Eyebrow>Hola de nuevo</Eyebrow>
      <div className="emp-h1">¡Hola, {employee.first_name}!</div>

      <StatCard label="Nivel XP" value={employee.xp_level ?? 1} icon={Award} sub={`${employee.xp_points ?? 0} XP acumulados`} accent="green" />
      <StatCard label="Racha" value={employee.streak_days ?? 0} icon={Flame} sub="días seguidos" accent="amber" />

      <div className="emp-glass emp-card">
        <div className="emp-row" style={{ justifyContent: "space-between" }}>
          <Eyebrow>Notificaciones</Eyebrow>
          <span className={`emp-badge ${unreadCount ? "rejected" : "approved"}`}>{unreadCount} sin leer</span>
        </div>
      </div>

      <div className="emp-glass emp-card" style={{ cursor: "pointer" }} onClick={onGoAvisos}>
        <div className="emp-row" style={{ justifyContent: "space-between" }}>
          <div>
            <Eyebrow>Avisos de la empresa</Eyebrow>
            <div style={{ fontSize: 13, marginTop: 4 }}>Ver comunicados recientes</div>
          </div>
          <ChevronRight size={18} color="var(--text-muted)" />
        </div>
      </div>

      <AnimatePresence>
        {checkin.confirm && (
          <ConfirmSheet
            confirm={checkin.confirm} busy={checkin.busy} error={checkin.error}
            onConfirm={checkin.run} onCancel={checkin.cancel}
            extra={
              <div style={{ background: "var(--surface-2)", borderLeft: "2px solid var(--accent-amber)", borderRadius: 10, padding: 12 }}>
                <div className="emp-row" style={{ gap: 8 }}>
                  <MapPin size={16} color="var(--accent-amber)" />
                  <span style={{ fontWeight: 500, fontSize: 13 }}>Planta Vallejo</span>
                </div>
              </div>
            }
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {checkout.confirm && (
          <ConfirmSheet confirm={checkout.confirm} busy={checkout.busy} error={checkout.error} onConfirm={checkout.run} onCancel={checkout.cancel} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── RECIBOS ──────────────────────────────────────────────────

function Row({ k, v, tone }) {
  const color = tone === "pos" ? "var(--accent-green)" : tone === "neg" ? "var(--accent-red)" : "var(--text-primary)";
  return (
    <div className="emp-row" style={{ justifyContent: "space-between", padding: "4px 0" }}>
      <span className="emp-muted" style={{ fontSize: 12 }}>{k}</span>
      <span className="mono" style={{ color, fontSize: 12.5, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

function PayrollAIExplain({ token, record, employee }) {
  const [ai, setAi] = useState({ status: "idle", data: null });
  const [rh, setRh] = useState({ status: "idle", folio: null, error: null });

  useEffect(() => {
    const totalDed = Number(record.total_deductions) || 0;
    if (totalDed <= 0) { setAi({ status: "not_applicable", data: null }); return; }
    let cancelled = false;
    setAi({ status: "loading", data: null });
    apiFetch(token, `/api/payroll/${record.id}/explain?audience=employee`)
      .then((res) => { if (!cancelled) setAi(res.applicable ? { status: "ready", data: res } : { status: "not_applicable", data: null }); })
      .catch((e) => { if (!cancelled) setAi({ status: "error", data: null, error: e.message }); });
    return () => { cancelled = true; };
    // record.net_pay / total_deductions en las deps (no solo record.id): un
    // reload en vivo actualiza el MISMO recibo (mismo id) con montos nuevos —
    // el backend ya invalidó el caché de Redis, así que hay que volver a
    // pedir la explicación en vez de confiar en el resultado ya cargado.
  }, [record.id, record.net_pay, record.total_deductions, token]);

  const consultarRH = async () => {
    setRh({ status: "loading", folio: null, error: null });
    try {
      const detail = `Período ${fmtDate(record.period_start)} – ${fmtDate(record.period_end)} · Monto en duda: ${mxn(record.total_deductions)}`;
      const created = await apiFetch(token, "/api/requests", {
        method: "POST",
        body: JSON.stringify({ employeeId: employee.id, type: "Aclaración nómina", detail }),
      });
      setRh({ status: "done", folio: folioFor("NOM", created.id), error: null });
    } catch (e) {
      setRh({ status: "error", folio: null, error: e.message });
    }
  };

  if (ai.status === "not_applicable") return null;

  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div className="emp-row" style={{ gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 15 }}>💬</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>¿Por qué me descontaron esto?</span>
      </div>
      {ai.status === "loading" && <div className="emp-muted" style={{ fontSize: 12.5 }}>Analizando tus deducciones…</div>}
      {ai.status === "error" && <div style={{ fontSize: 12.5, color: "var(--accent-red)" }}>No se pudo generar la explicación.</div>}
      {ai.status === "ready" && (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-primary)" }}>{ai.data.text}</div>
          {rh.status !== "done" ? (
            <button className="emp-btn-secondary" style={{ marginTop: 12, width: "100%" }} disabled={rh.status === "loading"} onClick={consultarRH}>
              {rh.status === "loading" ? "Enviando…" : "¿Tienes dudas? → Consultar con RH"}
            </button>
          ) : (
            <div style={{ marginTop: 12, textAlign: "center" }}>
              <div className="emp-muted" style={{ fontSize: 11.5 }}>Tu duda fue enviada a Recursos Humanos</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-amber)", marginTop: 4 }}>{rh.folio}</div>
            </div>
          )}
          {rh.status === "error" && <div style={{ fontSize: 11.5, color: "var(--accent-red)", marginTop: 6 }}>{rh.error}</div>}
        </>
      )}
    </div>
  );
}

function RecibosView({ token, employee, onOpen, refreshKey }) {
  const [state, setState] = useState({ status: "loading", data: [], error: null });
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(token, `/api/payroll?employeeId=${employee.id}&pageSize=50`);
        if (!cancelled) setState({ status: "ready", data: res.data, error: null });
      } catch (e) {
        if (!cancelled) setState({ status: "error", data: [], error: e.message });
      }
    })();
    return () => { cancelled = true; };
    // refreshKey se bumpea al recibir payroll:updated — un recibo abierto
    // sigue abierto tras el refetch porque conserva el mismo id (ver
    // upsertPayrollRecord en connectors.ts).
  }, [token, employee.id, refreshKey]);

  return (
    <motion.div {...PAGE_FADE}>
      <Eyebrow>Mis pagos</Eyebrow>
      <div className="emp-h1">Historial de nómina</div>

      {state.status === "loading" && <div className="emp-glass emp-card">Cargando pagos…</div>}
      {state.status === "error" && <div className="emp-glass emp-card" style={{ color: "var(--accent-red)" }}>{state.error}</div>}
      {state.status === "ready" && state.data.length === 0 && <div className="emp-glass emp-card emp-muted">Aún no hay recibos de nómina cargados.</div>}

      {state.data.length > 0 && (
        <div className="emp-glass emp-card" style={{ padding: "4px 14px" }}>
          {state.data.map((p, index) => {
            const isOpen = openId === p.id;
            return (
              <motion.div key={p.id} {...cardAppear(index)}>
                <div className="emp-payrow" onClick={() => { const next = isOpen ? null : p.id; setOpenId(next); if (next) onOpen(); }}>
                  <div className="emp-row" style={{ gap: 12 }}>
                    <div className="emp-payrow-icon"><CalendarDays size={17} color="var(--text-secondary)" /></div>
                    <div>
                      <div style={{ fontWeight: 400, fontSize: 14 }}>{p.payroll_type || "Recibo"}</div>
                      <div className="emp-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</div>
                    </div>
                  </div>
                  <div className="emp-row" style={{ gap: 8 }}>
                    <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-green)" }}>{mxn(p.net_pay)}</div>
                    <ChevronDown size={16} color="var(--text-muted)" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: ".2s" }} />
                  </div>
                </div>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ maxHeight: 0 }} animate={{ maxHeight: 1000 }} exit={{ maxHeight: 0 }}
                      transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }} style={{ overflow: "hidden" }}
                    >
                      <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, delay: 0.08 }} style={{ padding: "2px 2px 16px" }}
                      >
                        <Eyebrow>Percepciones</Eyebrow>
                        <div style={{ marginTop: 6, marginBottom: 12 }}>
                          <Row k="Gravado" v={mxn(p.gross_taxable)} tone="pos" />
                          <Row k="Exento" v={mxn(p.gross_exempt)} tone="pos" />
                          <Row k="Total" v={mxn(p.total_income)} tone="pos" />
                        </div>
                        <Eyebrow>Deducciones</Eyebrow>
                        <div style={{ marginTop: 6 }}>
                          <Row k="ISR" v={mxn(p.isr)} tone="neg" />
                          <Row k="IMSS" v={mxn(p.imss_employee)} tone="neg" />
                          <Row k="INFONAVIT" v={mxn(p.infonavit)} tone="neg" />
                          <Row k="Otras" v={mxn(p.other_deductions)} tone="neg" />
                        </div>
                        <div className="emp-row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border-dim)", marginTop: 10, paddingTop: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>NETO</span>
                          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--accent-green)" }}>{mxn(p.net_pay)}</span>
                        </div>
                        {isOpen && <PayrollAIExplain token={token} record={p} employee={employee} />}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ── VACACIONES ───────────────────────────────────────────────

function VacacionesView({ token, employee, onSuccess }) {
  const antiguedad = yearsSince(employee.hire_date);
  const [calc, setCalc] = useState(null);
  const [pendCount, setPendCount] = useState(0);
  const [form, setForm] = useState({ start: "", end: "" });
  const [folio, setFolio] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const salario = employee.monthly_salary ? `&salarioBase=${employee.monthly_salary}` : "";
      const c = await apiFetch(token, `/api/lft/vacaciones?antiguedad=${antiguedad}${salario}`);
      setCalc(c);
      const reqs = await apiFetch(token, `/api/requests?employeeId=${employee.id}&type=${encodeURIComponent("Vacaciones")}&pageSize=50`);
      setPendCount((reqs.data || []).filter((r) => r.stage === "MANAGER" || r.stage === "WORKFORCE").length);
    } catch (e) {
      setLoadError(e.message);
    }
  }, [token, employee, antiguedad]);

  useEffect(() => { load(); }, [load]);

  const dias = form.start && form.end ? Math.max(1, Math.round((new Date(form.end) - new Date(form.start)) / 86400000) + 1) : 0;

  const { confirm, ask, cancel, run, busy, error } = useConfirmedAction(async () => {
    const created = await apiFetch(token, "/api/requests", {
      method: "POST",
      body: JSON.stringify({ employeeId: employee.id, type: "Vacaciones", detail: `${dias} días · ${fmtDate(form.start)} – ${fmtDate(form.end)}` }),
    });
    setFolio(folioFor("VAC", created.id));
    setForm({ start: "", end: "" });
    onSuccess();
    load();
  });

  return (
    <motion.div {...PAGE_FADE}>
      <Eyebrow>Vacaciones y tiempo</Eyebrow>
      <div className="emp-h1">Tu tiempo libre</div>

      <div className="emp-grid2" style={{ marginBottom: 12 }}>
        <div className="emp-glass emp-card" style={{ marginBottom: 0, textAlign: "center" }}>
          <Eyebrow>Días de ley</Eyebrow>
          <div className="mono" style={{ fontSize: 32, fontWeight: 600, color: "var(--text-primary)", marginTop: 6 }}>{calc?.dias ?? "…"}</div>
          <div className="emp-muted" style={{ fontSize: 11, marginTop: 4 }}>{antiguedad} años de antigüedad</div>
        </div>
        <div className="emp-glass emp-card" style={{ marginBottom: 0, textAlign: "center" }}>
          <Eyebrow>Pendientes</Eyebrow>
          <div className="mono" style={{ fontSize: 32, fontWeight: 600, color: "var(--accent-amber)", marginTop: 6 }}>{pendCount}</div>
          <div className="emp-muted" style={{ fontSize: 11, marginTop: 4 }}>solicitudes en trámite</div>
        </div>
      </div>

      {calc?.primaVacacional != null && (
        <div className="emp-glass emp-card"><Row k="Prima vacacional estimada (25%)" v={mxn(calc.primaVacacional)} tone="pos" /></div>
      )}
      {loadError && <div className="emp-glass emp-card" style={{ color: "var(--accent-red)" }}>{loadError}</div>}

      <AnimatePresence mode="wait">
        {folio ? (
          <motion.div key="folio" {...PAGE_FADE}>
            <FolioReceipt folio={folio} note="Va con tu jefe directo primero." />
            <button className="emp-btn-secondary" style={{ marginTop: 10 }} onClick={() => setFolio(null)}>Nueva solicitud</button>
          </motion.div>
        ) : (
          <motion.div key="form" className="emp-glass emp-card" {...PAGE_FADE}>
            <Eyebrow>Solicitar vacaciones</Eyebrow>
            <div className="emp-grid2" style={{ margin: "12px 0" }}>
              <div>
                <label className="emp-label">Inicio</label>
                <input className="emp-input" type="date" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
              </div>
              <div>
                <label className="emp-label">Fin</label>
                <input className="emp-input" type="date" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
              </div>
            </div>
            {dias > 0 && <div className="emp-muted" style={{ fontSize: 12, marginBottom: 10 }}>{dias} día(s) solicitados</div>}
            <button
              className="emp-btn-primary" disabled={!form.start || !form.end}
              onClick={() => ask("Solicitar vacaciones", `${dias} día(s) · ${fmtDate(form.start)} – ${fmtDate(form.end)}`)}
            >
              <Check size={20} /> Solicitar vacaciones
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirm && <ConfirmSheet confirm={confirm} busy={busy} error={error} onConfirm={run} onCancel={cancel} />}
      </AnimatePresence>
    </motion.div>
  );
}

// ── SOLICITUDES ──────────────────────────────────────────────

const REQUEST_TYPES = ["Vacaciones", "Permiso", "Constancia laboral", "Cambio de turno", "Anticipo de nómina", "Actualización de datos", "Otro"];

function SolicitudesView({ token, employee, onSuccess }) {
  const [data, setData] = useState([]);
  const [status, setStatus] = useState("loading");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: REQUEST_TYPES[0], detail: "" });
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(token, `/api/requests?employeeId=${employee.id}&pageSize=50`);
      setData(res.data);
      setStatus("ready");
    } catch (e) { setLoadError(e.message); setStatus("error"); }
  }, [token, employee.id]);

  useEffect(() => { load(); }, [load]);

  const { confirm, ask, cancel, run, busy, error } = useConfirmedAction(async () => {
    await apiFetch(token, "/api/requests", {
      method: "POST",
      body: JSON.stringify({ employeeId: employee.id, type: form.type, detail: form.detail || undefined }),
    });
    setShowForm(false);
    setForm({ type: REQUEST_TYPES[0], detail: "" });
    onSuccess();
    load();
  });

  return (
    <motion.div {...PAGE_FADE}>
      <div className="emp-row" style={{ justifyContent: "space-between" }}>
        <div>
          <Eyebrow>Mis solicitudes</Eyebrow>
          <div className="emp-h1" style={{ margin: "4px 0 0" }}>Seguimiento</div>
        </div>
        <button className="emp-btn-secondary" style={{ width: "auto", padding: "0 18px", height: 40 }} onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancelar" : "Nueva solicitud"}</button>
      </div>

      {showForm && (
        <div className="emp-glass emp-card" style={{ marginTop: 14 }}>
          <label className="emp-label">Tipo</label>
          <select className="emp-select" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} style={{ marginBottom: 10 }}>
            {REQUEST_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <label className="emp-label">Detalle</label>
          <textarea className="emp-textarea" rows={3} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} style={{ marginBottom: 10 }} />
          <button
            className="emp-btn-primary"
            onClick={() => ask("Enviar solicitud a mi jefe", `${form.type}${form.detail ? " · " + form.detail : ""}`)}
          >
            <Send size={20} /> Enviar solicitud a mi jefe
          </button>
        </div>
      )}

      {loadError && <div className="emp-glass emp-card" style={{ color: "var(--accent-red)", marginTop: 14 }}>{loadError}</div>}

      <div style={{ marginTop: 16 }}>
        {status === "loading" && <div className="emp-glass emp-card">Cargando…</div>}
        {status === "ready" && data.length === 0 && <div className="emp-glass emp-card emp-muted">Sin solicitudes todavía.</div>}
        {data.map((r, index) => (
          <motion.div key={r.id} className="emp-glass emp-card" {...cardAppear(index)}>
            <div className="emp-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 400, fontSize: 14 }}>{r.type}</div>
              <StatusBadge stage={r.stage} />
            </div>
            {r.detail && <div className="emp-muted" style={{ fontSize: 12.5 }}>{r.detail}</div>}
            <div className="emp-muted" style={{ fontSize: 11, marginTop: 6 }}>{fmtDate(r.created_at)}</div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {confirm && <ConfirmSheet confirm={confirm} busy={busy} error={error} onConfirm={run} onCancel={cancel} />}
      </AnimatePresence>
    </motion.div>
  );
}

// ── AVISOS (placeholder — no hay endpoint de noticias en el backend) ─

const AVISOS_PLACEHOLDER = [
  {
    id: "a1", urgency: "var(--accent-blue-bright)", nuevo: true,
    title: "Jornada 2026: transición a 46 horas semanales",
    summary: "A partir de julio, la jornada máxima baja de 48 a 46 horas conforme al calendario de la reforma LFT. Consulta el detalle con RH.",
    date: "2026-07-01",
  },
  {
    id: "a2", urgency: "var(--accent-amber)", nuevo: true,
    title: "Campaña de vacunación estacional",
    summary: "Viernes 20 de junio en el comedor de Planta Vallejo, de 9:00 a 14:00. Acude con tu credencial GFP.",
    date: "2026-06-15",
  },
  {
    id: "a3", urgency: "var(--accent-green)", nuevo: false,
    title: "Resultado auditoría de inocuidad: A",
    summary: "Gracias al esfuerzo de todas las plantas, la auditoría interna de este trimestre cerró con calificación A.",
    date: "2026-05-28",
  },
];

function AvisosView() {
  const [openId, setOpenId] = useState(null);
  return (
    <motion.div {...PAGE_FADE}>
      <Eyebrow>Avisos</Eyebrow>
      <div className="emp-h1">Comunicados de la empresa</div>
      {AVISOS_PLACEHOLDER.map((a, index) => {
        const isOpen = openId === a.id;
        return (
          <motion.div key={a.id} className="emp-glass emp-card" style={{ cursor: "pointer" }} onClick={() => setOpenId(isOpen ? null : a.id)} {...cardAppear(index)}>
            <div className="emp-row" style={{ gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.urgency, marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="emp-row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{a.title}</div>
                  {a.nuevo && <span className="emp-badge workforce" style={{ flexShrink: 0 }}>Nuevo</span>}
                </div>
                {!isOpen && (
                  <div className="emp-muted" style={{ fontSize: 12, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {a.summary}
                  </div>
                )}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ maxHeight: 0 }} animate={{ maxHeight: 1000 }} exit={{ maxHeight: 0 }}
                      transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }} style={{ overflow: "hidden" }}
                    >
                      <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, delay: 0.08 }} style={{ marginTop: 4 }}
                      >
                        <div className="emp-muted" style={{ fontSize: 12 }}>{a.summary}</div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="mono emp-muted" style={{ fontSize: 10.5, marginTop: 6 }}>{fmtDate(a.date)}</div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ── CONSULTOR IA — árbol guiado ──────────────────────────────

const IA_BRANCHES = [
  { id: "nomina", title: "Mi nómina", icon: DollarSign, subtitle: "Recibos, pagos y dudas de nómina" },
  { id: "tiempo", title: "Tiempo y permisos", icon: Clock, subtitle: "Vacaciones, permisos y días disponibles" },
  { id: "documentos", title: "Mis documentos", icon: FileText, subtitle: "Constancias, contratos y cartas" },
  { id: "premium", title: "Más módulos", icon: Lock, locked: true, subtitle: "Capacitación · Reportes · Cambios de área" },
];

// `refreshKey` permite forzar un refetch (ej. al recibir un payroll:updated
// por Socket.io) sin depender de que token/employeeId cambien.
function useLatestPayroll(token, employeeId, refreshKey) {
  const [state, setState] = useState({ status: "loading", data: null });
  const reload = useCallback(async () => {
    try {
      const res = await apiFetch(token, `/api/payroll?employeeId=${employeeId}&pageSize=1`);
      setState({ status: "ready", data: res.data[0] || null });
    } catch {
      setState({ status: "error", data: null });
    }
  }, [token, employeeId]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { ...state, reload };
}

// Estado de asistencia del día — mock: no hay checadora real, pero el
// registro (o su ausencia) sí viene de la base de datos.
function useTodayAttendance(token, employeeId) {
  const [state, setState] = useState({ status: "loading", data: null });
  const reload = useCallback(async () => {
    try {
      const res = await apiFetch(token, `/api/attendance?date=${todayISO()}&employeeId=${employeeId}`);
      setState({ status: "ready", data: res.data[0] || null });
    } catch {
      setState({ status: "error", data: null });
    }
  }, [token, employeeId]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

function InfoAnswer({ children }) {
  return <div className="emp-glass emp-card" style={{ marginTop: 8 }}>{children}</div>;
}

function QuickRequestFlow({ token, employee, type, folioCode, placeholder, actionLabel, onSuccess }) {
  const [detail, setDetail] = useState("");
  const [folio, setFolio] = useState(null);

  const { confirm, ask, cancel, run, busy, error } = useConfirmedAction(async () => {
    const created = await apiFetch(token, "/api/requests", {
      method: "POST",
      body: JSON.stringify({ employeeId: employee.id, type, detail: detail || undefined }),
    });
    setFolio(folioFor(folioCode, created.id));
    onSuccess();
  });

  if (folio) return <FolioReceipt folio={folio} note="Recibirás actualizaciones en Mis solicitudes." />;

  return (
    <div>
      <textarea className="emp-textarea" rows={3} placeholder={placeholder} value={detail} onChange={(e) => setDetail(e.target.value)} style={{ marginBottom: 10 }} />
      <button className="emp-btn-primary" onClick={() => ask(actionLabel, detail || undefined)}>
        <Send size={20} /> {actionLabel}
      </button>
      <AnimatePresence>
        {confirm && <ConfirmSheet confirm={confirm} busy={busy} error={error} onConfirm={run} onCancel={cancel} />}
      </AnimatePresence>
    </div>
  );
}

function ContractSummary({ employee }) {
  return (
    <InfoAnswer>
      <Eyebrow>Resumen de tu contrato</Eyebrow>
      <div style={{ marginTop: 8 }}>
        <Row k="Tipo de contrato" v={employee.contract_type || "—"} />
        <Row k="Puesto" v={employee.position || "—"} />
        <Row k="Planta" v={employee.plant || "—"} />
        <Row k="Fecha de ingreso" v={fmtDate(employee.hire_date)} />
        {employee.monthly_salary != null && <Row k="Salario mensual" v={mxn(employee.monthly_salary)} tone="pos" />}
      </div>
    </InfoAnswer>
  );
}

function ConsultorIAView({ token, employee, explode, success, iaLocked, onLock, payrollRefreshKey }) {
  const [branch, setBranch] = useState(null);
  const [leaf, setLeaf] = useState(null);
  const [flag, setFlag] = useState(null); // { folio }
  const payroll = useLatestPayroll(token, employee.id, payrollRefreshKey);

  const openBranch = (b) => {
    setBranch(b);
    setLeaf(null);
    explode();
  };
  const close = () => { setBranch(null); setLeaf(null); };

  const {
    confirm: errorConfirm, ask: askError, cancel: cancelError,
    run: runErrorReport, busy: errorBusy, error: errorReportError,
  } = useConfirmedAction(async () => {
    const created = await apiFetch(token, "/api/requests", {
      method: "POST",
      body: JSON.stringify({ employeeId: employee.id, type: "Error en recibo", detail: "Reportado desde Consultor IA" }),
    });
    setFlag({ folio: folioFor("NOM", created.id) });
    close();
  });

  if (iaLocked) {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
        <Eyebrow>Consultor IA</Eyebrow>
        <div className="emp-h1">Módulo bloqueado</div>
        <div className="emp-glass emp-card">
          <AlertTriangle size={20} color="var(--accent-amber)" />
          <div className="emp-body" style={{ marginTop: 10 }}>
            Este módulo se bloqueó temporalmente después de reportar un incidente en esta sesión. Vuelve a intentarlo más tarde o contacta directamente a RH.
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div {...PAGE_FADE}>
      <Eyebrow>Consultor IA</Eyebrow>
      <div className="emp-h1">¿En qué te ayudamos?</div>

      <div className="emp-glass emp-iarow-list">
        {IA_BRANCHES.map((b) => {
          const Icon = b.icon;
          return (
            <div key={b.id} className={`emp-iarow ${b.locked ? "locked" : ""}`} onClick={() => openBranch(b)}>
              <div className="emp-iarow-icon"><Icon size={22} color="var(--accent-blue-bright)" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="emp-iarow-title">{b.title}</div>
                <div className="emp-iarow-sub">{b.subtitle}</div>
              </div>
              <ChevronRight size={18} color="var(--text-muted)" />
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {branch && !flag && (
          <BottomSheet title={branch.title} onClose={close}>
            {branch.id === "nomina" && !leaf && (
              <>
                <div className="emp-sheetrow" onClick={() => setLeaf("recibo")}><span>Ver mi recibo actual</span><ChevronRight size={16} color="var(--text-muted)" /></div>
                <div className="emp-sheetrow" onClick={() => setLeaf("error")}><span>Tengo un error en mi recibo</span><ChevronRight size={16} color="var(--text-muted)" /></div>
                <div className="emp-sheetrow" onClick={() => setLeaf("pago")}><span>¿Cuándo me pagan?</span><ChevronRight size={16} color="var(--text-muted)" /></div>
              </>
            )}
            {branch.id === "nomina" && leaf === "recibo" && (
              <InfoAnswer>
                {payroll.status === "loading" && "Cargando…"}
                {payroll.status === "ready" && payroll.data && (
                  <>
                    <Eyebrow>{payroll.data.payroll_type} · {fmtDate(payroll.data.period_start)} – {fmtDate(payroll.data.period_end)}</Eyebrow>
                    <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--accent-green)", marginTop: 8 }}>{mxn(payroll.data.net_pay)}</div>
                    <div className="emp-muted" style={{ fontSize: 12, marginTop: 4 }}>Neto a pagar</div>
                  </>
                )}
                {payroll.status === "ready" && !payroll.data && "Aún no tienes recibos cargados."}
              </InfoAnswer>
            )}
            {branch.id === "nomina" && leaf === "error" && (
              <div>
                <div className="emp-body" style={{ marginBottom: 12 }}>Vamos a registrar tu reporte y generarte un folio de seguimiento.</div>
                <button className="emp-btn-primary" onClick={() => askError("Reportar error en mi recibo", "Se notificará a Recursos Humanos con un folio de seguimiento.")}>
                  <AlertTriangle size={20} /> Reportar error en mi recibo
                </button>
              </div>
            )}
            {branch.id === "nomina" && leaf === "pago" && (
              <InfoAnswer>
                {payroll.data ? (
                  <>
                    <Eyebrow>Estimado</Eyebrow>
                    <div style={{ marginTop: 6 }}>Tu último pago fue el {fmtDate(payroll.data.payment_date)}. Con periodicidad {(payroll.data.payroll_type || "quincenal").toLowerCase()}, tu próximo pago debería rondar el {fmtDate(new Date(new Date(payroll.data.payment_date).getTime() + 15 * 86400000))}.</div>
                  </>
                ) : "No hay historial de nómina para estimar tu próximo pago."}
              </InfoAnswer>
            )}

            {branch.id === "tiempo" && !leaf && (
              <>
                <div className="emp-sheetrow" onClick={() => setLeaf("dias")}><span>¿Cuántos días de vacaciones tengo?</span><ChevronRight size={16} color="var(--text-muted)" /></div>
                <div className="emp-sheetrow" onClick={() => setLeaf("vac")}><span>Solicitar vacaciones</span><ChevronRight size={16} color="var(--text-muted)" /></div>
                <div className="emp-sheetrow" onClick={() => setLeaf("permiso")}><span>Pedir permiso</span><ChevronRight size={16} color="var(--text-muted)" /></div>
              </>
            )}
            {branch.id === "tiempo" && leaf === "dias" && <VacacionDiasAnswer token={token} employee={employee} />}
            {branch.id === "tiempo" && leaf === "vac" && (
              <QuickRequestFlow token={token} employee={employee} type="Vacaciones" folioCode="VAC" placeholder="Fechas o comentarios (opcional)" actionLabel="Solicitar vacaciones" onSuccess={success} />
            )}
            {branch.id === "tiempo" && leaf === "permiso" && (
              <QuickRequestFlow token={token} employee={employee} type="Permiso" folioCode="PER" placeholder="Motivo del permiso (opcional)" actionLabel="Solicitar permiso" onSuccess={success} />
            )}

            {branch.id === "documentos" && !leaf && (
              <>
                <div className="emp-sheetrow" onClick={() => setLeaf("constancia")}><span>Solicitar constancia laboral</span><ChevronRight size={16} color="var(--text-muted)" /></div>
                <div className="emp-sheetrow" onClick={() => setLeaf("contrato")}><span>Ver mi contrato</span><ChevronRight size={16} color="var(--text-muted)" /></div>
                <div className="emp-sheetrow" onClick={() => setLeaf("cna")}><span>Carta de no adeudo</span><ChevronRight size={16} color="var(--text-muted)" /></div>
              </>
            )}
            {branch.id === "documentos" && leaf === "constancia" && (
              <QuickRequestFlow token={token} employee={employee} type="Constancia laboral" folioCode="CON" placeholder="¿Para qué trámite la necesitas? (opcional)" actionLabel="Solicitar constancia laboral" onSuccess={success} />
            )}
            {branch.id === "documentos" && leaf === "contrato" && <ContractSummary employee={employee} />}
            {branch.id === "documentos" && leaf === "cna" && (
              <QuickRequestFlow token={token} employee={employee} type="Carta de no adeudo" folioCode="CNA" placeholder="Comentarios (opcional)" actionLabel="Solicitar carta de no adeudo" onSuccess={success} />
            )}

            {branch.id === "premium" && (
              <div style={{ textAlign: "center", padding: "10px 0" }}>
                <Lock size={30} color="var(--accent-green)" />
                <div style={{ fontWeight: 400, fontSize: 15, marginTop: 10 }}>Capacitación · Reportes · Cambios de área</div>
                <div style={{ marginTop: 16 }}>
                  <QuickRequestFlow token={token} employee={employee} type="Solicitud de activación" folioCode="UPG" placeholder="Comentarios (opcional)" actionLabel="Solicitar activación" onSuccess={success} />
                </div>
              </div>
            )}
          </BottomSheet>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {errorConfirm && (
          <ConfirmSheet confirm={errorConfirm} busy={errorBusy} error={errorReportError} onConfirm={runErrorReport} onCancel={cancelError} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {flag && (
          <motion.div className="emp-flagscreen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AlertTriangle size={48} color="var(--accent-amber)" />
            <div style={{ fontWeight: 500, fontSize: 18, marginTop: 16 }}>Incidente registrado</div>
            <div className="emp-body" style={{ marginTop: 8, maxWidth: 280 }}>
              {flag.error ? flag.error : "Tu reporte fue enviado a Recursos Humanos. Te contactarán con el folio de referencia."}
            </div>
            {flag.folio && <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--accent-amber)", marginTop: 14 }}>{flag.folio}</div>}
            <button className="emp-btn-primary" style={{ marginTop: 26, width: 200 }} onClick={() => { setFlag(null); onLock(); }}>Entendido</button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function VacacionDiasAnswer({ token, employee }) {
  const [calc, setCalc] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const antiguedad = yearsSince(employee.hire_date);
    apiFetch(token, `/api/lft/vacaciones?antiguedad=${antiguedad}`).then((c) => { if (!cancelled) setCalc(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [token, employee]);
  return (
    <InfoAnswer>
      <Eyebrow>Según la LFT</Eyebrow>
      {calc ? (
        <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", marginTop: 8 }}>{calc.dias} días</div>
      ) : "Calculando…"}
      <div className="emp-muted" style={{ fontSize: 12, marginTop: 4 }}>con {yearsSince(employee.hire_date)} años de antigüedad</div>
    </InfoAnswer>
  );
}

// ── TOAST HOST ───────────────────────────────────────────────

function EmpToastHost() {
  const [toasts, setToasts] = useState([]);
  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  useEffect(() => {
    _empToast = (msg, kind = "info") => {
      const id = Math.random();
      setToasts((t) => [...t, { id, msg, kind }]);
      setTimeout(() => dismiss(id), 4000);
    };
    return () => { _empToast = () => {}; };
  }, []);
  return (
    <div className="emp-toastwrap">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`emp-toast emp-toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
        >
          {t.kind === "success" && <ArrowUp size={15} color="var(--accent-green)" />}
          {t.kind === "warning" && <ArrowDown size={15} color="var(--accent-amber)" />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ── APP ──────────────────────────────────────────────────────

const NAV = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "recibos", label: "Mis Pagos", icon: Receipt },
  { id: "vacaciones", label: "Vacaciones", icon: CalendarDays },
  { id: "solicitudes", label: "Solicitudes", icon: Inbox },
  { id: "avisos", label: "Avisos", icon: Megaphone },
  { id: "ia", label: "IA", icon: Bot },
];

export default function EmpleadoShell() {
  const canvasRef = useRef(null);
  const fieldRef = useParticleField(canvasRef);

  const [stage, setStage] = useState("login"); // login | booting | error | ready
  const [bootError, setBootError] = useState(null);
  const [token, setToken] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingReq, setPendingReq] = useState(0);
  const [view, setView] = useState("home");
  const [showGreet, setShowGreet] = useState(true);
  const [iaLocked, setIaLocked] = useState(false);
  const [payrollRefreshKey, setPayrollRefreshKey] = useState(0);
  const socketRef = useRef(null);

  const explode = useCallback(() => fieldRef.current?.explode(), [fieldRef]);
  const pulse = useCallback((color) => fieldRef.current?.pulse(color), [fieldRef]);
  const success = useCallback(() => fieldRef.current?.success(), [fieldRef]);

  // Live-wire: se une a su sala personal y escucha payroll:updated — cuando
  // RH recarga o reemplaza el archivo conectado y cambia el neto de este
  // colaborador, el hero y "Mis Pagos" se refrescan solos, sin recargar la
  // página (ver runReloadForSource en apps/api/src/routes/connectors.ts).
  useEffect(() => {
    if (!employee?.id) return;
    const socket = io(API_BASE);
    socketRef.current = socket;
    socket.emit("join:employee", employee.id);
    socket.on("payroll:updated", ({ employeeId, previousNeto, newNeto, diff }) => {
      if (employeeId !== employee.id) return;
      setPayrollRefreshKey((k) => k + 1);

      // diff/previousNeto vienen de emitSyncComplete (lib/syncEmitter.ts) —
      // si algún emisor más viejo no los manda, cae al mensaje genérico.
      const delta = diff ?? (previousNeto != null && newNeto != null ? newNeto - previousNeto : null);
      if (delta == null) {
        empToast("Tu recibo ha sido actualizado");
      } else if (delta > 0) {
        empToast(`↑ Tu recibo aumentó $${Math.abs(delta).toFixed(2)}`, "success");
      } else {
        empToast(`↓ Tu recibo cambió $${Math.abs(delta).toFixed(2)}`, "warning");
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [employee?.id]);

  // Se dispara tras un login exitoso (real o demo) — carga el resto de la
  // información del colaborador antes de mostrar el saludo.
  const loadEmployeeData = useCallback(async (accessToken) => {
    console.log("[auth] loadEmployeeData() start — token recibido:", !!accessToken);
    setStage("booting");
    setBootError(null);
    try {
      const list = await apiFetch(accessToken, "/api/employees?pageSize=1");
      console.log("[auth] /api/employees?pageSize=1 ->", list);
      const first = list.data[0];
      if (!first) throw new Error("No hay colaboradores en este tenant");
      const full = await apiFetch(accessToken, `/api/employees/${first.id}`);
      console.log("[auth] employees[0] cargado:", full.first_name, full.last_name, full.id);

      const notif = await apiFetch(accessToken, `/api/notifications?employeeId=${full.id}`);
      const reqs = await apiFetch(accessToken, `/api/requests?employeeId=${full.id}&pageSize=50`);

      setToken(accessToken);
      setEmployee(full);
      setUnreadCount(notif.unreadCount);
      setPendingReq((reqs.data || []).filter((r) => r.stage === "MANAGER" || r.stage === "WORKFORCE").length);
      setShowGreet(true);
      setStage("ready");
      console.log("[auth] loadEmployeeData() listo — stage=ready");
    } catch (e) {
      console.log("[auth] loadEmployeeData() falló:", e.message);
      setBootError(e.message);
      setStage("error");
    }
  }, []);

  const backToLogin = () => {
    socketRef.current?.disconnect();
    setEmployee(null);
    setStage("login");
    setBootError(null);
  };

  const openModule = (id) => {
    setView(id);
    explode();
  };

  const xpPct = employee ? Math.min(100, ((employee.xp_points ?? 0) % 1000) / 10) : 0;

  return (
    <div className="empshell">
      <style>{CSS}</style>
      <div className="emp-bgwash" />
      <canvas ref={canvasRef} className="emp-canvas" />
      <EmpToastHost />

      {stage === "login" && <LoginScreen onSuccess={loadEmployeeData} />}
      {stage === "booting" && <LoadingScreen text="Cargando tu información…" />}
      {stage === "error" && <ErrorScreen message={bootError} onRetry={backToLogin} />}

      <AnimatePresence>
        {stage === "ready" && showGreet && employee && <GreetScreen employee={employee} onDismiss={() => setShowGreet(false)} />}
      </AnimatePresence>

      {stage === "ready" && !showGreet && employee && (
        <div className="emp-app">
          <div className="emp-topbar">
            <span className="emp-topbar-brand">✦ CÓDICE</span>
            <span className="emp-topbar-name">{employee.first_name}</span>
            <span className="emp-topbar-bell">
              <Bell size={18} />
              {unreadCount > 0 && <span className="emp-topbar-dot" />}
            </span>
          </div>
          <div className="emp-xpbar-track"><div className="emp-xpbar-fill" style={{ width: `${xpPct}%` }} /></div>

          <main className="emp-main">
            <AnimatePresence mode="wait">
              {view === "home" && <div key="home"><HomeView token={token} employee={employee} unreadCount={unreadCount} onGoAvisos={() => openModule("avisos")} onGoRecibos={() => openModule("recibos")} refreshKey={payrollRefreshKey} /></div>}
              {view === "recibos" && <div key="recibos"><RecibosView token={token} employee={employee} onOpen={() => pulse("#3b82f6")} refreshKey={payrollRefreshKey} /></div>}
              {view === "vacaciones" && <div key="vacaciones"><VacacionesView token={token} employee={employee} onSuccess={success} /></div>}
              {view === "solicitudes" && <div key="solicitudes"><SolicitudesView token={token} employee={employee} onSuccess={success} /></div>}
              {view === "avisos" && <div key="avisos"><AvisosView /></div>}
              {view === "ia" && (
                <div key="ia">
                  <ConsultorIAView token={token} employee={employee} explode={explode} success={success} iaLocked={iaLocked} onLock={() => setIaLocked(true)} payrollRefreshKey={payrollRefreshKey} />
                </div>
              )}
            </AnimatePresence>
          </main>

          <nav className="emp-nav">
            {NAV.map((n) => {
              const Icon = n.icon;
              const badge = n.id === "solicitudes" ? pendingReq : 0;
              const active = view === n.id;
              return (
                <div key={n.id} className={`emp-navitem ${active ? "on" : ""}`} onClick={() => openModule(n.id)}>
                  <Icon size={20} />
                  {active && <span className="emp-navlabel">{n.label}</span>}
                  {active && <span className="emp-navdot-active" />}
                  {badge > 0 && <span className="emp-navbadge">{badge}</span>}
                </div>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
