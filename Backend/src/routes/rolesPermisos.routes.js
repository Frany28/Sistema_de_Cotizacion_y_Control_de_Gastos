// routes/rolesPermisos.routes.js
import express from "express";
import {
  asignarPermisoARol,
  eliminarPermisoDeRol,
  obtenerPermisosPorRol,
} from "../controllers/rolesPermisos.controller.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { requerirAdministrador } from "../Middleware/requerirAdministrador.js";

const router = express.Router();

router.use(autenticarUsuario, requerirAdministrador);

router.get("/:rol_id/permisos", obtenerPermisosPorRol);
router.post("/", asignarPermisoARol);
router.delete("/", eliminarPermisoDeRol);

export default router;
