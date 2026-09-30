// middlewares/validarPermisoUsuarios.js
import db from "../config/database.js";
import cacheMemoria from "../utils/cacheMemoria.js";

export const validarPermisoUsuarios = (permisoRequerido) => {
  return async (req, res, next) => {
    try {
      const usuario = req.user;
      if (!usuario?.id) {
        return res.status(401).json({ message: "No has iniciado sesion" });
      }

      if (usuario.rol_id === 1) {
        return next();
      }

      const claveCache = `permiso_rol_${usuario.rol_id}_${permisoRequerido}`;
      const hit = cacheMemoria.get(claveCache);

      let tienePermiso = hit;
      if (tienePermiso === undefined) {
        const [rows] = await db.execute(
          `
          SELECT 1
            FROM roles_permisos rp
            JOIN permisos p ON rp.permiso_id = p.id
           WHERE rp.rol_id = ?
             AND (p.nombre = ? OR p.clave = ?)
           LIMIT 1
          `,
          [usuario.rol_id, permisoRequerido, permisoRequerido],
        );

        tienePermiso = rows.length > 0;
        cacheMemoria.set(claveCache, tienePermiso, 600);
      }

      if (!tienePermiso) {
        return res
          .status(403)
          .json({ message: "No tienes permiso para esta accion" });
      }

      return next();
    } catch (error) {
      console.error("Error en validacion de permisos de usuario:", error);
      return res
        .status(500)
        .json({ message: "Error interno al verificar permisos" });
    }
  };
};
