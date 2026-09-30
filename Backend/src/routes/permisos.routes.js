// routes/permisos.routes.js
import express from "express";
import {
  crearPermiso,
  obtenerPermisos,
} from "../controllers/permisos.controller.js";

const router = express.Router();

router.get("/", obtenerPermisos);
router.post("/", crearPermiso);

export default router;
