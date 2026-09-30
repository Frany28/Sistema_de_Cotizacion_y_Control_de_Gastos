import db from "../config/database.js";
import cacheMemoria from "../utils/cacheMemoria.js";

const limpiarCachePermisosRol = (rolId) => {
  const prefijo = `permiso_rol_${rolId}_`;

  for (const clave of cacheMemoria.keys()) {
    if (clave.startsWith(prefijo) || clave === `permisos_rol_${rolId}`) {
      cacheMemoria.del(clave);
    }
  }
};

export const obtenerPermisosPorRol = async (req, res) => {
  const { rol_id } = req.params;

  try {
    const claveCache = `permisos_rol_${rol_id}`;
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);

    const [permisos] = await db.query(
      `SELECT p.id, p.nombre, p.descripcion
       FROM permisos p
       INNER JOIN roles_permisos rp ON p.id = rp.permiso_id
       WHERE rp.rol_id = ?`,
      [rol_id],
    );

    cacheMemoria.set(claveCache, permisos, 600);
    return res.json(permisos);
  } catch (error) {
    console.error("Error al obtener permisos del rol:", error);
    return res.status(500).json({ message: "Error al obtener permisos" });
  }
};

export const asignarPermisoARol = async (req, res) => {
  const { rol_id, permiso_id } = req.body;

  if (!rol_id || !permiso_id) {
    return res
      .status(400)
      .json({ message: "rol_id y permiso_id son requeridos" });
  }

  try {
    await db.query(
      "INSERT INTO roles_permisos (rol_id, permiso_id) VALUES (?, ?)",
      [rol_id, permiso_id],
    );

    limpiarCachePermisosRol(rol_id);
    return res
      .status(201)
      .json({ message: "Permiso asignado al rol correctamente" });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ message: "Este permiso ya esta asignado al rol" });
    }

    console.error("Error al asignar permiso:", error);
    return res.status(500).json({ message: "Error al asignar permiso al rol" });
  }
};

export const eliminarPermisoDeRol = async (req, res) => {
  const { rol_id, permiso_id } = req.body;

  if (!rol_id || !permiso_id) {
    return res
      .status(400)
      .json({ message: "rol_id y permiso_id son requeridos" });
  }

  try {
    await db.query(
      "DELETE FROM roles_permisos WHERE rol_id = ? AND permiso_id = ?",
      [rol_id, permiso_id],
    );

    limpiarCachePermisosRol(rol_id);
    return res.json({ message: "Permiso eliminado del rol correctamente" });
  } catch (error) {
    console.error("Error al eliminar permiso del rol:", error);
    return res
      .status(500)
      .json({ message: "Error al eliminar permiso del rol" });
  }
};
