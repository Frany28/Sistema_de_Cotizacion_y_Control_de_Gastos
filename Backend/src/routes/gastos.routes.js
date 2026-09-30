// routes/gastos.routes.js
import express from "express";
import {
  getGastos,
  getGastoById,
  updateGasto,
  deleteGasto,
  getProveedores,
  actualizarEstadoGasto,
  getTiposGasto,
  obtenerUrlComprobante,
} from "../controllers/gastos.controller.js";

// Importamos el middleware de multer-s3:
import { uploadComprobante } from "../utils/s3.js";

import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import {
  verificarPermiso,
  scopeEdicionGasto,
} from "../Middleware/verificarPermiso.js";
import { validarGasto } from "../Middleware/validarGasto.js";
import { validarCuota } from "../Middleware/validarCuota.js";
import db from "../config/database.js";
import { obtenerScopeSucursalCache } from "../utils/cacheMemoria.js";
import { validarContenidoArchivo } from "../Middleware/validarContenidoArchivo.js";

const router = express.Router();

const validarAccesoGasto = async (req, res, next) => {
  try {
    const scopeSucursal = obtenerScopeSucursalCache(req);
    if (!scopeSucursal) {
      return res
        .status(403)
        .json({ message: "Tu usuario no tiene sucursal asignada." });
    }

    const esAdmin = Number(req.user?.rol_id) === 1;
    const filtroSucursal =
      esAdmin && scopeSucursal === "todas" ? "" : " AND sucursal_id = ?";
    const parametros =
      esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];
    const [[gasto]] = await db.execute(
      `SELECT id FROM gastos WHERE id = ?${filtroSucursal} LIMIT 1`,
      [req.params.id, ...parametros],
    );

    if (!gasto) {
      return res.status(404).json({ message: "Gasto no encontrado" });
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

// Rutas Públicas
router.get(
  "/proveedores",
  autenticarUsuario,
  verificarPermiso("verGastos"),
  getProveedores,
);
router.get(
  "/tipos",
  autenticarUsuario,
  verificarPermiso("verGastos"),
  getTiposGasto,
);

// Rutas Protegidas
router.get("/", autenticarUsuario, verificarPermiso("verGastos"), getGastos);

router.get(
  "/:id",
  autenticarUsuario,
  verificarPermiso("verGastos"),
  getGastoById
);

router.post(
  "/:id/comprobante",
  autenticarUsuario,
  verificarPermiso("editarGasto"),
  validarAccesoGasto,
  validarCuota,
  uploadComprobante.single("comprobante"),
  validarContenidoArchivo,
  async (req, res) => {
    try {
      const idGasto = req.params.id;

      // 1) Verificar que el gasto exista
      const [rows] = await db.execute("SELECT id FROM gastos WHERE id = ?", [
        idGasto,
      ]);
      if (rows.length === 0) {
        return res.status(404).json({ error: "Gasto no encontrado" });
      }

      // 2) Verificar que multer-s3 haya subido el archivo
      if (!req.file) {
        return res.status(400).json({ error: "No se envió ningún archivo" });
      }

      const keyFactura = req.file.key;

      // 4) Guardar esa key en la BD, en la columna
      await db.execute("UPDATE gastos SET documento = ? WHERE id = ?", [
        keyFactura,
        idGasto,
      ]);

      return res.json({
        mensaje: "Factura subido correctamente",
        urlFacturaKey: keyFactura,
      });
    } catch (err) {
      console.error("Error subiendo factura a S3:", err);
      return res.status(500).json({ error: "Error subiendo factura" });
    }
  }
);

router.get(
  "/:id/comprobante",
  autenticarUsuario,
  verificarPermiso("verGastos"),
  obtenerUrlComprobante
);

router.put(
  "/:id",
  autenticarUsuario,
  verificarPermiso("editarGasto"),
  scopeEdicionGasto,
  uploadComprobante.single("documento"),
  validarContenidoArchivo,
  validarGasto,
  updateGasto
);

router.put(
  "/:id/estado",
  autenticarUsuario,
  verificarPermiso("aprobarGasto"),
  actualizarEstadoGasto
);

router.delete(
  "/:id",
  autenticarUsuario,
  verificarPermiso("eliminarGasto"),
  deleteGasto
);

export default router;
