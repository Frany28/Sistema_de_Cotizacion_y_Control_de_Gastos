import React, { useEffect, useState } from "react";
import GenerarReporte from "../../components/ComponenteGestorEventos/GenerarReporte";
import ModalOpcionesReporte from "../../components/ComponenteGestorEventos/ModalOpcionesReporte";
import TarjetaArchivosSubidos from "../../components/ComponenteGestorEventos/tarjetas/TarjetaArchivosSubidos";
import TarjetaArchivosEliminados from "../../components/ComponenteGestorEventos/tarjetas/TarjetaArchivosEliminados";
import TarjetaTotalDeArchivos from "../../components/ComponenteGestorEventos/tarjetas/TarjetaTotalDeArchivos";
import TarjetaArchivosReemplazados from "../../components/ComponenteGestorEventos/tarjetas/TarjetaArchivosReemplazados";
import GraficoTendenciasActividad from "../../components/ComponenteGestorEventos/GraficoTendenciasActividad";
import ActividadRecienteArchivos from "../../components/ComponenteGestorEventos/ActividadRecienteArchivos";
import { descargarReporteEventosPdf } from "../../services/eventosArchivosApi";
import { verificarPermisoFront } from "../../../utils/verificarPermisoFront";

const claseGridTarjetas = `
  grid
  grid-cols-[repeat(auto-fit,minmax(220px,1fr))]
  auto-rows-fr
  items-stretch
  gap-x-4 gap-y-6
`;

function GestorDeEventosPage() {
  const [mostrarModal, setMostrarModal] = useState(false);
  const [verificandoAcceso, setVerificandoAcceso] = useState(true);
  const [puedeVerGestorEventos, setPuedeVerGestorEventos] = useState(false);

  useEffect(() => {
    let activo = true;

    const verificarAcceso = async () => {
      try {
        const usuario =
          JSON.parse(localStorage.getItem("usuario")) ||
          JSON.parse(sessionStorage.getItem("usuario"));

        const rolId = usuario?.rol_id ?? usuario?.rolId;
        const rolSlug = (usuario?.rolSlug || usuario?.rol || "")
          .toString()
          .toLowerCase();
        const esAdminOSupervisor =
          rolId === 1 ||
          rolId === 2 ||
          rolSlug === "admin" ||
          rolSlug === "supervisor";

        const tienePermiso = await verificarPermisoFront("verEventosArchivos");

        if (!activo) return;
        setPuedeVerGestorEventos(esAdminOSupervisor && tienePermiso);
      } finally {
        if (activo) setVerificandoAcceso(false);
      }
    };

    verificarAcceso();
    return () => {
      activo = false;
    };
  }, []);

  const abrirModal = () => {
    setMostrarModal(true);
  };

  const cerrarModal = () => {
    setMostrarModal(false);
  };

  const manejarConfirmar = async (opcionesSeleccion) => {
    try {
      const blob = await descargarReporteEventosPdf(opcionesSeleccion);
      const url = URL.createObjectURL(blob);
      const enlaceDescarga = document.createElement("a");
      enlaceDescarga.href = url;
      enlaceDescarga.download = "reporte-eventos.pdf";
      enlaceDescarga.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error al generar PDF:", error);
      alert("No se pudo generar el PDF");
    } finally {
      cerrarModal();
    }
  };

  if (verificandoAcceso) {
    return (
      <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 lg:px-8 pt-8">
        <div className="rounded-xl border border-gray-700 bg-gray-800 p-6 text-gray-300">
          Verificando permisos del Gestor de Eventos...
        </div>
      </div>
    );
  }

  if (!puedeVerGestorEventos) {
    return (
      <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 lg:px-8 pt-8">
        <div className="rounded-xl border border-red-800 bg-red-950/40 p-6 text-red-200">
          No tienes permiso para acceder al Gestor de Eventos.
        </div>
      </div>
    );
  }

  return (
    <div className="pt-5">
      <GenerarReporte onGenerarReporte={abrirModal} />

      <ModalOpcionesReporte
        visible={mostrarModal}
        onClose={cerrarModal}
        onConfirmar={manejarConfirmar}
      />

      <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 lg:px-8 mt-6 mb-8">
        <section className={claseGridTarjetas}>
          <div className="h-full">
            <TarjetaArchivosSubidos />
          </div>
          <div className="h-full">
            <TarjetaArchivosEliminados />
          </div>
          <div className="h-full">
            <TarjetaTotalDeArchivos />
          </div>
          <div className="h-full">
            <TarjetaArchivosReemplazados />
          </div>
        </section>
      </div>

      <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 lg:px-8">
        <GraficoTendenciasActividad alturaPx={420} />
      </div>

      <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 lg:px-8 md:pt-5">
        <ActividadRecienteArchivos />
      </div>
    </div>
  );
}

export default GestorDeEventosPage;
