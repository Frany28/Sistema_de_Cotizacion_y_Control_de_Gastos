import {
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { s3 } from "../utils/s3.js";

const empiezaCon = (buffer, firma) =>
  firma.every((byte, indice) => buffer[indice] === byte);

const esTextoUtf8 = (buffer) => {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
};

const coincideFirma = (mimetype, buffer) => {
  if (!buffer?.length) return false;

  switch (mimetype) {
    case "application/pdf":
      return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    case "image/jpeg":
      return empiezaCon(buffer, [0xff, 0xd8, 0xff]);
    case "image/png":
      return empiezaCon(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif": {
      const cabecera = buffer.subarray(0, 6).toString("ascii");
      return cabecera === "GIF87a" || cabecera === "GIF89a";
    }
    case "image/webp":
      return (
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case "text/plain":
    case "text/csv":
      return esTextoUtf8(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return empiezaCon(buffer, [0x50, 0x4b, 0x03, 0x04]);
    default:
      return false;
  }
};

const leerCabeceraS3 = async (key) => {
  const respuesta = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Range: "bytes=0-8191",
    }),
  );
  const partes = [];
  for await (const parte of respuesta.Body) partes.push(parte);
  return Buffer.concat(partes);
};

const eliminarSubidaInvalida = async (file) => {
  if (!file?.key) return;
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.key,
    }),
  );
};

export const validarContenidoArchivo = async (req, res, next) => {
  const file = req.file;
  if (!file) return next();

  try {
    const cabecera = file.buffer ?? (await leerCabeceraS3(file.key));
    if (!coincideFirma(file.mimetype, cabecera)) {
      await eliminarSubidaInvalida(file);
      return res.status(400).json({
        message: "El contenido real del archivo no coincide con su tipo",
      });
    }

    return next();
  } catch (error) {
    try {
      await eliminarSubidaInvalida(file);
    } catch (errorEliminacion) {
      console.error("No se pudo eliminar una subida no validada:", errorEliminacion);
    }
    return next(error);
  }
};
