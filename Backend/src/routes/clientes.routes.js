// src/routes/clientes.routes.js
import express from "express";
import {
  crearCliente,
  obtenerClientes,
  actualizarCliente,
  eliminarCliente,
  verificarClienteExistente,
} from "../controllers/clientes.controller.js";
import { validarEliminacionCliente } from "../Middleware/validarEliminacionCliente.js";
import { validarCliente } from "../Middleware/validarCliente.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";

const router = express.Router();

// Ruta para crear un cliente
router.post(
  "/",
  autenticarUsuario,
  verificarPermiso("crearCliente"),
  validarCliente,
  crearCliente
);

// Ruta para editar un cliente
router.put(
  "/:id",
  autenticarUsuario,
  verificarPermiso("editarCliente"),
  validarCliente,
  actualizarCliente
);

// Ruta para obtener todos los clientes
router.get(
  "/",
  autenticarUsuario,
  verificarPermiso("verClientes"),
  obtenerClientes
);

// Ruta para verificar existencia de cliente (sin autenticación)
router.get(
  "/check",
  autenticarUsuario,
  verificarPermiso("verClientes"),
  verificarClienteExistente,
);

router.get(
  "/:id/validar-eliminacion",
  autenticarUsuario,
  verificarPermiso("eliminarCliente"),
  async (req, res) => {
    try {
      await validarEliminacionCliente(req, res, () => {
        res.json({ ok: true });
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Error validando eliminación" });
    }
  }
);

// Ruta para eliminar un cliente (usa el mismo middleware de validación)
router.delete(
  "/:id",
  autenticarUsuario,
  verificarPermiso("eliminarCliente"),
  validarEliminacionCliente,
  eliminarCliente
);

export default router;
