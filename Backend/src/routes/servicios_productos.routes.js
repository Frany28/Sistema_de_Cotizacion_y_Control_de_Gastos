import express from "express";
import {
  crearServicioProducto,
  obtenerServiciosProductos,
  actualizarServicioProducto,
  eliminarServicioProducto,
  verificarServicioProductoExistente,
  restarCantidadProducto,
  getServicioProductoById,
} from "../controllers/servicios_productos.controller.js";

import { validarServicioProducto } from "../Middleware/validarServicioProducto.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";

const router = express.Router();

/* ✅ Crear servicio/producto: primero auth, luego permiso, luego validación, luego controlador */
router.post(
  "/",
  autenticarUsuario,
  verificarPermiso("crearServicio"),
  validarServicioProducto,
  crearServicioProducto
);

/* Editar y eliminar */
router.put(
  "/:id",
  autenticarUsuario,
  verificarPermiso("editarServicio"),
  validarServicioProducto,
  actualizarServicioProducto
);

router.put(
  "/restar/:id",
  autenticarUsuario,
  verificarPermiso("editarServicio"),
  restarCantidadProducto,
);

/* Listar (paginado/filtrado) */
router.get(
  "/",
  autenticarUsuario,
  verificarPermiso("verServicios"),
  obtenerServiciosProductos
);

/* Verificar duplicado por nombre */
router.get(
  "/check",
  autenticarUsuario,
  verificarPermiso("verServicios"),
  verificarServicioProductoExistente,
);

/* Obtener por id (si necesitas protegerlo, agrega auth+permiso aquí también) */
router.get(
  "/:id",
  autenticarUsuario,
  verificarPermiso("verServicios"),
  getServicioProductoById,
);

/* Eliminar */
router.delete(
  "/:id",
  autenticarUsuario,
  verificarPermiso("eliminarServicio"),
  eliminarServicioProducto
);

export default router;
