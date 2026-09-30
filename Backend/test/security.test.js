import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { requerirAdministrador } from "../src/Middleware/requerirAdministrador.js";
import { limitarGeneracionPdf } from "../src/Middleware/limitesSeguridad.js";
import { validarContenidoArchivo } from "../src/Middleware/validarContenidoArchivo.js";
import { sanitizarDatosPdf } from "../src/utils/seguridadPdf.js";
import { generarHTMLCotizacion } from "../templates/generarHTMLCotizacion.js";

const crearRespuesta = () => {
  const respuesta = new EventEmitter();
  respuesta.statusCode = 200;
  respuesta.headers = {};
  respuesta.set = (clave, valor) => {
    respuesta.headers[clave] = valor;
    return respuesta;
  };
  respuesta.status = (status) => {
    respuesta.statusCode = status;
    return respuesta;
  };
  respuesta.json = (body) => {
    respuesta.body = body;
    return respuesta;
  };
  return respuesta;
};

test("las rutas administrativas rechazan roles no administradores", () => {
  const res = crearRespuesta();
  let siguiente = false;

  requerirAdministrador({ user: { rol_id: 2 } }, res, () => {
    siguiente = true;
  });

  assert.equal(res.statusCode, 403);
  assert.equal(siguiente, false);
});

test("el administrador supera el control administrativo", () => {
  const res = crearRespuesta();
  let siguiente = false;

  requerirAdministrador({ user: { rol_id: 1 } }, res, () => {
    siguiente = true;
  });

  assert.equal(siguiente, true);
});

test("los datos del PDF no pueden inyectar etiquetas HTML", () => {
  const datos = sanitizarDatosPdf({
    cliente: "<script src=x></script>",
    observaciones: "<img src=http://127.0.0.1>",
  });
  const html = generarHTMLCotizacion(datos, "preview");

  assert.doesNotMatch(html, /<script src=x>/);
  assert.doesNotMatch(html, /<img src=http:\/\/127\.0\.0\.1>/);
  assert.match(html, /&lt;script/);
});

test("solo se permiten dos generadores PDF concurrentes", () => {
  const respuestas = [crearRespuesta(), crearRespuesta(), crearRespuesta()];
  let iniciados = 0;

  limitarGeneracionPdf({}, respuestas[0], () => {
    iniciados += 1;
  });
  limitarGeneracionPdf({}, respuestas[1], () => {
    iniciados += 1;
  });
  limitarGeneracionPdf({}, respuestas[2], () => {
    iniciados += 1;
  });

  assert.equal(iniciados, 2);
  assert.equal(respuestas[2].statusCode, 429);

  respuestas[0].emit("finish");
  respuestas[1].emit("finish");
});

test("se rechaza un archivo cuya firma binaria no coincide", async () => {
  const res = crearRespuesta();
  let siguiente = false;

  await validarContenidoArchivo(
    {
      file: {
        mimetype: "image/png",
        buffer: Buffer.from("<html>contenido falso</html>"),
      },
    },
    res,
    () => {
      siguiente = true;
    },
  );

  assert.equal(res.statusCode, 400);
  assert.equal(siguiente, false);
});

test("se acepta un archivo con firma binaria valida", async () => {
  const res = crearRespuesta();
  let siguiente = false;

  await validarContenidoArchivo(
    {
      file: {
        mimetype: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\n"),
      },
    },
    res,
    () => {
      siguiente = true;
    },
  );

  assert.equal(siguiente, true);
});

test("roles y permisos comienzan con autenticacion de administrador", async () => {
  const [{ default: roles }, { default: permisos }, { default: rolesPermisos }] =
    await Promise.all([
      import("../src/routes/roles.routes.js"),
      import("../src/routes/permisos.routes.js"),
      import("../src/routes/rolesPermisos.routes.js"),
    ]);

  for (const router of [roles, permisos, rolesPermisos]) {
    assert.equal(router.stack[0].handle.name, "autenticarUsuario");
    assert.equal(router.stack[1].handle.name, "requerirAdministrador");
  }
});

test("inventario y PDFs sensibles exigen autenticacion", async () => {
  const [
    { default: servicios },
    { default: cotizaciones },
    { default: solicitudes },
  ] = await Promise.all([
    import("../src/routes/servicios_productos.routes.js"),
    import("../src/routes/cotizaciones.routes.js"),
    import("../src/routes/solicitudesPago.routes.js"),
  ]);

  const obtenerMiddlewares = (router, ruta, metodo) => {
    const capa = router.stack.find(
      (item) => item.route?.path === ruta && item.route.methods[metodo],
    );
    assert.ok(capa, `No se encontró ${metodo.toUpperCase()} ${ruta}`);
    return capa.route.stack.map((item) => item.handle.name);
  };

  const inventario = obtenerMiddlewares(servicios, "/restar/:id", "put");
  const pdfCotizacion = obtenerMiddlewares(cotizaciones, "/:id/pdf", "get");
  const pdfSolicitud = obtenerMiddlewares(solicitudes, "/:id/pdf", "get");

  assert.equal(inventario[0], "autenticarUsuario");
  assert.equal(pdfCotizacion[0], "autenticarUsuario");
  assert.equal(pdfSolicitud[0], "autenticarUsuario");
  assert.ok(pdfCotizacion.includes("limitarGeneracionPdf"));
  assert.ok(pdfSolicitud.includes("limitarGeneracionPdf"));
});
