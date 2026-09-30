// controllers/cotizaciones.controller.js
import db from "../config/database.js";
import path from "path";
import cacheMemoria, {
  obtenerScopeSucursalCache,
  invalidarCachePorPrefijos,
} from "../utils/cacheMemoria.js";
import { generarHTMLCotizacion } from "../../templates/generarHTMLCotizacion.js";
import { generarPdfSeguro, sanitizarDatosPdf } from "../utils/seguridadPdf.js";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const archivoActual = fileURLToPath(import.meta.url);
const carpetaActual = path.dirname(archivoActual);

let logo = null;
try {
  const rutaLogo = path.join(
    carpetaActual,
    "..",
    "..",
    "styles",
    "Logo Operaciones Logisticas Falcon.jpg",
  );
  const bufferLogo = fs.readFileSync(rutaLogo);
  logo = `data:image/jpeg;base64,${bufferLogo.toString("base64")}`;
} catch (err) {
  console.error("No se pudo cargar el logo en Cotización:", err);
}

// Obtener todas las cotizaciones con detalle

export const getCotizaciones = async (req, res) => {
  const page = Number.isNaN(Number(req.query.page))
    ? 1
    : Number(req.query.page);
  const limit = Number.isNaN(Number(req.query.limit))
    ? 10
    : Number(req.query.limit);
  const offset = (page - 1) * limit;

  const q = (req.query.search || "").trim();

  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const claveCache = `cotizaciones_${scopeSucursal}_${page}_${limit}_${q}`;
  const enCache = cacheMemoria.get(claveCache);
  if (enCache) return res.json(enCache);

  try {
    let total;

    const esAdmin = Number(req.user?.rol_id) === 1;
    const filtroSucursalSql =
      esAdmin && scopeSucursal === "todas" ? "" : " AND c.sucursal_id = ?";
    const paramsSucursal =
      esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

    if (q) {
      const [[{ total: count }]] = await db.query(
        `SELECT COUNT(*) AS total
           FROM cotizaciones c
           JOIN clientes cli ON c.cliente_id = cli.id
          WHERE (c.codigo_referencia LIKE ? OR cli.nombre LIKE ?)
          ${filtroSucursalSql}`,
        [`%${q}%`, `%${q}%`, ...paramsSucursal],
      );
      total = count;
    } else {
      const [[{ total: count }]] = await db.query(
        `SELECT COUNT(*) AS total
           FROM cotizaciones c
          WHERE 1=1 ${filtroSucursalSql}`,
        [...paramsSucursal],
      );
      total = count;
    }

    let cotizaciones;
    if (q) {
      [cotizaciones] = await db.query(
        `
          SELECT 
            c.id,
            c.fecha,
            c.total,
            c.estado,
            c.motivo_rechazo,
            c.codigo_referencia AS codigo,
            c.subtotal,
            c.impuesto,
            c.cliente_id,
            c.sucursal_id,
            c.confirmacion_cliente,
            c.observaciones,
            s.nombre AS sucursal,
            cli.nombre AS cliente_nombre
          FROM cotizaciones c
          JOIN clientes cli ON c.cliente_id = cli.id
          LEFT JOIN sucursales s ON c.sucursal_id = s.id
         WHERE (c.codigo_referencia LIKE ? OR cli.nombre LIKE ?)
         ${filtroSucursalSql}
         ORDER BY c.fecha DESC
         LIMIT ${limit} OFFSET ${offset}
        `,
        [`%${q}%`, `%${q}%`, ...paramsSucursal],
      );
    } else {
      [cotizaciones] = await db.query(
        `
          SELECT 
            c.id,
            c.fecha,
            c.total,
            c.estado,
            c.motivo_rechazo,
            c.codigo_referencia AS codigo,
            c.subtotal,
            c.impuesto,
            c.cliente_id,
            c.sucursal_id,
            c.confirmacion_cliente,
            c.observaciones,
            s.nombre AS sucursal,
            cli.nombre AS cliente_nombre
          FROM cotizaciones c
          JOIN clientes cli ON c.cliente_id = cli.id
          LEFT JOIN sucursales s ON c.sucursal_id = s.id
         WHERE 1=1 ${filtroSucursalSql}
         ORDER BY c.fecha DESC
         LIMIT ${limit} OFFSET ${offset}
        `,
        [...paramsSucursal],
      );
    }

    cacheMemoria.set(claveCache, { cotizaciones, total, page, limit });
    return res.json({ cotizaciones, total, page, limit });
  } catch (error) {
    console.error("Error al obtener cotizaciones:", error);
    return res.status(500).json({ message: "Error al obtener cotizaciones" });
  }
};

// controllers/cotizaciones.controller.js
export const getCotizacionById = async (req, res) => {
  const { id } = req.params;

  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const claveCache = `cotizacion_${scopeSucursal}_${id}`;
  const enCache = cacheMemoria.get(claveCache);
  if (enCache) return res.json(enCache);

  try {
    const esAdmin = Number(req.user?.rol_id) === 1;
    const whereSucursal =
      esAdmin && scopeSucursal === "todas" ? "" : " AND c.sucursal_id = ?";
    const paramsSucursal =
      esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

    const [[cot]] = await db.query(
      `SELECT
         c.id,
         c.fecha,
         c.total,
         c.estado,
         c.subtotal,
         c.impuesto,
         c.cliente_id,
         c.sucursal_id,
         s.nombre    AS sucursal,
         c.confirmacion_cliente,
         c.observaciones,
         c.operacion,
         c.mercancia,
         c.bl,
         c.contenedor,
         c.puerto,
         c.motivo_rechazo,
         c.codigo_referencia AS codigo, 
         cli.nombre  AS cliente_nombre,
         cli.email,
         u.nombre    AS declarante
       FROM cotizaciones c
       JOIN clientes cli ON c.cliente_id = cli.id
       LEFT JOIN sucursales s ON c.sucursal_id = s.id
       LEFT JOIN usuarios u   ON u.id = c.creadoPor
       WHERE c.id = ? ${whereSucursal}`,
      [id, ...paramsSucursal],
    );

    if (!cot)
      return res.status(404).json({ message: "No existe esa cotización" });

    const [detalle] = await db.query(
      `SELECT
         dc.id,
         dc.servicio_productos_id,
         sp.nombre           AS servicio,
         sp.descripcion,
         dc.cantidad,
         dc.precio_unitario,
         dc.porcentaje_iva,
         dc.subtotal,
         dc.impuesto,
         dc.total
       FROM detalle_cotizacion dc
       JOIN servicios_productos sp ON sp.id = dc.servicio_productos_id
       WHERE dc.cotizacion_id = ?`,
      [id],
    );

    cot.subtotal = Number(cot.subtotal);
    cot.impuesto = Number(cot.impuesto);
    cot.total = Number(cot.total);
    cot.detalle = detalle;

    cacheMemoria.set(claveCache, cot);
    return res.json(cot);
  } catch (error) {
    console.error("Error al obtener cotización:", error);
    return res.status(500).json({ message: "Error interno" });
  }
};

// Actualizar estado de cotización
export const actualizarEstadoCotizacion = async (req, res) => {
  const { id } = req.params;
  const { estado, motivo_rechazo } = req.body;

  // 0) Validar sucursal (admin ve todo; usuario solo su sucursal)
  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;

  // 1) Verificar existencia/estado y obtener sucursal_id (para cache)
  const whereSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " AND sucursal_id = ?";
  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

  const [estadoRow] = await db.query(
    `SELECT estado, sucursal_id FROM cotizaciones WHERE id = ? ${whereSucursalSql} LIMIT 1`,
    [id, ...paramsSucursal],
  );

  if (!estadoRow.length) {
    return res.status(404).json({ message: "Cotización no encontrada" });
  }

  const estadoActual = estadoRow[0].estado;
  const sucursalIdCotizacion = Number(estadoRow[0].sucursal_id);

  if (estadoActual === "aprobada") {
    return res.status(403).json({
      message: "No se puede cambiar el estado de una cotización aprobada",
    });
  }

  if (!["pendiente", "aprobada", "rechazada"].includes(estado)) {
    return res.status(400).json({ message: "Estado no válido" });
  }

  if (estado === "rechazada" && (!motivo_rechazo || !motivo_rechazo.trim())) {
    return res
      .status(400)
      .json({ message: "Debes indicar el motivo del rechazo." });
  }

  try {
    // 2) Actualizar estado (respetando sucursal si aplica)
    const [result] = await db.query(
      `UPDATE cotizaciones
          SET estado = ?,
              motivo_rechazo = ?
        WHERE id = ? ${whereSucursalSql}`,
      [
        estado,
        estado === "rechazada" ? motivo_rechazo.trim() : null,
        id,
        ...paramsSucursal,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Cotización no encontrada" });
    }

    // 3) Si se aprueba => generar CxC y limpiar cache
    if (estado === "aprobada") {
      const [cotizacionData] = await db.query(
        `SELECT cliente_id, total FROM cotizaciones WHERE id = ? LIMIT 1`,
        [id],
      );

      if (cotizacionData.length > 0) {
        const cot = cotizacionData[0];

        const [insertResult] = await db.query(
          `INSERT INTO cuentas_por_cobrar 
            (codigo, cliente_id, cotizacion_id, monto, descripcion, estado, fecha_emision, fecha_vencimiento)
           VALUES (?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 15 DAY))`,
          [
            "",
            cot.cliente_id,
            id,
            cot.total,
            `Cuenta generada por cotización #${id}`,
            "pendiente",
          ],
        );

        const nuevoId = insertResult.insertId;
        const codigoGenerado = `CXC-${nuevoId.toString().padStart(5, "0")}`;

        await db.query(
          `UPDATE cuentas_por_cobrar SET codigo = ? WHERE id = ?`,
          [codigoGenerado, nuevoId],
        );
      }

      // ✅ invalidación de cache correcta (por sucursal de la cotización)
      const scopeInvalidar =
        !Number.isNaN(sucursalIdCotizacion) && sucursalIdCotizacion > 0
          ? String(sucursalIdCotizacion)
          : null;

      invalidarCachePorPrefijos({
        prefijos: ["cotizaciones_", "cotizacion_", "buscCot_"],
        scopeSucursal: scopeInvalidar,
      });
    }

    return res.json({
      message: "Estado de cotización actualizado correctamente",
    });
  } catch (error) {
    console.error("Error al actualizar estado:", error);
    return res
      .status(500)
      .json({ message: "Error al actualizar el estado de la cotización" });
  }
};

export const buscarCotizaciones = async (req, res) => {
  const q = (req.query.q || "").trim();

  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const clave = `buscCot_${scopeSucursal}_${q}`;
  const hit = cacheMemoria.get(clave);
  if (hit) return res.json(hit);

  const esAdmin = Number(req.user?.rol_id) === 1;
  const filtroSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " AND c.sucursal_id = ?";
  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

  const [rows] = await db.query(
    `
      SELECT c.id,
             c.codigo_referencia AS codigo,
             cli.nombre          AS cliente,
             c.total
      FROM cotizaciones c
      JOIN clientes cli ON cli.id = c.cliente_id
      WHERE (c.codigo_referencia LIKE ? OR cli.nombre LIKE ?)
      ${filtroSucursalSql}
      ORDER BY c.id DESC
      LIMIT 20
    `,
    [`%${q}%`, `%${q}%`, ...paramsSucursal],
  );

  cacheMemoria.set(clave, rows, 120);
  return res.json(rows);
};

// En cotizaciones.controller.js

export const editarCotizacion = async (req, res) => {
  const { id } = req.params;

  const {
    cliente_id,
    sucursal_id,
    operacion = "",
    mercancia = "",
    bl = "",
    contenedor = "",
    puerto = "",
    confirmacion_cliente = false,
    observaciones = "",
    detalle = [],
  } = req.body;

  // Validar sucursal (admin ve todo; usuario solo su sucursal)
  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1) Validar estado actual + obtener sucursal anterior
    const whereSucursalSql =
      esAdmin && scopeSucursal === "todas" ? "" : " AND sucursal_id = ?";
    const paramsSucursal =
      esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

    const [rowsEstado] = await conn.query(
      `SELECT estado, sucursal_id FROM cotizaciones WHERE id = ? ${whereSucursalSql} LIMIT 1`,
      [id, ...paramsSucursal],
    );

    if (rowsEstado.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: "Cotización no encontrada." });
    }

    const estadoActual = rowsEstado[0].estado;
    const sucursalIdAnterior = Number(rowsEstado[0].sucursal_id);

    if (!["pendiente", "rechazada"].includes(estadoActual)) {
      await conn.rollback();
      return res.status(403).json({
        message:
          'Sólo se pueden editar cotizaciones en estado "pendiente" o "rechazada".',
      });
    }

    // 2) Actualizar cabecera
    const confirmacionClienteVal = confirmacion_cliente ? 1 : 0;

    await conn.query(
      `UPDATE cotizaciones
          SET cliente_id           = ?,
              sucursal_id          = ?,
              operacion            = ?,
              mercancia            = ?,
              bl                   = ?,
              contenedor           = ?,
              puerto               = ?,
              confirmacion_cliente = ?,
              observaciones        = ?,
              estado               = 'pendiente',
              fechaActualizacion   = NOW()
        WHERE id = ? ${whereSucursalSql}`,
      [
        cliente_id,
        sucursal_id,
        operacion,
        mercancia,
        bl,
        contenedor,
        puerto,
        confirmacionClienteVal,
        observaciones,
        id,
        ...paramsSucursal,
      ],
    );

    // 3) Leer detalle actual (viejo)
    const [detalleOldRows] = await conn.query(
      `SELECT id, servicio_productos_id, cantidad, precio_unitario, porcentaje_iva
         FROM detalle_cotizacion
        WHERE cotizacion_id = ?`,
      [id],
    );
    const viejoPorId = new Map(detalleOldRows.map((r) => [r.id, r]));

    // 4) Determinar operaciones en detalle
    const idsAEliminar = [];
    const lineasAActualizar = [];
    const lineasAInsertar = [];

    detalleOldRows.forEach(({ id: oldId }) => {
      if (!detalle.some((n) => n.id === oldId)) {
        idsAEliminar.push(oldId);
      }
    });

    detalle.forEach((item) => {
      if (item.id) {
        const viejo = viejoPorId.get(item.id);
        if (
          viejo.servicio_productos_id !== item.servicio_productos_id ||
          viejo.cantidad !== Number(item.cantidad) ||
          viejo.precio_unitario !== Number(item.precio_unitario) ||
          viejo.porcentaje_iva !== Number(item.porcentaje_iva)
        ) {
          lineasAActualizar.push(item);
        }
      } else {
        lineasAInsertar.push(item);
      }
    });

    // 5) Ejecutar eliminaciones
    if (idsAEliminar.length) {
      await conn.query(`DELETE FROM detalle_cotizacion WHERE id IN (?)`, [
        idsAEliminar,
      ]);
    }

    // 6) Actualizaciones
    for (const {
      id: lineaId,
      servicio_productos_id,
      cantidad,
      precio_unitario,
      porcentaje_iva,
    } of lineasAActualizar) {
      const cant = Number(cantidad);
      const precio = Number(precio_unitario);
      const iva = Number(
        typeof porcentaje_iva === "number" ? porcentaje_iva : 16,
      );
      const sub = cant * precio;
      const imp = sub * (iva / 100);

      await conn.query(
        `UPDATE detalle_cotizacion
            SET servicio_productos_id = ?,
                cantidad              = ?,
                precio_unitario       = ?,
                porcentaje_iva        = ?,
                subtotal              = ?,
                impuesto              = ?,
                total                 = ?
          WHERE id = ?`,
        [
          servicio_productos_id,
          cant,
          precio,
          iva,
          sub,
          imp,
          sub + imp,
          lineaId,
        ],
      );
    }

    // 7) Inserciones
    for (const {
      servicio_productos_id,
      cantidad,
      precio_unitario,
      porcentaje_iva = 16,
    } of lineasAInsertar) {
      const cant = Number(cantidad);
      const precio = Number(precio_unitario);
      const iva = Number(porcentaje_iva);
      const sub = cant * precio;
      const imp = sub * (iva / 100);

      await conn.query(
        `INSERT INTO detalle_cotizacion
           (cotizacion_id, servicio_productos_id, cantidad, precio_unitario, porcentaje_iva, subtotal, impuesto, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, servicio_productos_id, cant, precio, iva, sub, imp, sub + imp],
      );
    }

    // 8) Recalcular totales desde BD
    const [[totales]] = await conn.query(
      `SELECT 
         IFNULL(SUM(subtotal), 0) AS subtotal,
         IFNULL(SUM(impuesto), 0) AS impuesto
       FROM detalle_cotizacion
      WHERE cotizacion_id = ?`,
      [id],
    );

    const subtotalCalc = Number(totales.subtotal || 0);
    const impuestoCalc = Number(totales.impuesto || 0);
    const totalCalc = subtotalCalc + impuestoCalc;

    await conn.query(
      `UPDATE cotizaciones
          SET subtotal = ?, 
              impuesto = ?, 
              total    = ?,
              fechaActualizacion = NOW()
        WHERE id = ? ${whereSucursalSql}`,
      [subtotalCalc, impuestoCalc, totalCalc, id, ...paramsSucursal],
    );

    await conn.commit();

    // 9) ✅ Limpiar caches (correcto por sucursal)
    const sucursalIdNueva = Number(sucursal_id);

    const scopesAInvalidar = new Set();

    if (!Number.isNaN(sucursalIdAnterior) && sucursalIdAnterior > 0) {
      scopesAInvalidar.add(String(sucursalIdAnterior));
    }
    if (!Number.isNaN(sucursalIdNueva) && sucursalIdNueva > 0) {
      scopesAInvalidar.add(String(sucursalIdNueva));
    }

    if (scopesAInvalidar.size === 0) {
      invalidarCachePorPrefijos({
        prefijos: ["cotizaciones_", "cotizacion_", "buscCot_"],
      });
    } else {
      for (const scopeSucursalItem of scopesAInvalidar) {
        invalidarCachePorPrefijos({
          prefijos: ["cotizaciones_", "cotizacion_", "buscCot_"],
          scopeSucursal: scopeSucursalItem,
        });
      }
    }

    return res.json({
      message: "Cotización actualizada y reabierta como 'pendiente'.",
    });
  } catch (error) {
    await conn.rollback();
    console.error("Error editando cotización:", error);
    return res
      .status(500)
      .json({ message: "Error al editar la cotización.", error });
  } finally {
    conn.release();
  }
};

export const deleteCotizacion = async (req, res) => {
  const { id } = req.params;

  // Validar sucursal (admin ve todo; usuario solo su sucursal)
  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;
  const whereSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " AND sucursal_id = ?";
  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

  try {
    // 1) Verificar si existe y cuál es su estado + sucursal_id
    const [rows] = await db.query(
      `SELECT estado, sucursal_id FROM cotizaciones WHERE id = ? ${whereSucursalSql} LIMIT 1`,
      [id, ...paramsSucursal],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Cotización no encontrada" });
    }

    if (rows[0].estado === "aprobada") {
      return res
        .status(403)
        .json({ message: "No puede eliminar una cotización aprobada" });
    }

    const sucursalIdCotizacion = Number(rows[0].sucursal_id);

    // 2) Eliminar detalles primero
    await db.query("DELETE FROM detalle_cotizacion WHERE cotizacion_id = ?", [
      id,
    ]);

    // 3) Eliminar la cotización (respetando sucursal si aplica)
    const [result] = await db.query(
      `DELETE FROM cotizaciones WHERE id = ? ${whereSucursalSql}`,
      [id, ...paramsSucursal],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Cotización no encontrada" });
    }

    // ✅ invalidación de cache correcta
    const scopeInvalidar =
      !Number.isNaN(sucursalIdCotizacion) && sucursalIdCotizacion > 0
        ? String(sucursalIdCotizacion)
        : null;

    invalidarCachePorPrefijos({
      prefijos: ["cotizaciones_", "cotizacion_", "buscCot_"],
      scopeSucursal: scopeInvalidar,
    });

    return res.json({ message: "Cotización eliminada exitosamente" });
  } catch (error) {
    console.error("Error al eliminar cotización:", error);
    return res
      .status(500)
      .json({ message: "Hubo un error al eliminar la cotización" });
  }
};

// Generar PDF de cotización

export const generarPDFCotizacion = async (req, res) => {
  const { id } = req.params;
  const scopeSucursal = obtenerScopeSucursalCache(req);

  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;
  const filtroSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " AND c.sucursal_id = ?";
  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

  try {
    const [cotizacionData] = await db.query(
      `SELECT 
        c.id,
        c.codigo_referencia AS codigo,
        c.fecha,
        c.total,
        c.estado,
        c.subtotal,
        c.impuesto,
        c.observaciones,
        c.operacion,
        c.mercancia,
        c.bl,
        c.contenedor,
        c.puerto,
        s.nombre AS sucursal,
        cli.nombre AS cliente_nombre,
        cli.email,
        u.nombre AS declarante
      FROM cotizaciones c
      JOIN clientes cli ON cli.id = c.cliente_id
      LEFT JOIN sucursales s ON c.sucursal_id = s.id
      LEFT JOIN usuarios u ON u.id = c.creadoPor
      WHERE c.id = ?${filtroSucursalSql}`,
      [id, ...paramsSucursal],
    );

    if (cotizacionData.length === 0) {
      return res.status(404).json({ message: "Cotización no encontrada" });
    }

    const cotizacion = cotizacionData[0];

    const [detalleCotizacion] = await db.query(
      `SELECT 
         sp.nombre AS servicio,
         sp.tipo,
         dc.cantidad,
         dc.precio_unitario,
         dc.porcentaje_iva,
         dc.subtotal,
         dc.impuesto,
         dc.total
       FROM detalle_cotizacion dc
       JOIN servicios_productos sp ON sp.id = dc.servicio_productos_id
       WHERE dc.cotizacion_id = ?
       ORDER BY sp.nombre`,
      [id],
    );

    const datosCotizacion = {
      codigo: cotizacion.codigo,
      fecha: cotizacion.fecha,
      cliente: cotizacion.cliente_nombre,
      sucursal: cotizacion.sucursal || "N/A",
      estado: cotizacion.estado,
      observaciones: cotizacion.observaciones,
      operacion: cotizacion.operacion || "N/A",
      mercancia: cotizacion.mercancia || "N/A",
      bl: cotizacion.bl || "N/A",
      contenedor: cotizacion.contenedor || "N/A",
      puerto: cotizacion.puerto || "N/A",
      declarante: cotizacion.declarante || "N/A",
      subtotal: cotizacion.subtotal,
      impuesto: cotizacion.impuesto,
      total: cotizacion.total,
      detalle: detalleCotizacion,
      logo,
    };

    const html = generarHTMLCotizacion(
      sanitizarDatosPdf(datosCotizacion),
      "final",
    );

    const pdfBuffer = await generarPdfSeguro(html, {
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
    });

    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=cotizacion_${cotizacion.codigo}.pdf`,
      })
      .send(pdfBuffer);
  } catch (err) {
    console.error("Error generando PDF de cotización:", err);
    res.status(500).json({ message: "Error al generar PDF de cotización" });
  }
};
