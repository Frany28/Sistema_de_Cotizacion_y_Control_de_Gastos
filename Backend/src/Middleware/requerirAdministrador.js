export const requerirAdministrador = (req, res, next) => {
  const rolId = Number(req.user?.rol_id ?? req.user?.rolId);

  if (rolId !== 1) {
    return res.status(403).json({
      message: "Esta operación está reservada para administradores",
    });
  }

  return next();
};
