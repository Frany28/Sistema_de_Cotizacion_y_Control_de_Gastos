// middlewares/verificarPermisoDinamico.js
import db from "../config/database.js";
import cacheMemoria from "../utils/cacheMemoria.js";
import { autenticarUsuario } from "./autenticarUsuario.js";

export const verificaPermisoDinamico = [
  autenticarUsuario,
  async (req, res, next) => {
    const usuario = req.user;
    if (!usuario) {
      return res.status(401).json({ message: "No has iniciado sesion" });
    }

    const tipo = req.body?.tipo;
    const permisoClave =
      tipo === "gasto"
        ? "crearGasto"
        : tipo === "cotizacion"
          ? "crearCotizacion"
          : null;

    if (!permisoClave) {
      return res.status(400).json({ message: "Tipo de registro no valido" });
    }

    if (usuario.rol_id === 1) {
      return next();
    }

    try {
      const claveCache = `permiso_rol_${usuario.rol_id}_${permisoClave}`;
      const hit = cacheMemoria.get(claveCache);

      let tienePermiso = hit;
      if (tienePermiso === undefined) {
        const [rows] = await db.execute(
          `SELECT 1
             FROM roles_permisos rp
             JOIN permisos p ON p.id = rp.permiso_id
            WHERE rp.rol_id = ? AND p.nombre = ?
            LIMIT 1`,
          [usuario.rol_id, permisoClave],
        );

        tienePermiso = rows.length > 0;
        cacheMemoria.set(claveCache, tienePermiso, 600);
      }

      if (!tienePermiso) {
        return res.status(403).json({
          message: "No tienes permiso para crear este tipo de registro",
        });
      }

      return next();
    } catch (error) {
      console.error("Error al verificar permiso dinamico:", error);
      return res
        .status(500)
        .json({ message: "Error interno al verificar permisos" });
    }
  },
];
