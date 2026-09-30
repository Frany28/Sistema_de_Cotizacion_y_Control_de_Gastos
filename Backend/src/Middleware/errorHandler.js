// middlewares/errorHandler.js
export const errorHandler = (err, req, res, next) => {
  console.error("Error capturado: ", {
    message: err.message,
    stack: err.stack,
    ruta: req.originalUrl,
    metodo: req.method,
  });

  const status = Number(err.status || err.statusCode) || 500;
  const mensajePublico =
    status >= 500
      ? "Error interno del servidor"
      : err.message || "No se pudo procesar la solicitud";

  res.status(status).json({
    message: mensajePublico,
  });
};

