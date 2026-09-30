import db from "../config/database.js";
import bcrypt from "bcrypt";

const HASH_COMPARACION_SIMULADA =
  "$2b$10$1pQN9js1hkMaTMXHQsFheOstscH8rgOpyN82vSY6a3cyJyckG5AfW";

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password ||
    email.length > 254 ||
    password.length > 1024
  ) {
    return res
      .status(400)
      .json({ message: "Email y contraseña son obligatorios" });
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM usuarios WHERE email = ? AND estado = 'activo'",
      [email.trim()],
    );

    const usuario = rows[0] ?? null;
    const passwordValida = await bcrypt.compare(
      password,
      usuario?.password ?? HASH_COMPARACION_SIMULADA,
    );

    if (!usuario || !passwordValida) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });

    req.session.usuario = {
      id: usuario.id,
      rol_id: usuario.rol_id,
      nombre: usuario.nombre,
      email: usuario.email,
    };
    req.session.userId = usuario.id;

    await new Promise((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });

    return res.json({
      message: "Login exitoso",
      usuario: req.session.usuario,
    });
  } catch (error) {
    console.error("Error al iniciar sesión:", error);
    return res.status(500).json({ message: "Error interno al iniciar sesión" });
  }
};
