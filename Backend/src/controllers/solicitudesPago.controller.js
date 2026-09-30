// controllers/solicitudesPago.controller.js
import db from "../config/database.js";
import {
  s3,
  generarUrlPrefirmadaLectura,
  subirBufferAS3,
  borrarObjetoAS3,
} from "../utils/s3.js";
import { obtenerOcrearGrupoComprobante } from "../utils/gruposArchivos.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { generarHTMLOrdenPago } from "../../templates/generarHTMLOrdenDePago.js";
import cacheMemoria, {
  obtenerScopeSucursalCache,
  invalidarCachePorPrefijos,
} from "../utils/cacheMemoria.js";

// 🔹 NUEVOS IMPORTS PARA EL LOGO LOCAL
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PREFIJOS_CACHE_SOLICITUDES = [
  "solicitudesPago_",
  "solicitudPago_",
  "ordenesPagoSolicitud_",
];

async function firmaToDataUrl(key) {
  console.log("🪣 [DEBUG] Intentando leer del bucket:", process.env.S3_BUCKET);
  console.log("🪣 [DEBUG] Clave que se intenta leer:", key);
  if (!key) return null; // sin firma
  const Bucket = process.env.S3_BUCKET;
  const { Body } = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  const chunks = [];
  for await (const chunk of Body) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const ext = key.split(".").pop().toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "jpeg" : ext; // png, gif…
  return `data:image/${mime};base64,${buffer.toString("base64")}`;
}

export const generarPDFSolicitudPago = async (req, res) => {
  const { id } = req.params;

  /* ---------- 1. Consulta completa ---------- */
  const [[row]] = await db.execute(
    `
    SELECT  
            sp.*,
            g.codigo              AS gasto_codigo,
            g.total               AS gasto_total,
            g.moneda              AS gasto_moneda,
            g.tasa_cambio         AS gasto_tasa_cambio,
            g.documento           AS gasto_documento,
            tg.nombre             AS tipo_gasto_nombre,
            p.nombre              AS proveedor_nombre,
            p.rif                 AS proveedor_rif,
            p.telefono            AS proveedor_telefono,
            p.email               AS proveedor_email,
            b.nombre              AS banco_nombre,

            us.nombre             AS solicita_nombre,
            us.firma              AS solicita_firma,

            ur.nombre             AS revisa_nombre,
            ur.firma              AS revisa_firma,

            up.nombre             AS aprueba_nombre,
            up.firma              AS aprueba_firma
    FROM    solicitudes_pago sp
    LEFT JOIN gastos g         ON g.id = sp.gasto_id
    LEFT JOIN tipos_gasto tg   ON tg.id = g.tipo_gasto_id
    LEFT JOIN proveedores p    ON p.id = sp.proveedor_id
    LEFT JOIN bancos b         ON b.id = sp.banco_id
    LEFT JOIN usuarios us      ON us.id = sp.usuario_solicita_id
    LEFT JOIN usuarios ur      ON ur.id = sp.usuario_revisa_id
    LEFT JOIN usuarios up      ON up.id = sp.usuario_aprueba_id
    WHERE sp.id = ?`,
    [id],
  );

  if (!row) {
    return res.status(404).json({ message: "Solicitud de pago no encontrada" });
  }

  /* ---------- 2. Firmas → Base64 ---------- */
  const [firmaSolicita, firmaRevisa, firmaAprueba] = await Promise.all([
    firmaToDataUrl(row.solicita_firma),
    firmaToDataUrl(row.revisa_firma),
    firmaToDataUrl(row.aprueba_firma),
  ]);

  /* ---------- 3. Logo local → Base64 ---------- */
  let logo = null;
  try {
    const archivoActual = fileURLToPath(import.meta.url);
    const carpetaActual = path.dirname(archivoActual);
    // estamos en Backend/src/controllers → subir a Backend y entrar a styles
    const rutaLogo = path.join(
      carpetaActual,
      "..",
      "..",
      "styles",
      "Logo Operaciones Logisticas Falcon.jpg",
    );
    const bufferLogo = fs.readFileSync(rutaLogo);
    const base64Logo = bufferLogo.toString("base64");
    logo = `data:image/jpeg;base64,${base64Logo}`;
  } catch (err) {
    console.error("No se pudo cargar el logo de Orden de Pago:", err);
  }

  /* ---------- 4. Firmar URLs de comprobante y documento gasto ---------- */
  let comprobanteUrl = null;
  if (row.ruta_comprobante) {
    comprobanteUrl = await generarUrlPrefirmadaLectura(
      row.ruta_comprobante,
      600,
    );
  }

  let gastoDocumentoUrl = null;
  if (row.gasto_documento) {
    gastoDocumentoUrl = await generarUrlPrefirmadaLectura(
      row.gasto_documento,
      600,
    );
  }

  /* ---------- 5. Calcular diferencia ---------- */
  const diferencia = (row.monto_total || 0) - (row.monto_pagado || 0);

  /* ---------- 6. Armar objeto para el template ---------- */
  const datos = {
    /* cabecera */
    codigo: row.codigo,
    fechaSolicitud: row.fecha_solicitud,
    fechaPago: row.fecha_pago,
    estado: row.estado,

    solicitadoPor: row.solicita_nombre,
    autorizadoPor: row.revisa_nombre,
    aprobadoPor: row.aprueba_nombre,

    firmaSolicita,
    firmaAutoriza: firmaRevisa,
    firmaAprueba,

    metodoPago: row.metodo_pago,
    banco: row.banco_nombre || "—",
    referencia: row.referencia_pago || "—",

    montoSolicitado: row.monto_total,
    montoAbono: abono.monto_pagado,
    montoPagado: row.monto_pagado,
    diferencia,
    moneda: row.moneda,
    tasaCambio: row.tasa_cambio,

    observaciones: row.observaciones,

    /* gasto asociado */
    gasto: {
      codigo: row.gasto_codigo || "—",
      tipoGasto: row.tipo_gasto_nombre || "—",
      total: row.gasto_total || 0,
      moneda: row.gasto_moneda || "—",
      tasaCambio: row.gasto_tasa_cambio || null,
      documentoUrl: gastoDocumentoUrl || null,
    },

    /* proveedor (si existe) */
    proveedor: row.proveedor_nombre
      ? {
          nombre: row.proveedor_nombre,
          rif: row.proveedor_rif,
          telefono: row.proveedor_telefono,
          email: row.proveedor_email,
        }
      : null,

    /* archivo comprobante pago */
    comprobanteUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    /* 🔹 Logo en base64 para el template */
    logo,
  };

  const html = generarHTMLOrdenPago(datos, "final");

  /* ---------- 7. Puppeteer → PDF ---------- */
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
  });

  await browser.close();

  /* ============================================================
   8) GUARDAR PDF (ORDEN DE PAGO) EN S3 + REGISTRAR EN BD
   - Se asocia al PRIMER ABONO (primer pago_realizado de la solicitud)
   ============================================================ */

  const usuarioId = req.user?.id; // viene del middleware autenticarUsuario
  let clavePdfOrdenPago = null;

  const conexion = await db.getConnection();

  try {
    await conexion.beginTransaction();

    // 1) Buscar el PRIMER abono (primer pago_realizado)
    const [[primerAbono]] = await conexion.execute(
      `
    SELECT id, fecha_pago
    FROM pagos_realizados
    WHERE solicitud_pago_id = ?
    ORDER BY fecha_pago ASC, id ASC
    LIMIT 1
    `,
      [id],
    );

    // Si aún no hay abonos, solo devolvemos el PDF sin guardar.
    if (primerAbono) {
      const idPagoRealizado = primerAbono.id;

      // 2) Grupo de archivos para la solicitud (reutiliza tu flujo actual)
      const grupoId = await obtenerOcrearGrupoComprobante(
        conexion,
        id,
        usuarioId,
      );

      // 3) Construir ruta S3 en la MISMA “carpeta” de la solicitud
      const meses = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
      ];

      const fechaBase = primerAbono.fecha_pago
        ? new Date(primerAbono.fecha_pago)
        : new Date();
      const anio = fechaBase.getFullYear();
      const mesPalabra = meses[fechaBase.getMonth()];

      const numeroAbono = 1; // este PDF es del primer abono
      const timestamp = Date.now();

      const nombreOriginal = `ordenPago-${row.codigo}-abono-${String(
        numeroAbono,
      ).padStart(4, "0")}-${idPagoRealizado}-${timestamp}.pdf`;
      const extension = "pdf";
      const tamanioBytes = pdfBuffer.length;

      clavePdfOrdenPago = `comprobantes_pagos/${anio}/${mesPalabra}/${row.codigo}/ordenes_pago/${nombreOriginal}`;

      // 4) Subir a S3
      await subirBufferAS3({
        claveS3: clavePdfOrdenPago,
        buffer: pdfBuffer,
        contentType: "application/pdf",
      });

      // 5) Calcular versión (por primer abono y ordenPago)
      const [[ver]] = await conexion.execute(
        `
      SELECT IFNULL(MAX(numeroVersion), 0) AS maxVer
      FROM archivos
      WHERE registroTipo = 'comprobantesPagos'
        AND registroId = ?
        AND subTipoArchivo = 'ordenPago'
      `,
        [idPagoRealizado],
      );

      const numeroVersion = Number(ver?.maxVer || 0) + 1;

      // 6) Insert en archivos (IMPORTANTE: registroId = idPagoRealizado)
      const [aRes] = await conexion.execute(
        `
      INSERT INTO archivos
        (registroTipo, subTipoArchivo, registroId, grupoArchivoId,
         nombreOriginal, extension, tamanioBytes, numeroVersion,
         rutaS3, estado, esPublico, subidoPor)
      VALUES
        ('comprobantesPagos', 'ordenPago', ?, ?, ?, ?, ?, ?, ?, 'activo', 0, ?)
      `,
        [
          idPagoRealizado,
          grupoId,
          nombreOriginal,
          extension,
          tamanioBytes,
          numeroVersion,
          clavePdfOrdenPago,
          usuarioId,
        ],
      );

      const archivoId = aRes.insertId;

      // 7) Insert en versionesArchivo
      const [vRes] = await conexion.execute(
        `
      INSERT INTO versionesArchivo
        (archivoId, numeroVersion, nombreOriginal, extension,
         tamanioBytes, rutaS3, subidoPor)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          archivoId,
          numeroVersion,
          nombreOriginal,
          extension,
          tamanioBytes,
          clavePdfOrdenPago,
          usuarioId,
        ],
      );

      const versionId = vRes.insertId;

      // 8) Auditoría en eventosArchivo
      await conexion.execute(
        `
      INSERT INTO eventosArchivo
        (archivoId, versionId, accion, creadoPor, ip, userAgent, detalles)
      VALUES
        (?, ?, 'subidaArchivo', ?, ?, ?, ?)
      `,
        [
          archivoId,
          versionId,
          usuarioId,
          req.ip || null,
          req.headers["user-agent"] || null,
          JSON.stringify({
            registroTipo: "comprobantesPagos",
            subTipoArchivo: "ordenPago",
            solicitudPagoId: Number(id),
            pagoRealizadoId: idPagoRealizado,
            codigoSolicitudPago: row.codigo,
            origen: "sistema",
          }),
        ],
      );

      // 9) Sumar almacenamiento al usuario
      await conexion.execute(
        `
      UPDATE usuarios
      SET usoStorageBytes = usoStorageBytes + ?
      WHERE id = ?
      `,
        [tamanioBytes, usuarioId],
      );
    }

    await conexion.commit();
  } catch (error) {
    await conexion.rollback();

    // Si ya subimos a S3 pero falló BD, intentamos limpiar
    if (clavePdfOrdenPago) {
      try {
        await borrarObjetoAS3(clavePdfOrdenPago);
      } catch (_) {}
    }

    console.error("Error guardando PDF Orden de Pago:", error);
  } finally {
    conexion.release();
  }

  /* ---------- 9. Enviar ---------- */
  res
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=orden_pago_${
        row.codigo || "SIN_CODIGO"
      }.pdf`,
    })
    .send(pdfBuffer);
};

async function guardarPdfOrdenPagoPrimerAbono({
  solicitudPagoId,
  pagoRealizadoId,
  usuarioId,
  ip,
  userAgent,
}) {
  let clavePdfOrdenPago = null;
  const conexion = await db.getConnection();

  try {
    await conexion.beginTransaction();

    // 1) Traer data completa de la solicitud (misma consulta base del PDF)
    const [[row]] = await conexion.execute(
      `
      SELECT  
              sp.*,
              g.codigo              AS gasto_codigo,
              g.total               AS gasto_total,
              g.moneda              AS gasto_moneda,
              g.tasa_cambio         AS gasto_tasa_cambio,
              g.documento           AS gasto_documento,
              tg.nombre             AS tipo_gasto_nombre,
              p.nombre              AS proveedor_nombre,
              p.rif                 AS proveedor_rif,
              p.telefono            AS proveedor_telefono,
              p.email               AS proveedor_email,
              b.nombre              AS banco_nombre,

              us.nombre             AS solicita_nombre,
              us.firma              AS solicita_firma,

              ur.nombre             AS revisa_nombre,
              ur.firma              AS revisa_firma,

              up.nombre             AS aprueba_nombre,
              up.firma              AS aprueba_firma
      FROM    solicitudes_pago sp
      LEFT JOIN gastos g         ON g.id = sp.gasto_id
      LEFT JOIN tipos_gasto tg   ON tg.id = g.tipo_gasto_id
      LEFT JOIN proveedores p    ON p.id = sp.proveedor_id
      LEFT JOIN bancos b         ON b.id = sp.banco_id
      LEFT JOIN usuarios us      ON us.id = sp.usuario_solicita_id
      LEFT JOIN usuarios ur      ON ur.id = sp.usuario_revisa_id
      LEFT JOIN usuarios up      ON up.id = sp.usuario_aprueba_id
      WHERE sp.id = ?
      `,
      [solicitudPagoId],
    );

    if (!row) {
      await conexion.rollback();
      return { ok: false, motivo: "Solicitud no encontrada" };
    }

    // 2) Asegurar que este PDF sea del primer abono
    const [[primerAbono]] = await conexion.execute(
      `
      SELECT *
      FROM pagos_realizados
      WHERE solicitud_pago_id = ?
      ORDER BY fecha_pago ASC, id ASC
      LIMIT 1
      `,
      [solicitudPagoId],
    );

    if (!primerAbono) {
      await conexion.rollback();
      return { ok: false, motivo: "No existe primer abono todavía" };
    }

    // Si el primer abono real no coincide con el pagoRealizadoId que acabamos de crear,
    // entonces NO generamos (esto evita generar el PDF si ya existían abonos antes).
    if (Number(primerAbono.id) !== Number(pagoRealizadoId)) {
      await conexion.rollback();
      return { ok: true, omitido: true, motivo: "No es el primer abono" };
    }

    // 3) Evitar duplicado: si ya existe un ordenPago para este pagoRealizadoId, no regenerar
    const [[yaExiste]] = await conexion.execute(
      `
      SELECT id
      FROM archivos
      WHERE registroTipo = 'comprobantesPagos'
        AND registroId = ?
        AND subTipoArchivo = 'ordenPago'
        AND estado = 'activo'
      LIMIT 1
      `,
      [pagoRealizadoId],
    );

    if (yaExiste?.id) {
      await conexion.rollback();
      return { ok: true, omitido: true, motivo: "PDF ya estaba registrado" };
    }

    // 4) Firmas + logo (igual que generarPDFSolicitudPago)
    const solicitaFirma = await firmaToDataUrl(row.solicita_firma);
    const revisaFirma = await firmaToDataUrl(row.revisa_firma);
    const apruebaFirma = await firmaToDataUrl(row.aprueba_firma);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const rutaLogo = path.join(__dirname, "../assets/logo.png");
    const logo = fs.existsSync(rutaLogo)
      ? `data:image/png;base64,${fs.readFileSync(rutaLogo).toString("base64")}`
      : null;

    // 5) Comprobante URL (si aplica)
    const comprobanteUrl = row.ruta_comprobante
      ? await generarUrlPrefirmadaLectura(row.ruta_comprobante)
      : null;

    // 6) Construir objeto para template
    const datos = {
      solicitud: {
        id: row.id,
        codigo: row.codigo,
        conceptoPago: row.concepto_pago,
        metodoPago: row.metodo_pago,
        referenciaPago: row.referencia_pago,
        observaciones: row.observaciones,
        moneda: row.moneda,
        tasaCambio: row.tasa_cambio,
        montoTotal: row.monto_total,
        montoPagado: row.monto_pagado,
        estado: row.estado,
        fechaSolicitud: row.fecha_solicitud,
        fechaPago: primerAbono.fecha_pago,
      },
      gasto: row.gasto_id
        ? {
            id: row.gasto_id,
            codigo: row.gasto_codigo,
            total: row.gasto_total || 0,
            moneda: row.gasto_moneda || "—",
            tasaCambio: row.gasto_tasa_cambio || null,
            documentoUrl: row.gasto_documento
              ? await generarUrlPrefirmadaLectura(row.gasto_documento)
              : null,
          }
        : null,
      proveedor: row.proveedor_nombre
        ? {
            nombre: row.proveedor_nombre,
            rif: row.proveedor_rif,
            telefono: row.proveedor_telefono,
            email: row.proveedor_email,
          }
        : null,
      banco: row.banco_nombre ? { nombre: row.banco_nombre } : null,
      firmas: {
        solicita: solicitaFirma,
        revisa: revisaFirma,
        aprueba: apruebaFirma,
      },
      comprobanteUrl,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      logo,
    };

    const html = generarHTMLOrdenPago(datos, "final");

    // 7) Puppeteer → PDF buffer
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
    });

    await browser.close();

    // 8) Carpeta S3: .../SP-00005/ordenes_pago/...
    const meses = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ];

    const fechaBase = primerAbono?.fecha_pago
      ? new Date(primerAbono.fecha_pago)
      : new Date();
    const anio = fechaBase.getFullYear();
    const mesPalabra = meses[fechaBase.getMonth()];

    const numeroAbono = 1;
    const timestamp = Date.now();

    const nombreOriginal = `ordenPago-${row.codigo}-abono-${String(
      numeroAbono,
    ).padStart(4, "0")}-${pagoRealizadoId}-${timestamp}.pdf`;

    const extension = "pdf";
    const tamanioBytes = pdfBuffer.length;

    clavePdfOrdenPago = `comprobantes_pagos/${anio}/${mesPalabra}/${row.codigo}/ordenes_pago/${nombreOriginal}`;

    // 9) Subir a S3
    await subirBufferAS3({
      claveS3: clavePdfOrdenPago,
      buffer: pdfBuffer,
      contentType: "application/pdf",
    });

    // 10) Grupo de archivos (misma utilidad que ya usas)
    const grupoId = await obtenerOcrearGrupoComprobante(
      conexion,
      solicitudPagoId,
      usuarioId,
    );

    // 11) Versionado
    const [[ver]] = await conexion.execute(
      `
      SELECT IFNULL(MAX(numeroVersion), 0) AS maxVer
      FROM archivos
      WHERE registroTipo = 'comprobantesPagos'
        AND registroId = ?
        AND subTipoArchivo = 'ordenPago'
      `,
      [pagoRealizadoId],
    );

    const numeroVersion = Number(ver?.maxVer || 0) + 1;

    // 12) Insert archivos (registroId = pagoRealizadoId)
    const [aRes] = await conexion.execute(
      `
      INSERT INTO archivos
        (registroTipo, subTipoArchivo, registroId, grupoArchivoId,
         nombreOriginal, extension, tamanioBytes, numeroVersion,
         rutaS3, estado, esPublico, subidoPor)
      VALUES
        ('comprobantesPagos', 'ordenPago', ?, ?, ?, ?, ?, ?, ?, 'activo', 0, ?)
      `,
      [
        pagoRealizadoId,
        grupoId,
        nombreOriginal,
        extension,
        tamanioBytes,
        numeroVersion,
        clavePdfOrdenPago,
        usuarioId,
      ],
    );

    const archivoId = aRes.insertId;

    // 13) Insert versionesArchivo
    const [vRes] = await conexion.execute(
      `
      INSERT INTO versionesArchivo
        (archivoId, numeroVersion, nombreOriginal, extension,
         tamanioBytes, rutaS3, subidoPor)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        archivoId,
        numeroVersion,
        nombreOriginal,
        extension,
        tamanioBytes,
        clavePdfOrdenPago,
        usuarioId,
      ],
    );

    const versionId = vRes.insertId;

    // 14) Auditoría eventosArchivo
    await conexion.execute(
      `
      INSERT INTO eventosArchivo
        (archivoId, versionId, accion, creadoPor, ip, userAgent, detalles)
      VALUES
        (?, ?, 'subidaArchivo', ?, ?, ?, ?)
      `,
      [
        archivoId,
        versionId,
        usuarioId,
        ip || null,
        userAgent || null,
        JSON.stringify({
          registroTipo: "comprobantesPagos",
          subTipoArchivo: "ordenPago",
          solicitudPagoId: Number(solicitudPagoId),
          pagoRealizadoId: Number(pagoRealizadoId),
          codigoSolicitudPago: row.codigo,
          origen: "abono",
        }),
      ],
    );

    // 15) Storage
    await conexion.execute(
      `
      UPDATE usuarios
      SET usoStorageBytes = usoStorageBytes + ?
      WHERE id = ?
      `,
      [tamanioBytes, usuarioId],
    );

    await conexion.commit();

    return {
      ok: true,
      clavePdfOrdenPago,
      archivoId,
      versionId,
    };
  } catch (error) {
    await conexion.rollback();

    // Si subió a S3 pero falló BD, limpia
    if (clavePdfOrdenPago) {
      try {
        await borrarObjetoAS3(clavePdfOrdenPago);
      } catch (_) {}
    }

    console.error("Error guardando PDF Orden de Pago (auto):", error);
    return { ok: false, error: error?.message || "Error desconocido" };
  } finally {
    conexion.release();
  }
}

/* ============================================================
 * 1. LISTAR SOLICITUDES DE PAGO
 * ========================================================== */
export const obtenerSolicitudesPago = async (req, res) => {
  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const { estado } = req.query;
  const search = (req.query.search || "").trim();
  const claveCache = `solicitudesPago_${scopeSucursal}_${page}_${limit}_${estado || "todos"}_${search}`;
  const enCache = cacheMemoria.get(claveCache);
  if (enCache) return res.json(enCache);

  try {
    let whereSQL = "";
    const whereParams = [];

    if (!(esAdmin && scopeSucursal === "todas")) {
      whereSQL += (whereSQL ? " AND " : " WHERE ") + "sp.sucursal_id = ?";
      whereParams.push(Number(scopeSucursal));
    }

    if (estado && estado !== "todos") {
      whereSQL += (whereSQL ? " AND " : " WHERE ") + "sp.estado = ?";
      whereParams.push(estado);
    }

    if (search) {
      whereSQL +=
        (whereSQL ? " AND " : " WHERE ") +
        `(
          sp.codigo LIKE ? OR
          p.nombre LIKE ? OR
          sp.moneda LIKE ? OR
          sp.estado LIKE ?
        )`;
      whereParams.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
      );
    }

    // Total
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
         FROM solicitudes_pago sp
         LEFT JOIN proveedores p ON p.id = sp.proveedor_id
         ${whereSQL}`,
      whereParams,
    );

    // Data
    const [solicitudes] = await db.query(
      `
      SELECT 
        sp.id,
        sp.codigo,
        sp.gasto_id,
        sp.usuario_solicita_id,
        sp.usuario_revisa_id,
        sp.usuario_aprueba_id,
        p.nombre AS proveedor_nombre,
        sp.monto_total    AS monto,
        sp.monto_pagado   AS pagado,
        sp.moneda,
        sp.fecha_solicitud AS fecha,
        sp.estado
      FROM solicitudes_pago sp
      LEFT JOIN proveedores p ON p.id = sp.proveedor_id
      ${whereSQL}
      ORDER BY sp.fecha_solicitud DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      whereParams,
    );

    const respuesta = { solicitudes, total, page, limit };
    cacheMemoria.set(claveCache, respuesta, 300);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error al listar solicitudes de pago:", error);
    return res
      .status(500)
      .json({ message: "Error al listar solicitudes de pago" });
  }
};

/* ============================================================
 * 2. DETALLE DE UNA SOLICITUD (con abonos + saldos)
 * ========================================================== */
export const obtenerSolicitudPagoPorId = async (req, res) => {
  const { id } = req.params;
  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;
  const whereSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " AND sp.sucursal_id = ?";
  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];
  const claveCache = `solicitudPago_${scopeSucursal}_${id}`;
  const enCache = cacheMemoria.get(claveCache);
  if (enCache) return res.json(enCache);

  try {
    // 1) Solicitud
    const [[solicitud]] = await db.execute(
      `
      SELECT sp.*,
             g.codigo  AS gasto_codigo,
             p.nombre  AS proveedor_nombre,
             us.nombre AS usuario_solicita_nombre,
             ur.nombre AS usuario_revisa_nombre,
             up.nombre AS usuario_aprueba_nombre,
             b.nombre  AS banco_nombre
        FROM solicitudes_pago sp
        LEFT JOIN gastos      g  ON g.id  = sp.gasto_id
        LEFT JOIN proveedores p  ON p.id  = sp.proveedor_id
        LEFT JOIN usuarios    us ON us.id = sp.usuario_solicita_id
        LEFT JOIN usuarios    ur ON ur.id = sp.usuario_revisa_id
        LEFT JOIN usuarios    up ON up.id = sp.usuario_aprueba_id
        LEFT JOIN bancos      b  ON b.id  = sp.banco_id
       WHERE sp.id = ?${whereSucursalSql}
       `,
      [id, ...paramsSucursal],
    );

    if (!solicitud) {
      return res.status(404).json({ message: "Solicitud no encontrada" });
    }

    // 2) Firma del usuario (sesión)
    const usuarioFirma = req.session.usuario?.ruta_firma || null;

    // 3) Bancos disponibles según moneda
    const [bancosDisponibles] = await db.execute(
      `
      SELECT id, nombre, identificador
        FROM bancos
       WHERE (moneda = ? OR ? IS NULL)
         AND estado = 'activo'
      `,
      [solicitud.moneda, solicitud.moneda],
    );

    // 4) Comprobante de la solicitud (si aplica)
    const comprobanteUrlSolicitud = solicitud.ruta_comprobante
      ? await generarUrlPrefirmadaLectura(solicitud.ruta_comprobante, 600)
      : null;

    // 5) Listado de abonos (pagos_realizados)
    const [pagosRealizados] = await db.execute(
      `
      SELECT pr.id,
             pr.solicitud_pago_id,
             pr.usuario_id,
             u.nombre AS usuario_nombre,
             pr.metodo_pago,
             pr.referencia_pago,
             pr.banco_id,
             b.nombre AS banco_nombre,
             pr.monto_pagado,
             pr.moneda,
             pr.tasa_cambio,
             pr.monto_pagado_usd,
             pr.fecha_pago,
             pr.ruta_comprobante,
             pr.observaciones,
             pr.created_at
        FROM pagos_realizados pr
        LEFT JOIN usuarios u ON u.id = pr.usuario_id
        LEFT JOIN bancos   b ON b.id = pr.banco_id
       WHERE pr.solicitud_pago_id = ?
       ORDER BY pr.fecha_pago DESC, pr.id DESC
      `,
      [id],
    );

    // 6) Generar URL prefirmada por cada comprobante de abono
    const pagosRealizadosConUrl = await Promise.all(
      pagosRealizados.map(async (pago) => {
        const comprobanteUrl = pago.ruta_comprobante
          ? await generarUrlPrefirmadaLectura(pago.ruta_comprobante, 600)
          : null;

        return {
          ...pago,
          comprobante_url: comprobanteUrl,
        };
      }),
    );

    // 7) Totales en USD (la fuente de verdad para validar sobrepagos)
    const [[sumas]] = await db.execute(
      `
      SELECT IFNULL(SUM(monto_pagado_usd), 0) AS total_pagado_usd
        FROM pagos_realizados
       WHERE solicitud_pago_id = ?
      `,
      [id],
    );

    const montoTotalUsd = parseFloat(solicitud.monto_total_usd) || 0;
    const totalPagadoUsd = parseFloat(sumas.total_pagado_usd) || 0;
    const saldoPendienteUsd = Math.max(montoTotalUsd - totalPagadoUsd, 0);

    // 8) Saldo pendiente “en moneda” (referencia con tasa de la solicitud)
    let saldoPendienteMoneda = saldoPendienteUsd;

    if (solicitud.moneda === "VES") {
      const tasaSolicitud = parseFloat(solicitud.tasa_cambio) || 0;
      saldoPendienteMoneda =
        tasaSolicitud > 0 ? saldoPendienteUsd * tasaSolicitud : 0;
    }

    const respuesta = {
      ...solicitud,
      usuario_firma: usuarioFirma,
      bancosDisponibles,
      comprobante_url: comprobanteUrlSolicitud,

      pagos_realizados: pagosRealizadosConUrl,

      // ✅ Totales/saldos en USD (fuente de verdad)
      total_pagado_usd: totalPagadoUsd,
      saldo_pendiente_usd: saldoPendienteUsd,

      // ✅ Compatibilidad: algunos componentes esperan esto como “cabecera”
      monto_pagado_usd: totalPagadoUsd,

      // ✅ Referencia “en moneda” usando la tasa guardada en solicitud (no es la tasa del día)
      saldo_pendiente_moneda: saldoPendienteMoneda,
    };

    cacheMemoria.set(claveCache, respuesta, 300);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error al obtener solicitud de pago:", error);
    return res
      .status(500)
      .json({ message: "Error interno al obtener la solicitud" });
  }
};

/* ============================================================
 * 3. ACTUALIZAR (cuando estado = 'por_pagar')
 * ========================================================== */
export const actualizarSolicitudPago = async (req, res) => {
  const { id } = req.params;
  const campos = req.body;
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

  const [[s]] = await db.execute(
    `SELECT estado, sucursal_id FROM solicitudes_pago WHERE id = ?${whereSucursalSql}`,
    [id, ...paramsSucursal],
  );
  if (!s) return res.status(404).json({ message: "Solicitud no encontrada" });
  if (s.estado !== "por_pagar") {
    return res
      .status(400)
      .json({ message: "Solo se puede modificar cuando está por pagar" });
  }

  const setCols = Object.keys(campos)
    .map((k) => `${k} = ?`)
    .join(", ");
  await db.execute(`UPDATE solicitudes_pago SET ${setCols} WHERE id = ?${whereSucursalSql}`, [
    ...Object.values(campos),
    id,
    ...paramsSucursal,
  ]);

  invalidarCachePorPrefijos({
    prefijos: PREFIJOS_CACHE_SOLICITUDES,
    scopeSucursal:
      !Number.isNaN(Number(s.sucursal_id)) && Number(s.sucursal_id) > 0
        ? String(Number(s.sucursal_id))
        : null,
  });

  return res.json({ message: "Solicitud actualizada correctamente" });
};

/* ============================================================
 * 4. CANCELAR (cuando estado = 'por_pagar')
 * ========================================================== */
export const cancelarSolicitudPago = async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;
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

  const [[s]] = await db.execute(
    `SELECT estado, sucursal_id FROM solicitudes_pago WHERE id = ?${whereSucursalSql}`,
    [id, ...paramsSucursal],
  );
  if (!s) return res.status(404).json({ message: "Solicitud no encontrada" });
  if (s.estado !== "por_pagar") {
    return res
      .status(400)
      .json({ message: "Solo se puede cancelar cuando está por pagar" });
  }

  await db.execute(
      `UPDATE solicitudes_pago
         SET estado       = 'cancelada',
             observaciones = CONCAT(
               IFNULL(observaciones, ''), 
               '\nCancelada: ', ?
             )
       WHERE id = ?${whereSucursalSql}`,
    [motivo || "Sin motivo especificado", id, ...paramsSucursal],
  );

  invalidarCachePorPrefijos({
    prefijos: PREFIJOS_CACHE_SOLICITUDES,
    scopeSucursal:
      !Number.isNaN(Number(s.sucursal_id)) && Number(s.sucursal_id) > 0
        ? String(Number(s.sucursal_id))
        : null,
  });

  return res.json({ message: "Solicitud cancelada" });
};

export const pagarSolicitudPago = async (req, res) => {
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

  const usuarioApruebaId = req.user?.id ?? req.session?.usuario?.id ?? null;

  const ip = req.ip || null;
  const userAgent = req.get("user-agent") || null;

  const metodoPago = req.body?.metodo_pago;
  const referenciaPago = req.body?.referencia_pago ?? null;
  const bancoId = req.body?.banco_id ?? null;

  const montoPagadoRaw = req.body?.monto_pagado ?? req.body?.monto_abono;
  const tasaCambioRaw = req.body?.tasa_cambio ?? req.body?.tasa_cambio_abono;

  const monedaBody = req.body?.moneda ?? null;
  const observaciones = req.body?.observaciones ?? null;
  const fechaPagoRaw = req.body?.fecha_pago ?? null;

  // ✅ Comprobante subido (S3)
  const rutaComprobante = req.file?.key ?? null;

  const normalizarFechaMySql = (fechaIso) => {
    if (!fechaIso) return null;
    const fecha = String(fechaIso).replace("T", " ").trim();
    return fecha.length === 16 ? `${fecha}:00` : fecha;
  };

  const conexion = await db.getConnection();
  let pagoRealizadoId = null;

  try {
    if (!usuarioApruebaId) {
      return res
        .status(401)
        .json({ message: "Sesión inválida: usuario no autenticado." });
    }

    if (!metodoPago) {
      return res.status(400).json({ message: "Debe indicar método de pago." });
    }

    const montoPagado = Number(montoPagadoRaw);
    if (!Number.isFinite(montoPagado) || montoPagado <= 0) {
      return res
        .status(400)
        .json({ message: "Debe indicar un monto válido mayor a 0." });
    }

    const fechaPagoMySql = normalizarFechaMySql(fechaPagoRaw);

    await conexion.beginTransaction();

    // 1) Bloquear solicitud
    const [[solicitud]] = await conexion.execute(
      `
      SELECT id, codigo, monto_total, monto_pagado, estado, moneda, sucursal_id
      FROM solicitudes_pago
      WHERE id = ?${whereSucursalSql}
      FOR UPDATE
      `,
      [id, ...paramsSucursal],
    );

    if (!solicitud) {
      await conexion.rollback();
      return res.status(404).json({ message: "Solicitud no encontrada." });
    }

    const monedaFinal = monedaBody ?? solicitud.moneda ?? "VES";

    // 2) Insertar abono
    const [pRes] = await conexion.execute(
      `
      INSERT INTO pagos_realizados
        (solicitud_pago_id, usuario_id, metodo_pago, referencia_pago, banco_id,
         monto_pagado, moneda, tasa_cambio, fecha_pago,
         ruta_comprobante, ruta_firma, observaciones, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()),
         ?, NULL, ?, NOW(), NOW())
      `,
      [
        id,
        usuarioApruebaId,
        metodoPago,
        referenciaPago,
        bancoId,
        montoPagado,
        monedaFinal,
        tasaCambioRaw ?? null,
        fechaPagoMySql,
        rutaComprobante,
        observaciones,
      ],
    );

    pagoRealizadoId = pRes.insertId;

    // ✅ 2.1) Registrar el comprobante en "archivos" con versionado real
    if (rutaComprobante && req.file) {
      const nombreOriginal = req.file.originalname ?? "comprobante";
      const extension = nombreOriginal.includes(".")
        ? nombreOriginal.split(".").pop()
        : null;

      const tamanioBytes = Number(req.file.size ?? 0);
      if (!Number.isFinite(tamanioBytes) || tamanioBytes <= 0) {
        throw new Error("Tamaño de comprobante inválido.");
      }

      // 1) Calcular la siguiente versión para evitar DUPLICADOS
      const [[filaVersion]] = await conexion.execute(
        `
        SELECT IFNULL(MAX(numeroVersion), 0) AS maxVersion
        FROM archivos
        WHERE registroTipo = 'comprobantesPagos'
          AND registroId = ?
          AND tipoDocumento = 'comprobante'
        `,
        [pagoRealizadoId],
      );

      const numeroVersion = Number(filaVersion?.maxVersion || 0) + 1;

      // 2) Insertar en archivos (OJO: subTipoArchivo permitido: 'comprobante')
      await conexion.execute(
        `
        INSERT INTO archivos
          (registroTipo, subTipoArchivo, registroId, tipoDocumento,
           nombreOriginal, extension, tamanioBytes, numeroVersion,
           rutaS3, estado, esPublico, subidoPor)
        VALUES
          ('comprobantesPagos', 'comprobante', ?, 'comprobante',
           ?, ?, ?, ?,
           ?, 'activo', 0, ?)
        `,
        [
          pagoRealizadoId,
          nombreOriginal,
          extension,
          tamanioBytes,
          numeroVersion,
          rutaComprobante,
          usuarioApruebaId,
        ],
      );

      // 3) Sumar almacenamiento (si manejas cuota)
      await conexion.execute(
        `
        UPDATE usuarios
        SET usoStorageBytes = IFNULL(usoStorageBytes, 0) + ?
        WHERE id = ?
        `,
        [tamanioBytes, usuarioApruebaId],
      );
    }

    // 3) Recalcular estado
    const nuevoMontoPagado =
      Number(solicitud.monto_pagado || 0) + Number(montoPagado || 0);

    const quedaPagada = nuevoMontoPagado >= Number(solicitud.monto_total || 0);
    const nuevoEstado = quedaPagada ? "pagada" : "parcialmente_pagada";

    // 4) Actualizar solicitud
    await conexion.execute(
      `
      UPDATE solicitudes_pago
      SET monto_pagado = ?,
          estado = ?,
          usuario_aprueba_id = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [nuevoMontoPagado, nuevoEstado, usuarioApruebaId, id],
    );

    await conexion.commit();

    invalidarCachePorPrefijos({
      prefijos: PREFIJOS_CACHE_SOLICITUDES,
      scopeSucursal:
        !Number.isNaN(Number(solicitud.sucursal_id)) &&
        Number(solicitud.sucursal_id) > 0
          ? String(Number(solicitud.sucursal_id))
          : null,
    });

    // 5) Generar PDF orden de pago (tu lógica actual)
    let resultadoPdf = null;
    if (typeof guardarPdfOrdenPagoPorAbono === "function") {
      resultadoPdf = await guardarPdfOrdenPagoPorAbono({
        solicitudPagoId: Number(id),
        pagoRealizadoId: Number(pagoRealizadoId),
        usuarioId: Number(usuarioApruebaId),
        ip,
        userAgent,
      });
    }

    return res.status(200).json({
      message: "Abono registrado correctamente.",
      pagoRealizadoId,
      nuevoEstado,
      nuevoMontoPagado,
      usuarioApruebaId,
      pdfOrdenPago: resultadoPdf
        ? {
            generado: Boolean(resultadoPdf?.ok && !resultadoPdf?.omitido),
            omitido: Boolean(resultadoPdf?.omitido),
            motivo: resultadoPdf?.motivo ?? null,
            archivoId: resultadoPdf?.archivoId ?? null,
            versionId: resultadoPdf?.versionId ?? null,
            claveS3: resultadoPdf?.clavePdfOrdenPago ?? null,
            numeroAbono: resultadoPdf?.numeroAbono ?? null,
            nombreOriginal: resultadoPdf?.nombreOriginal ?? null,
          }
        : null,
    });
  } catch (error) {
    try {
      await conexion.rollback();
    } catch (_) {}

    console.error("Error al registrar abono:", error);
    return res.status(500).json({
      message: "No se pudo registrar el abono.",
      error: error?.message ?? String(error),
    });
  } finally {
    try {
      conexion.release();
    } catch (_) {}
  }
};

export const obtenerOrdenesPagoSolicitud = async (req, res) => {
  const solicitudPagoId = Number(req.params.id);
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
  const claveCache = `ordenesPagoSolicitud_${scopeSucursal}_${solicitudPagoId}`;
  const enCache = cacheMemoria.get(claveCache);
  if (enCache) return res.json(enCache);

  try {
    if (!solicitudPagoId || Number.isNaN(solicitudPagoId)) {
      return res.status(400).json({ message: "ID de solicitud inválido." });
    }

    // 1) Validar que exista la solicitud
    const [[solicitud]] = await db.execute(
      `SELECT id, codigo, estado
       FROM solicitudes_pago
       WHERE id = ?${whereSucursalSql}
       LIMIT 1`,
      [solicitudPagoId, ...paramsSucursal],
    );

    if (!solicitud) {
      return res
        .status(404)
        .json({ message: "Solicitud de pago no encontrada." });
    }

    // 2) Traer los abonos (pagos_realizados) de esa solicitud
    const [pagos] = await db.execute(
      `SELECT
          pr.id,
          pr.solicitud_pago_id,
          pr.monto_pagado,
          pr.moneda,
          pr.tasa_cambio,
          pr.fecha_pago,
          pr.referencia_pago,
          pr.banco_id
       FROM pagos_realizados pr
       WHERE pr.solicitud_pago_id = ?
       ORDER BY pr.fecha_pago ASC, pr.id ASC`,
      [solicitudPagoId],
    );

    // 3) Por cada abono, buscar el PDF ordenPago en archivos
    //    (activo y con mayor numeroVersion)
    const ordenesPago = await Promise.all(
      pagos.map(async (pago, index) => {
        const pagoRealizadoId = Number(pago.id);
        const numeroAbono = index + 1;

        const [[archivoPdf]] = await db.execute(
          `SELECT
              a.id AS archivoId,
              a.rutaS3,
              a.numeroVersion,
              a.estado,
              a.nombreOriginal
           FROM archivos a
           WHERE a.registroTipo = 'comprobantesPagos'
             AND a.subTipoArchivo = 'ordenPago'
             AND a.registroId = ?
             AND a.estado = 'activo'
           ORDER BY a.numeroVersion DESC, a.id DESC
           LIMIT 1`,
          [pagoRealizadoId],
        );

        let urlPdf = null;
        if (archivoPdf?.rutaS3) {
          // 10 min de validez (ajusta si quieres)
          urlPdf = await generarUrlPrefirmadaLectura(archivoPdf.rutaS3, 600);
        }

        return {
          pagoRealizadoId,
          numeroAbono,
          fechaPago: pago.fecha_pago,
          monto: pago.monto_pagado,
          moneda: pago.moneda,
          tasaCambio: pago.tasa_cambio ?? null,
          referenciaPago: pago.referencia_pago ?? null,
          bancoId: pago.banco_id ?? null,

          // PDF orden de pago (si existe)
          tienePdf: Boolean(archivoPdf?.rutaS3),
          archivoId: archivoPdf?.archivoId ?? null,
          nombreArchivo: archivoPdf?.nombreOriginal ?? null,
          rutaS3: archivoPdf?.rutaS3 ?? null,
          numeroVersion: archivoPdf?.numeroVersion ?? null,
          urlPdf,
        };
      }),
    );

    cacheMemoria.set(claveCache, ordenesPago, 300);
    return res.json(ordenesPago);
  } catch (error) {
    console.error("Error obtenerOrdenesPagoSolicitud:", error);
    return res.status(500).json({
      message: "Error interno al obtener las órdenes de pago.",
    });
  }
};

async function guardarPdfOrdenPagoPorAbono({
  solicitudPagoId,
  pagoRealizadoId,
  usuarioId,
  ip,
  userAgent,
}) {
  let clavePdfOrdenPago = null;
  const conexion = await db.getConnection();

  try {
    await conexion.beginTransaction();

    // 1) Traer data completa de la solicitud
    const [[row]] = await conexion.execute(
      `
      SELECT  
              sp.*,
              g.codigo              AS gasto_codigo,
              g.total               AS gasto_total,
              g.moneda              AS gasto_moneda,
              g.tasa_cambio         AS gasto_tasa_cambio,
              g.documento           AS gasto_documento,
              tg.nombre             AS tipo_gasto_nombre,
              p.nombre              AS proveedor_nombre,
              p.rif                 AS proveedor_rif,
              p.telefono            AS proveedor_telefono,
              p.email               AS proveedor_email,

              us.nombre             AS solicita_nombre,
              us.firma              AS solicita_firma,

              ur.nombre             AS revisa_nombre,
              ur.firma              AS revisa_firma,

              up.nombre             AS aprueba_nombre,
              up.firma              AS aprueba_firma
      FROM    solicitudes_pago sp
      LEFT JOIN gastos g         ON g.id = sp.gasto_id
      LEFT JOIN tipos_gasto tg   ON tg.id = g.tipo_gasto_id
      LEFT JOIN proveedores p    ON p.id = sp.proveedor_id
      LEFT JOIN usuarios us      ON us.id = sp.usuario_solicita_id
      LEFT JOIN usuarios ur      ON ur.id = sp.usuario_revisa_id
      LEFT JOIN usuarios up      ON up.id = sp.usuario_aprueba_id
      WHERE sp.id = ?
      `,
      [solicitudPagoId],
    );

    if (!row) {
      await conexion.rollback();
      return { ok: false, motivo: "Solicitud no encontrada" };
    }

    // 2)Traer el abono actual + banco (nombre + identificador + tipo_identificador)
    const [[abono]] = await conexion.execute(
      `
      SELECT
        pr.id,
        pr.solicitud_pago_id,
        pr.usuario_id,
        pr.metodo_pago,
        pr.referencia_pago,
        pr.banco_id,
        pr.monto_pagado,
        pr.monto_pagado_usd,
        pr.tasa_cambio,
        pr.moneda,
        pr.fecha_pago,
        pr.ruta_comprobante,
        pr.ruta_firma,
        pr.observaciones,
        pr.created_at,
        pr.updated_at,

        b.nombre            AS banco_nombre_pago,
        b.identificador     AS banco_identificador,
        b.tipo_identificador AS banco_tipo_identificador
      FROM pagos_realizados pr
      LEFT JOIN bancos b ON b.id = pr.banco_id
      WHERE pr.id = ? AND pr.solicitud_pago_id = ?
      LIMIT 1
      `,
      [pagoRealizadoId, solicitudPagoId],
    );

    if (!abono) {
      await conexion.rollback();
      return { ok: false, motivo: "Abono no encontrado para esta solicitud" };
    }

    // 3) Calcular numeroAbono (ROW_NUMBER)
    const [[rankRow]] = await conexion.execute(
      `
      SELECT rn
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY fecha_pago ASC, id ASC) AS rn
        FROM pagos_realizados
        WHERE solicitud_pago_id = ?
      ) t
      WHERE t.id = ?
      LIMIT 1
      `,
      [solicitudPagoId, pagoRealizadoId],
    );

    const numeroAbono = Number(rankRow?.rn || 1);

    // ✅ 4) Evitar duplicado: validar por tipoDocumento (clave del UNIQUE)
    const [[yaExiste]] = await conexion.execute(
      `
      SELECT id
      FROM archivos
      WHERE registroTipo = 'comprobantesPagos'
        AND registroId = ?
        AND tipoDocumento = 'ordenPago'
        AND estado = 'activo'
      LIMIT 1
      `,
      [pagoRealizadoId],
    );

    if (yaExiste?.id) {
      await conexion.rollback();
      return { ok: true, omitido: true, motivo: "PDF ya estaba registrado" };
    }

    // 5) Firmas a base64
    const [firmaSolicita, firmaRevisa, firmaAprueba] = await Promise.all([
      firmaToDataUrl(row.solicita_firma),
      firmaToDataUrl(row.revisa_firma),
      firmaToDataUrl(row.aprueba_firma),
    ]);

    // 6) Logo local a base64
    let logo = null;
    try {
      const archivoActual = fileURLToPath(import.meta.url);
      const carpetaActual = path.dirname(archivoActual);
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
      console.error("No se pudo cargar el logo de Orden de Pago:", err);
    }

    // 7) URLs prefirmadas: comprobante desde el ABONO
    const comprobanteUrl = abono.ruta_comprobante
      ? await generarUrlPrefirmadaLectura(abono.ruta_comprobante, 600)
      : null;

    const gastoDocumentoUrl = row.gasto_documento
      ? await generarUrlPrefirmadaLectura(row.gasto_documento, 600)
      : null;

    // 8) Diferencia (manteniendo tu lógica: solicitado - pagado acumulado)
    const diferencia = (row.monto_total || 0) - (row.monto_pagado || 0);

    // 9) Datos para el template (manteniendo tu estructura + ✅ pagoRealizado)
    const datos = {
      codigo: row.codigo,
      fechaSolicitud: row.fecha_solicitud,
      fechaPago: abono.fecha_pago,
      estado: row.estado,

      solicitadoPor: row.solicita_nombre,
      autorizadoPor: row.revisa_nombre,
      aprobadoPor: row.aprueba_nombre,

      firmaSolicita,
      firmaAutoriza: firmaRevisa,
      firmaAprueba,

      // Compatibilidad vieja (por si algo aún lo usa)
      metodoPago: abono.metodo_pago ?? row.metodo_pago,
      banco: abono.banco_nombre_pago || "—",
      referencia: abono.referencia_pago || "—",
      comprobanteUrl,

      // Nuevo: tu HTML actualizado lo prioriza
      pagoRealizado: {
        metodoPago: abono.metodo_pago ?? "N/A",
        referenciaPago: abono.referencia_pago ?? "—",
        bancoNombre: abono.banco_nombre_pago || "—",
        // "Cuenta" real en tu BD:
        numeroCuenta: abono.banco_identificador || "—",
        tipoIdentificador: abono.banco_tipo_identificador || null, // 'nro_cuenta' | 'email'
        rutaComprobante: comprobanteUrl,
        fechaPago: abono.fecha_pago,
      },

      montoSolicitado: row.monto_total,
      montoAbono: abono.monto_pagado,
      montoPagado: row.monto_pagado,
      diferencia,

      moneda: abono.moneda ?? row.moneda,
      tasaCambio:
        abono.tasa_cambio !== null && abono.tasa_cambio !== undefined
          ? abono.tasa_cambio
          : row.tasa_cambio,

      observaciones: row.observaciones,

      gasto: {
        codigo: row.gasto_codigo || "—",
        tipoGasto: row.tipo_gasto_nombre || "—",
        total: row.gasto_total || 0,
        moneda: row.gasto_moneda || "—",
        tasaCambio: row.gasto_tasa_cambio || null,
        documentoUrl: gastoDocumentoUrl || null,
      },

      proveedor: row.proveedor_nombre
        ? {
            nombre: row.proveedor_nombre,
            rif: row.proveedor_rif,
            telefono: row.proveedor_telefono,
            email: row.proveedor_email,
          }
        : null,

      createdAt: row.created_at,
      updatedAt: row.updated_at,
      logo,
    };

    const html = generarHTMLOrdenPago(datos, "final");

    // 10) Generar PDF
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
    });

    await browser.close();

    // 11) Construir ruta S3
    const meses = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ];

    const fechaBase = abono.fecha_pago
      ? new Date(abono.fecha_pago)
      : new Date();
    const anio = fechaBase.getFullYear();
    const mesPalabra = meses[fechaBase.getMonth()];
    const timestamp = Date.now();

    const nombreOriginal = `ordenPago-${row.codigo}-abono-${String(
      numeroAbono,
    ).padStart(4, "0")}-${pagoRealizadoId}-${timestamp}.pdf`;

    const extension = "pdf";
    const tamanioBytes = pdfBuffer.length;

    clavePdfOrdenPago = `comprobantes_pagos/${anio}/${mesPalabra}/${row.codigo}/ordenes_pago/${nombreOriginal}`;

    // 12) Subir a S3
    await subirBufferAS3({
      claveS3: clavePdfOrdenPago,
      buffer: pdfBuffer,
      contentType: "application/pdf",
    });

    // 13) Grupo de archivos de la solicitud
    const grupoId = await obtenerOcrearGrupoComprobante(
      conexion,
      solicitudPagoId,
      usuarioId,
    );

    // ✅ 14) Versionado (por tipoDocumento, no por subTipoArchivo)
    const [[ver]] = await conexion.execute(
      `
      SELECT IFNULL(MAX(numeroVersion), 0) AS maxVer
      FROM archivos
      WHERE registroTipo = 'comprobantesPagos'
        AND registroId = ?
        AND tipoDocumento = 'ordenPago'
      `,
      [pagoRealizadoId],
    );

    const numeroVersion = Number(ver?.maxVer || 0) + 1;

    // ✅ 15) Insert archivos (incluyendo tipoDocumento explícito)
    const [aRes] = await conexion.execute(
      `
      INSERT INTO archivos
        (registroTipo, subTipoArchivo, registroId, tipoDocumento, grupoArchivoId,
         nombreOriginal, extension, tamanioBytes, numeroVersion,
         rutaS3, estado, esPublico, subidoPor)
      VALUES
        ('comprobantesPagos', 'ordenPago', ?, 'ordenPago', ?,
         ?, ?, ?, ?,
         ?, 'activo', 0, ?)
      `,
      [
        pagoRealizadoId,
        grupoId,
        nombreOriginal,
        extension,
        tamanioBytes,
        numeroVersion,
        clavePdfOrdenPago,
        usuarioId,
      ],
    );

    const archivoId = aRes.insertId;

    // 16) Insert versionesArchivo
    const [vRes] = await conexion.execute(
      `
      INSERT INTO versionesArchivo
        (archivoId, numeroVersion, nombreOriginal, extension,
         tamanioBytes, rutaS3, subidoPor)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        archivoId,
        numeroVersion,
        nombreOriginal,
        extension,
        tamanioBytes,
        clavePdfOrdenPago,
        usuarioId,
      ],
    );

    const versionId = vRes.insertId;

    // 17) Auditoría eventosArchivo
    await conexion.execute(
      `
      INSERT INTO eventosArchivo
        (archivoId, versionId, accion, creadoPor, ip, userAgent, detalles)
      VALUES
        (?, ?, 'subidaArchivo', ?, ?, ?, ?)
      `,
      [
        archivoId,
        versionId,
        usuarioId,
        ip || null,
        userAgent || null,
        JSON.stringify({
          registroTipo: "comprobantesPagos",
          subTipoArchivo: "ordenPago",
          tipoDocumento: "ordenPago",
          solicitudPagoId: Number(solicitudPagoId),
          pagoRealizadoId: Number(pagoRealizadoId),
          codigoSolicitudPago: row.codigo,
          numeroAbono,
          origen: "abono",
        }),
      ],
    );

    // 18) Storage
    await conexion.execute(
      `
      UPDATE usuarios
      SET usoStorageBytes = IFNULL(usoStorageBytes, 0) + ?
      WHERE id = ?
      `,
      [tamanioBytes, usuarioId],
    );

    await conexion.commit();

    return {
      ok: true,
      claveS3: clavePdfOrdenPago,
      numeroVersion,
      archivoId,
    };
  } catch (error) {
    await conexion.rollback();
    console.error("Error guardando PDF Orden de Pago (auto por abono):", error);
    return { ok: false, error };
  } finally {
    conexion.release();
  }
}
