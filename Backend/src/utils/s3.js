// utils/s3.js
import {
  S3Client,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"; // HeadObjectCommand eliminado porque ya no se usa
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import multer from "multer";
import multerS3 from "multer-s3";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import db from "../config/database.js"; // para consultas auxiliares

const directorioActual = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(directorioActual, "../config/.env") });
dotenv.config();

/*──────────────────── Cliente S3 ────────────────────*/
export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const slugify = (str) =>
  str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const TIPOS_ARCHIVO = new Map([
  ["application/pdf", ["pdf"]],
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["image/gif", ["gif"]],
  ["image/webp", ["webp"]],
  ["text/plain", ["txt"]],
  ["text/csv", ["csv"]],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ["docx"],
  ],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ["xlsx"],
  ],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ["pptx"],
  ],
]);

const sanitizarNombreArchivo = (nombre = "archivo") => {
  const nombreBase = String(nombre).split(/[\\/]/).pop();
  const seguro = nombreBase
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return seguro || "archivo";
};

const archivoPermitido = (
  file,
  { permitirPdf = true, permitirDocumentos = false } = {},
) => {
  const extensiones = TIPOS_ARCHIVO.get(file.mimetype);
  const nombreSeguro = sanitizarNombreArchivo(file.originalname);
  if (!nombreSeguro.includes(".")) return false;
  const extension = nombreSeguro
    .split(".")
    .pop()
    .toLowerCase();

  if (!extensiones?.includes(extension)) return false;
  if (file.mimetype === "application/pdf") return permitirPdf;
  if (file.mimetype.startsWith("image/")) return true;
  return permitirDocumentos;
};

/*──────────────── Carga rápida en memoria ───────────*/
export const uploadComprobanteMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (archivoPermitido(file)) return cb(null, true);
    cb(new Error("Tipo de archivo no permitido para comprobante de gasto"));
  },
}).single("documento");

/*─────────────── URL pre‑firmada (GET) ─────────────*/
export async function generarUrlPrefirmadaLectura(key, expiresInSeconds = 300) {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/*─────────────── Mover archivo a /papelera/ ─────────*/
export async function moverArchivoAPapelera(claveAntigua) {
  const bucket = process.env.S3_BUCKET;

  // 1. Nueva clave en la papelera
  if (claveAntigua.startsWith("papelera/")) return claveAntigua;

  // Mantener la misma jerarquía ⇒ añadir el prefijo
  const claveNueva = `papelera/${claveAntigua}`;

  // 2. Copiar el objeto
  const copySource = encodeURI(`${bucket}/${claveAntigua}`);

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: copySource,
        Key: claveNueva,
        ACL: "private",
      })
    );
  } catch (error) {
    if (error.name === "NotFound" || error.Code === "NoSuchKey") {
      console.warn(`⚠ Archivo no encontrado en S3: ${claveAntigua}`);
      return null;
    }
    throw error;
  }

  // 3. Borrar el original
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: claveAntigua,
    })
  );

  // 4. Devolver la nueva ruta
  return claveNueva;
}

/*─────────────── Creador de upload genérico ────────*/
export function makeUploader({ folder, maxSizeMb = 5, allowPdf = false }) {
  return multer({
    storage: multerS3({
      s3,
      bucket: process.env.S3_BUCKET,
      acl: "private",
      metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
      key: (req, file, cb) => {
        const ahora = new Date();
        const anio = ahora.getFullYear();
        const mes = String(ahora.getMonth() + 1).padStart(2, "0");
        const nombreSeguro = sanitizarNombreArchivo(file.originalname);
        const timestamp = Date.now();
        const clave = `${folder}/${anio}/${mes}/${timestamp}-${nombreSeguro}`;
        cb(null, clave);
      },
    }),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (
        archivoPermitido(file, {
          permitirPdf: allowPdf,
          permitirDocumentos: true,
        })
      ) {
        return cb(null, true);
      }
      return cb(new Error("Tipo o extension de archivo no permitidos"));
    },
  });
}

/*────────────────── Upload de firmas ───────────────*/
// utils/s3.js

export const uploadFirma = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET,
    acl: "private",
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => {
      const extension = sanitizarNombreArchivo(file.originalname)
        .split(".")
        .pop()
        .toLowerCase();
      const marcaTiempo = Date.now(); // <- clave única por versión

      // ──────────────────────────────────────────────
      // 1) Creación de usuario (req.body.nombre existe)
      // ──────────────────────────────────────────────
      if (req.body.nombre) {
        const nombreSlug = slugify(req.body.nombre);
        const claveFirma = `firmas/${nombreSlug}/${marcaTiempo}-firma.${extension}`;
        return cb(null, claveFirma);
      }

      // ──────────────────────────────────────────────
      // 2) Actualización de usuario (req.params.id)
      // ──────────────────────────────────────────────
      if (req.params.id) {
        db.query("SELECT nombre FROM usuarios WHERE id = ?", [req.params.id])
          .then(([filas]) => {
            const nombreBase = filas[0]?.nombre
              ? slugify(filas[0].nombre)
              : `usuario-${req.params.id}`;

            const claveFirma = `firmas/${nombreBase}/${marcaTiempo}-firma.${extension}`;
            cb(null, claveFirma);
          })
          .catch((error) => cb(error));
        return;
      }

      // ──────────────────────────────────────────────
      // 3) Caso de respaldo (por seguridad)
      // ──────────────────────────────────────────────
      const claveFirma = `firmas/usuario-desconocido/${marcaTiempo}-firma.${extension}`;
      cb(null, claveFirma);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (archivoPermitido(file, { permitirPdf: false })) return cb(null, true);
    return cb(new Error("Tipo de archivo no permitido para firma"));
  },
});

/*────────────── Upload de facturas de gastos ───────*/
export const uploadComprobante = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET,
    acl: "private",
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => {
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
      const ahora = new Date();
      const anio = ahora.getFullYear();
      const mesPalabra = meses[ahora.getMonth()];
      const idGasto = req.params.id;

      db.query("SELECT codigo FROM gastos WHERE id = ?", [idGasto])
        .then(([rows]) => {
          const codigoGasto = rows[0]?.codigo ?? `G-${idGasto}`;
          const nombreSeguro = sanitizarNombreArchivo(file.originalname);
          const timestamp = Date.now();
          const clave = `facturas_gastos/${anio}/${mesPalabra}/${codigoGasto}/${timestamp}-${nombreSeguro}`;
          cb(null, clave);
        })
        .catch((err) => cb(err));
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (archivoPermitido(file)) return cb(null, true);
    return cb(
      new Error("Tipo de archivo no permitido para comprobante de gasto")
    );
  },
});

/*────────────────── Upload de comprobantes de pago ───*/
export const uploadComprobantePago = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET,
    acl: "private",
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => {
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

      const ahora = new Date();
      const anio = ahora.getFullYear();
      const mesPalabra = meses[ahora.getMonth()];
      const solicitudId = req.params.id;

      db.query("SELECT codigo FROM solicitudes_pago WHERE id = ?", [
        solicitudId,
      ])
        .then(([rows]) => {
          const codigoSolicitud =
            rows[0]?.codigo?.trim().replace(/\s+/g, "_") || `SP-${solicitudId}`;
          const nombreSeguro = sanitizarNombreArchivo(file.originalname);
          const timestamp = Date.now();
          const clave = `comprobantes_pagos/${anio}/${mesPalabra}/${codigoSolicitud}/${timestamp}-${nombreSeguro}`;
          cb(null, clave);
        })
        .catch((err) => cb(err));
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (archivoPermitido(file)) return cb(null, true);
    return cb(new Error("Tipo de archivo no permitido para comprobante de pago"));
  },
});

/*────────────────── Upload genérico para cualquier archivo ───*/
export const uploadGeneric = makeUploader({
  folder: "archivos",
  maxSizeMb: 10,
  allowPdf: true,
});

/*────────────────── Upload de abonos CxC ─────────────*/
export const uploadComprobanteAbono = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET,
    acl: "private",
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => {
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
      const ahora = new Date();
      const anio = ahora.getFullYear();
      const mesPalabra = meses[ahora.getMonth()];

      const cuentaId = req.params.cuenta_id;
      // Obtener el código de la cuenta por cobrar desde la BD
      db.query("SELECT codigo FROM cuentas_por_cobrar WHERE id = ?", [cuentaId])
        .then(([rows]) => {
          const codigoCXC = rows[0]?.codigo ?? `CXC-${cuentaId}`;
          const nombreSeguro = sanitizarNombreArchivo(file.originalname);
          const timestamp = Date.now();
          const clave = `abonos_cxc/${anio}/${mesPalabra}/${codigoCXC}/${timestamp}-${nombreSeguro}`;
          cb(null, clave);
        })
        .catch((err) => cb(err));
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (archivoPermitido(file)) return cb(null, true);
    return cb(
      new Error("Tipo de archivo no permitido para comprobante de abono")
    );
  },
});

export async function subirBufferAS3({
  claveS3,
  buffer,
  contentType = "application/pdf",
}) {
  const bucket = process.env.S3_BUCKET;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: claveS3,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return claveS3;
}

export async function borrarObjetoAS3(claveS3) {
  const bucket = process.env.S3_BUCKET;

  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: claveS3,
    })
  );
}
