// src/routes/archivos.routes.js
import express from "express";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";
import { uploadGeneric } from "../utils/s3.js";
import { validarDestinoRepositorio } from "../Middleware/validarDestinoRepositorio.js";
import { validarContenidoArchivo } from "../Middleware/validarContenidoArchivo.js";

import {
  obtenerArbolArchivos,
  descargarArchivo,
  listarArchivos,
  eliminarArchivo,
  restaurarArchivo,
  listarHistorialVersiones,
  descargarVersion,
  restaurarVersion,
  eliminarDefinitivamente,
  eliminarDefinitivoArchivo,
  sustituirArchivo,
  obtenerDetallesArchivo,
  contarVersionesArchivo,
  listarArchivosEliminados,
  listarVersionesPorGrupo,
  purgarPapelera,
  subirArchivoRepositorio,
} from "../controllers/archivos.controller.js";

const router = express.Router();

/*─────────────────────── Árbol y subida ───────────────────────*/
router.get(
  "/arbol",
  autenticarUsuario,
  verificarPermiso("listarArchivos"),
  obtenerArbolArchivos,
);

router.put(
  "/sustituir/:registroTipo/:registroId",
  autenticarUsuario,
  verificarPermiso("editarArchivos"),
  uploadGeneric.single("archivo"),
  validarContenidoArchivo,
  sustituirArchivo,
);

/*─────────────────────── Descargas ────────────────────────────*/
router.get(
  "/descargar/:id",
  autenticarUsuario,
  verificarPermiso("verArchivos"),
  descargarArchivo,
);

router.get(
  "/version/:versionId/descargar",
  autenticarUsuario,
  verificarPermiso("verArchivos"),
  descargarVersion,
);

/*─────────────────────── Listados ─────────────────────────────*/
router.get(
  "/papelera",
  autenticarUsuario,
  verificarPermiso("verArchivos"),
  listarArchivosEliminados,
);

router.get(
  "/",
  autenticarUsuario,
  verificarPermiso("verArchivos"),
  listarArchivos,
);

router.get(
  "/grupo/:grupoArchivoId/versiones",
  autenticarUsuario,
  verificarPermiso("verArchivos"),
  listarVersionesPorGrupo,
);

router.get(
  "/detalle/:id",
  autenticarUsuario,
  verificarPermiso("verArchivos"),
  obtenerDetallesArchivo,
);

/*─────────────────────── Eliminación / Restauración ───────────*/
// Soft-delete (mover a papelera)
router.delete(
  "/:id",
  autenticarUsuario,
  verificarPermiso("eliminarArchivos"),
  eliminarArchivo,
);

// src/routes/archivos.routes.js
router.delete(
  "/papelera/purgar",
  autenticarUsuario,
  verificarPermiso("eliminarArchivos"),
  purgarPapelera,
);

// Restaurar archivo desde papelera
router.post(
  "/:id/restaurar",
  autenticarUsuario,
  verificarPermiso("restaurarArchivos"),
  restaurarArchivo,
);

router.delete(
  "/papelera/:id",
  autenticarUsuario,
  verificarPermiso("eliminarArchivos"),
  eliminarDefinitivoArchivo,
);

// Fallback global (solo-Admin) —mantener si lo usas en otras vistas
router.delete(
  "/eliminar-definitivo/:id",
  autenticarUsuario,
  verificarPermiso("eliminarArchivos"),
  eliminarDefinitivamente,
);

/*─────────────────────── Versiones ────────────────────────────*/
router.get(
  "/:id/total-versiones",
  autenticarUsuario,
  verificarPermiso("verArchivos"),
  contarVersionesArchivo,
);

router.get(
  "/:id/versiones",
  autenticarUsuario,
  verificarPermiso("verArchivos"),
  listarHistorialVersiones,
);

router.post(
  "/version/:versionId/restaurar",
  autenticarUsuario,
  verificarPermiso("editarArchivos"),
  restaurarVersion,
);

// Subir archivo al repositorio general
router.post(
  "/repositorio",
  autenticarUsuario,
  verificarPermiso("editarArchivos"),
  uploadGeneric.single("archivo"),
  validarContenidoArchivo,
  validarDestinoRepositorio,
  subirArchivoRepositorio,
);

export default router;
