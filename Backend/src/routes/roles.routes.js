// routes/roles.routes.js
import express from "express";
import { crearRol, obtenerRoles } from "../controllers/roles.controller.js";

const router = express.Router();

// Obtener todos los roles
router.get("/", obtenerRoles);

// Crear nuevo rol
router.post("/", crearRol);

export default router;
