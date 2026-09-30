// routes/roles.routes.js
import express from "express";
import { crearRol, obtenerRoles } from "../controllers/roles.controller.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { requerirAdministrador } from "../Middleware/requerirAdministrador.js";

const router = express.Router();

router.use(autenticarUsuario, requerirAdministrador);

// Obtener todos los roles
router.get("/", obtenerRoles);

// Crear nuevo rol
router.post("/", crearRol);

export default router;
