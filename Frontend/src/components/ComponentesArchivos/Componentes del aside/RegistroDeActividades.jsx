import { useEffect, useState, useCallback } from "react";
import { Bell, File } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import api from "../../../api";
import { verificarPermisoFront } from "../../../../utils/verificarPermisoFront.js";

function RegistroDeActividades() {
  const [eventos, setEventos] = useState([]);
  const [verificandoPermiso, setVerificandoPermiso] = useState(true);
  const [puedeVerEventos, setPuedeVerEventos] = useState(false);

  /** 🔎 Traduce el tipo de evento a una frase legible */
  const obtenerDescripcionAccion = (tipoEvento) => {
    switch (tipoEvento) {
      case "subida":
        return "fue subido";
      case "eliminacion":
        return "fue eliminado";
      case "sustitucion":
        return "fue sustituido";
      case "edicionMetadatos":
        return "fue modificado";
      case "borradoDefinitivo": // 🆕 nuevo evento
        return "fue eliminado de forma permanente";
      default:
        return "tuvo actividad";
    }
  };

  /** 🕒 Devuelve “hace 3 h” o “jul 31 2025” según antigüedad */
  const formatearTiempo = (fechaIso) => {
    const fecha = new Date(fechaIso);
    const diffHoras = (Date.now() - fecha.getTime()) / 3_600_000;
    return diffHoras < 48
      ? formatDistanceToNowStrict(fecha, { locale: es, addSuffix: true })
      : format(fecha, "LLL dd, yyyy", { locale: es });
  };

  /** 📡 Petición al backend */
  const fetchEventos = useCallback(async () => {
    try {
      const { data } = await api.get("/archivos/eventos", {
        params: { limit: 3 },
        withCredentials: true,
      });
      setEventos(data.eventos ?? []);
    } catch (error) {
      console.error("Error al obtener eventos:", error);
    }
  }, []);

  useEffect(() => {
    let activo = true;

    const cargar = async () => {
      try {
        const tienePermiso = await verificarPermisoFront("verEventosArchivos");
        if (!activo) return;

        setPuedeVerEventos(tienePermiso);
        if (tienePermiso) {
          await fetchEventos();
        }
      } finally {
        if (activo) setVerificandoPermiso(false);
      }
    };

    cargar();
    return () => {
      activo = false;
    };
  }, [fetchEventos]);

  if (verificandoPermiso || !puedeVerEventos) {
    return null;
  }

  return (
    <div className="w-full bg-gray-700 rounded-2xl shadow p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Bell size={20} color="#1A56DB" />
        <p className="text-white font-semibold">Actividad Reciente</p>
      </div>

      <div className="flex flex-col gap-3 max-h-64 overflow-y-auto pr-2">
        {eventos.length === 0 && (
          <p className="text-gray-400 text-sm pt-2">Sin actividad por ahora</p>
        )}

        {eventos.map(
          ({ nombreArchivo, fechaEvento, tipoEvento, idEvento }, idx) => (
            <div key={idEvento ?? idx} className="flex gap-2 items-start">
              <File
                size={18}
                color="#D1D5DB"
                className="mt-0.5 flex-shrink-0"
              />
              <div className="grid grid-cols-1">
                <p className="text-white text-sm">
                  <span className="font-medium">{nombreArchivo}</span>{" "}
                  {obtenerDescripcionAccion(tipoEvento)}.
                </p>
                <p className="text-[13px] text-gray-400">
                  {formatearTiempo(fechaEvento)}
                </p>
              </div>
            </div>
          )
        )}
      </div>

      <button
        type="button"
        onClick={() => window.location.assign("/gestor-eventos")}
        className="text-center text-sm font-medium text-[#1A56DB] hover:underline"
      >
        Ver Actividad Reciente
      </button>
    </div>
  );
}

export default RegistroDeActividades;
