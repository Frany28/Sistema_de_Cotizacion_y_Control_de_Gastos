// src/routes/cxc.routes.js

import express from "express";
import { uploadComprobanteAbono } from "../utils/s3.js";

import {
  listaCuentasPorCobrar,
  clientesConCXC,
  getTotalesPorCliente,
  getSaldoCuenta,
  registrarAbono,
} from "../controllers/cxc.controller.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";

const router = express.Router();

router.post(
  "/:cuenta_id/abonos",
  autenticarUsuario,
  verificarPermiso("registrarAbonoCliente"),
  uploadComprobanteAbono.single("comprobante"),
  registrarAbono
);

router.get(
  "/",
  autenticarUsuario,
  verificarPermiso("verCuentasPorCobrar"),
  listaCuentasPorCobrar
);

router.get(
  "/clientes",
  autenticarUsuario,
  verificarPermiso("verCuentasPorCobrar"),
  clientesConCXC
);

router.get(
  "/totales/:cliente_id",
  autenticarUsuario,
  verificarPermiso("verCuentasPorCobrar"),
  getTotalesPorCliente
);

router.get(
  "/:cuenta_id/saldo",
  autenticarUsuario,
  verificarPermiso("registrarAbonoCliente"),
  getSaldoCuenta
);

export default router;
