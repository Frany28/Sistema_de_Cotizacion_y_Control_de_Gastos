// routes/permisos.routes.js
import express from "express";
import {
  crearPermiso,
  obtenerPermisos,
} from "../controllers/permisos.controller.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { requerirAdministrador } from "../Middleware/requerirAdministrador.js";

const router = express.Router();

router.use(autenticarUsuario, requerirAdministrador);

router.get("/", obtenerPermisos);
router.post("/", crearPermiso);

export default router;
