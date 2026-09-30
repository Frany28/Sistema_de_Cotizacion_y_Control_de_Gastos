import db from "../config/database.js";
import { s3 } from "../utils/s3.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import cacheMemoria, {
  obtenerScopeSucursalCache,
  invalidarCachePorPrefijos,
} from "../utils/cacheMemoria.js";

/* ========================================================================== */
/* REGISTRAR ABONO                                                            */
/* ========================================================================== */
export const registrarAbono = async (req, res) => {
  const cuentaId = Number(req.params.cuenta_id);
  if (!cuentaId || Number.isNaN(cuentaId)) {
    return res.status(400).json({ message: "cuenta_id requerido en la URL" });
  }

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

  const conexion = await db.getConnection();

  try {
    await conexion.beginTransaction();

    // 1) Leer la cuenta y bloquearla (evita carreras al actualizar saldo)
    const [[cuentaRow]] = await conexion.query(
      `SELECT cliente_id, sucursal_id, moneda, tasa_cambio
         FROM cuentas_por_cobrar
        WHERE id = ?${whereSucursalSql}
        FOR UPDATE`,
      [cuentaId, ...paramsSucursal],
    );

    if (!cuentaRow) {
      await conexion.rollback();
      return res
        .status(404)
        .json({ message: "Cuenta por cobrar no encontrada" });
    }

    const clienteId = cuentaRow.cliente_id;
    const sucursalIdCuenta = cuentaRow.sucursal_id ?? null;

    const monedaCuenta = (cuentaRow.moneda ?? "USD").toUpperCase();
    const tasaCambioCxc =
      cuentaRow.tasa_cambio !== null ? Number(cuentaRow.tasa_cambio) : null;

    // 2) Entrada
    const metodoPago = (
      req.body.metodo_pago ??
      req.body.metodoPago ??
      ""
    ).toUpperCase();

    const bancoId = req.body.banco_id ?? req.body.bancoId ?? null;

    const monedaPago = (
      req.body.moneda_pago ??
      req.body.moneda ??
      req.body.monedaPago ??
      "USD"
    ).toUpperCase();

    // Si viene vacío/undefined => NaN, lo normalizamos luego
    const tasaCambioEntrada = Number(
      req.body.tasa_cambio ?? req.body.tasaCambio,
    );

    const montoAbonado = Number(
      req.body.monto_abonado ?? req.body.monto ?? req.body.montoAbonado ?? 0,
    );

    const observaciones = req.body.observaciones ?? null;
    const usuarioId = req.user?.id || req.session?.usuario?.id || null;

    // 3) Validaciones base
    if (!usuarioId) {
      await conexion.rollback();
      return res
        .status(401)
        .json({ message: "Sesión expirada: reingresa al sistema" });
    }

    if (!montoAbonado || Number.isNaN(montoAbonado)) {
      await conexion.rollback();
      return res
        .status(400)
        .json({ message: "monto_abonado es obligatorio y numérico" });
    }

    if (!["EFECTIVO", "TRANSFERENCIA"].includes(metodoPago)) {
      await conexion.rollback();
      return res.status(400).json({ message: "método_pago inválido" });
    }

    if (!["USD", "VES"].includes(monedaPago)) {
      await conexion.rollback();
      return res
        .status(400)
        .json({ message: "moneda_pago inválida (USD/VES)" });
    }

    if (metodoPago === "TRANSFERENCIA") {
      if (!bancoId) {
        await conexion.rollback();
        return res
          .status(400)
          .json({ message: "banco_id es obligatorio en TRANSFERENCIA" });
      }
      if (!req.file) {
        await conexion.rollback();
        return res
          .status(400)
          .json({ message: "Adjunta el comprobante de transferencia" });
      }
    } else if (bancoId) {
      await conexion.rollback();
      return res.status(400).json({
        message: "banco_id debe ser null cuando el método es EFECTIVO",
      });
    }

    // 4) Resolver tasa FINAL (la del abono manda)
    let tasaCambioFinal = null;

    if (monedaPago === "VES") {
      const tasaEntradaValida =
        Number.isFinite(tasaCambioEntrada) && tasaCambioEntrada > 0;

      const tasaCxcValida = Number.isFinite(tasaCambioCxc) && tasaCambioCxc > 0;

      // Prioridad: tasa del request (modal) > tasa guardada en CxC (fallback)
      tasaCambioFinal = tasaEntradaValida
        ? tasaCambioEntrada
        : tasaCxcValida
          ? tasaCambioCxc
          : null;

      if (!tasaCambioFinal) {
        await conexion.rollback();
        return res.status(400).json({
          message:
            "tasa_cambio es obligatoria cuando la moneda del abono es VES (y debe ser > 0).",
        });
      }

      // Guardar tasa en CxC solo si está null/ inválida (no la pisamos siempre)
      if (!tasaCxcValida) {
        await conexion.execute(
          `UPDATE cuentas_por_cobrar
              SET tasa_cambio = ?
            WHERE id = ?`,
          [tasaCambioFinal, cuentaId],
        );
      }
    } else {
      // USD: no hace falta tasa
      tasaCambioFinal = null;
    }

    // 5) Archivo (si existe)
    const file = req.file;
    const rutaComprobante = file?.key ?? file?.location ?? file?.path ?? null;

    // 6) Calcular monto en USD (para saldo y consolidación)
    const montoUsd =
      monedaPago === "USD"
        ? parseFloat(montoAbonado.toFixed(2))
        : parseFloat((montoAbonado / tasaCambioFinal).toFixed(2));

    // 7) Insertar abono (guardando sucursal_id y tasa usada)
    const [abonoRes] = await conexion.execute(
      `INSERT INTO abonos_cuentas
         (cuenta_id, sucursal_id, banco_id, metodo_pago, usuario_id,
          moneda_pago, tasa_cambio,
          monto_abonado, monto_usd_calculado,
          ruta_comprobante, observaciones,
          fecha_abono)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        cuentaId,
        sucursalIdCuenta,
        metodoPago === "TRANSFERENCIA" ? bancoId : null,
        metodoPago,
        usuarioId,
        monedaPago,
        monedaPago === "VES" ? tasaCambioFinal : 1, // si tu frontend ya no manda tasa en USD, esto queda igual o lo ajustas luego
        montoAbonado,
        montoUsd,
        rutaComprobante,
        observaciones,
      ],
    );

    const abonoId = abonoRes.insertId;

    // 8) Actualizar saldo de la cuenta (en USD si tu CxC está en USD)
    const [[{ saldo_restante: saldoActual }]] = await conexion.query(
      `SELECT COALESCE(saldo_restante, monto) AS saldo_restante
         FROM cuentas_por_cobrar
        WHERE id = ?
        FOR UPDATE`,
      [cuentaId],
    );

    const nuevoSaldo = parseFloat((Number(saldoActual) - montoUsd).toFixed(2));

    await conexion.execute(
      `UPDATE cuentas_por_cobrar
          SET saldo_restante = ?,
              estado         = IF(? <= 0, 'pagado', estado),
              fecha_pago     = IF(? <= 0 AND fecha_pago IS NULL, NOW(), fecha_pago)
        WHERE id = ?`,
      [nuevoSaldo, nuevoSaldo, nuevoSaldo, cuentaId],
    );

    // 9) Cache
    const scopeInvalidar =
      !Number.isNaN(Number(sucursalIdCuenta)) && Number(sucursalIdCuenta) > 0
        ? String(Number(sucursalIdCuenta))
        : null;

    invalidarCachePorPrefijos({
      prefijos: ["cxc_", "saldo_", "totales_", "clientesConCxc_"],
      scopeSucursal: scopeInvalidar,
    });

    await conexion.commit();
    return res.status(201).json({
      message: "Abono registrado correctamente",
      abonoId,
      nuevoSaldo,
    });
  } catch (error) {
    await conexion.rollback();

    // Limpieza S3 si se subió archivo
    if (req.file?.key) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: req.file.key,
          }),
        );
      } catch {
        console.error("No se pudo eliminar el archivo S3 tras rollback");
      }
    }

    console.error("Error al registrar abono:", error);
    return res
      .status(500)
      .json({ message: "Error interno al registrar abono" });
  } finally {
    conexion.release();
  }
};

/* ========================================================================== */
/* (Opcional) Grupo de archivos (se deja por compatibilidad si lo usas luego)  */
/* ========================================================================== */
export const obtenerOcrearGrupoAbono = async (conn, abonoId, userId) => {
  const [[g]] = await conn.query(
    `SELECT id FROM archivoGrupos
      WHERE registroTipo = 'abonosCXC' AND registroId = ?`,
    [abonoId],
  );
  if (g) return g.id;

  const [res] = await conn.query(
    `INSERT INTO archivoGrupos
       (registroTipo, registroId, creadoPor, nombreReferencia)
     VALUES ('abonosCXC', ?, ?, ?)`,
    [abonoId, userId, `Comprobantes abono ${abonoId}`],
  );
  return res.insertId;
};

/* ========================================================================== */
/* LISTAR CUENTAS POR COBRAR DE UN CLIENTE                                    */
/* ========================================================================== */
export const listaCuentasPorCobrar = async (req, res) => {
  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;
  const pageRaw = Number(req.query.page);
  const limitRaw = Number(req.query.limit);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 100)
      : 10;
  const offset = (page - 1) * limit;
  const { cliente_id } = req.query;

  const whereSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " AND cxc.sucursal_id = ?";
  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

  const claveCache = `cxc_${scopeSucursal}_${cliente_id}_${page}_${limit}`;
  const enCache = cacheMemoria.get(claveCache);
  if (enCache) return res.json(enCache);

  if (!cliente_id) {
    return res.status(400).json({ message: "cliente_id es requerido" });
  }

  try {
    // 1. Total de cuentas
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM cuentas_por_cobrar cxc
       WHERE cxc.cliente_id = ?${whereSucursalSql}`,
      [cliente_id, ...paramsSucursal],
    );

    // 2. Obtener cuentas paginadas
    const [cuentas] = await db.query(
      `SELECT 
        cxc.id,
        cxc.codigo,
        cxc.cotizacion_id,
        cli.nombre AS cliente_nombre,
        cxc.monto,
        cxc.estado,
        cxc.fecha_emision,
        cxc.fecha_vencimiento
       FROM cuentas_por_cobrar cxc
       JOIN clientes cli ON cli.id = cxc.cliente_id
       WHERE cxc.cliente_id = ?${whereSucursalSql}
       ORDER BY cxc.fecha_vencimiento ASC
       LIMIT ${limit} OFFSET ${offset}`,
      [cliente_id, ...paramsSucursal],
    );

    // 3. Si no hay cuentas
    if (cuentas.length === 0) {
      return res.json({ cuentas: [], total, page, limit });
    }

    // 4. Obtener abonos por cuenta
    const [abonos] = await db.query(
      `SELECT cuenta_id, SUM(monto_usd_calculado) AS abonado
       FROM abonos_cuentas
       WHERE cuenta_id IN (${cuentas.map((c) => c.id).join(",")})
       GROUP BY cuenta_id`,
    );

    const abonosMap = {};
    abonos.forEach((row) => {
      abonosMap[row.cuenta_id] = parseFloat(row.abonado);
    });

    // 5. Calcular saldo restante
    cuentas.forEach((cuenta) => {
      const abonado = abonosMap[cuenta.id] || 0;
      cuenta.saldo_restante = parseFloat((cuenta.monto - abonado).toFixed(2));
    });

    cacheMemoria.set(claveCache, { cuentas, total, page, limit });

    return res.json({ cuentas, total, page, limit });
  } catch (error) {
    console.error("Error al obtener cuentas por cobrar:", error);
    return res
      .status(500)
      .json({ message: "Error al obtener cuentas por cobrar" });
  }
};

/* ========================================================================== */
/* CLIENTES CON CUENTAS POR COBRAR (APROBADAS)                                */
/* ========================================================================== */
export const clientesConCXC = async (req, res) => {
  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;
  const whereSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " AND cxc.sucursal_id = ?";
  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

  const clave = `clientesConCxc_${scopeSucursal}_lista`;
  const hit = cacheMemoria.get(clave);
  if (hit) return res.json(hit);

  try {
    const [rows] = await db.query(
      `SELECT DISTINCT 
         cli.id,
         cli.codigo_referencia,
         cli.nombre
       FROM cuentas_por_cobrar cxc
       JOIN clientes cli ON cli.id = cxc.cliente_id
       JOIN cotizaciones cot ON cot.id = cxc.cotizacion_id
       WHERE cot.estado = 'aprobada'${whereSucursalSql}
       ORDER BY cli.nombre ASC`,
      paramsSucursal,
    );

    cacheMemoria.set(clave, rows, 600);
    return res.json(rows);
  } catch (error) {
    console.error(
      "Error al obtener clientes con cuentas aprobadas por cobrar:",
      error,
    );
    return res
      .status(500)
      .json({ message: "Error al obtener clientes con CXC aprobadas" });
  }
};

/* ========================================================================== */
/* TOTALES (DEBE, HABER, SALDO) POR CLIENTE                                   */
/* ========================================================================== */
export const getTotalesPorCliente = async (req, res) => {
  const { cliente_id } = req.params;
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

  const clave = `totales_${scopeSucursal}_${cliente_id}`;
  const hit = cacheMemoria.get(clave);
  if (hit) return res.json(hit);

  try {
    if (!cliente_id) {
      return res.status(400).json({ message: "Cliente no especificado" });
    }

    // 1. Total DEBE
    const [debeResult] = await db.query(
      `SELECT COALESCE(SUM(monto), 0) AS debe
       FROM cuentas_por_cobrar
       WHERE cliente_id = ? AND estado != 'pagado'${whereSucursalSql}`,
      [cliente_id, ...paramsSucursal],
    );

    const debe = parseFloat(debeResult[0].debe);

    // 2. Total HABER
    const [haberResult] = await db.query(
      `SELECT COALESCE(SUM(monto_usd_calculado), 0) AS haber
       FROM abonos_cuentas
       WHERE cuenta_id IN (
         SELECT id FROM cuentas_por_cobrar WHERE cliente_id = ?${whereSucursalSql}
       )`,
      [cliente_id, ...paramsSucursal],
    );

    const haber = parseFloat(haberResult[0].haber);

    // 3. SALDO
    const saldo = parseFloat((debe - haber).toFixed(2));
    cacheMemoria.set(clave, { debe, haber, saldo });

    return res.json({ debe, haber, saldo });
  } catch (error) {
    console.error("Error al calcular totales del cliente:", error);
    return res.status(500).json({ message: "Error al calcular totales" });
  }
};

/* ========================================================================== */
/* SALDO INDIVIDUAL DE UNA CUENTA                                             */
/* ========================================================================== */
export const getSaldoCuenta = async (req, res) => {
  const { cuenta_id } = req.params;
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

  const clave = `saldo_${scopeSucursal}_${cuenta_id}`;
  const hit = cacheMemoria.get(clave);
  if (hit) return res.json(hit);

  try {
    const [[{ monto }]] = await db.query(
      `SELECT monto FROM cuentas_por_cobrar WHERE id = ?${whereSucursalSql}`,
      [cuenta_id, ...paramsSucursal],
    );

    if (!monto) {
      return res.status(404).json({ message: "Cuenta no encontrada" });
    }

    const [[{ abonado }]] = await db.query(
      `SELECT COALESCE(SUM(monto_usd_calculado), 0) AS abonado
       FROM abonos_cuentas WHERE cuenta_id = ?`,
      [cuenta_id],
    );

    const saldo = parseFloat((monto - abonado).toFixed(2));
    cacheMemoria.set(clave, { saldo }, 120);

    return res.json({ saldo });
  } catch (error) {
    console.error("Error al obtener saldo de la cuenta:", error);
    return res.status(500).json({ message: "Error al calcular el saldo" });
  }
};
