// controllers/gastos.controller.js
import db from "../config/database.js";
import {
  generarUrlPrefirmadaLectura,
  s3,
  moverArchivoAPapelera,
} from "../utils/s3.js";
import { obtenerOcrearGrupoFactura } from "../utils/gruposArchivos.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import cacheMemoria, {
  obtenerScopeSucursalCache,
  invalidarCachePorPrefijos,
} from "../utils/cacheMemoria.js";

// controllers/gastos.controller.js
export const getGastos = async (req, res) => {
  const pageRaw = Number(req.query.page);
  const limitRaw = Number(req.query.limit);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 100)
      : 5;
  const offset = (page - 1) * limit;
  const q = (req.query.search || "").trim();

  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;

  const filtroSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " AND g.sucursal_id = ?";

  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

  const claveCache = `gastos_${scopeSucursal}_${page}_${limit}_${q}`;
  const respuestaEnCache = cacheMemoria.get(claveCache);
  if (respuestaEnCache) return res.json(respuestaEnCache);

  try {
    // 1) TOTAL (con filtro por sucursal)
    let total = 0;

    if (q) {
      const [[{ total: count }]] = await db.query(
        `
        SELECT COUNT(*) AS total
          FROM gastos g
          LEFT JOIN proveedores p ON p.id = g.proveedor_id
         WHERE (
              g.codigo        LIKE ?
           OR p.nombre        LIKE ?
           OR g.concepto_pago LIKE ?
         )
         ${filtroSucursalSql}
        `,
        [`%${q}%`, `%${q}%`, `%${q}%`, ...paramsSucursal],
      );
      total = count;
    } else {
      const [[{ total: count }]] = await db.query(
        `
        SELECT COUNT(*) AS total
          FROM gastos g
         WHERE 1=1
         ${filtroSucursalSql}
        `,
        [...paramsSucursal],
      );
      total = count;
    }

    // 2) LISTA (con filtro por sucursal)
    let gastos = [];
    if (q) {
      [gastos] = await db.query(
        `
        SELECT
          g.id,
          g.codigo,
          g.fecha,
          g.total,
          g.estado,
          g.motivo_rechazo,
          g.tipo_gasto_id,
          tg.nombre AS tipo_gasto,
          p.nombre  AS proveedor,
          s.nombre  AS sucursal,
          g.concepto_pago,
          g.descripcion,
          g.subtotal,
          g.impuesto,
          g.moneda,
          g.porcentaje_iva,
          g.tasa_cambio,
          g.cotizacion_id,
          g.documento
        FROM gastos g
        LEFT JOIN proveedores  p  ON p.id  = g.proveedor_id
        LEFT JOIN sucursales   s  ON s.id  = g.sucursal_id
        LEFT JOIN tipos_gasto  tg ON tg.id = g.tipo_gasto_id
        WHERE (
             g.codigo        LIKE ?
          OR p.nombre        LIKE ?
          OR g.concepto_pago LIKE ?
        )
        ${filtroSucursalSql}
        ORDER BY g.fecha DESC, g.id DESC
        LIMIT ${limit} OFFSET ${offset}
        `,
        [`%${q}%`, `%${q}%`, `%${q}%`, ...paramsSucursal],
      );
    } else {
      [gastos] = await db.query(
        `
        SELECT
          g.id,
          g.codigo,
          g.fecha,
          g.total,
          g.estado,
          g.motivo_rechazo,
          g.tipo_gasto_id,
          tg.nombre AS tipo_gasto,
          p.nombre  AS proveedor,
          s.nombre  AS sucursal,
          g.concepto_pago,
          g.descripcion,
          g.subtotal,
          g.impuesto,
          g.moneda,
          g.porcentaje_iva,
          g.tasa_cambio,
          g.cotizacion_id,
          g.documento
        FROM gastos g
        LEFT JOIN proveedores  p  ON p.id  = g.proveedor_id
        LEFT JOIN sucursales   s  ON s.id  = g.sucursal_id
        LEFT JOIN tipos_gasto  tg ON tg.id = g.tipo_gasto_id
        WHERE 1=1
        ${filtroSucursalSql}
        ORDER BY g.fecha DESC, g.id DESC
        LIMIT ${limit} OFFSET ${offset}
        `,
        [...paramsSucursal],
      );
    }

    const respuesta = { data: gastos, total, page, limit };
    cacheMemoria.set(claveCache, respuesta);

    return res.json(respuesta);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
};

export const obtenerUrlComprobante = async (req, res) => {
  try {
    const { id } = req.params;

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

    const claveCache = `gastoComprobante_${scopeSucursal}_${id}`;
    const enCache = cacheMemoria.get(claveCache);
    if (enCache) return res.json(enCache);

    const [[fila]] = await db.query(
      `SELECT documento AS keyS3
         FROM gastos
        WHERE id = ? ${whereSucursalSql}
        LIMIT 1`,
      [id, ...paramsSucursal],
    );

    if (!fila || !fila.keyS3) {
      return res
        .status(404)
        .json({ message: "Este gasto no tiene un comprobante adjunto" });
    }

    const url = await generarUrlPrefirmadaLectura(fila.keyS3, 300);
    const respuesta = { url };

    cacheMemoria.set(claveCache, respuesta);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error al obtener URL de comprobante:", error);
    return res
      .status(500)
      .json({ message: "Error al obtener el comprobante del gasto." });
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FUNCIÃ“N 1: updateGasto (solo cambios relacionados a eventos)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const updateGasto = async (req, res) => {
  const { id } = req.params;
  let claveS3Nueva = null;
  const conexion = await db.getConnection();

  // 0) Validar sucursal (admin ve todo; usuario solo su sucursal)
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
    await conexion.beginTransaction();

    // 1) Cargar gasto existente (respetando sucursal)
    const [[gastoExistente]] = await conexion.query(
      `SELECT * FROM gastos WHERE id = ? ${whereSucursalSql} LIMIT 1`,
      [id, ...paramsSucursal],
    );

    if (!gastoExistente) {
      await conexion.rollback();
      return res.status(404).json({ message: "Gasto no encontrado" });
    }

    if (gastoExistente.estado === "aprobado") {
      await conexion.rollback();
      return res
        .status(403)
        .json({ message: "No puedes editar un gasto aprobado." });
    }

    const {
      proveedor_id,
      concepto_pago,
      tipo_gasto_id,
      descripcion,
      subtotal,
      porcentaje_iva,
      fecha,
      cotizacion_id,
      moneda,
      tasa_cambio,
      estado,
      motivo_rechazo,
    } = req.body;

    // 2) Forzar sucursal para no-admin (no puede â€œmoverâ€ gastos)
    const sucursalIdFinal = Number(gastoExistente.sucursal_id);

    const subtotalNum = parseFloat(subtotal);
    const ivaNum = parseFloat(porcentaje_iva);
    const impuesto = parseFloat(((subtotalNum * ivaNum) / 100).toFixed(2));
    const total = parseFloat((subtotalNum + impuesto).toFixed(2));

    const estadosPermitidos = ["pendiente", "rechazado"];
    let nuevoEstado =
      gastoExistente.estado === "rechazado"
        ? "pendiente"
        : gastoExistente.estado;

    if (estado && estadosPermitidos.includes(estado)) nuevoEstado = estado;

    let motivoRechazoFinal =
      nuevoEstado === "rechazado" ? motivo_rechazo : null;

    if (
      nuevoEstado === "rechazado" &&
      (!motivo_rechazo || motivo_rechazo.trim() === "")
    ) {
      await conexion.rollback();
      return res
        .status(400)
        .json({ message: "Debes indicar el motivo del rechazo." });
    }

    let tasaCambioFinal = null;
    if (moneda === "VES") {
      const tasaCambioNumerica = parseFloat(tasa_cambio);
      if (Number.isNaN(tasaCambioNumerica)) {
        await conexion.rollback();
        return res
          .status(400)
          .json({ message: "Tasa de cambio invalida para VES." });
      }
      tasaCambioFinal = tasaCambioNumerica;
    }
    const documentoNuevo = req.file ? req.file.key : undefined;

    // 3) Update cabecera (respetando sucursal por WHERE y preservando sucursal_id)
    await conexion.query(
      `
      UPDATE gastos SET 
        proveedor_id = ?,
        concepto_pago = ?,
        tipo_gasto_id = ?,
        descripcion = ?,
        subtotal = ?,
        porcentaje_iva = ?,
        impuesto = ?,
        total = ?,
        fecha = ?,
        sucursal_id = ?,
        cotizacion_id = ?,
        moneda = ?,
        tasa_cambio = ?,
        estado = ?,
        motivo_rechazo = ?,
        ${documentoNuevo ? "documento = ?," : ""}
        updated_at = NOW()
      WHERE id = ? ${whereSucursalSql}
      `,
      [
        proveedor_id,
        concepto_pago,
        tipo_gasto_id,
        descripcion,
        subtotalNum,
        ivaNum,
        impuesto,
        total,
        fecha,
        sucursalIdFinal,
        cotizacion_id,
        moneda,
        tasaCambioFinal,
        nuevoEstado,
        motivoRechazoFinal,
        ...(documentoNuevo ? [documentoNuevo] : []),
        id,
        ...paramsSucursal,
      ],
    );

    // 4) Manejo de archivo (igual que ya lo tienes)
    if (documentoNuevo) {
      claveS3Nueva = documentoNuevo;
      const huboReemplazo = Boolean(gastoExistente.documento);

      if (huboReemplazo) {
        const rutaPapelera = await moverArchivoAPapelera(
          gastoExistente.documento,
          "facturasGastos",
          id,
        );

        await conexion.query(
          `UPDATE archivos
             SET estado = 'reemplazado', rutaS3 = ?
           WHERE registroTipo = 'facturasGastos'
             AND registroId   = ?
             AND estado       = 'activo'`,
          [rutaPapelera, id],
        );

        const [antArchivo] = await conexion.query(
          `SELECT id
             FROM archivos
            WHERE registroTipo = 'facturasGastos'
              AND registroId   = ?
              AND estado       = 'reemplazado'
            ORDER BY id DESC
            LIMIT 1`,
          [id],
        );

        if (antArchivo.length) {
          await conexion.query(
            `INSERT INTO eventosArchivo
               (archivoId, accion, creadoPor, fechaHora, ip, userAgent, detalles)
             VALUES (?, 'eliminacionArchivo', ?, NOW(), ?, ?, ?)`,
            [
              antArchivo[0].id,
              req.user?.id || null,
              req.ip || null,
              req.get("user-agent") || null,
              JSON.stringify({
                motivo: "SustituciÃ³n de la factura al editar gasto",
                nuevaRuta: rutaPapelera,
              }),
            ],
          );
        }
      }

      const grupoArchivoId = await obtenerOcrearGrupoFactura(
        conexion,
        id,
        req.user?.id || null,
      );

      const [[{ maxVer }]] = await conexion.query(
        `SELECT IFNULL(MAX(numeroVersion),0) AS maxVer
           FROM archivos
          WHERE registroTipo = 'facturasGastos'
            AND registroId   = ?`,
        [id],
      );
      const numeroVersion = maxVer + 1;

      const extension = req.file.originalname.split(".").pop().toLowerCase();
      const tamanioBytes = req.file.size;

      const [resArchivo] = await conexion.query(
        `INSERT INTO archivos
           (registroTipo, registroId, grupoArchivoId,
            nombreOriginal, extension, tamanioBytes,
            rutaS3, numeroVersion, estado,
            subidoPor, creadoEn, actualizadoEn)
         VALUES ('facturasGastos', ?, ?, ?, ?, ?, ?, ?, 'activo',
                 ?, NOW(), NOW())`,
        [
          id,
          grupoArchivoId,
          req.file.originalname,
          extension,
          tamanioBytes,
          claveS3Nueva,
          numeroVersion,
          req.user?.id || null,
        ],
      );
      const archivoId = resArchivo.insertId;

      await conexion.query(
        `INSERT INTO versionesArchivo
           (archivoId, numeroVersion, nombreOriginal, extension,
            tamanioBytes, rutaS3, subidoPor, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          archivoId,
          numeroVersion,
          req.file.originalname,
          extension,
          tamanioBytes,
          claveS3Nueva,
          req.user?.id || null,
        ],
      );

      const accionNueva = huboReemplazo
        ? "sustitucionArchivo"
        : "subidaArchivo";
      await conexion.query(
        `INSERT INTO eventosArchivo
           (archivoId, accion, creadoPor, fechaHora, ip, userAgent, detalles)
         VALUES (?, ?, ?, NOW(), ?, ?, ?)`,
        [
          archivoId,
          accionNueva,
          req.user?.id || null,
          req.ip || null,
          req.get("user-agent") || null,
          JSON.stringify({
            nombre: req.file.originalname,
            extension,
            ruta: claveS3Nueva,
          }),
        ],
      );

      await conexion.query(
        `UPDATE usuarios
            SET usoStorageBytes = usoStorageBytes + ?
          WHERE id = ?`,
        [tamanioBytes, req.user?.id || null],
      );
    }

    await conexion.commit();

    // 5) âœ… invalidar cache por sucursal real del gasto (antes vs despuÃ©s)
    const sucursalIdAnterior = Number(gastoExistente.sucursal_id);
    const sucursalIdNueva = Number(sucursalIdFinal);

    const scopesAInvalidar = new Set();
    if (!Number.isNaN(sucursalIdAnterior) && sucursalIdAnterior > 0) {
      scopesAInvalidar.add(String(sucursalIdAnterior));
    }
    if (!Number.isNaN(sucursalIdNueva) && sucursalIdNueva > 0) {
      scopesAInvalidar.add(String(sucursalIdNueva));
    }

    if (scopesAInvalidar.size === 0) {
      invalidarCachePorPrefijos({
        prefijos: ["gastos_", "gasto_", "gastoComprobante_"],
      });
    } else {
      for (const scopeSucursalItem of scopesAInvalidar) {
        invalidarCachePorPrefijos({
          prefijos: ["gastos_", "gasto_", "gastoComprobante_"],
          scopeSucursal: scopeSucursalItem,
        });
      }
    }

    const [[gastoActualizado]] = await conexion.query(
      "SELECT * FROM gastos WHERE id = ? LIMIT 1",
      [id],
    );

    const urlFacturaFirmada = gastoActualizado?.documento
      ? await generarUrlPrefirmadaLectura(gastoActualizado.documento)
      : null;

    return res.json({
      message: "Gasto actualizado correctamente",
      data: { ...gastoActualizado, urlFacturaFirmada },
    });
  } catch (error) {
    console.error("Error al actualizar gasto:", error);
    await conexion.rollback();

    if (claveS3Nueva) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: claveS3Nueva,
          }),
        );
      } catch (err) {
        console.error("Error al borrar archivo nuevo tras fallo:", err);
      }
    }

    return res
      .status(500)
      .json({ message: "Error interno al actualizar gasto." });
  } finally {
    conexion.release();
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FUNCIÃ“N 2: deleteGasto (solo cambio de acciÃ³n a eliminacionArchivo)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const deleteGasto = async (req, res) => {
  const { id } = req.params;
  const conexion = await db.getConnection();

  // 0) Validar sucursal (admin ve todo; usuario solo su sucursal)
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
    await conexion.beginTransaction();

    const [[gastoExistente]] = await conexion.query(
      `SELECT estado, documento, sucursal_id
         FROM gastos
        WHERE id = ? ${whereSucursalSql}
        LIMIT 1`,
      [id, ...paramsSucursal],
    );

    if (!gastoExistente) {
      await conexion.rollback();
      return res.status(404).json({ message: "Gasto no encontrado" });
    }

    if (gastoExistente.estado === "aprobado") {
      await conexion.rollback();
      return res
        .status(403)
        .json({ message: "No puedes eliminar un gasto aprobado." });
    }

    const sucursalIdGasto = Number(gastoExistente.sucursal_id);

    if (gastoExistente.documento) {
      const nuevaClave = await moverArchivoAPapelera(
        gastoExistente.documento,
        "facturasGastos",
        id,
      );

      await conexion.query(
        `UPDATE archivos
            SET estado = 'eliminado', rutaS3 = ?
          WHERE registroTipo = ? AND registroId = ?`,
        [nuevaClave, "facturasGastos", id],
      );

      const [archivos] = await conexion.query(
        `SELECT id
           FROM archivos
          WHERE registroTipo = ? AND registroId = ?
          ORDER BY id DESC
          LIMIT 1`,
        ["facturasGastos", id],
      );

      if (archivos.length > 0) {
        const archivoId = archivos[0].id;
        await conexion.query(
          `INSERT INTO eventosArchivo
             (archivoId, accion, creadoPor, fechaHora, ip, userAgent, detalles)
           VALUES (?, 'eliminacionArchivo', ?, NOW(), ?, ?, ?)`,
          [
            archivoId,
            req.user?.id || null,
            req.ip || null,
            req.get("user-agent") || null,
            JSON.stringify({
              motivo: "EliminaciÃ³n del gasto",
              nuevaRuta: nuevaClave,
            }),
          ],
        );
      }
    }

    await conexion.query(
      `DELETE FROM gastos WHERE id = ? ${whereSucursalSql}`,
      [id, ...paramsSucursal],
    );

    await conexion.commit();

    const scopeInvalidar =
      !Number.isNaN(sucursalIdGasto) && sucursalIdGasto > 0
        ? String(sucursalIdGasto)
        : null;

    invalidarCachePorPrefijos({
      prefijos: ["gastos_", "gasto_", "gastoComprobante_"],
      scopeSucursal: scopeInvalidar,
    });

    return res.json({
      message: "Gasto eliminado y archivo movido a papelera correctamente.",
    });
  } catch (error) {
    await conexion.rollback();
    console.error("Error al eliminar gasto:", error);
    return res
      .status(500)
      .json({ message: "Error interno al eliminar gasto." });
  } finally {
    conexion.release();
  }
};

export const getGastoById = async (req, res) => {
  try {
    const { id } = req.params;

    const scopeSucursal = obtenerScopeSucursalCache(req);
    if (!scopeSucursal) {
      return res
        .status(403)
        .json({ message: "Tu usuario no tiene sucursal asignada." });
    }

    const esAdmin = Number(req.user?.rol_id) === 1;
    const whereSucursalSql =
      esAdmin && scopeSucursal === "todas" ? "" : " AND g.sucursal_id = ?";
    const paramsSucursal =
      esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

    const claveCache = `gasto_${scopeSucursal}_${id}`;
    const enCache = cacheMemoria.get(claveCache);
    if (enCache) return res.json(enCache);

    const [[gasto]] = await db.query(
      `
      SELECT 
        g.*,
        g.documento,
        p.nombre  AS proveedor_nombre,
        p.id      AS proveedor_id,
        s.nombre  AS sucursal_nombre,
        s.id      AS sucursal_id,
        c.codigo_referencia AS cotizacion_codigo,
        c.codigo_referencia AS codigo,
        c.id      AS cotizacion_id,
        tg.nombre AS tipo_gasto_nombre,
        tg.id     AS tipo_gasto_id
      FROM gastos g
      LEFT JOIN proveedores  p  ON p.id  = g.proveedor_id
      LEFT JOIN sucursales   s  ON s.id  = g.sucursal_id
      LEFT JOIN cotizaciones c  ON c.id  = g.cotizacion_id
      LEFT JOIN tipos_gasto  tg ON tg.id = g.tipo_gasto_id
      WHERE g.id = ? ${whereSucursalSql}
      LIMIT 1;
      `,
      [id, ...paramsSucursal],
    );

    if (!gasto) {
      return res.status(404).json({ message: "Gasto no encontrado" });
    }

    const urlFacturaFirmada = gasto.documento
      ? await generarUrlPrefirmadaLectura(gasto.documento)
      : null;

    // Opciones (tambiÃ©n restringidas):
    const [tiposGasto] = await db.query("SELECT id, nombre FROM tipos_gasto");

    const [proveedores] = await db.query(
      "SELECT id, nombre FROM proveedores WHERE estado = 'activo'",
    );

    // Sucursales: admin ve todas; no-admin solo la suya
    const [sucursales] =
      esAdmin && scopeSucursal === "todas"
        ? await db.query("SELECT id, nombre FROM sucursales")
        : await db.query("SELECT id, nombre FROM sucursales WHERE id = ?", [
            Number(scopeSucursal),
          ]);

    // Cotizaciones: admin ve todas; no-admin solo las de su sucursal
    const whereCotSucursalSql =
      esAdmin && scopeSucursal === "todas" ? "" : " WHERE sucursal_id = ?";
    const paramsCotSucursal =
      esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

    const [cotizaciones] = await db.query(
      `SELECT id, codigo_referencia AS codigo FROM cotizaciones${whereCotSucursalSql} ORDER BY id DESC`,
      [...paramsCotSucursal],
    );

    const respuesta = {
      gasto: {
        ...gasto,
        urlFacturaFirmada,
      },
      opciones: {
        tiposGasto,
        proveedores,
        sucursales,
        cotizaciones,
      },
    };

    cacheMemoria.set(claveCache, respuesta);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error al obtener gasto por ID:", error);
    return res.status(500).json({ message: "Error al obtener gasto" });
  }
};

export const getTiposGasto = async (req, res) => {
  try {
    const [tiposGasto] = await db.query("SELECT * FROM tipos_gasto");
    res.json(tiposGasto);
  } catch (error) {
    console.error("Error al obtener tipos de gasto:", error);
    res.status(500).json({ message: "Error al obtener tipos de gasto" });
  }
};

export const getProveedores = async (req, res) => {
  try {
    const [proveedores] = await db.query(
      "SELECT id, nombre FROM proveedores WHERE estado = 'activo'",
    );
    res.json(proveedores);
  } catch (error) {
    console.error("Error al obtener proveedores:", error);
    res.status(500).json({ message: "Error al obtener proveedores" });
  }
};

export const actualizarEstadoGasto = async (req, res) => {
  try {
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
    const whereSucursalSql =
      esAdmin && scopeSucursal === "todas" ? "" : " AND sucursal_id = ?";
    const paramsSucursal =
      esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

    // 1) Verificar que exista y obtener sucursal_id real (para invalidaciÃ³n)
    const [[gastoRow]] = await db.query(
      `SELECT id, sucursal_id
         FROM gastos
        WHERE id = ? ${whereSucursalSql}
        LIMIT 1`,
      [id, ...paramsSucursal],
    );

    if (!gastoRow) {
      return res.status(404).json({ message: "Gasto no encontrado" });
    }

    const sucursalIdGasto = Number(gastoRow.sucursal_id);

    // 2) Actualizar estado (respetando sucursal)
    await db.query(
      `
      UPDATE gastos
         SET estado         = ?,
             motivo_rechazo = ?,
             updated_at     = NOW()
       WHERE id = ? ${whereSucursalSql}
      `,
      [estado, motivo_rechazo || null, id, ...paramsSucursal],
    );

    // 3) Invalidar cache por sucursal del gasto
    const scopeInvalidar =
      !Number.isNaN(sucursalIdGasto) && sucursalIdGasto > 0
        ? String(sucursalIdGasto)
        : null;

    invalidarCachePorPrefijos({
      prefijos: ["gastos_", "gasto_", "gastoComprobante_"],
      scopeSucursal: scopeInvalidar,
    });

    // 4) Si es aprobado, crear solicitud de pago (sin duplicar)
    if (estado === "aprobado") {
      const [yaExiste] = await db.query(
        "SELECT id FROM solicitudes_pago WHERE gasto_id = ?",
        [id],
      );

      if (yaExiste.length === 0) {
        const [[gasto]] = await db.query(
          `
          SELECT
            creadoPor      AS usuario_solicita_id,
            sucursal_id,
            proveedor_id,
            concepto_pago,
            total          AS monto_total,
            moneda,
            tasa_cambio
          FROM gastos
          WHERE id = ?
          LIMIT 1
          `,
          [id],
        );

        const codigoTemporal = `SP-TMP-${Date.now()}-${id}`;

        const [resultadoInsercion] = await db.query(
          `
          INSERT INTO solicitudes_pago (
            codigo,
            gasto_id,
            sucursal_id,
            usuario_solicita_id,
            usuario_revisa_id,
            proveedor_id,
            concepto_pago,
            monto_total,
            monto_pagado,
            estado,
            fecha_solicitud,
            created_at,
            updated_at,
            moneda,
            tasa_cambio
          )
          VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),NOW(),?,?)
          `,
          [
            codigoTemporal,
            id,
            gasto.sucursal_id,
            gasto.usuario_solicita_id,
            req.user?.id ?? null,
            gasto.proveedor_id,
            gasto.concepto_pago,
            gasto.monto_total,
            0,
            "por_pagar",
            gasto.moneda,
            gasto.tasa_cambio,
          ],
        );

        const solicitudPagoId = resultadoInsercion.insertId;
        const codigoFinal = `SP-${String(solicitudPagoId).padStart(5, "0")}`;

        await db.query(
          "UPDATE solicitudes_pago SET codigo = ? WHERE id = ?",
          [codigoFinal, solicitudPagoId],
        );

        invalidarCachePorPrefijos({
          prefijos: [
            "solicitudesPago_",
            "solicitudPago_",
            "ordenesPagoSolicitud_",
          ],
          scopeSucursal:
            !Number.isNaN(Number(gasto.sucursal_id)) &&
            Number(gasto.sucursal_id) > 0
              ? String(Number(gasto.sucursal_id))
              : null,
        });
      }
    }

    return res.json({ message: "Estado de gasto actualizado correctamente" });
  } catch (error) {
    console.error("Error al actualizar estado del gasto:", error);
    return res
      .status(500)
      .json({ message: "Error interno al actualizar estado del gasto" });
  }
};
