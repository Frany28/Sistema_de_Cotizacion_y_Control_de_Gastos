// controllers/usuarios.controller.js
import db from "../config/database.js";
import bcrypt from "bcrypt";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  s3,
  generarUrlPrefirmadaLectura,
  moverArchivoAPapelera,
} from "../utils/s3.js";
import { obtenerOcrearGrupoFirma } from "../utils/gruposArchivos.js";
import cacheMemoria, {
  invalidarCachePorPrefijos,
} from "../utils/cacheMemoria.js";

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const limpiarCacheUsuarios = () =>
  invalidarCachePorPrefijos({
    prefijos: ["usuarios_", "perfil_", "archivos_"],
  });

const obtenerContextoAcceso = (req) => {
  const rolId = Number(req.user?.rolId ?? req.user?.rol_id);
  const sucursalIdRaw = req.user?.sucursalId ?? req.user?.sucursal_id;
  const sucursalId =
    sucursalIdRaw === null ||
    sucursalIdRaw === undefined ||
    sucursalIdRaw === ""
      ? null
      : Number(sucursalIdRaw);

  return {
    rolId,
    sucursalId,
    esAdmin: rolId === 1,
  };
};

const validarSucursalRequerida = (contexto) => {
  if (!contexto.esAdmin && !contexto.sucursalId) {
    const error = new Error("Tu usuario no tiene sucursal asignada.");
    error.statusCode = 403;
    throw error;
  }
};

const validarAccesoMismaSucursal = (contexto, sucursalIdDelRegistro) => {
  if (contexto.esAdmin) return;

  validarSucursalRequerida(contexto);

  if (Number(sucursalIdDelRegistro) !== Number(contexto.sucursalId)) {
    const error = new Error("No tienes acceso a este registro.");
    error.statusCode = 403;
    throw error;
  }
};

/*─────────────────────────────────────────────────────────────
  Crear usuario (y firma opcional en `firmas/`)
─────────────────────────────────────────────────────────────*/
export const crearUsuario = async (req, res) => {
  const conexion = await db.getConnection();
  let firmaKeyNueva = null;

  try {
    await conexion.beginTransaction();

    const contexto = obtenerContextoAcceso(req);

    // ── Entradas base
    const nombre = (req.body?.nombre || "").trim();
    const email = (req.body?.email || "").trim();
    const passwordPlano = req.body?.password || "";
    const rolIdBody = req.body?.rol_id;
    const estado = (req.body?.estado || "activo").trim();

    // ✅ sucursal del body (solo admin decide esto)
    const sucursalIdBody =
      req.body?.sucursal_id === null ||
      String(req.body?.sucursal_id || "").toLowerCase() === "null" ||
      String(req.body?.sucursal_id || "").trim() === ""
        ? null
        : Number(req.body?.sucursal_id);

    // Campos opcionales
    const numero = (req.body?.numero ?? "").toString().trim();
    const telefono = (req.body?.telefono ?? "").toString().trim();

    // Datos de archivo (firma opcional)
    const firmaKey = req.file?.key ?? null;
    const nombreOriginal = req.file?.originalname ?? null;
    const extension = nombreOriginal?.split(".").pop() ?? null;
    const tamanioBytes = req.file?.size ?? null;

    const errores = [];

    if (!nombre) errores.push("El nombre es requerido.");
    if (!email) errores.push("El email es requerido.");
    else if (!EMAIL_REGEX.test(email))
      errores.push("El email no tiene un formato válido.");
    if (!passwordPlano) errores.push("La contraseña es requerida.");
    else if (passwordPlano.length < 6)
      errores.push("La contraseña debe tener al menos 6 caracteres.");
    if (!rolIdBody) errores.push("El rol es requerido.");

    if (errores.length) {
      await conexion.rollback();
      return res.status(400).json({ message: "Error de validación.", errores });
    }

    const rolIdNuevo = Number(rolIdBody);

    // ✅ Reglas de negocio por sucursal/rol
    if (!contexto.esAdmin) {
      // No-admin: debe tener sucursal y no puede crear admin
      validarSucursalRequerida(contexto);

      if (rolIdNuevo === 1) {
        await conexion.rollback();
        return res.status(403).json({
          message: "No tienes permiso para crear un usuario administrador.",
        });
      }
    }

    // ✅ Sucursal final
    // Regla: TODO usuario NO-admin debe tener sucursal.
    // Excepción: admin (rol_id=1) SIEMPRE va con sucursal_id = NULL.
    let sucursalIdFinal = null;

    if (rolIdNuevo === 1) {
      // Admin: NO se vincula a sucursal
      sucursalIdFinal = null;
    } else if (contexto.esAdmin) {
      // Admin creando usuario NO-admin: debe indicar sucursal
      if (!sucursalIdBody) {
        await conexion.rollback();
        return res.status(400).json({
          message: "Debe asignarse sucursal_id al crear un usuario no admin.",
        });
      }

      const [[sucursalValida]] = await conexion.query(
        `SELECT id
           FROM sucursales
          WHERE id = ? AND estado = 'activo'
          LIMIT 1`,
        [Number(sucursalIdBody)],
      );

      if (!sucursalValida) {
        await conexion.rollback();
        return res.status(400).json({
          message: "La sucursal indicada no existe o está inactiva.",
        });
      }

      sucursalIdFinal = Number(sucursalIdBody);
    } else {
      // No-admin: se fuerza su sucursal (ignora body)
      sucursalIdFinal = Number(contexto.sucursalId);

      const [[sucursalValida]] = await conexion.query(
        `SELECT id
           FROM sucursales
          WHERE id = ? AND estado = 'activo'
          LIMIT 1`,
        [sucursalIdFinal],
      );

      if (!sucursalValida) {
        await conexion.rollback();
        return res.status(403).json({
          message: "Tu sucursal no existe o está inactiva.",
        });
      }
    }

    // ── Duplicados básicos
    const [[dupNombre]] = await conexion.query(
      `SELECT id FROM usuarios WHERE LOWER(nombre) = LOWER(?) LIMIT 1`,
      [nombre],
    );
    if (dupNombre) {
      await conexion.rollback();
      return res
        .status(409)
        .json({ message: "Ya existe un usuario con ese nombre." });
    }

    const [[dupEmail]] = await conexion.query(
      `SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email],
    );
    if (dupEmail) {
      await conexion.rollback();
      return res
        .status(409)
        .json({ message: "Ya existe un usuario con ese email." });
    }

    // Opcionales
    if (numero) {
      const [[dupNumero]] = await conexion.query(
        `SELECT id FROM usuarios WHERE numero = ? LIMIT 1`,
        [numero],
      );
      if (dupNumero) {
        await conexion.rollback();
        return res
          .status(409)
          .json({ message: "Ya existe un usuario con ese número." });
      }
    }

    if (telefono) {
      const [[dupTelefono]] = await conexion.query(
        `SELECT id FROM usuarios WHERE telefono = ? LIMIT 1`,
        [telefono],
      );
      if (dupTelefono) {
        await conexion.rollback();
        return res
          .status(409)
          .json({ message: "Ya existe un usuario con ese teléfono." });
      }
    }

    // ── Hash password
    const passwordHash = await bcrypt.hash(passwordPlano, 10);

    // ── Insert usuario (✅ incluye sucursal_id)
    const usuarioCreadorId = req.user?.id ?? null;

    const [resInsert] = await conexion.query(
      `INSERT INTO usuarios
         (nombre, email, password, rol_id, sucursal_id, estado, creadoPor, actualizadoPor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nombre,
        email,
        passwordHash,
        rolIdNuevo,
        sucursalIdFinal,
        estado,
        usuarioCreadorId,
        usuarioCreadorId,
      ],
    );

    const nuevoUsuarioId = resInsert.insertId;

    // ── Firma opcional: crear registro en archivos/versiones/eventos
    if (firmaKey) {
      firmaKeyNueva = firmaKey;

      const grupoArchivoId = await obtenerOcrearGrupoFirma(
        conexion,
        nuevoUsuarioId,
        usuarioCreadorId,
      );

      const [resArchivo] = await conexion.query(
        `INSERT INTO archivos
           (registroTipo, registroId, grupoArchivoId,
            nombreOriginal, extension, tamanioBytes,
            rutaS3, numeroVersion, estado,
            subidoPor, creadoEn, actualizadoEn)
         VALUES ('firmas', ?, ?, ?, ?, ?, ?, 1, 'activo', ?, NOW(), NOW())`,
        [
          nuevoUsuarioId,
          grupoArchivoId,
          nombreOriginal,
          extension,
          tamanioBytes,
          firmaKey,
          usuarioCreadorId,
        ],
      );

      const archivoId = resArchivo.insertId;

      await conexion.query(
        `INSERT INTO versionesArchivo
           (archivoId, numeroVersion, nombreOriginal, extension,
            tamanioBytes, rutaS3, subidoPor, creadoEn)
         VALUES (?, 1, ?, ?, ?, ?, ?, NOW())`,
        [
          archivoId,
          nombreOriginal,
          extension,
          tamanioBytes,
          firmaKey,
          usuarioCreadorId,
        ],
      );

      await conexion.query(
        `INSERT INTO eventosArchivo
           (archivoId, accion, creadoPor, fechaHora, ip, userAgent, detalles)
         VALUES (?, 'subidaArchivo', ?, NOW(), ?, ?, ?)`,
        [
          archivoId,
          usuarioCreadorId,
          req.ip,
          req.get("user-agent"),
          JSON.stringify({ ruta: firmaKey, nombre: nombreOriginal, extension }),
        ],
      );

      // aumentar usoStorageBytes del nuevo usuario
      await conexion.query(
        `UPDATE usuarios SET usoStorageBytes = usoStorageBytes + ? WHERE id = ?`,
        [tamanioBytes, nuevoUsuarioId],
      );
    }

    await conexion.commit();
    limpiarCacheUsuarios();
    return res
      .status(201)
      .json({ id: nuevoUsuarioId, firma: firmaKey || null });
  } catch (error) {
    await conexion.rollback();

    // Limpieza S3 si se subió firma y luego falló
    if (firmaKeyNueva) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: firmaKeyNueva,
          }),
        );
      } catch (e) {
        console.error("Error borrando firma tras rollback:", e);
      }
    }

    const status = error?.statusCode || 500;
    console.error("Error al crear usuario:", error);
    return res
      .status(status)
      .json({ error: error.message || "Error al crear usuario" });
  } finally {
    conexion.release();
  }
};

/*─────────────────────────────────────────────────────────────
  Actualizar usuario (incluye reemplazo de firma) + sucursales
─────────────────────────────────────────────────────────────*/
export const actualizarUsuario = async (req, res) => {
  const conexion = await db.getConnection();
  let firmaKeyNueva = null;

  try {
    await conexion.beginTransaction();

    const { id } = req.params;

    const { nombre, email, password, rol_id, estado, cuotaMb, sucursal_id } =
      req.body;

    // Datos de archivo (si viene nueva firma)
    const firmaKey = req.file?.key ?? null;
    const nombreOriginal = req.file?.originalname ?? null;
    const extension = nombreOriginal?.split(".").pop() ?? null;
    const tamanioBytes = req.file?.size ?? null;

    const contexto = obtenerContextoAcceso(req);

    // ✅ Verificar usuario a editar (traer también sucursal_id)
    const [[filaUsuario]] = await conexion.query(
      `SELECT id, password, rol_id, sucursal_id, cuotaMb, usoStorageBytes
         FROM usuarios
        WHERE id = ?`,
      [id],
    );

    if (!filaUsuario) {
      await conexion.rollback();
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // ✅ Validación por sucursal (solo admin puede cross-sucursal)
    validarAccesoMismaSucursal(contexto, filaUsuario.sucursal_id);

    // ─────────────────────────────────────────────
    // Validaciones base
    // ─────────────────────────────────────────────
    if (email !== undefined) {
      if (!String(email).trim() || !EMAIL_REGEX.test(String(email).trim())) {
        await conexion.rollback();
        return res
          .status(400)
          .json({ message: "El email tiene un formato inválido" });
      }
    }

    if (password !== undefined) {
      if (String(password).length < 6) {
        await conexion.rollback();
        return res
          .status(400)
          .json({ message: "La contraseña debe tener al menos 6 caracteres" });
      }

      const coincide = await bcrypt.compare(password, filaUsuario.password);
      if (coincide) {
        await conexion.rollback();
        return res.status(400).json({
          message: "La nueva contraseña debe ser diferente a la actual.",
        });
      }
    }

    if (rol_id !== undefined && !rol_id) {
      await conexion.rollback();
      return res
        .status(400)
        .json({ message: "Si envías rol_id, debe ser un valor válido" });
    }

    // 🚫 No-admin no puede asignar rol administrador
    if (!contexto.esAdmin && rol_id !== undefined && Number(rol_id) === 1) {
      await conexion.rollback();
      return res.status(403).json({
        message: "No tienes permiso para asignar el rol de administrador.",
      });
    }

    // ─────────────────────────────────────────────
    // Cuota (MB)
    // ─────────────────────────────────────────────
    let cuotaMbNormalizada = undefined;

    const rolIdFinal =
      rol_id !== undefined ? Number(rol_id) : Number(filaUsuario.rol_id);

    // Normalizar sucursal_id del body (si viene)
    const sucursalIdBodyNormalizada =
      sucursal_id === undefined
        ? undefined
        : sucursal_id === null ||
            String(sucursal_id).toLowerCase() === "null" ||
            String(sucursal_id).trim() === ""
          ? null
          : Number(sucursal_id);

    if (cuotaMb !== undefined) {
      const texto = cuotaMb === null ? null : String(cuotaMb).trim();

      if (texto === "") {
        cuotaMbNormalizada = undefined;
      } else if (
        String(texto).toLowerCase() === "null" ||
        String(texto).toLowerCase() === "ilimitado"
      ) {
        cuotaMbNormalizada = null;
      } else {
        const numero = Number(texto);
        const esValido = Number.isFinite(numero) && numero >= 0;

        if (!esValido) {
          await conexion.rollback();
          return res.status(400).json({
            message: "La cuota debe ser un número >= 0 o 'ilimitado'.",
          });
        }
        cuotaMbNormalizada = numero;
      }
    }

    // Admin siempre ilimitado
    if (rolIdFinal === 1) cuotaMbNormalizada = null;

    // No bajar cuota por debajo del uso actual
    if (cuotaMbNormalizada !== undefined && cuotaMbNormalizada !== null) {
      const cuotaBytes = Number(cuotaMbNormalizada) * 1024 * 1024;
      const usoActualBytes = Number(filaUsuario.usoStorageBytes || 0);
      if (usoActualBytes > cuotaBytes) {
        await conexion.rollback();
        return res.status(400).json({
          message:
            "La cuota no puede ser menor al almacenamiento ya usado por el usuario.",
        });
      }
    }

    // ─────────────────────────────────────────────
    // Build de actualización dinámica
    // ─────────────────────────────────────────────
    const campos = [];
    const valores = [];

    if (nombre !== undefined) {
      campos.push("nombre = ?");
      valores.push(String(nombre).trim());
    }

    if (email !== undefined) {
      campos.push("email = ?");
      valores.push(String(email).trim());
    }

    if (password !== undefined) {
      const nuevoHash = await bcrypt.hash(password, 10);
      campos.push("password = ?");
      valores.push(nuevoHash);
    }

    if (rol_id !== undefined) {
      campos.push("rol_id = ?");
      valores.push(Number(rol_id));
    }

    if (estado !== undefined) {
      campos.push("estado = ?");
      valores.push(estado);
    }

    if (cuotaMbNormalizada !== undefined) {
      campos.push("cuotaMb = ?");
      valores.push(cuotaMbNormalizada);
    }

    if (firmaKey) {
      campos.push("firma = ?");
      valores.push(firmaKey);
      firmaKeyNueva = firmaKey;
    }

    // ✅ Regla por rol:
    // - Admin (rol_id=1): sucursal_id SIEMPRE NULL
    // - No-admin: sucursal_id OBLIGATORIA
    if (rolIdFinal === 1) {
      // Si va a ser admin, se limpia sucursal sí o sí
      campos.push("sucursal_id = ?");
      valores.push(null);
    } else {
      // Si NO es admin, debe quedar con sucursal
      if (contexto.esAdmin) {
        // Admin puede asignar / cambiar sucursal
        let sucursalIdParaGuardar = filaUsuario.sucursal_id;

        if (sucursalIdBodyNormalizada !== undefined) {
          sucursalIdParaGuardar = sucursalIdBodyNormalizada;
        }

        if (!sucursalIdParaGuardar) {
          await conexion.rollback();
          return res.status(400).json({
            message:
              "Debe asignarse sucursal_id para usuarios que no sean admin.",
          });
        }

        const [[sucursalValida]] = await conexion.query(
          `SELECT id
             FROM sucursales
            WHERE id = ? AND estado = 'activo'
            LIMIT 1`,
          [Number(sucursalIdParaGuardar)],
        );

        if (!sucursalValida) {
          await conexion.rollback();
          return res.status(400).json({
            message: "La sucursal indicada no existe o está inactiva.",
          });
        }

        // Solo setear en UPDATE si:
        // - vino en body, o
        // - el usuario estaba sin sucursal (p.ej. era admin y lo pasan a no-admin)
        if (
          sucursalIdBodyNormalizada !== undefined ||
          !filaUsuario.sucursal_id
        ) {
          campos.push("sucursal_id = ?");
          valores.push(Number(sucursalIdParaGuardar));
        }
      } else {
        // No-admin: no puede tocar sucursal
        if (sucursalIdBodyNormalizada !== undefined) {
          await conexion.rollback();
          return res.status(403).json({
            message: "No tienes permiso para cambiar la sucursal.",
          });
        }
      }
    }

    if (campos.length === 0) {
      await conexion.rollback();
      return res
        .status(400)
        .json({ message: "No se enviaron campos para actualizar." });
    }

    campos.push("actualizadoPor = ?");
    valores.push(req.user.id);
    valores.push(id);

    await conexion.query(
      `UPDATE usuarios SET ${campos.join(", ")} WHERE id = ?`,
      valores,
    );

    // ─────────────────────────────────────────────
    // Nueva firma: archivos/versiones/eventos + papelera + usoStorage
    // ─────────────────────────────────────────────
    if (firmaKey) {
      const grupoArchivoId = await obtenerOcrearGrupoFirma(
        conexion,
        id,
        req.user.id,
      );

      const [[{ maxVer }]] = await conexion.query(
        `SELECT IFNULL(MAX(numeroVersion),0) AS maxVer
           FROM archivos
          WHERE registroTipo='firmas' AND registroId = ?`,
        [id],
      );
      const numeroVersion = (maxVer || 0) + 1;

      const [resArchivo] = await conexion.query(
        `INSERT INTO archivos
           (registroTipo, registroId, grupoArchivoId,
            nombreOriginal, extension, tamanioBytes,
            rutaS3, numeroVersion, estado,
            subidoPor, creadoEn, actualizadoEn)
         VALUES ('firmas', ?, ?, ?, ?, ?, ?, ?, 'activo', ?, NOW(), NOW())`,
        [
          id,
          grupoArchivoId,
          nombreOriginal,
          extension,
          tamanioBytes,
          firmaKey,
          numeroVersion,
          req.user.id,
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
          nombreOriginal,
          extension,
          tamanioBytes,
          firmaKey,
          req.user.id,
        ],
      );

      await conexion.query(
        `INSERT INTO eventosArchivo
           (archivoId, accion, creadoPor, fechaHora, ip, userAgent, detalles)
         VALUES (?, 'sustitucionArchivo', ?, NOW(), ?, ?, ?)`,
        [
          archivoId,
          req.user.id,
          req.ip,
          req.get("user-agent"),
          JSON.stringify({ ruta: firmaKey, nombre: nombreOriginal, extension }),
        ],
      );

      const [anteriorActiva] = await conexion.query(
        `SELECT id, rutaS3
           FROM archivos
          WHERE registroTipo='firmas'
            AND registroId = ?
            AND estado = 'activo'
            AND id <> ?
          ORDER BY numeroVersion DESC
          LIMIT 1`,
        [id, archivoId],
      );

      if (anteriorActiva.length) {
        const archivoAnteriorId = anteriorActiva[0].id;
        const rutaAnterior = anteriorActiva[0].rutaS3;

        const nuevaRutaPapelera = await moverArchivoAPapelera(rutaAnterior);

        await conexion.query(
          `UPDATE archivos SET estado='reemplazado', rutaS3=? WHERE id=?`,
          [nuevaRutaPapelera, archivoAnteriorId],
        );

        await conexion.query(
          `INSERT INTO eventosArchivo
             (archivoId, accion, creadoPor, fechaHora, ip, userAgent, detalles)
           VALUES (?, 'eliminacionArchivo', ?, NOW(), ?, ?, ?)`,
          [
            archivoAnteriorId,
            req.user.id,
            req.ip,
            req.get("user-agent"),
            JSON.stringify({
              motivo: "Sustitución de firma",
              nuevaRuta: nuevaRutaPapelera,
            }),
          ],
        );
      }

      await conexion.query(
        `UPDATE usuarios SET usoStorageBytes = usoStorageBytes + ? WHERE id = ?`,
        [tamanioBytes, id],
      );
    }

    await conexion.commit();
    limpiarCacheUsuarios();
    return res.json({ id, firma: firmaKey || null });
  } catch (error) {
    await conexion.rollback();

    if (firmaKeyNueva) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: firmaKeyNueva,
          }),
        );
      } catch (e) {
        console.error("Error borrando firma tras fallo:", e);
      }
    }

    const status = error?.statusCode || 500;
    console.error("Error al actualizar usuario:", error);
    return res
      .status(status)
      .json({ error: error.message || "Error al actualizar usuario" });
  } finally {
    conexion.release();
  }
};

/*─────────────────────────────────────────────────────────────
  Listado de usuarios (filtrado por sucursal)
─────────────────────────────────────────────────────────────*/
export const obtenerUsuarios = async (req, res) => {
  try {
    const contexto = obtenerContextoAcceso(req);
    validarSucursalRequerida(contexto); // solo bloquea si no-admin sin sucursal

    const whereSucursal = contexto.esAdmin ? "" : "WHERE u.sucursal_id = ?";
    const params = contexto.esAdmin ? [] : [contexto.sucursalId];
    const scope = contexto.esAdmin ? "todas" : String(contexto.sucursalId);
    const claveCache = `usuarios_${scope}`;
    const hit = cacheMemoria.get(claveCache);
    if (hit) return res.json(hit);

    const [filasUsuarios] = await db.query(
      `
      SELECT
        u.id,
        u.codigo,
        u.nombre,
        u.email,
        u.estado,
        u.cuotaMb,
        u.usoStorageBytes,
        u.sucursal_id AS sucursalId,
        s.codigo      AS sucursalCodigo,
        s.nombre      AS sucursalNombre,
        u.fechaCreacion      AS fechaCreacion,
        u.fechaActualizacion AS fechaActualizacion,
        u.creadoPor,
        u.actualizadoPor,
        r.nombre             AS rol
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      LEFT JOIN sucursales s ON s.id = u.sucursal_id
      ${whereSucursal}
      ORDER BY u.id DESC
      `,
      params,
    );

    cacheMemoria.set(claveCache, filasUsuarios, 180);
    return res.json(filasUsuarios);
  } catch (error) {
    const status = error?.statusCode || 500;
    console.error("Error al obtener usuarios:", error);
    return res
      .status(status)
      .json({ message: error.message || "Error al obtener usuarios" });
  }
};

/*─────────────────────────────────────────────────────────────
  Detalle de usuario (incluye URL prefirmada de firma activa)
─────────────────────────────────────────────────────────────*/
export const obtenerUsuarioPorId = async (req, res) => {
  const { id } = req.params;

  try {
    const contexto = obtenerContextoAcceso(req);
    validarSucursalRequerida(contexto);

    const [[usuario]] = await db.query(
      `
      SELECT
        u.id,
        u.codigo,
        u.nombre,
        u.email,
        u.estado,
        u.rol_id               AS rolId,
        r.nombre               AS rol,
        u.cuotaMb              AS cuotaMb,
        u.usoStorageBytes      AS usoStorageBytes,
        u.sucursal_id          AS sucursalId,
        u.fechaCreacion        AS fechaCreacion,
        u.fechaActualizacion   AS fechaActualizacion
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      WHERE u.id = ?
      `,
      [id],
    );

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // ✅ Validación por sucursal
    validarAccesoMismaSucursal(contexto, usuario.sucursalId);

    // Firma activa
    const [archivos] = await db.query(
      `
      SELECT rutaS3
      FROM archivos
      WHERE registroTipo = 'firmas'
        AND registroId   = ?
        AND estado       = 'activo'
      ORDER BY id DESC
      LIMIT 1
      `,
      [id],
    );

    const urlFirma = archivos.length
      ? await generarUrlPrefirmadaLectura(archivos[0].rutaS3)
      : null;

    // ✅ FIX: spread correcto
    return res.json({ ...usuario, urlFirma });
  } catch (error) {
    const status = error?.statusCode || 500;
    console.error("Error al obtener usuario por ID:", error);
    return res
      .status(status)
      .json({ message: error.message || "Error al obtener usuario" });
  }
};

/*─────────────────────────────────────────────────────────────
  Eliminar usuario (mover firmas a papelera + auditoría) + sucursal
─────────────────────────────────────────────────────────────*/
export const eliminarUsuario = async (req, res) => {
  const { id } = req.params;
  const conexion = await db.getConnection();

  try {
    await conexion.beginTransaction();

    const contexto = obtenerContextoAcceso(req);
    validarSucursalRequerida(contexto);

    const [[usuario]] = await conexion.query(
      `SELECT id, sucursal_id FROM usuarios WHERE id = ?`,
      [id],
    );

    if (!usuario) {
      await conexion.rollback();
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // ✅ Validación por sucursal
    validarAccesoMismaSucursal(contexto, usuario.sucursal_id);

    const [archivosFirma] = await conexion.query(
      `SELECT id, rutaS3 FROM archivos WHERE registroTipo='firmas' AND registroId = ?`,
      [id],
    );

    for (const archivo of archivosFirma) {
      const nuevaRutaPapelera = await moverArchivoAPapelera(archivo.rutaS3);

      await conexion.query(
        `UPDATE archivos
            SET estado='papelera',
                rutaS3=?
          WHERE id=?`,
        [nuevaRutaPapelera, archivo.id],
      );

      await conexion.query(
        `INSERT INTO eventosArchivo
           (archivoId, accion, creadoPor, fechaHora, ip, userAgent, detalles)
         VALUES (?, 'eliminacionArchivo', ?, NOW(), ?, ?, ?)`,
        [
          archivo.id,
          req.user?.id || null,
          req.ip || null,
          req.get("user-agent") || null,
          JSON.stringify({
            motivo: "Eliminación de usuario",
            nuevaRuta: nuevaRutaPapelera,
          }),
        ],
      );
    }

    await conexion.query(`DELETE FROM usuarios WHERE id = ?`, [id]);

    await conexion.commit();
    limpiarCacheUsuarios();
    return res.json({
      message: "Usuario eliminado y firmas movidas a papelera correctamente.",
    });
  } catch (error) {
    await conexion.rollback();
    const status = error?.statusCode || 500;
    console.error("Error al eliminar usuario:", error);
    return res.status(status).json({
      message: error.message || "Error interno al eliminar usuario.",
    });
  } finally {
    conexion.release();
  }
};
