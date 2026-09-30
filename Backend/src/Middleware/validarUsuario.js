// Middleware: validarUsuario.js

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const validarUsuario = async (req, res, next) => {
  const { nombre, email, password, rol_id } = req.body;

  // 1. Campos obligatorios
  if (!nombre?.trim() || !email?.trim() || !rol_id) {
    return res
      .status(400)
      .json({ message: "Debe proporcionar nombre, email y rol_id" });
  }

  // 2. Formato de email
  if (!EMAIL_REGEX.test(email.trim())) {
    return res
      .status(400)
      .json({ message: "El email tiene un formato inválido" });
  }

  // 3. Longitud mínima de password (si viene)
  if (password && password.length < 12) {
    return res
      .status(400)
      .json({ message: "La contraseña debe tener al menos 12 caracteres" });
  }

  next();
};
