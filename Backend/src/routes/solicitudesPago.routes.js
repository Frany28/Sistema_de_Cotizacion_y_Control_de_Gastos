// src/routes/solicitudes_pago.routes.js
import express from "express";
import {
  obtenerSolicitudesPago,
  obtenerSolicitudPagoPorId,
  actualizarSolicitudPago,
  cancelarSolicitudPago,
  pagarSolicitudPago,
  generarPDFSolicitudPago,
  obtenerOrdenesPagoSolicitud,
} from "../controllers/solicitudesPago.controller.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";
import { uploadComprobantePago } from "../utils/s3.js";
import { validarCuota } from "../Middleware/validarCuota.js";
import { limitarGeneracionPdf } from "../Middleware/limitesSeguridad.js";
import { validarContenidoArchivo } from "../Middleware/validarContenidoArchivo.js";

const router = express.Router();

router.get(
  "/",
  autenticarUsuario,
  verificarPermiso("verSolicitudesPago"),
  obtenerSolicitudesPago
);

router.get(
  "/:id/pdf",
  autenticarUsuario,
  verificarPermiso("verSolicitudesPago"),
  limitarGeneracionPdf,
  generarPDFSolicitudPago,
);

router.get(
  "/:id",
  autenticarUsuario,
  verificarPermiso("verSolicitudesPago"),
  obtenerSolicitudPagoPorId
);

router.patch(
  "/:id",
  autenticarUsuario,
  verificarPermiso("editarSolicitudPago"),
  actualizarSolicitudPago
);

router.patch(
  "/:id/cancelar",
  autenticarUsuario,
  verificarPermiso("editarSolicitudPago"),
  cancelarSolicitudPago
);

router.get(
  "/:id/ordenes-pago",
  autenticarUsuario,
  verificarPermiso("verSolicitudesPago"),
  obtenerOrdenesPagoSolicitud
);

router.patch(
  "/:id/pagar",
  autenticarUsuario,
  verificarPermiso("pagarSolicitudPago"),
  validarCuota,
  uploadComprobantePago.single("comprobante"),
  validarContenidoArchivo,
  pagarSolicitudPago
);

export default router;
