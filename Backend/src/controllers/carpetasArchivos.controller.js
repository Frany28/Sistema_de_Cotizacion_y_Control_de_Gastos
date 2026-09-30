import db from "../config/database.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../utils/s3.js";
import cacheMemoria from "../utils/cacheMemoria.js";

// Roles autorizados (igual estilo que archivos.controller.js)
const rolAdmin = 1;
const rolSupervisor = 2;

const esRolAdminOSupervisor = (rolId) =>
  [rolAdmin, rolSupervisor].includes(Number(rolId));

const limpiarCacheCarpetas = () => {
  for (const clave of cacheMemoria.keys()) {
    if (clave.startsWith("carpetas_") || clave.startsWith("archivos_")) {
      cacheMemoria.del(clave);
    }
  }
};

const normalizarNombreCarpeta = (texto) => String(texto || "").trim();

const construirRutaVirtual = (rutaPadre, nombre) => {
  const nombreSeguro = normalizarNombreCarpeta(nombre);
  if (!rutaPadre) return `/${nombreSeguro}`;
  return `${rutaPadre}/${nombreSeguro}`;
};

/**
 * Devuelve ids descendientes (incluye el id raíz)
 * MySQL 8+ (tú usas 8.0.x, ok).
 */
const obtenerIdsDescendientes = async (conexion, carpetaRaizId) => {
  const [filas] = await conexion.query(
    `
    WITH RECURSIVE arbol AS (
      SELECT id, padreId
      FROM carpetasArchivos
      WHERE id = ?
      UNION ALL
      SELECT c.id, c.padreId
      FROM carpetasArchivos c
      INNER JOIN arbol a ON c.padreId = a.id
    )
    SELECT id FROM arbol
    `,
    [carpetaRaizId],
  );

  return filas.map((f) => f.id);
};

/**
 * Recalcula rutaVirtual de una carpeta y TODA su descendencia usando reemplazo por prefijo.
 * Esto permite renombrar/mover sin recalcular nodo por nodo en JS.
 */
const actualizarRutaVirtualSubarbol = async (
  conexion,
  carpetaId,
  rutaAntigua,
  rutaNueva,
) => {
  // 1) actualizar la raíz
  await conexion.query(
    `UPDATE carpetasArchivos
        SET rutaVirtual = ?
      WHERE id = ?`,
    [rutaNueva, carpetaId],
  );

  // 2) actualizar descendientes reemplazando el prefijo antiguo por el nuevo
  // Solo los que comienzan con "rutaAntigua/" (hijos y nietos)
  await conexion.query(
    `
    UPDATE carpetasArchivos
       SET rutaVirtual = CONCAT(?, SUBSTRING(rutaVirtual, ?))
     WHERE rutaVirtual LIKE CONCAT(?, '/%')
    `,
    [
      rutaNueva, // nuevo prefijo
      rutaAntigua.length + 1, // SUBSTRING base 1, así que +1 (posición después del prefijo)
      rutaAntigua,
    ],
  );
};

/**
 * POST /carpetas
 * body: { nombre, padreId? }
 */
export const crearCarpeta = async (req, res) => {
  const conexion = await db.getConnection();
  const usuarioId = req.user.id;

  try {
    const nombre = normalizarNombreCarpeta(req.body.nombre);
    const padreId = req.body.padreId ? Number(req.body.padreId) : null;

    if (!nombre) {
      return res
        .status(400)
        .json({ message: "El nombre de la carpeta es obligatorio." });
    }

    // Validar padre si viene
    let rutaPadre = null;

    if (padreId) {
      const [[padre]] = await conexion.query(
        `SELECT id, rutaVirtual, estado
           FROM carpetasArchivos
          WHERE id = ?`,
        [padreId],
      );

      if (!padre) {
        return res.status(404).json({ message: "La carpeta padre no existe." });
      }
      if (padre.estado !== "activa") {
        return res.status(400).json({
          message: "No puedes crear dentro de una carpeta en papelera/borrada.",
        });
      }

      rutaPadre = padre.rutaVirtual;
    }

    const rutaVirtual = construirRutaVirtual(rutaPadre, nombre);

    // Evitar duplicados por mismo padre + nombre (excepto si está borrada definitivamente)
    const [duplicados] = await conexion.query(
      `SELECT id
         FROM carpetasArchivos
        WHERE padreId <=> ?
          AND nombre = ?
          AND estado <> 'borrado'
        LIMIT 1`,
      [padreId, nombre],
    );
    if (duplicados.length) {
      return res.status(409).json({
        message: "Ya existe una carpeta con ese nombre en esa ubicación.",
      });
    }

    await conexion.beginTransaction();

    const [resultado] = await conexion.query(
      `INSERT INTO carpetasArchivos (nombre, padreId, rutaVirtual, creadoPor)
       VALUES (?, ?, ?, ?)`,
      [nombre, padreId, rutaVirtual, usuarioId],
    );

    // ✅ BD + S3: materializar carpeta en S3 con placeholder ".keep"
    // Regla: repositorio general vive bajo el prefijo "archivos/"
    const rutaVirtualSinSlash = String(rutaVirtual || "").replace(/^\/+/, ""); // quita "/" inicial
    const prefijoS3 = `archivos/${rutaVirtualSinSlash}`.replace(/\/?$/, "/"); // asegura "/"

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `${prefijoS3}.keep`,
        Body: "",
        ContentType: "text/plain",
      }),
    );

    await conexion.commit();
    limpiarCacheCarpetas();

    return res.status(201).json({
      message: "Carpeta creada.",
      carpetaId: resultado.insertId,
      rutaVirtual,
      prefijoS3,
    });
  } catch (error) {
    await conexion.rollback();
    console.error("Error creando carpeta:", error);
    return res.status(500).json({ message: "Error creando carpeta." });
  } finally {
    conexion.release();
  }
};

export const listarCarpetas = async (req, res) => {
  const conexion = await db.getConnection();

  try {
    const estado = req.query.estado || "activa";
    const claveCache = `carpetas_${estado}`;
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);

    if (!["activa", "papelera", "borrado"].includes(estado)) {
      return res.status(400).json({ message: "Estado inválido." });
    }

    const [carpetas] = await conexion.query(
      `SELECT id, nombre, padreId, rutaVirtual, estado, creadoPor, creadoEn, actualizadoEn,
              enviadoPapeleraPor, enviadoPapeleraEn, borradoPor, borradoEn
         FROM carpetasArchivos
        WHERE estado = ?
        ORDER BY rutaVirtual ASC`,
      [estado],
    );

    const respuesta = { carpetas };
    cacheMemoria.set(claveCache, respuesta, 180);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error listando carpetas:", error);
    return res.status(500).json({ message: "Error listando carpetas." });
  } finally {
    conexion.release();
  }
};

/**
 * GET /carpetas/:id
 */
export const obtenerCarpetaPorId = async (req, res) => {
  const conexion = await db.getConnection();

  try {
    const carpetaId = Number(req.params.id);
    const claveCache = `carpeta_${carpetaId}`;
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);

    const [[carpeta]] = await conexion.query(
      `SELECT id, nombre, padreId, rutaVirtual, estado, creadoPor, creadoEn, actualizadoEn,
              enviadoPapeleraPor, enviadoPapeleraEn, borradoPor, borradoEn
         FROM carpetasArchivos
        WHERE id = ?`,
      [carpetaId],
    );

    if (!carpeta) {
      return res.status(404).json({ message: "Carpeta no encontrada." });
    }

    const respuesta = { carpeta };
    cacheMemoria.set(claveCache, respuesta, 180);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error obteniendo carpeta:", error);
    return res.status(500).json({ message: "Error obteniendo carpeta." });
  } finally {
    conexion.release();
  }
};

/**
 * PUT /carpetas/:id/renombrar
 * body: { nombre }
 */
export const renombrarCarpeta = async (req, res) => {
  const conexion = await db.getConnection();
  const usuarioId = req.user.id;

  try {
    const carpetaId = Number(req.params.id);
    const nombreNuevo = normalizarNombreCarpeta(req.body.nombre);

    if (!carpetaId || Number.isNaN(carpetaId)) {
      return res.status(400).json({ message: "ID de carpeta inválido." });
    }

    if (!nombreNuevo) {
      return res
        .status(400)
        .json({ message: "El nombre nuevo es obligatorio." });
    }

    await conexion.beginTransaction();

    const [[carpeta]] = await conexion.query(
      `SELECT id, nombre, padreId, rutaVirtual, estado
         FROM carpetasArchivos
        WHERE id = ? FOR UPDATE`,
      [carpetaId],
    );

    if (!carpeta) {
      await conexion.rollback();
      return res.status(404).json({ message: "Carpeta no encontrada." });
    }

    if (carpeta.estado !== "activa") {
      await conexion.rollback();
      return res
        .status(400)
        .json({ message: "Solo puedes renombrar carpetas activas." });
    }

    /**
     * ✅ VALIDACIÓN CLAVE:
     * Bloquear si la carpeta contiene archivos anclados a:
     * firmas, facturasGastos, comprobantesPagos, abonosCXC
     */
    const rutaVirtualActual = String(carpeta.rutaVirtual || "").trim();
    const prefijoRutaSinSlash = rutaVirtualActual
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");

    if (prefijoRutaSinSlash) {
      const [[anclado]] = await conexion.query(
        `
        SELECT 1 AS existe
          FROM archivos
         WHERE registroTipo IN ('firmas','facturasGastos','comprobantesPagos','abonosCXC')
           AND registroId IS NOT NULL
           AND (
             rutaS3 = ?
             OR rutaS3 LIKE CONCAT(?, '/%')
           )
         LIMIT 1
        `,
        [prefijoRutaSinSlash, prefijoRutaSinSlash],
      );

      if (anclado?.existe) {
        await conexion.rollback();
        return res.status(400).json({
          message:
            "No puedes renombrar esta carpeta porque contiene archivos anclados (firmas, facturas de gastos, comprobantes o abonos).",
        });
      }
    }

    // Validar duplicado en mismo padre
    const [duplicados] = await conexion.query(
      `SELECT id
         FROM carpetasArchivos
        WHERE padreId <=> ?
          AND nombre = ?
          AND estado <> 'borrado'
          AND id <> ?
        LIMIT 1`,
      [carpeta.padreId, nombreNuevo, carpetaId],
    );

    if (duplicados.length) {
      await conexion.rollback();
      return res.status(409).json({
        message: "Ya existe una carpeta con ese nombre en esa ubicación.",
      });
    }

    // Recalcular nueva rutaVirtual
    let rutaPadre = null;

    if (carpeta.padreId) {
      const [[padre]] = await conexion.query(
        `SELECT rutaVirtual, estado FROM carpetasArchivos WHERE id = ?`,
        [carpeta.padreId],
      );

      if (!padre || padre.estado !== "activa") {
        await conexion.rollback();
        return res
          .status(400)
          .json({ message: "La carpeta padre no es válida." });
      }

      rutaPadre = padre.rutaVirtual;
    }

    const rutaAntigua = carpeta.rutaVirtual;
    const rutaNueva = construirRutaVirtual(rutaPadre, nombreNuevo);

    // Actualiza nombre + rutas (subárbol completo)
    await conexion.query(
      `UPDATE carpetasArchivos
          SET nombre = ?,
              actualizadoEn = NOW()
        WHERE id = ?`,
      [nombreNuevo, carpetaId],
    );

    await actualizarRutaVirtualSubarbol(
      conexion,
      carpetaId,
      rutaAntigua,
      rutaNueva,
    );

    /**
     * ✅ Registrar evento (ip + userAgent)
     * Requiere: eventosArchivo.carpetaId y archivoId nullable + enum accion incluye 'renombrarCarpeta'
     */
    await conexion.query(
      `INSERT INTO eventosArchivo
         (archivoId, carpetaId, versionId, accion, creadoPor, ip, userAgent, detalles)
       VALUES (?, ?, ?, 'renombrarCarpeta', ?, ?, ?, ?)`,
      [
        null,
        carpetaId,
        null,
        usuarioId,
        req.ip,
        req.get("User-Agent"),
        JSON.stringify({
          nombreAnterior: carpeta.nombre,
          nombreNuevo,
          rutaAntigua,
          rutaNueva,
        }),
      ],
    );

    await conexion.commit();
    limpiarCacheCarpetas();
    return res.json({ message: "Carpeta renombrada.", rutaVirtual: rutaNueva });
  } catch (error) {
    await conexion.rollback();
    console.error("Error renombrando carpeta:", error);
    return res.status(500).json({ message: "Error renombrando carpeta." });
  } finally {
    conexion.release();
  }
};

/**
 * PUT /carpetas/:id/mover
 * body: { padreId }  (puede ser null para mover a raíz)
 */
export const moverCarpeta = async (req, res) => {
  const conexion = await db.getConnection();

  try {
    const carpetaId = Number(req.params.id);
    const padreIdNuevo = req.body.padreId ? Number(req.body.padreId) : null;

    await conexion.beginTransaction();

    const [[carpeta]] = await conexion.query(
      `SELECT id, nombre, padreId, rutaVirtual, estado
         FROM carpetasArchivos
        WHERE id = ? FOR UPDATE`,
      [carpetaId],
    );

    if (!carpeta) {
      await conexion.rollback();
      return res.status(404).json({ message: "Carpeta no encontrada." });
    }
    if (carpeta.estado !== "activa") {
      await conexion.rollback();
      return res
        .status(400)
        .json({ message: "Solo puedes mover carpetas activas." });
    }

    if (padreIdNuevo === carpetaId) {
      await conexion.rollback();
      return res
        .status(400)
        .json({ message: "Una carpeta no puede ser su propio padre." });
    }

    // Si viene padre nuevo, validar que exista y esté activo
    let rutaPadreNueva = null;
    if (padreIdNuevo) {
      const [[padreNuevo]] = await conexion.query(
        `SELECT id, rutaVirtual, estado
           FROM carpetasArchivos
          WHERE id = ? FOR UPDATE`,
        [padreIdNuevo],
      );

      if (!padreNuevo) {
        await conexion.rollback();
        return res
          .status(404)
          .json({ message: "La carpeta padre destino no existe." });
      }
      if (padreNuevo.estado !== "activa") {
        await conexion.rollback();
        return res.status(400).json({
          message: "No puedes mover a una carpeta en papelera/borrada.",
        });
      }

      // Evitar ciclos: no puedes mover dentro de tu propio subárbol
      const idsDescendientes = await obtenerIdsDescendientes(
        conexion,
        carpetaId,
      );
      if (idsDescendientes.includes(padreIdNuevo)) {
        await conexion.rollback();
        return res.status(400).json({
          message:
            "Movimiento inválido: no puedes mover una carpeta dentro de su propio subárbol.",
        });
      }

      rutaPadreNueva = padreNuevo.rutaVirtual;
    }

    // Validar duplicado nombre en destino
    const [duplicados] = await conexion.query(
      `SELECT id
         FROM carpetasArchivos
        WHERE padreId <=> ?
          AND nombre = ?
          AND estado <> 'borrado'
          AND id <> ?
        LIMIT 1`,
      [padreIdNuevo, carpeta.nombre, carpetaId],
    );
    if (duplicados.length) {
      await conexion.rollback();
      return res.status(409).json({
        message: "Ya existe una carpeta con ese nombre en la carpeta destino.",
      });
    }

    const rutaAntigua = carpeta.rutaVirtual;
    const rutaNueva = construirRutaVirtual(rutaPadreNueva, carpeta.nombre);

    await conexion.query(
      `UPDATE carpetasArchivos
          SET padreId = ?,
              actualizadoEn = NOW()
        WHERE id = ?`,
      [padreIdNuevo, carpetaId],
    );

    await actualizarRutaVirtualSubarbol(
      conexion,
      carpetaId,
      rutaAntigua,
      rutaNueva,
    );

    await conexion.commit();
    limpiarCacheCarpetas();
    return res.json({ message: "Carpeta movida.", rutaVirtual: rutaNueva });
  } catch (error) {
    await conexion.rollback();
    console.error("Error moviendo carpeta:", error);
    return res.status(500).json({ message: "Error moviendo carpeta." });
  } finally {
    conexion.release();
  }
};

/**
 * DELETE lógico => enviar a papelera
 * PUT /carpetas/:id/papelera
 *
 * Regla: solo cambia estado en BD (como base).
 * Luego, cuando integremos "archivos sin relación", aquí mismo haremos:
 *  - marcar archivos en esa carpeta como eliminado
 *  - mover objetos en S3 a prefijo papelera/
 */
export const enviarCarpetaAPapelera = async (req, res) => {
  const conexion = await db.getConnection();
  const usuarioId = req.user.id;

  try {
    const carpetaId = Number(req.params.id);

    await conexion.beginTransaction();

    const [[carpeta]] = await conexion.query(
      `SELECT id, estado
         FROM carpetasArchivos
        WHERE id = ? FOR UPDATE`,
      [carpetaId],
    );

    if (!carpeta) {
      await conexion.rollback();
      return res.status(404).json({ message: "Carpeta no encontrada." });
    }
    if (carpeta.estado !== "activa") {
      await conexion.rollback();
      return res.status(400).json({ message: "La carpeta no está activa." });
    }

    const idsSubarbol = await obtenerIdsDescendientes(conexion, carpetaId);

    await conexion.query(
      `UPDATE carpetasArchivos
          SET estado = 'papelera',
              enviadoPapeleraPor = ?,
              enviadoPapeleraEn = NOW()
        WHERE id IN (?)`,
      [usuarioId, idsSubarbol],
    );

    // NOTA: aquí luego agregamos el manejo de archivos (BD + S3) según tu flujo actual.

    await conexion.commit();
    limpiarCacheCarpetas();
    return res.json({ message: "Carpeta enviada a papelera." });
  } catch (error) {
    await conexion.rollback();
    console.error("Error enviando carpeta a papelera:", error);
    return res
      .status(500)
      .json({ message: "Error enviando carpeta a papelera." });
  } finally {
    conexion.release();
  }
};

/**
 * Restaurar desde papelera => activa
 * PUT /carpetas/:id/restaurar
 */
export const restaurarCarpeta = async (req, res) => {
  const conexion = await db.getConnection();

  try {
    const carpetaId = Number(req.params.id);

    await conexion.beginTransaction();

    const [[carpeta]] = await conexion.query(
      `SELECT id, nombre, padreId, rutaVirtual, estado
         FROM carpetasArchivos
        WHERE id = ? FOR UPDATE`,
      [carpetaId],
    );

    if (!carpeta) {
      await conexion.rollback();
      return res.status(404).json({ message: "Carpeta no encontrada." });
    }
    if (carpeta.estado !== "papelera") {
      await conexion.rollback();
      return res.status(400).json({
        message: "Solo puedes restaurar carpetas que estén en papelera.",
      });
    }

    // Validar que el padre (si existe) esté activo. Si no, restauramos en raíz.
    let padreIdFinal = carpeta.padreId;
    let rutaPadreFinal = null;

    if (padreIdFinal) {
      const [[padre]] = await conexion.query(
        `SELECT id, rutaVirtual, estado
           FROM carpetasArchivos
          WHERE id = ?`,
        [padreIdFinal],
      );

      if (!padre || padre.estado !== "activa") {
        padreIdFinal = null;
        rutaPadreFinal = null;
      } else {
        rutaPadreFinal = padre.rutaVirtual;
      }
    }

    const rutaNueva = construirRutaVirtual(rutaPadreFinal, carpeta.nombre);

    const idsSubarbol = await obtenerIdsDescendientes(conexion, carpetaId);

    await conexion.query(
      `UPDATE carpetasArchivos
          SET estado = 'activa',
              padreId = CASE WHEN id = ? THEN ? ELSE padreId END,
              enviadoPapeleraPor = NULL,
              enviadoPapeleraEn = NULL,
              actualizadoEn = NOW()
        WHERE id IN (?)`,
      [carpetaId, padreIdFinal, idsSubarbol],
    );

    // Si la carpeta cambió de padre, debemos recalcular rutas.
    // Para simplificar: recalculamos rutas del subárbol tomando como base la raíz.
    // (si padre quedó igual y ruta coincide, esto igual es seguro)
    await actualizarRutaVirtualSubarbol(
      conexion,
      carpetaId,
      carpeta.rutaVirtual,
      rutaNueva,
    );

    // NOTA: aquí luego agregamos restauración de archivos (BD + S3) cuando exista el vínculo.

    await conexion.commit();
    limpiarCacheCarpetas();
    return res.json({ message: "Carpeta restaurada.", rutaVirtual: rutaNueva });
  } catch (error) {
    await conexion.rollback();
    console.error("Error restaurando carpeta:", error);
    return res.status(500).json({ message: "Error restaurando carpeta." });
  } finally {
    conexion.release();
  }
};

/**
 * Borrado definitivo (solo desde papelera)
 * DELETE /carpetas/:id/borrado-definitivo
 *
 * Regla: BD + S3 para archivos. Para carpetas: marcamos como 'borrado'.
 * Aquí dejamos listo el control de permisos: admin/supervisor.
 */
export const borrarDefinitivoCarpeta = async (req, res) => {
  const conexion = await db.getConnection();
  const usuarioId = req.user.id;
  const rolId = req.user.rol_id;

  try {
    const carpetaId = Number(req.params.id);

    if (!esRolAdminOSupervisor(rolId)) {
      return res
        .status(403)
        .json({ message: "No tienes permisos para borrar definitivamente." });
    }

    await conexion.beginTransaction();

    const [[carpeta]] = await conexion.query(
      `SELECT id, estado
         FROM carpetasArchivos
        WHERE id = ? FOR UPDATE`,
      [carpetaId],
    );

    if (!carpeta) {
      await conexion.rollback();
      return res.status(404).json({ message: "Carpeta no encontrada." });
    }
    if (carpeta.estado !== "papelera") {
      await conexion.rollback();
      return res.status(400).json({
        message:
          "Solo puedes borrar definitivamente carpetas que estén en papelera.",
      });
    }

    const idsSubarbol = await obtenerIdsDescendientes(conexion, carpetaId);

    // 1) Aquí, cuando exista relación carpeta->archivos, se hace:
    //    - borrar en S3 los objetos de archivos
    //    - borrar/actualizar BD de archivos y versiones
    //    Por ahora: solo carpetas.

    await conexion.query(
      `UPDATE carpetasArchivos
          SET estado = 'borrado',
              borradoPor = ?,
              borradoEn = NOW()
        WHERE id IN (?)`,
      [usuarioId, idsSubarbol],
    );

    await conexion.commit();
    limpiarCacheCarpetas();
    return res.json({ message: "Carpeta borrada definitivamente." });
  } catch (error) {
    await conexion.rollback();
    console.error("Error borrando definitivamente carpeta:", error);
    return res
      .status(500)
      .json({ message: "Error borrando definitivamente carpeta." });
  } finally {
    conexion.release();
  }
};
