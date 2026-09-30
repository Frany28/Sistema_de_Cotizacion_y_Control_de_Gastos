import express from "express";
import {
  getCotizaciones,
  getCotizacionById,
  editarCotizacion,
  actualizarEstadoCotizacion,
  generarPDFCotizacion,
  deleteCotizacion,
  buscarCotizaciones,
} from "../controllers/cotizaciones.controller.js";

import { validarCotizacion } from "../Middleware/validarCotizacion.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";
import { limitarGeneracionPdf } from "../Middleware/limitesSeguridad.js";

const router = express.Router();

router.get(
  "/",
  autenticarUsuario,
  verificarPermiso("verCotizaciones"),
  getCotizaciones
);
router.get(
  "/buscar",
  autenticarUsuario,
  verificarPermiso("verCotizaciones"),
  buscarCotizaciones,
);
router.get(
  "/:id",
  autenticarUsuario,
  verificarPermiso("verCotizaciones"),
  getCotizacionById
);
router.get(
  "/:id/pdf",
  autenticarUsuario,
  verificarPermiso("verCotizaciones"),
  limitarGeneracionPdf,
  generarPDFCotizacion,
);
router.put(
  "/:id",
  autenticarUsuario,
  verificarPermiso("editarCotizacion"),
  validarCotizacion,
  editarCotizacion
);
router.delete(
  "/:id",
  autenticarUsuario,
  verificarPermiso("eliminarCotizacion"),
  deleteCotizacion
);
router.patch(
  "/:id/estado",
  autenticarUsuario,
  verificarPermiso("aprobarCotizacion"),
  actualizarEstadoCotizacion
);
export default router;
