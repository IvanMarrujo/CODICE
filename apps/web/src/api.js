const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function login({ slug, email, password }) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Login falló (${res.status})`);
  }
  return res.json();
}

export async function fetchEmployees(token) {
  // pageSize=100 truncaba Plantilla en exactamente 100 empleados sin importar
  // cuántos existieran realmente — no hay UI de "cargar más" en Plantilla,
  // así que esto necesita cubrir el tenant completo en un solo fetch.
  const res = await fetch(`${API_BASE}/api/employees?pageSize=2000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error al cargar empleados (${res.status})`);
  }
  return res.json();
}

export async function fetchAttendance(token, date) {
  const res = await fetch(`${API_BASE}/api/attendance?date=${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error al cargar asistencia (${res.status})`);
  }
  return res.json();
}

export async function checkinAttendance(token, employeeId) {
  const res = await fetch(`${API_BASE}/api/attendance/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ employeeId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error al registrar entrada (${res.status})`);
  }
  return res.json();
}

export async function checkoutAttendance(token, employeeId) {
  const res = await fetch(`${API_BASE}/api/attendance/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ employeeId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error al registrar salida (${res.status})`);
  }
  return res.json();
}

async function authedFetch(token, path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error de API (${res.status})`);
  return body;
}

export function fetchSyncLogLatest(token) {
  return authedFetch(token, `/api/connectors/sync-log/latest`);
}

export function fetchPayroll(token, employeeId, { page = 1, limit = 25 } = {}) {
  return authedFetch(token, `/api/payroll?employeeId=${employeeId}&page=${page}&limit=${limit}`);
}

export function fetchPayrollSummary(token, period) {
  return authedFetch(token, `/api/payroll/summary${period ? `?period=${period}` : ""}`);
}

export function fetchPayrollLatestByEmployee(token) {
  return authedFetch(token, `/api/payroll/latest-by-employee`);
}

export function fetchPayrollExplain(token, recordId) {
  return authedFetch(token, `/api/payroll/${recordId}/explain`);
}

export function fetchEmployeeGamification(token, employeeId) {
  return authedFetch(token, `/api/employees/${employeeId}/gamification`);
}

export function fetchGamificationLeaderboard(token, limit = 5) {
  return authedFetch(token, `/api/employees/leaderboard?limit=${limit}`);
}

export function fetchSyncLogHistory(token) {
  return authedFetch(token, `/api/connectors/sync-log/history`);
}

async function authedFetchJSON(token, path, method, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const responseBody = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(responseBody.error || `Error de API (${res.status})`);
  return responseBody;
}

// ── Live-wire connectors: archivo conectado, reload, reemplazo, auto-sync ─

export function fetchConnectedSources(token) {
  return authedFetch(token, `/api/connectors/sources`);
}

export function reloadConnectedSource(token, sourceId) {
  return authedFetchJSON(token, `/api/connectors/${sourceId}/reload`, "POST");
}

export function setConnectedSourceAutoSync(token, sourceId, autoSync, syncIntervalMinutes) {
  return authedFetchJSON(token, `/api/connectors/${sourceId}/auto-sync`, "PATCH", { autoSync, syncIntervalMinutes });
}

// Reemplaza el archivo de una conexión ya existente (PATCH, multipart, con
// progreso real vía XHR — mismo patrón que uploadConnectorFile).
export function replaceConnectedSourceFile(token, sourceId, files, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));

    const xhr = new XMLHttpRequest();
    xhr.open("PATCH", `${API_BASE}/api/connectors/${sourceId}/update-file`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* respuesta no-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Error al reemplazar archivo (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Error de red al reemplazar archivo"));
    xhr.send(form);
  });
}

// Dry-run: parsea el archivo (headers detectados + primeras 5 filas) sin
// escribir en DB — usado por el wizard de conectores (Modo A, steps 3-4).
export function previewExcel(token, file) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/connectors/preview/excel`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* respuesta no-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Error al previsualizar archivo (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Error de red al previsualizar archivo"));
    xhr.send(form);
  });
}

export function previewCfdi(token, files) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/connectors/preview/cfdi`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* respuesta no-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Error al previsualizar archivos (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Error de red al previsualizar archivos"));
    xhr.send(form);
  });
}

// Sube archivos a un conector (multipart) con progreso real vía XHR — fetch
// no expone eventos de progreso de subida.
export function uploadConnectorFile(token, endpointPath, files, onProgress, extraFields) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    if (extraFields) Object.entries(extraFields).forEach(([k, v]) => form.append(k, v));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${endpointPath}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* respuesta no-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Error al subir archivo (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Error de red al subir archivo"));
    xhr.send(form);
  });
}

// ── Agente local (webhook + heartbeat) ────────────────────────

export function fetchAgentStatus(token, tenantId) {
  return authedFetch(token, `/api/connectors/agent-status/${tenantId}`);
}

export async function downloadAgentZip(token, tenantId) {
  const res = await fetch(`${API_BASE}/api/connectors/download-agent/${tenantId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error al descargar el agente (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  return { blob, filename: match ? match[1] : "codice-agent.zip" };
}

// ── Control total de fuentes conectadas ───────────────────────

export function pauseConnectedSource(token, sourceId) {
  return authedFetchJSON(token, `/api/connectors/sources/${sourceId}/pause`, "PATCH");
}

export function resumeConnectedSource(token, sourceId) {
  return authedFetchJSON(token, `/api/connectors/sources/${sourceId}/resume`, "PATCH");
}

export function deleteConnectedSource(token, sourceId) {
  return authedFetchJSON(token, `/api/connectors/sources/${sourceId}`, "DELETE");
}

export function deleteConnectedSourceWithData(token, sourceId) {
  return authedFetchJSON(token, `/api/connectors/sources/${sourceId}/with-data?confirm=true`, "DELETE");
}

// ── Empleados — alta/edición/baja ─────────────────────────────

export function fetchEmployee(token, id) {
  return authedFetch(token, `/api/employees/${id}`);
}

export function createEmployee(token, payload) {
  return authedFetchJSON(token, `/api/employees`, "POST", payload);
}

export function updateEmployee(token, id, payload) {
  return authedFetchJSON(token, `/api/employees/${id}`, "PATCH", payload);
}

export function deleteEmployee(token, id) {
  return authedFetchJSON(token, `/api/employees/${id}`, "DELETE");
}

export function bulkDeleteEmployees(token) {
  return authedFetchJSON(token, `/api/employees/bulk`, "DELETE");
}

export function fetchEmployeeStatusSummary(token) {
  return authedFetch(token, `/api/employees/status-summary`);
}

// ── Supervisores (AREA_MANAGER) — Supervisor Shell ──────────────

export function fetchSupervisors(token) {
  return authedFetch(token, `/api/admin/supervisors`);
}

export function createSupervisor(token, payload) {
  return authedFetchJSON(token, `/api/admin/supervisors`, "POST", payload);
}

// ── Perfil de salud del colaborador ────────────────────────────

export function fetchEmployeeHealth(token, employeeId) {
  return authedFetch(token, `/api/employees/${employeeId}/health`);
}

export function fetchHealthDocumentInsights(token, employeeId, docId) {
  return authedFetch(token, `/api/employees/${employeeId}/health/documents/${docId}/insights`);
}

export function updateEmployeeHealth(token, employeeId, payload) {
  return authedFetchJSON(token, `/api/employees/${employeeId}/health`, "PATCH", payload);
}

export function deleteHealthDocument(token, employeeId, docId) {
  return authedFetchJSON(token, `/api/employees/${employeeId}/health/documents/${docId}`, "DELETE");
}

// Sube un documento médico (multipart) con progreso real vía XHR.
export function uploadHealthDocument(token, employeeId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/employees/${employeeId}/health/documents`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* respuesta no-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Error al subir documento (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Error de red al subir documento"));
    xhr.send(form);
  });
}

// ── Riesgo de salud de la plantilla ────────────────────────────

export function fetchRiskSummary(token) {
  return authedFetch(token, `/api/employees/risk-summary`);
}

export function fetchRiskNarrative(token, { refresh = false } = {}) {
  return authedFetchJSON(token, `/api/employees/risk-summary/narrative${refresh ? "?refresh=true" : ""}`, "POST");
}

export function fetchContractsExpiringSoon(token) {
  return authedFetch(token, `/api/contracts/expiring-soon`);
}

export function fetchTeam(token, department) {
  return authedFetch(token, `/api/employees/team?department=${encodeURIComponent(department)}`);
}

// ── CÓDICE Radar — perfiles de riesgo por depto + digest normativo ──

export function fetchDeptRiskProfiles(token) {
  return authedFetch(token, `/api/risk/departments`);
}

export function fetchDeptRiskProfile(token, department) {
  return authedFetch(token, `/api/risk/departments/${encodeURIComponent(department)}`);
}

export function updateDeptRiskProfile(token, department, payload) {
  return authedFetchJSON(token, `/api/risk/departments/${encodeURIComponent(department)}`, "PATCH", payload);
}

export function logDeptAccidente(token, department, payload) {
  return authedFetchJSON(token, `/api/risk/departments/${encodeURIComponent(department)}/accidente`, "POST", payload);
}

export function fetchRadarLatest(token) {
  return authedFetch(token, `/api/radar/latest`);
}

export function refreshRadar(token) {
  return authedFetchJSON(token, `/api/radar/refresh`, "POST");
}

export function fetchRadarHistory(token) {
  return authedFetch(token, `/api/radar/history`);
}

export function fetchNews(token) {
  return authedFetch(token, `/api/news`);
}

// ── Dispositivos ZKTeco (checadoras ADMS) ───────────────────────

export function fetchZktecoDevices(token) {
  return authedFetch(token, `/api/devices/zkteco`);
}

export function registerZktecoDevice(token, payload) {
  return authedFetchJSON(token, `/api/devices/zkteco`, "POST", payload);
}

export function deleteZktecoDevice(token, sn) {
  return authedFetchJSON(token, `/api/devices/zkteco/${encodeURIComponent(sn)}`, "DELETE");
}

// SSE streaming hacia /api/ai/consult (ver routes/ai.ts) — a diferencia de
// askClaude() de arriba (llamada directa al API público, sin backend), este
// pasa por el proxy autenticado del tenant y hace streaming real vía
// ReadableStream (fetch no soporta EventSource con POST + headers custom).
export async function consultAIStream(token, { question, context }, onDelta) {
  const res = await fetch(`${API_BASE}/api/ai/consult`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question, context }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error de IA (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6));
      if (payload.type === "delta") { full += payload.text; onDelta(full); }
      else if (payload.type === "error") throw new Error(payload.message);
    }
  }
  return full;
}

export async function downloadHealthDocument(token, employeeId, docId, filename) {
  const res = await fetch(`${API_BASE}/api/employees/${employeeId}/health/documents/${docId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error al descargar documento (${res.status})`);
  }
  const blob = await res.blob();
  return { blob, filename };
}

// ── Recibos de nómina — eliminación ────────────────────────────

export function deletePayrollRecord(token, id) {
  return authedFetchJSON(token, `/api/payroll/${id}`, "DELETE");
}

export function bulkDeletePayrollRecords(token, employeeId) {
  return authedFetchJSON(token, `/api/payroll/bulk?employeeId=${employeeId}`, "DELETE");
}

function yearsSince(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  return Math.max(0, years);
}

// ── Perfil de admin (número de WhatsApp) ───────────────────────

export function fetchAdminProfile(token) {
  return authedFetch(token, `/api/admin/profile`);
}

export function updateAdminProfile(token, payload) {
  return authedFetchJSON(token, `/api/admin/profile`, "PATCH", payload);
}

// ── Configuración de WhatsApp (conexión + notificaciones) ──────

export function fetchWhatsAppSettings(token) {
  return authedFetch(token, `/api/settings/whatsapp`);
}

export function updateWhatsAppSettings(token, payload) {
  return authedFetchJSON(token, `/api/settings/whatsapp`, "PATCH", payload);
}

export function fetchWhatsAppMockLog(token) {
  return authedFetch(token, `/api/settings/whatsapp/mock-log`);
}

export function simulateWhatsAppAgent(token, message) {
  return authedFetchJSON(token, `/api/webhook/whatsapp/simulate`, "POST", { message });
}

// ── Política de vacaciones ──────────────────────────────────────

export function fetchVacationPolicy(token) {
  return authedFetch(token, `/api/settings/vacation-policy`);
}

export function updateVacationPolicy(token, payload) {
  return authedFetchJSON(token, `/api/settings/vacation-policy`, "PATCH", payload);
}

// ── Storage status ───────────────────────────────────────────────

export function fetchStorageStatus(token) {
  return authedFetch(token, `/api/admin/storage-status`);
}

// ── NDA de piloto ────────────────────────────────────────────────

export async function downloadNdaPreview(token) {
  const res = await fetch(`${API_BASE}/api/admin/nda-preview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error al generar el NDA (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  return { blob, filename: match ? match[1] : "nda-codice.pdf" };
}

export function mapEmployee(row) {
  return {
    id: row.employee_code || row.id,
    dbId: row.id, // uuid real — requerido por /api/payroll?employeeId=
    nombre: row.full_name,
    depto: row.department,
    puesto: row.position,
    status: row.status,
    contrato: row.contract_type,
    planta: row.plant,
    turno: row.shift,
    ingreso: row.hire_date ? String(row.hire_date).slice(0, 10) : "",
    antiguedad: row.hire_date ? yearsSince(row.hire_date) : 0,
    salario: Number(row.monthly_salary ?? 0),
    email: row.email,
  };
}
