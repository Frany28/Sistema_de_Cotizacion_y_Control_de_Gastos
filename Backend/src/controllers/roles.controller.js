// controllers/roles.controller.js
import db from "../config/database.js";
import cacheMemoria from "../utils/cacheMemoria.js";

const CLAVE_CACHE_ROLES = "roles_todos";

export const obtenerRoles = async (req, res) => {
  const hit = cacheMemoria.get(CLAVE_CACHE_ROLES);
  if (hit) return res.json(hit);

  try {
    const [rows] = await db.query("SELECT * FROM roles");
    cacheMemoria.set(CLAVE_CACHE_ROLES, rows, 1800);
    res.json(rows);
  } catch (error) {
    console.error("Error al obtener roles:", error);
    res.status(500).json({ message: "Error al obtener roles" });
  }
};

export const crearRol = async (req, res) => {
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res
      .status(400)
      .json({ message: "El nombre del rol es obligatorio" });
  }

  try {
    const [result] = await db.query(
      "INSERT INTO roles (nombre, descripcion) VALUES (?, ?)",
      [nombre, descripcion]
    );
    cacheMemoria.del(CLAVE_CACHE_ROLES);
    res.status(201).json({ id: result.insertId, nombre, descripcion });
  } catch (error) {
    console.error("Error al crear rol:", error);
    res.status(500).json({ message: "Error al crear rol" });
  }
};
