import express from "express";
import { login } from "../controllers/auth.controller.js";
import { autenticarUsuario } from "../Middleware/autenticarUsuario.js";
import { limitarIntentosLogin } from "../Middleware/limitesSeguridad.js";

const router = express.Router();

router.get("/verificar-sesion", autenticarUsuario, (req, res) => {
  res.json({ message: "Sesión activa", usuario: req.user });
});

router.post("/login", limitarIntentosLogin, login);

router.post("/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ message: "Error al cerrar sesión" });
    }

    res.clearCookie("sidSistema", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return res.json({ message: "Sesión cerrada correctamente" });
  });
});

export default router;
