import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import EmpleadoShell from "./components/EmpleadoShell.jsx";

const isEmpleado = window.location.pathname.startsWith("/empleado");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isEmpleado ? <EmpleadoShell /> : <App />}
  </React.StrictMode>
);
