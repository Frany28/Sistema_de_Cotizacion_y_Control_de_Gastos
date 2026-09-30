import express from "express";
import {
  getDatosRegistro,
  createRegistro,
  generarVistaPreviaCotizacion,
  getTiposGasto,
} from "../controllers/registros.controller.js";

import { validarRegistro } from "../Middleware/validarRegistro.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { verificaPermisoDinamico } from "../Middleware/verificarPermisoDinamico.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";
import { uploadComprobanteMemoria } from "../utils/s3.js";
import { validarCuota } from "../Middleware/validarCuota.js";
import { limitarGeneracionPdf } from "../Middleware/limitesSeguridad.js";
import { validarContenidoArchivo } from "../Middleware/validarContenidoArchivo.js";

const router = express.Router();

router.get("/", autenticarUsuario, getDatosRegistro);

router.post(
  "/",
  autenticarUsuario,
  uploadComprobanteMemoria,
  validarContenidoArchivo,
  validarCuota,
  verificaPermisoDinamico,
  validarRegistro,
  createRegistro
);

router.post(
  "/cotizaciones/vista-previa",
  autenticarUsuario,
  verificarPermiso("crearCotizacion"),
  limitarGeneracionPdf,
  generarVistaPreviaCotizacion
);

router.get("/tipos-gasto", autenticarUsuario, getTiposGasto);

export default router;
