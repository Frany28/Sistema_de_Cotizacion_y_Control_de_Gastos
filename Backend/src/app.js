// backend/src/app.js
import express from "express";
import cors from "cors";
import session from "express-session";
import { RedisStore } from "connect-redis"; // ← import nombrado correcto
import redisClient from "./config/redisClient.js";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

/* ── Middlewares propios ────────────────────────────────── */
import { errorHandler } from "./Middleware/errorHandler.js";
import { logger } from "./Middleware/logger.js";
import { autenticarUsuario } from "./Middleware/autenticarUsuario.js";

/* ── Rutas de negocio ───────────────────────────────────── */
import clientesRoutes from "./routes/clientes.routes.js";
import serviciosProductosRoutes from "./routes/servicios_productos.routes.js";
import proveedoresRoutes from "./routes/proveedores.routes.js";
import cotizacionesRoutes from "./routes/cotizaciones.routes.js";
import gastosRoutes from "./routes/gastos.routes.js";
import registrosRoutes from "./routes/registros.routes.js";
import sucursalesRoutes from "./routes/sucursales.routes.js";
import cxcRoutes from "./routes/cxc.routes.js";
import solicitudesPagoRoutes from "./routes/solicitudesPago.routes.js";
import bancosRoutes from "./routes/bancos.routes.js";
import archivosRoutes from "./routes/archivos.routes.js";
import almacenamientoRoutes from "./routes/almacenamiento.routes.js";
import "./jobs/purgarPapeleras.js";
import eventosArchivosRoutes from "./routes/eventosArchivos.routes.js";
import perfilRoutes from "./routes/perfil.routes.js";
import carpetasArchivosRoutes from "./routes/carpetasArchivos.routes.js";

import authRoutes from "./routes/auth.routes.js";
import usuariosRoutes from "./routes/usuarios.routes.js";
import rolesRoutes from "./routes/roles.routes.js";
import permisosRoutes from "./routes/permisos.routes.js";
import rolesPermisosRoutes from "./routes/rolesPermisos.routes.js";

dotenv.config();

/* ───── Init ─────────────────────────────────────────────── */
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "config", ".env") });

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });

  if (process.env.NODE_ENV === "production") {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  res.set("Cache-Control", "no-store");

  next();
});

/* ── CORS mínimo y correcto ────────────────────────────── */
const listaOrígenesPermitidos = [
  process.env.FRONT_URL || "http://localhost:5173",
];

const opcionesCors = {
  origin: (origen, callback) => {
    // Permite herramientas locales (origen null) y los orígenes configurados
    if (!origen || listaOrígenesPermitidos.includes(origen)) {
      return callback(null, true);
    }
    return callback(new Error("origenNoPermitido"), false);
  },
  credentials: true,
};

app.use(cors(opcionesCors));

/* ── Parsing ───────────────────────────────────────────── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Sesión ────────────────────────────────────────────── */
const esProduccion = process.env.NODE_ENV === "production";
const secretoSesion = process.env.SESSION_SECRET;

if (!secretoSesion || secretoSesion.length < 32) {
  throw new Error("SESSION_SECRET debe existir y tener al menos 32 caracteres");
}

const nombreCookie = "sidSistema"; // camelCase y claro
const opcionesDeCookie = {
  httpOnly: true,
  sameSite: "lax", // con proxy mismo origen es suficiente
  secure: esProduccion, // true en prod (https)
  path: "/",
  priority: "high",
  maxAge: 1000 * 60 * 60 * 2,
};

app.use(
  session({
    name: nombreCookie,
    secret: secretoSesion,
    resave: false,
    saveUninitialized: false,
    unset: "destroy",
    cookie: opcionesDeCookie,
    store: new RedisStore({ client: redisClient, prefix: "sess:" }),
  }),
);

/* ───── Estáticos y parsers ─────────────────────────────── */
app.use(
  "/uploads",
  autenticarUsuario,
  express.static(path.resolve(__dirname, "../uploads")),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger);

/* ───── Rutas REST ──────────────────────────────────────── */
app.use("/api/clientes", clientesRoutes);
app.use("/api/servicios-productos", serviciosProductosRoutes);
app.use("/api/proveedores", proveedoresRoutes);
app.use("/api/cotizaciones", cotizacionesRoutes);
app.use("/api/gastos", gastosRoutes);
app.use("/api/registros", registrosRoutes);
app.use("/api/sucursales", sucursalesRoutes);
app.use("/api/cuentas", cxcRoutes);
app.use("/api/solicitudes-pago", solicitudesPagoRoutes);
app.use("/api/bancos", bancosRoutes);
app.use("/api/archivos", archivosRoutes);
app.use("/api/carpetas-archivos", carpetasArchivosRoutes);
app.use("/api/almacenamiento", almacenamientoRoutes);
app.use("/api/perfil", perfilRoutes);
/* ───── Rutas de seguridad ──────────────────────────────── */
app.use("/api/auth", authRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/permisos", permisosRoutes);
app.use("/api/roles-permisos", rolesPermisosRoutes);
app.use("/api/archivos/eventos", eventosArchivosRoutes);

/* ───── 404 para API inexistente ─────────────────────────── */
app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(404).json({ message: "Ruta no encontrada" });
  }
  next();
});

/* ───── Error handler global ────────────────────────────── */
app.use(errorHandler);

export default app;
