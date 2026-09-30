// controllers/clientes.controller.js
import db from "../config/database.js";
import cacheMemoria, {
  obtenerScopeSucursalCache,
  invalidarCachePorPrefijos,
} from "../utils/cacheMemoria.js";

export const verificarClienteExistente = async (req, res) => {
  const { nombre = "", email = "" } = req.query;

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

  const key = `verifCliente_${scopeSucursal}_${nombre.trim()}_${email.trim()}`;
  const hit = cacheMemoria.get(key);
  if (hit) return res.json(hit);

  if (!nombre.trim() && !email.trim()) {
    return res.status(400).json({
      error: "Se requiere al menos un nombre o email para la verificación",
    });
  }

  try {
    const conditions = [];
    const params = [];

    if (nombre.trim()) {
      conditions.push("nombre = ?");
      params.push(nombre.trim());
    }
    if (email.trim()) {
      conditions.push("email = ?");
      params.push(email.trim());
    }

    const [rows] = await db.execute(
      `SELECT nombre, email FROM clientes WHERE (${conditions.join(" OR ")})${whereSucursalSql}`,
      [...params, ...paramsSucursal],
    );

    const response = {
      exists: rows.length > 0,
      duplicateFields: {
        nombre: rows.some((r) => r.nombre === nombre.trim()),
        email: rows.some((r) => r.email === email.trim()),
      },
    };
    cacheMemoria.set(key, response, 60);
    return res.json(response);
  } catch (error) {
    console.error("Error al verificar cliente:", error);
    return res
      .status(500)
      .json({ message: "Error interno al verificar cliente" });
  }
};

export const crearCliente = async (req, res) => {
  const { nombre, email, telefono, direccion, sucursal_id, identificacion } =
    req.body;

  const scopeSucursal = obtenerScopeSucursalCache(req);
  if (!scopeSucursal) {
    return res
      .status(403)
      .json({ message: "Tu usuario no tiene sucursal asignada." });
  }

  const esAdmin = Number(req.user?.rol_id) === 1;

  if (
    ![nombre, email, telefono, direccion, identificacion].every((v) =>
      v?.trim(),
    )
  ) {
    return res.status(400).json({
      error: "Todos los campos son obligatorios",
      detalles: {
        nombre: !nombre?.trim() ? "Falta el nombre" : null,
        email: !email?.trim() ? "Falta el email" : null,
        telefono: !telefono?.trim() ? "Falta el teléfono" : null,
        direccion: !direccion?.trim() ? "Falta la dirección" : null,
        identificacion: !identificacion?.trim()
          ? "Falta la identificación"
          : null,
      },
    });
  }

  try {
    const [existing] = await db.execute(
      "SELECT id FROM clientes WHERE email = ? OR identificacion = ?",
      [email.trim(), identificacion.trim()],
    );
    if (existing.length) {
      return res.status(409).json({
        error: "Cliente ya registrado",
      });
    }

    const sucursalId = esAdmin
      ? sucursal_id
        ? parseInt(sucursal_id, 10)
        : 4
      : Number(scopeSucursal);

    const usuarioId = req.user.id;
    const [insert] = await db.execute(
      `INSERT INTO clientes
         (nombre, email, telefono, direccion, sucursal_id, identificacion, creadoPor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nombre.trim(),
        email.trim(),
        telefono.trim(),
        direccion.trim(),
        sucursalId,
        identificacion.trim(),
        usuarioId,
      ],
    );

    const clienteId = insert.insertId;
    const codigoReferencia = `CLI-${String(clienteId).padStart(4, "0")}`;
    await db.execute("UPDATE clientes SET codigo_referencia = ? WHERE id = ?", [
      codigoReferencia,
      clienteId,
    ]);

    invalidarCachePorPrefijos({
      prefijos: ["clientes_"],
      scopeSucursal: String(sucursalId),
    });

    const [[clienteCompleto]] = await db.execute(
      `SELECT c.id, c.codigo_referencia, c.nombre, c.email, c.telefono,
              c.direccion, c.identificacion, c.sucursal_id,
              s.nombre AS sucursal_nombre
         FROM clientes c
         LEFT JOIN sucursales s ON s.id = c.sucursal_id
        WHERE c.id = ?`,
      [clienteId],
    );

    return res.status(201).json(clienteCompleto);
  } catch (error) {
    console.error("Error en crearCliente:", error);
    return res.status(500).json({ message: "Error al crear el cliente" });
  }
};

export const obtenerClientes = async (req, res) => {
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

  const whereSucursalSql =
    esAdmin && scopeSucursal === "todas" ? "" : " WHERE sucursal_id = ?";
  const paramsSucursal =
    esAdmin && scopeSucursal === "todas" ? [] : [Number(scopeSucursal)];

  const claveCache = `clientes_${scopeSucursal}_${page}_${limit}`;
  const enCache = cacheMemoria.get(claveCache);
  if (enCache) return res.json(enCache);

  try {
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM clientes${whereSucursalSql}`,
      paramsSucursal,
    );

    const [clientes] = await db.query(
      `SELECT *
         FROM clientes${whereSucursalSql}
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      paramsSucursal,
    );

    const respuesta = { clientes, total, page, limit };
    cacheMemoria.set(claveCache, respuesta, 300);
    return res.json(respuesta);
  } catch (error) {
    console.error("Error al obtener clientes:", error);
    return res.status(500).json({ message: "Error al obtener los clientes" });
  }
};

export const actualizarCliente = async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "ID de cliente inválido" });
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

  const {
    nombre = "",
    email = "",
    telefono = "",
    direccion = "",
    identificacion = "",
    sucursal_id = null,
  } = req.body;

  if (
    ![nombre, email, telefono, direccion, identificacion].every((v) => v.trim())
  ) {
    return res.status(400).json({ error: "Todos los campos son obligatorios" });
  }

  try {
    const [[actual]] = await db.execute(
      `SELECT email, identificacion, sucursal_id
         FROM clientes
        WHERE id = ?${whereSucursalSql}`,
      [id, ...paramsSucursal],
    );
    if (!actual) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }

    const emailCambio =
      actual.email?.toLowerCase().trim() !== email.toLowerCase().trim();
    const identCambio =
      (actual.identificacion ?? "").trim() !== identificacion.trim();

    if (emailCambio || identCambio) {
      const conds = [];
      const params = [];

      if (emailCambio) {
        conds.push("email = ?");
        params.push(email.trim());
      }
      if (identCambio) {
        conds.push("identificacion = ?");
        params.push(identificacion.trim());
      }

      const [dup] = await db.execute(
        `SELECT id FROM clientes WHERE (${conds.join(" OR ")}) AND id <> ?`,
        [...params, id],
      );
      if (dup.length) {
        return res.status(409).json({ error: "Conflicto de datos únicos" });
      }
    }

    const sucursalIdFinal = esAdmin
      ? sucursal_id
        ? Number(sucursal_id)
        : null
      : Number(scopeSucursal);

    const usuarioId = req.user.id;
    const [result] = await db.execute(
      `UPDATE clientes
          SET nombre         = ?,
              email          = ?,
              telefono       = ?,
              direccion      = ?,
              identificacion = ?,
              sucursal_id    = ?,
              actualizadoPor = ?
        WHERE id = ?${whereSucursalSql}`,
      [
        nombre.trim(),
        email.trim(),
        telefono.trim(),
        direccion.trim(),
        identificacion.trim(),
        sucursalIdFinal,
        usuarioId,
        id,
        ...paramsSucursal,
      ],
    );

    const scopesAInvalidar = new Set();
    const sucursalAnterior = Number(actual.sucursal_id);
    if (!Number.isNaN(sucursalAnterior) && sucursalAnterior > 0) {
      scopesAInvalidar.add(String(sucursalAnterior));
    }
    if (!Number.isNaN(sucursalIdFinal) && sucursalIdFinal > 0) {
      scopesAInvalidar.add(String(sucursalIdFinal));
    }

    if (scopesAInvalidar.size === 0) {
      invalidarCachePorPrefijos({ prefijos: ["clientes_"] });
    } else {
      for (const scopeSucursalItem of scopesAInvalidar) {
        invalidarCachePorPrefijos({
          prefijos: ["clientes_"],
          scopeSucursal: scopeSucursalItem,
        });
      }
    }

    return res.json({
      message: result.affectedRows
        ? "Cliente actualizado correctamente"
        : "Sin cambios aplicados",
    });
  } catch (err) {
    console.error("Error al actualizar cliente:", err);
    return res
      .status(500)
      .json({ message: "Error interno al actualizar cliente" });
  }
};

export const eliminarCliente = async (req, res) => {
  const clienteId = Number(req.params.id);

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
    const [[clienteActual]] = await db.execute(
      `SELECT sucursal_id FROM clientes WHERE id = ?${whereSucursalSql}`,
      [clienteId, ...paramsSucursal],
    );

    if (!clienteActual) {
      return res.status(404).json({ message: "Cliente no encontrado." });
    }

    const [[{ cuentaPendiente }]] = await db.execute(
      `SELECT COUNT(*) AS cuentaPendiente
         FROM cuentas_por_cobrar
        WHERE cliente_id = ? AND estado = 'pendiente'`,
      [clienteId],
    );

    if (cuentaPendiente > 0) {
      return res.status(400).json({
        error:
          "No se puede eliminar: el cliente tiene cuentas por cobrar pendientes.",
      });
    }

    const [[{ cotizacionPendiente }]] = await db.execute(
      `SELECT COUNT(*) AS cotizacionPendiente
         FROM cotizaciones
        WHERE cliente_id = ? AND estado = 'pendiente'`,
      [clienteId],
    );

    if (cotizacionPendiente > 0) {
      return res.status(400).json({
        error:
          "No se puede eliminar: el cliente tiene cotizaciones en proceso.",
      });
    }

    const [result] = await db.execute(
      `DELETE FROM clientes WHERE id = ?${whereSucursalSql}`,
      [clienteId, ...paramsSucursal],
    );

    const scopeInvalidar =
      !Number.isNaN(Number(clienteActual.sucursal_id)) &&
      Number(clienteActual.sucursal_id) > 0
        ? String(Number(clienteActual.sucursal_id))
        : null;

    invalidarCachePorPrefijos({
      prefijos: ["clientes_"],
      scopeSucursal: scopeInvalidar,
    });

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Cliente no encontrado." });
    }

    return res.status(204).end();
  } catch (error) {
    if (error.errno === 1451) {
      return res.status(409).json({
        error: "No se puede eliminar: el cliente tiene registros asociados.",
      });
    }
    console.error("Error al eliminar cliente:", error);
    return res
      .status(500)
      .json({ message: "Error interno al eliminar el cliente." });
  }
};
