// src/controllers/eventosArchivos.controller.js
import db from "../config/database.js";
import { generarHTMLEventosArchivos } from "../../templates/generarHTMLEventosArchivos.js";
import { generarPdfSeguro, sanitizarDatosPdf } from "../utils/seguridadPdf.js";
import PDFDocument from "pdfkit";
import cacheMemoria from "../utils/cacheMemoria.js"; // 🧠 cache en memoria

export const rolAdmin = 1;
export const rolSupervisor = 2;
export const rolEmpleado = 3;

/* ===========================
 * Utilidades comunes (camelCase)
 * =========================== */

/** Convierte a entero positivo o devuelve default */
const toPosInt = (valor, defecto) => {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : defecto;
};

/** Restringe un número entre [min, max] */
const clamp = (numero, min, max) => Math.max(min, Math.min(max, numero));

/** Normaliza un valor JS a string estable para claves de cache */
const normalizarParaClave = (valor) => {
  if (valor === undefined || valor === null) return "null";
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor))
    return `[${valor.map(normalizarParaClave).join(",")}]`;
  if (typeof valor === "object") {
    const entradasOrdenadas = Object.entries(valor).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entradasOrdenadas
      .map(([k, v]) => `${k}:${normalizarParaClave(v)}`)
      .join("|")}}`;
  }
  return String(valor);
};

/** Construye clave determinística: prefijo_param=valor|... */
const construirClaveCache = (prefijo, objetoParams = {}) => {
  const entradas = Object.entries(objetoParams).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const partes = entradas.map(([k, v]) => `${k}=${normalizarParaClave(v)}`);
  return `${prefijo}_${partes.join("|")}`;
};

/** Borra todas las claves del cache que comiencen por 'prefijo' */
const borrarPorPrefijo = (prefijo) => {
  for (const clave of cacheMemoria.keys()) {
    if (clave.startsWith(prefijo)) cacheMemoria.del(clave);
  }
};

/** Prefijos que usa ESTE controlador (para limpieza selectiva) */
const prefijosEventos = {
  metricas: "ev_metricas_",
  tendencia: "ev_tendencia_",
  feed: "ev_feed_",
  versionesMes: "ev_versionesMes_",
  almacenamientoDoc: "ev_almaPorDoc_",
  tarjetas: "ev_tarjetas_",
  pdfDatos: "ev_pdfDatos_",
};

/** API pública para limpieza (para que otros controladores la llamen) */
export const limpiarCacheEventos = (prefijo = null) => {
  const lista = Object.values(prefijosEventos);
  if (prefijo && typeof prefijo === "string") {
    const coincide = lista.find(
      (p) => p.startsWith(prefijo) || prefijo.startsWith(p),
    );
    if (coincide) {
      borrarPorPrefijo(coincide);
      return { ok: true, limpiado: coincide };
    }
    // Si envían un prefijo no listado, limpiamos exactamente ese
    borrarPorPrefijo(prefijo);
    return { ok: true, limpiado: prefijo };
  }
  // Limpia todos los prefijos de este controlador
  for (const p of lista) borrarPorPrefijo(p);
  return { ok: true, limpiado: "todos" };
};

/** Handler opcional (exponlo por ruta /eventos/limpiar-cache?prefijo=ev_tendencia_) */
export const limpiarCacheEventosHandler = async (req, res) => {
  try {
    // Opcional: permitir solo admin/supervisor
    const rolId = req.user?.rol_id;
    if (![rolAdmin, rolSupervisor].includes(rolId)) {
      return res.status(403).json({ ok: false, mensaje: "No autorizado" });
    }
    const { prefijo } = req.query;
    const resultado = limpiarCacheEventos(prefijo ?? null);
    return res.json({ ok: true, ...resultado });
  } catch (error) {
    console.error("Error en limpiarCacheEventosHandler:", error);
    return res
      .status(500)
      .json({ ok: false, mensaje: "Error al limpiar cache" });
  }
};

/* =====  A) MÉTRICAS DEL TABLERO  ===== */

/**
 * Métricas del tablero (mes en curso).
 * Cache TTL: 60s. Bypass con ?refresh=1
 */
export const obtenerMetricasTablero = async (req, res) => {
  const { registroTipo } = req.query;

  const fechaInicio = new Date();
  fechaInicio.setDate(1);
  fechaInicio.setHours(0, 0, 0, 0);

  const fechaFin = new Date(fechaInicio);
  fechaFin.setMonth(fechaFin.getMonth() + 1);

  const filtroTipoSql = registroTipo ? "AND a.registroTipo = ?" : "";
  const paramsTipo = registroTipo ? [registroTipo] : [];

  const claveCache = construirClaveCache(prefijosEventos.metricas, {
    registroTipo: registroTipo ?? "all",
    mes: fechaInicio.toISOString().slice(0, 7),
  });

  const forzarRefresh = String(req.query.refresh) === "1";
  if (!forzarRefresh) {
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);
  }

  try {
    const [[mActivos]] = await db.query(
      `SELECT COUNT(*) AS totalArchivosActivos
         FROM archivos a
        WHERE a.estado = 'activo' ${filtroTipoSql}`,
      paramsTipo,
    );

    const [[mEventos]] = await db.query(
      `SELECT COUNT(*) AS totalEventosMes
         FROM eventosArchivo e
        WHERE e.fechaHora >= ? AND e.fechaHora < ?`,
      [fechaInicio, fechaFin],
    );

    const [[mVersiones]] = await db.query(
      `SELECT COUNT(*) AS totalVersionesMes
         FROM versionesArchivo v
         JOIN archivos a ON a.id = v.archivoId
        WHERE v.creadoEn >= ? AND v.creadoEn < ?
              ${filtroTipoSql}`,
      [fechaInicio, fechaFin, ...paramsTipo],
    );

    const [[mAlmacen]] = await db.query(
      `SELECT COALESCE(SUM(a.tamanioBytes),0) AS totalAlmacenamientoBytes
         FROM archivos a
        WHERE 1=1 ${filtroTipoSql}`,
      paramsTipo,
    );

    const respuesta = {
      totalArchivosActivos: mActivos.totalArchivosActivos,
      totalEventosMes: mEventos.totalEventosMes,
      totalVersionesMes: mVersiones.totalVersionesMes,
      totalAlmacenamientoBytes: mAlmacen.totalAlmacenamientoBytes,
    };

    cacheMemoria.set(claveCache, respuesta, 60);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error en obtenerMetricasTablero:", error);
    return res.status(500).json({ mensaje: "Error al obtener métricas" });
  }
};

/**
 * Tendencia de actividad (diaria).
 * Cache TTL: 300s. Bypass con ?refresh=1
 */
export const obtenerTendenciaActividad = async (req, res) => {
  const dias = clamp(Number(req.query.dias ?? 30), 7, 180);
  const { registroTipo, accion, todo } = req.query;

  const claveCache = construirClaveCache(prefijosEventos.tendencia, {
    dias,
    registroTipo: registroTipo ?? "all",
    accion: accion ?? "all",
    todo: String(todo ?? "0"),
  });

  const forzarRefresh = String(req.query.refresh) === "1";
  if (!forzarRefresh) {
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);
  }

  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const fechaFin = new Date(hoy);
    fechaFin.setDate(fechaFin.getDate() + 1);

    const fechaInicio = new Date(fechaFin);
    fechaInicio.setDate(fechaFin.getDate() - dias);

    if (String(todo) === "1") {
      const [[minRow]] = await db.query(
        `SELECT MIN(DATE(fechaHora)) AS fechaMin FROM eventosArchivo`,
      );
      if (minRow?.fechaMin) {
        const fechaMinDb = new Date(minRow.fechaMin);
        fechaMinDb.setHours(0, 0, 0, 0);
        fechaInicio.setTime(fechaMinDb.getTime());
      }
    }

    const params = [];
    const filtrosEv = [];
    const filtrosJoinArch = [];

    if (accion) {
      filtrosEv.push(`ev.accionNorm = ?`);
      params.push(accion);
    } else {
      filtrosEv.push(
        `ev.accionNorm IN ('subidaArchivo','eliminacionArchivo','sustitucionArchivo','borradoDefinitivo')`,
      );
    }
    if (registroTipo) {
      filtrosJoinArch.push(`a.registroTipo = ?`);
      params.push(registroTipo);
    }

    const whereEv = filtrosEv.length ? `WHERE ${filtrosEv.join(" AND ")}` : "";
    const andJoinArch = filtrosJoinArch.length
      ? `AND ${filtrosJoinArch.join(" AND ")}`
      : "";

    const [rows] = await db.query(
      `
      WITH RECURSIVE fechas AS (
        SELECT DATE(?) AS f
        UNION ALL
        SELECT DATE_ADD(f, INTERVAL 1 DAY) FROM fechas
        WHERE f < DATE(?)
      ),
      eventosNorm AS (
        SELECT
          DATE(e.fechaHora) AS fechaDia,
          CASE
            WHEN e.accion IN ('subida','subidaArchivo')                 THEN 'subidaArchivo'
            WHEN e.accion IN ('eliminacion','eliminacionArchivo')       THEN 'eliminacionArchivo'
            WHEN e.accion IN ('sustitucion','sustitucionArchivo')       THEN 'sustitucionArchivo'
            WHEN e.accion = 'borradoDefinitivo'                         THEN 'borradoDefinitivo'
            ELSE ''
          END AS accionNorm,
          e.archivoId
        FROM eventosArchivo e
        WHERE e.fechaHora >= ? AND e.fechaHora < ?
      ),
      ev AS (
        SELECT en.*, a.registroTipo
        FROM eventosNorm en
        JOIN archivos a ON a.id = en.archivoId
        WHERE 1=1 ${andJoinArch}
      )
      SELECT
        f.f AS fecha,
        SUM(CASE WHEN ev.accionNorm = 'subidaArchivo'       THEN 1 ELSE 0 END) AS subidas,
        SUM(CASE WHEN ev.accionNorm = 'eliminacionArchivo'  THEN 1 ELSE 0 END) AS eliminaciones,
        SUM(CASE WHEN ev.accionNorm = 'sustitucionArchivo'  THEN 1 ELSE 0 END) AS sustituciones,
        SUM(CASE WHEN ev.accionNorm = 'borradoDefinitivo'   THEN 1 ELSE 0 END) AS borradosDefinitivos
      FROM fechas f
      LEFT JOIN ev ON ev.fechaDia = f.f
      ${whereEv}
      GROUP BY f.f
      ORDER BY f.f ASC
      `,
      [fechaInicio, fechaFin, fechaInicio, fechaFin, ...params],
    );

    const respuesta = {
      desde: fechaInicio,
      hasta: fechaFin,
      dias,
      serie: rows,
    };
    cacheMemoria.set(claveCache, respuesta, 300);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error en obtenerTendenciaActividad:", error);
    return res.status(500).json({ mensaje: "Error al obtener tendencia" });
  }
};

/* =====  B) FEED DE ACTIVIDAD  ===== */

/**
 * Feed de actividad (paginado, sensible a rol/usuario).
 * Cache TTL: 45s. Bypass con ?refresh=1
 */
export const listarActividadReciente = async (req, res) => {
  const creadoPorUsuario = req.user.id;
  const rolId = req.user.rol_id;
  const esVistaCompleta = rolId === rolAdmin || rolId === rolSupervisor;

  const limit = clamp(Number(req.query.limit ?? 10), 1, 100);
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const { q, accion, registroTipo, desde, hasta } = req.query;

  const filtros = [];
  const params = [];

  if (desde) {
    filtros.push("en.fechaHora >= ?");
    params.push(new Date(`${desde}T00:00:00`));
  }
  if (hasta) {
    filtros.push("en.fechaHora < ?");
    params.push(new Date(`${hasta}T23:59:59`));
  }
  if (accion) {
    filtros.push("en.accionNorm = ?");
    params.push(accion);
  } else {
    filtros.push("en.accionNorm <> ''");
  }
  if (registroTipo) {
    filtros.push("a.registroTipo = ?");
    params.push(registroTipo);
  }
  if (q) {
    filtros.push("a.nombreOriginal LIKE ?");
    params.push(`%${q}%`);
  }
  if (!esVistaCompleta) {
    filtros.push("(a.subidoPor = ? OR en.creadoPor = ?)");
    params.push(creadoPorUsuario, creadoPorUsuario);
  }

  const whereSql = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

  const claveCache = construirClaveCache(prefijosEventos.feed, {
    usuarioId: creadoPorUsuario,
    rolId,
    limit,
    offset,
    q: q ?? "",
    accion: accion ?? "all",
    registroTipo: registroTipo ?? "all",
    desde: desde ?? "",
    hasta: hasta ?? "",
  });

  const forzarRefresh = String(req.query.refresh) === "1";
  if (!forzarRefresh) {
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);
  }

  try {
    const baseSql = `
      WITH eventosNorm AS (
        SELECT
          e.id,
          e.fechaHora,
          e.creadoPor,
          e.archivoId,
          CASE
            WHEN e.accion IN ('subida','subidaArchivo')                 THEN 'subidaArchivo'
            WHEN e.accion IN ('eliminacion','eliminacionArchivo')       THEN 'eliminacionArchivo'
            WHEN e.accion IN ('sustitucion','sustitucionArchivo')       THEN 'sustitucionArchivo'
            WHEN e.accion = 'borradoDefinitivo'                         THEN 'borradoDefinitivo'
            ELSE ''
          END AS accionNorm
        FROM eventosArchivo e
      )
      SELECT
        en.id             AS eventoId,
        en.fechaHora      AS fechaEvento,
        en.accionNorm     AS tipoEvento,
        en.creadoPor      AS usuarioId,
        u.nombre          AS usuarioNombre,
        a.id              AS archivoId,
        a.nombreOriginal  AS nombreArchivo,
        a.extension       AS extension,
        a.tamanioBytes    AS tamanioBytes,
        a.registroTipo    AS registroTipo,
        a.registroId      AS registroId
      FROM eventosNorm en
      JOIN archivos a      ON a.id = en.archivoId
      LEFT JOIN usuarios u ON u.id = en.creadoPor
      ${whereSql}
    `;

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM (${baseSql}) AS t`,
      params,
    );

    const [tiposRows] = await db.query(
      `SELECT DISTINCT tipoEvento FROM (${baseSql}) AS t
       WHERE tipoEvento IN ('subidaArchivo','eliminacionArchivo','sustitucionArchivo','borradoDefinitivo')
       ORDER BY tipoEvento ASC`,
      params,
    );
    const tiposDisponibles = tiposRows.map((r) => r.tipoEvento);

    const [eventos] = await db.query(
      `${baseSql}
       ORDER BY fechaEvento DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const respuesta = { eventos, limit, offset, total, tiposDisponibles };
    cacheMemoria.set(claveCache, respuesta, 45);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error en listarActividadReciente:", error);
    return res.status(500).json({ mensaje: "Error al listar eventos" });
  }
};

/* =====  C) VERSIONES DEL MES POR ARCHIVO  ===== */

/**
 * Cuenta versiones del mes para un archivo.
 * Cache TTL: 300s. Bypass con ?refresh=1
 */
export const contarVersionesDelMesPorArchivo = async (req, res) => {
  const archivoId = Number(req.params.id);

  const fechaInicio = new Date();
  fechaInicio.setDate(1);
  fechaInicio.setHours(0, 0, 0, 0);

  const fechaFin = new Date(fechaInicio);
  fechaFin.setMonth(fechaFin.getMonth() + 1);

  const claveCache = construirClaveCache(prefijosEventos.versionesMes, {
    archivoId,
    mes: fechaInicio.toISOString().slice(0, 7),
  });

  const forzarRefresh = String(req.query.refresh) === "1";
  if (!forzarRefresh) {
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);
  }

  try {
    const [[existe]] = await db.query(`SELECT id FROM archivos WHERE id = ?`, [
      archivoId,
    ]);
    if (!existe) {
      return res.status(404).json({ mensaje: "Archivo no encontrado" });
    }

    const [[fila]] = await db.query(
      `SELECT COUNT(*) AS totalDelMes
         FROM versionesArchivo
        WHERE archivoId = ?
          AND creadoEn >= ? AND creadoEn < ?`,
      [archivoId, fechaInicio, fechaFin],
    );

    const respuesta = { totalDelMes: fila.totalDelMes };
    cacheMemoria.set(claveCache, respuesta, 300);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error al contar versiones del mes:", error);
    return res
      .status(500)
      .json({ mensaje: "Error al contar versiones del mes" });
  }
};

/* =====  D) ALMACENAMIENTO TOTAL POR DOCUMENTO  ===== */

/**
 * Suma de bytes por documento (registroTipo + registroId del archivo base).
 * Cache TTL: 300s. Bypass con ?refresh=1
 */
export const obtenerAlmacenamientoTotalPorDocumento = async (req, res) => {
  const archivoId = req.params.id;

  const claveCache = construirClaveCache(prefijosEventos.almacenamientoDoc, {
    archivoId,
  });

  const forzarRefresh = String(req.query.refresh) === "1";
  if (!forzarRefresh) {
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);
  }

  try {
    // ✅ 1) Verificar que existe el archivo
    const [[archivo]] = await db.query(
      `SELECT id, tamanioBytes
         FROM archivos
        WHERE id = ?`,
      [archivoId],
    );

    if (!archivo) {
      return res.status(404).json({ mensaje: "Archivo no encontrado" });
    }

    // ✅ 2) Calcular total SOLO desde versiones (fuente de verdad)
    const [[sumaVersiones]] = await db.query(
      `SELECT 
         COALESCE(SUM(CAST(tamanioBytes AS UNSIGNED)), 0) AS totalBytes
       FROM versionesArchivo
       WHERE archivoId = ?`,
      [archivoId],
    );

    // ✅ 3) Fallback: si no hay versiones aún, usar tamanioBytes del archivo
    const totalVersionesBytes = Number(sumaVersiones?.totalBytes);
    const tamanioArchivoBytes = Number(archivo?.tamanioBytes);

    const totalBytesFinal =
      Number.isFinite(totalVersionesBytes) && totalVersionesBytes > 0
        ? totalVersionesBytes
        : Number.isFinite(tamanioArchivoBytes)
          ? tamanioArchivoBytes
          : 0;

    const respuesta = { totalBytes: totalBytesFinal };
    cacheMemoria.set(claveCache, respuesta, 300);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error al calcular almacenamiento total:", error);
    return res
      .status(500)
      .json({ mensaje: "Error al calcular almacenamiento total" });
  }
};

/* =====  E) CONTADORES PARA TARJETAS (por rango)  ===== */

/**
 * Contadores para tarjetas (rango: mensual por defecto o ?desde/?hasta).
 * Cache TTL: 120s. Bypass con ?refresh=1
 */
export const obtenerContadoresTarjetas = async (req, res) => {
  try {
    const { desde, hasta, registroTipo } = req.query;

    const fechaInicio = desde
      ? new Date(`${desde}T00:00:00`)
      : (() => {
          const f = new Date();
          f.setDate(1);
          f.setHours(0, 0, 0, 0);
          return f;
        })();

    const fechaFin = hasta
      ? new Date(`${hasta}T23:59:59`)
      : (() => {
          const f = new Date(fechaInicio);
          f.setMonth(f.getMonth() + 1);
          return f;
        })();

    const claveCache = construirClaveCache(prefijosEventos.tarjetas, {
      registroTipo: registroTipo ?? "all",
      desde: fechaInicio,
      hasta: fechaFin,
    });

    const forzarRefresh = String(req.query.refresh) === "1";
    if (!forzarRefresh) {
      const hit = cacheMemoria.get(claveCache);
      if (hit) return res.json(hit);
    }

    const filtroTipoSql = registroTipo ? "AND a.registroTipo = ?" : "";
    const paramsTipo = registroTipo ? [registroTipo] : [];

    const [[mActivos]] = await db.query(
      `SELECT COUNT(*) AS totalArchivosActivos
         FROM archivos a
        WHERE a.estado = 'activo' ${filtroTipoSql}`,
      paramsTipo,
    );

    const baseParams = [fechaInicio, fechaFin, ...paramsTipo];

    const [[mSubidos]] = await db.query(
      `SELECT COUNT(*) AS totalSubidos
         FROM eventosArchivo e
         JOIN archivos a ON a.id = e.archivoId
        WHERE e.fechaHora >= ? AND e.fechaHora < ?
          AND e.accion = 'subidaArchivo' ${filtroTipoSql}`,
      baseParams,
    );

    const [[mEliminados]] = await db.query(
      `SELECT COUNT(*) AS totalEliminados
         FROM eventosArchivo e
         JOIN archivos a ON a.id = e.archivoId
        WHERE e.fechaHora >= ? AND e.fechaHora < ?
         AND e.accion = 'eliminacionArchivo'  ${filtroTipoSql}`,
      baseParams,
    );

    const [[mReemplazados]] = await db.query(
      `SELECT COUNT(*) AS totalReemplazados
         FROM eventosArchivo e
         JOIN archivos a ON a.id = e.archivoId
        WHERE e.fechaHora >= ? AND e.fechaHora < ?
          AND e.accion = 'sustitucionArchivo'  ${filtroTipoSql}`,
      baseParams,
    );

    const respuesta = {
      totalArchivosActivos: mActivos.totalArchivosActivos,
      totalSubidos: mSubidos.totalSubidos,
      totalEliminados: mEliminados.totalEliminados,
      totalReemplazados: mReemplazados.totalReemplazados,
      desde: fechaInicio,
      hasta: fechaFin,
      registroTipo: registroTipo ?? null,
    };

    cacheMemoria.set(claveCache, respuesta, 120);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error en obtenerContadoresTarjetas:", error);
    return res.status(500).json({ mensaje: "Error al obtener contadores" });
  }
};

/* =====  F) PDF DE MOVIMIENTOS (cache de datos, no del PDF)  ===== */

/**
 * Genera PDF de movimientos. Cacheo SOLO los datos (totales + detalle) 180s
 * para reducir carga de BD en reportes repetidos. El PDF se renderiza siempre.
 */
function rango({ tipoReporte, mes, anio, fechaInicio, fechaFin }) {
  const ahora = new Date();
  if (tipoReporte === "mensual") {
    const m = Number(mes);
    const y = Number(anio || ahora.getFullYear());
    const fIni = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const fFin = new Date(y, m, 1, 0, 0, 0, 0);
    return {
      fIni,
      fFin,
      periodoLabel: `Mensual ${String(m).padStart(2, "0")}/${y}`,
      fechaInicioTexto: fIni.toLocaleDateString("es-VE"),
      fechaFinTexto: new Date(fFin - 1).toLocaleDateString("es-VE"),
    };
  }
  if (tipoReporte === "anual") {
    const y = Number(anio || ahora.getFullYear());
    const fIni = new Date(y, 0, 1, 0, 0, 0, 0);
    const fFin = new Date(y + 1, 0, 1, 0, 0, 0, 0);
    return {
      fIni,
      fFin,
      periodoLabel: `Anual ${y}`,
      fechaInicioTexto: fIni.toLocaleDateString("es-VE"),
      fechaFinTexto: new Date(fFin - 1).toLocaleDateString("es-VE"),
    };
  }
  const fIni = new Date(`${fechaInicio}T00:00:00`);
  const fFin = new Date(`${fechaFin}T23:59:59`);
  return {
    fIni,
    fFin,
    periodoLabel: `Rango ${fechaInicio} → ${fechaFin}`,
    fechaInicioTexto: fIni.toLocaleDateString("es-VE"),
    fechaFinTexto: fFin.toLocaleDateString("es-VE"),
  };
}

export const generarPdfMovimientosArchivos = async (req, res) => {
  try {
    const {
      tipoReporte = "mensual",
      mes,
      anio,
      fechaInicio,
      fechaFin,
      registroTipo,
    } = req.query;

    let desde, hasta, fechaInicioTexto, fechaFinTexto;
    const hoy = new Date();

    if (tipoReporte === "mensual") {
      const mesNum = Number(mes ?? hoy.getMonth() + 1);
      const anioNum = Number(anio ?? hoy.getFullYear());
      desde = new Date(anioNum, mesNum - 1, 1, 0, 0, 0, 0);
      hasta = new Date(anioNum, mesNum, 1, 0, 0, 0, 0);
      fechaInicioTexto = desde.toLocaleDateString("es-VE");
      fechaFinTexto = new Date(hasta - 1).toLocaleDateString("es-VE");
    } else if (tipoReporte === "anual") {
      const anioNum = Number(anio ?? hoy.getFullYear());
      desde = new Date(anioNum, 0, 1, 0, 0, 0, 0);
      hasta = new Date(anioNum + 1, 0, 1, 0, 0, 0, 0);
      fechaInicioTexto = desde.toLocaleDateString("es-VE");
      fechaFinTexto = new Date(hasta - 1).toLocaleDateString("es-VE");
    } else if (tipoReporte === "rango") {
      desde = new Date(`${fechaInicio}T00:00:00`);
      const finDia = new Date(`${fechaFin}T23:59:59`);
      hasta = new Date(finDia.getTime() + 1000);
      fechaInicioTexto = desde.toLocaleDateString("es-VE");
      fechaFinTexto = new Date(hasta - 1).toLocaleDateString("es-VE");
    } else {
      return res.status(400).json({ mensaje: "tipoReporte inválido" });
    }

    // Clave de cache para los DATOS del PDF (no el buffer)
    const claveDatos = construirClaveCache(prefijosEventos.pdfDatos, {
      tipoReporte,
      mes: mes ?? "",
      anio: anio ?? "",
      fechaInicio: fechaInicio ?? "",
      fechaFin: fechaFin ?? "",
      registroTipo: registroTipo ?? "all",
    });

    const forzarRefresh = String(req.query.refresh) === "1";
    let datosPdf = !forzarRefresh ? cacheMemoria.get(claveDatos) : null;

    if (!datosPdf) {
      const filtrosJoin = ["e.fechaHora >= ? AND e.fechaHora < ?"];
      const paramsJoin = [desde, hasta];
      if (registroTipo) {
        filtrosJoin.push("a.registroTipo = ?");
        paramsJoin.push(registroTipo);
      }
      const whereJoin = filtrosJoin.join(" AND ");

      const [[totales]] = await db.query(
        `
        SELECT
          SUM(CASE WHEN accionNorm = 'subidaArchivo'       THEN 1 ELSE 0 END) AS subidos,
          SUM(CASE WHEN accionNorm = 'sustitucionArchivo'  THEN 1 ELSE 0 END) AS reemplazados,
          SUM(CASE WHEN accionNorm = 'eliminacionArchivo'  THEN 1 ELSE 0 END) AS eliminados,
          SUM(CASE WHEN accionNorm = 'borradoDefinitivo'   THEN 1 ELSE 0 END) AS borrados
        FROM (
          SELECT
            e.id,
            CASE
              WHEN e.accion IN ('subida','subidaArchivo')                 THEN 'subidaArchivo'
              WHEN e.accion IN ('sustitucion','sustitucionArchivo')       THEN 'sustitucionArchivo'
              WHEN e.accion IN ('eliminacion','eliminacionArchivo')       THEN 'eliminacionArchivo'
              WHEN e.accion = 'borradoDefinitivo'                         THEN 'borradoDefinitivo'
              ELSE ''
            END AS accionNorm
          FROM eventosArchivo e
          JOIN archivos a ON a.id = e.archivoId
          WHERE ${whereJoin}
        ) t
        `,
        paramsJoin,
      );

      const [detalle] = await db.query(
        `
        SELECT
          DATE_FORMAT(e.fechaHora, '%d/%m/%Y') AS fecha,
          DATE_FORMAT(e.fechaHora, '%H:%i')    AS hora,
          COALESCE(u.nombre, CONCAT('Usuario #', e.creadoPor)) AS usuario,
          e.accion               AS tipoAccion,
          a.nombreOriginal       AS archivo,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(e.detalles,'$.motivo')), '') AS observaciones
        FROM eventosArchivo e
        JOIN archivos a      ON a.id = e.archivoId
        LEFT JOIN usuarios u ON u.id = e.creadoPor
        WHERE ${whereJoin}
        ORDER BY e.fechaHora DESC
        LIMIT 500
        `,
        paramsJoin,
      );

      datosPdf = {
        fechaInicioTexto,
        fechaFinTexto,
        totales: {
          subidos: Number(totales?.subidos || 0),
          reemplazados: Number(totales?.reemplazados || 0),
          eliminados: Number(totales?.eliminados || 0),
          borrados: Number(totales?.borrados || 0),
        },
        detalleMovimientos: detalle.map((r) => ({
          fecha: r.fecha,
          hora: r.hora,
          usuario: r.usuario,
          tipoAccion: r.tipoAccion,
          archivo: r.archivo,
          observaciones: r.observaciones || "",
        })),
      };

      cacheMemoria.set(claveDatos, datosPdf, 180);
    }

    const html = generarHTMLEventosArchivos(
      sanitizarDatosPdf({
        usuario: req.user?.nombre || "admin",
        fechaInicioTexto: datosPdf.fechaInicioTexto,
        fechaFinTexto: datosPdf.fechaFinTexto,
        totales: datosPdf.totales,
        detalleMovimientos: datosPdf.detalleMovimientos,
        mostrarGrafico: true,
        mostrarDetalle: true,
        tituloReporte: "REPORTE DE MOVIMIENTOS DE ARCHIVOS",
        forzarDataUriLogo: true,
      }),
    );

    const pdfBuffer = await generarPdfSeguro(html, {
      printBackground: true,
      format: "A4",
      margin: { top: "16mm", right: "14mm", bottom: "14mm", left: "14mm" },
      preferCSSPageSize: true,
    });

    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=reporte_movimientos_${tipoReporte}.pdf`,
      })
      .send(pdfBuffer);
  } catch (error) {
    console.error("Error en generarPdfMovimientosArchivos:", error);
    return res.status(500).json({ mensaje: "No se pudo generar el PDF" });
  }
};
