import { createHash } from "node:crypto";

const VENTANA_LOGIN_MS = 15 * 60 * 1000;
const MAX_INTENTOS_LOGIN = 10;
const intentosLogin = new Map();

let pdfsActivos = 0;
const MAX_PDFS_CONCURRENTES = 2;

const claveIp = (req) => req.ip || req.socket?.remoteAddress || "desconocida";

const claveRedisLogin = (req) => {
  const hashIp = createHash("sha256").update(claveIp(req)).digest("hex");
  return `seguridad:login:${hashIp}`;
};

const limpiarIntentosExpirados = (ahora) => {
  if (intentosLogin.size < 1000) return;
  for (const [clave, registro] of intentosLogin) {
    if (ahora - registro.inicio >= VENTANA_LOGIN_MS) {
      intentosLogin.delete(clave);
    }
  }
};

const limitarIntentosLoginEnMemoria = (req, res, next) => {
  const clave = claveIp(req);
  const ahora = Date.now();
  limpiarIntentosExpirados(ahora);
  const registro = intentosLogin.get(clave);

  if (registro && ahora - registro.inicio < VENTANA_LOGIN_MS) {
    if (registro.intentos >= MAX_INTENTOS_LOGIN) {
      const reintentarEn = Math.ceil(
        (VENTANA_LOGIN_MS - (ahora - registro.inicio)) / 1000,
      );
      res.set("Retry-After", String(reintentarEn));
      return res.status(429).json({
        message: "Demasiados intentos. Intenta nuevamente más tarde",
      });
    }
  } else if (registro) {
    intentosLogin.delete(clave);
  }

  res.once("finish", () => {
    if (res.statusCode === 401) {
      const actual = intentosLogin.get(clave);
      if (!actual || ahora - actual.inicio >= VENTANA_LOGIN_MS) {
        intentosLogin.set(clave, { intentos: 1, inicio: Date.now() });
      } else {
        actual.intentos += 1;
      }
    } else if (res.statusCode >= 200 && res.statusCode < 300) {
      intentosLogin.delete(clave);
    }
  });

  return next();
};

export const limitarIntentosLogin = async (req, res, next) => {
  const redis = req.sessionStore?.client;
  if (!redis?.isReady) {
    return limitarIntentosLoginEnMemoria(req, res, next);
  }

  const clave = claveRedisLogin(req);

  try {
    const intentos = await redis.incr(clave);
    if (intentos === 1) {
      await redis.expire(clave, Math.ceil(VENTANA_LOGIN_MS / 1000));
    }

    if (intentos > MAX_INTENTOS_LOGIN) {
      const ttl = await redis.ttl(clave);
      res.set("Retry-After", String(Math.max(ttl, 1)));
      return res.status(429).json({
        message: "Demasiados intentos. Intenta nuevamente más tarde",
      });
    }

    res.once("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        redis.del(clave).catch((error) => {
          console.error("No se pudo limpiar el límite de login:", error);
        });
      }
    });

    return next();
  } catch (error) {
    return next(error);
  }
};

export const limitarGeneracionPdf = (_req, res, next) => {
  if (pdfsActivos >= MAX_PDFS_CONCURRENTES) {
    res.set("Retry-After", "5");
    return res.status(429).json({
      message: "El generador de documentos está ocupado. Intenta nuevamente",
    });
  }

  pdfsActivos += 1;
  let liberado = false;
  const liberar = () => {
    if (liberado) return;
    liberado = true;
    pdfsActivos = Math.max(0, pdfsActivos - 1);
  };

  res.once("finish", liberar);
  res.once("close", liberar);
  return next();
};
