import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import EmpleadoShell, { ActaFirmaView } from "./components/EmpleadoShell.jsx";

// /acta-firma/{token} — pantalla pública de testigo digital, sin login.
// Se resuelve ANTES que /empleado: el firmante llega por un link de
// WhatsApp/copiar-link, nunca por el flujo normal de sesión.
const actaFirmaMatch = window.location.pathname.match(/^\/acta-firma\/([^/]+)/);
const isEmpleado = window.location.pathname.startsWith("/empleado");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {actaFirmaMatch ? <ActaFirmaView token={actaFirmaMatch[1]} /> : (isEmpleado ? <EmpleadoShell /> : <App />)}
  </React.StrictMode>
);
