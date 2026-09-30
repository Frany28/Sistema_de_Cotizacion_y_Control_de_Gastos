// middlewares/verificarPermiso.js
import db from "../config/database.js";
import { autenticarUsuario } from "./autenticarUsuario.js";
import cacheMemoria from "../utils/cacheMemoria.js";

/**
 * Middleware para proteger rutas según permiso dinámico.
 * Uso: router.post('/pagar', verificarPermiso('aprobar_solicitud_pago'), controller.pagar);
 */
export const verificarPermiso = (permisoRequerido) => [
  autenticarUsuario,
  async (req, res, next) => {
    // 1) Usuario autenticado en req.user
    const usuario = req.user;
    if (!usuario) {
      return res.status(401).json({ message: "No has iniciado sesión" });
    }

    // 2) SuperAdmin (rol_id = 1) salta comprobación
    if (usuario.rol_id === 1) {
      return next();
    }

    try {
      const claveCache = `permiso_rol_${usuario.rol_id}_${permisoRequerido}`;
      const hit = cacheMemoria.get(claveCache);

      if (hit !== undefined) {
        if (!hit) {
          return res
            .status(403)
            .json({ message: "No tienes permiso para esta acciÃ³n" });
        }
        return next();
      }

      // 3) Verificar en la BD si este rol tiene la clave de permiso
      const [rows] = await db.query(
        `SELECT 1
           FROM roles_permisos rp
           JOIN permisos p ON p.id = rp.permiso_id
          WHERE rp.rol_id = ? AND p.nombre = ?
          LIMIT 1`,
        [usuario.rol_id, permisoRequerido]
      );

      cacheMemoria.set(claveCache, rows.length > 0, 600);

      if (!rows.length) {
        return res
          .status(403)
          .json({ message: "No tienes permiso para esta acción" });
      }

      next();
    } catch (err) {
      console.error("Error al verificar permiso:", err);
      res.status(500).json({ message: "Error interno al verificar permisos" });
    }
  },
];

/**
 * Middleware específico para controlar la edición de gastos.
 * Solo usuarios con rol distinto de Supervisor (rol_id 3) o que cumplan condición pueden editar.
 */
export const scopeEdicionGasto = [
  autenticarUsuario,
  async (req, res, next) => {
    // Solo aplicable en PUT
    if (req.method !== "PUT") return next();

    const usuario = req.user;
    if (!usuario) {
      return res.status(401).json({ message: "No has iniciado sesión" });
    }

    // Obtener gasto actual
    const gastoId = req.params.id;
    const [[gasto]] = await db.query(
      "SELECT creadoPor, estado FROM gastos WHERE id = ?",
      [gastoId]
    );

    // Supervisor (rol_id = 3) solo puede editar sus propios gastos pendientes
    if (usuario.rol_id === 3) {
      if (gasto.creadoPor !== usuario.id || gasto.estado !== "pendiente") {
        return res.status(403).json({
          message: "Solo puedes editar tus propios gastos pendientes",
        });
      }
    }

    next();
  },
];
