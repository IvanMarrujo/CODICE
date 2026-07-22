import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import EmpleadoShell from "./components/EmpleadoShell.jsx";
import SupervisorShell from "./components/SupervisorShell.jsx";

const isEmpleado = window.location.pathname.startsWith("/empleado");
const isSupervisor = window.location.pathname.startsWith("/supervisor");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isSupervisor ? <SupervisorShell /> : isEmpleado ? <EmpleadoShell /> : <App />}
  </React.StrictMode>
);
