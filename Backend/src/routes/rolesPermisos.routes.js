// routes/rolesPermisos.routes.js
import express from "express";
import {
  asignarPermisoARol,
  eliminarPermisoDeRol,
  obtenerPermisosPorRol,
} from "../controllers/rolesPermisos.controller.js";

const router = express.Router();

router.get("/:rol_id/permisos", obtenerPermisosPorRol);
router.post("/", asignarPermisoARol);
router.delete("/", eliminarPermisoDeRol);

export default router;
