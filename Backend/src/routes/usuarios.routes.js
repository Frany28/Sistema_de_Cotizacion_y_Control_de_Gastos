// routes/usuarios.routes.js
import express from "express";
import db from "../config/database.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { verificarPermiso } from "../Middleware/verificarPermiso.js";
import { uploadFirma } from "../utils/s3.js";
import cacheMemoria from "../utils/cacheMemoria.js";

import {
  obtenerUsuarios,
  obtenerUsuarioPorId,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
} from "../controllers/usuarios.controller.js";

const router = express.Router();

// Listado y detalle
router.get(
  "/",
  autenticarUsuario,
  verificarPermiso("verUsuarios"),
  obtenerUsuarios
);

router.get(
  "/:id",
  autenticarUsuario,
  verificarPermiso("verUsuarios"),
  obtenerUsuarioPorId
);

// Crear
router.post(
  "/",
  autenticarUsuario,
  verificarPermiso("crearUsuario"),
  uploadFirma.single("firma"),
  crearUsuario
);

// Actualizar (✅ aquí va cuotaMb también)
router.put(
  "/:id",
  autenticarUsuario,
  verificarPermiso("editarUsuario"),
  uploadFirma.single("firma"),
  actualizarUsuario
);

// Eliminar
router.delete(
  "/:id",
  autenticarUsuario,
  verificarPermiso("eliminarUsuario"),
  eliminarUsuario
);

// Verificar permiso por clave (frontend)
router.get("/permisos/:clave", autenticarUsuario, async (req, res) => {
  const { clave } = req.params;
  const usuario = req.user;

  try {
    if (usuario.rol_id === 1) {
      return res.json({ tienePermiso: true });
    }

    const claveCache = `permiso_rol_${usuario.rol_id}_${clave}`;
    const hit = cacheMemoria.get(claveCache);
    if (hit !== undefined) {
      return res.json({ tienePermiso: Boolean(hit) });
    }

    const [rows] = await db.query(
      `SELECT 1
         FROM roles_permisos rp
         JOIN permisos p ON p.id = rp.permiso_id
        WHERE rp.rol_id = ? AND p.nombre = ?
        LIMIT 1`,
      [usuario.rol_id, clave]
    );

    const tienePermiso = rows.length > 0;
    cacheMemoria.set(claveCache, tienePermiso, 600);
    res.json({ tienePermiso });
  } catch (error) {
    console.error("Error al verificar permiso (frontend):", error);
    res.status(500).json({ message: "Error interno al verificar permiso" });
  }
});

export default router;
