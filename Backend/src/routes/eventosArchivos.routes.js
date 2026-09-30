// routes/eventosArchivos.routes.js
import { Router } from "express";
import {
  obtenerMetricasTablero,
  obtenerTendenciaActividad,
  listarActividadReciente,
  contarVersionesDelMesPorArchivo,
  obtenerAlmacenamientoTotalPorDocumento,
  obtenerContadoresTarjetas,
  generarPdfMovimientosArchivos,
} from "../controllers/eventosArchivos.controller.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";
import { limitarGeneracionPdf } from "../Middleware/limitesSeguridad.js";

const router = Router();

// Middleware local: solo Admin (1) o Supervisor (2)
const verificarRolAdminSupervisor = (req, res, next) => {
  const rolId = req.user?.rol_id ?? req.user?.rolId;
  const rolSlug = (req.user?.rolSlug || req.user?.rol || "")
    .toString()
    .toLowerCase();
  const esValido =
    rolId === 1 ||
    rolId === 2 ||
    rolSlug === "admin" ||
    rolSlug === "supervisor";
  if (!esValido) {
    return res.status(403).json({
      ok: false,
      mensaje:
        "Acceso restringido al Gestor de Eventos (solo Admin o Supervisor).",
    });
  }
  return next();
};

/* === Endpoints de tablero === */
router.get(
  "/metricas",
  autenticarUsuario,
  verificarRolAdminSupervisor,
  verificarPermiso("verEventosArchivos"),
  obtenerMetricasTablero
);

// Serie diaria (el gráfico consume esta)
router.get(
  "/tendencia",
  autenticarUsuario,
  verificarRolAdminSupervisor,
  verificarPermiso("verEventosArchivos"),
  obtenerTendenciaActividad
);

/* === Feed principal === */
router.get(
  "/",
  autenticarUsuario,
  verificarRolAdminSupervisor,
  verificarPermiso("verEventosArchivos"),
  listarActividadReciente
);

/* === Utilidades por archivo === */
router.get(
  "/:id/versiones-del-mes",
  autenticarUsuario,
  verificarRolAdminSupervisor,
  verificarPermiso("verEventosArchivos"),
  contarVersionesDelMesPorArchivo
);

router.get(
  "/:id/almacenamiento-total",
  autenticarUsuario,
  verificarRolAdminSupervisor,
  verificarPermiso("verEventosArchivos"),
  obtenerAlmacenamientoTotalPorDocumento
);

router.get(
  "/contadores",
  autenticarUsuario,
  verificarRolAdminSupervisor,
  verificarPermiso("verEventosArchivos"),
  obtenerContadoresTarjetas
);

router.get(
  "/reporte.pdf",
  autenticarUsuario,
  verificarRolAdminSupervisor,
  verificarPermiso("verEventosArchivos"),
  limitarGeneracionPdf,
  generarPdfMovimientosArchivos
);

export default router;
