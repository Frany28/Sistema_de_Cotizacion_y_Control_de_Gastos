import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  FileArchive,
  Image as IconoImagen,
  FileAudio,
  FileVideo,
  FileWarning,
  Upload,
  X,
  FolderPlus,
  Home,
} from "lucide-react";
import ModalError from "../Modals/ModalError.jsx";
import ModalExito from "../Modals/ModalExito.jsx";
import { format, formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import { verificarPermisoFront } from "../../../utils/verificarPermisoFront.js";

// ✅ FIX BUILD: ruta correcta
import api from "../../api/index.js";

import { useNavigate } from "react-router-dom";

function TablaArchivos() {
  /* ----------------------------------------------------------------------- */
  /* Estado                                                                  */
  /* ----------------------------------------------------------------------- */
  const [arbolArchivos, setArbolArchivos] = useState([]);
  const [nodosExpandidos, setNodosExpandidos] = useState({});
  const [cargando, setCargando] = useState(true);
  const [terminoBusqueda, setTerminoBusqueda] = useState("");
  const [orden, setOrden] = useState({ campo: "nombre", asc: true });
  const [puedeEditarArchivos, setPuedeEditarArchivos] = useState(false);

  // Carpeta actual (para subir al lugar correcto)
  const [carpetaActual, setCarpetaActual] = useState({
    carpetaId: null, // carpeta BD
    esDestinoS3: false, // carpeta virtual S3
    prefijoS3: "",
    ruta: "/",
    nombre: "Raíz",
  });

  // Modal subida
  const [modalSubidaAbierto, setModalSubidaAbierto] = useState(false);
  const [estaArrastrando, setEstaArrastrando] = useState(false);
  const [archivoSeleccionado, setArchivoSeleccionado] = useState(null);
  const [subiendoArchivo, setSubiendoArchivo] = useState(false);

  // Modal crear carpeta
  const [modalCarpetaAbierto, setModalCarpetaAbierto] = useState(false);
  const [nombreCarpetaNueva, setNombreCarpetaNueva] = useState("");
  const [creandoCarpeta, setCreandoCarpeta] = useState(false);

  // Modal éxito / error
  const [modalExitoVisible, setModalExitoVisible] = useState(false);
  const [modalErrorVisible, setModalErrorVisible] = useState(false);
  const [tituloModalExito, setTituloModalExito] = useState("¡Listo!");
  const [mensajeModalExito, setMensajeModalExito] = useState("");
  const [tituloModalError, setTituloModalError] = useState(
    "¡Ha ocurrido un error!",
  );
  const [mensajeModalError, setMensajeModalError] = useState("");

  const inputArchivoRef = useRef(null);
  const navegar = useNavigate();

  /* ----------------------------------------------------------------------- */
  /* Helpers de modales                                                      */
  /* ----------------------------------------------------------------------- */
  const mostrarExito = (mensaje, titulo = "¡Acción completada!") => {
    setTituloModalExito(titulo);
    setMensajeModalExito(mensaje);
    setModalExitoVisible(true);
  };

  const mostrarError = (mensaje, titulo = "¡Ha ocurrido un error!") => {
    setTituloModalError(titulo);
    setMensajeModalError(mensaje);
    setModalErrorVisible(true);
  };

  /* ----------------------------------------------------------------------- */
  /* Obtención de datos                                                      */
  /* ----------------------------------------------------------------------- */
  const obtenerArbolArchivos = useCallback(async () => {
    try {
      const { data } = await api.get("/archivos/arbol", {
        withCredentials: true,
      });
      setArbolArchivos(Array.isArray(data) ? data : Object.values(data || {}));
    } catch (error) {
      console.error("Error al traer árbol de archivos", error);
      setArbolArchivos([]);
      mostrarError(
        error?.response?.data?.message ||
          "No se pudo cargar el árbol de archivos.",
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    obtenerArbolArchivos();
  }, [obtenerArbolArchivos]);

  useEffect(() => {
    let activo = true;

    const cargarPermisos = async () => {
      const tienePermiso = await verificarPermisoFront("editarArchivos");
      if (activo) setPuedeEditarArchivos(tienePermiso);
    };

    cargarPermisos();
    return () => {
      activo = false;
    };
  }, []);

  const irARaiz = () => {
    setCarpetaActual({
      carpetaId: null,
      esDestinoS3: false,
      prefijoS3: "",
      ruta: "/",
      nombre: "Raíz",
    });
  };

  const formatoFecha = (fecha) => {
    if (!fecha) return "-";
    const date = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(date.getTime())) return "-";

    const horasDesde = (Date.now() - date) / 3_600_000;
    return horasDesde < 48
      ? formatDistanceToNowStrict(date, { locale: es, addSuffix: true })
      : format(date, "LLL dd, yyyy", { locale: es });
  };

  const formatoTamano = (bytes) => {
    const bytesNormalizado = Number(bytes);
    if (!Number.isFinite(bytesNormalizado) || bytesNormalizado <= 0) return "-";

    const unidades = ["B", "KB", "MB", "GB", "TB"];
    let indice = 0;
    let valor = bytesNormalizado;

    while (valor >= 1024 && indice < unidades.length - 1) {
      valor /= 1024;
      indice++;
    }

    return `${valor.toFixed(indice ? 1 : 0)} ${unidades[indice]}`;
  };

  const iconoPorExtension = (ext) => {
    const e = ext?.toLowerCase();
    switch (e) {
      case "pdf":
        return <FileText size={18} className="text-red-400" />;
      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
        return <IconoImagen size={18} className="text-cyan-400" />;
      case "zip":
      case "rar":
        return <FileArchive size={18} className="text-amber-400" />;
      case "mp3":
      case "wav":
        return <FileAudio size={18} className="text-yellow-400" />;
      case "mp4":
      case "avi":
        return <FileVideo size={18} className="text-violet-400" />;
      default:
        return <FileWarning size={18} className="text-gray-400" />;
    }
  };

  const alternarNodo = (ruta) =>
    setNodosExpandidos((prev) => ({ ...prev, [ruta]: !prev[ruta] }));

  const coincideBusqueda = (cadena) =>
    cadena.toLowerCase().includes(terminoBusqueda.trim().toLowerCase());

  /* ----------------------------------------------------------------------- */
  /* Subida de archivos                                                      */
  /* ----------------------------------------------------------------------- */
  const abrirModalSubida = () => {
    if (!puedeEditarArchivos) return;
    setArchivoSeleccionado(null);
    setEstaArrastrando(false);
    setModalSubidaAbierto(true);
  };

  const cerrarModalSubida = () => {
    if (subiendoArchivo) return;
    setModalSubidaAbierto(false);
  };

  const onSeleccionarArchivo = (file) => {
    if (!file) return;
    setArchivoSeleccionado(file);
  };

  const onDropArchivo = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setEstaArrastrando(false);

    const file = e.dataTransfer?.files?.[0];
    onSeleccionarArchivo(file);
  };

  const subirArchivoAlRepositorio = async () => {
    if (!archivoSeleccionado) {
      mostrarError("Selecciona un archivo antes de subir.");
      return;
    }
    const tieneDestinoBd = !!carpetaActual?.carpetaId;
    const tieneDestinoVirtual =
      !tieneDestinoBd &&
      !!carpetaActual?.ruta &&
      carpetaActual.ruta !== "/" &&
      String(carpetaActual.ruta).trim() !== "";

    if (!tieneDestinoBd && !tieneDestinoVirtual) {
      mostrarError("Selecciona una carpeta destino antes de subir.");
      return;
    }

    setSubiendoArchivo(true);

    try {
      const formData = new FormData();
      formData.append("archivo", archivoSeleccionado);

      if (tieneDestinoBd) {
        // Prioridad: carpeta BD
        formData.append("carpetaId", String(carpetaActual.carpetaId));
      } else {
        // ✅ Virtual: derivar prefijoS3 desde la ruta "/a/b/c"
        const prefijoNormalizado = String(carpetaActual.ruta)
          .replace(/^\/+/, "")
          .replace(/\/+$/, "");

        formData.append("prefijoS3", prefijoNormalizado);
      }

      await api.post("/archivos/repositorio", formData, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });

      setModalSubidaAbierto(false);
      await obtenerArbolArchivos();

      mostrarExito("Archivo subido correctamente.");
    } catch (error) {
      console.error("Error subiendo archivo:", error);
      mostrarError(
        error?.response?.data?.message ||
          "No se pudo subir el archivo. Revisa permisos o el backend.",
      );
    } finally {
      setSubiendoArchivo(false);
    }
  };

  /* ----------------------------------------------------------------------- */
  /* Crear carpeta (BD)                                                      */
  /* ----------------------------------------------------------------------- */
  const abrirModalCarpeta = () => {
    if (!puedeEditarArchivos) return;
    setNombreCarpetaNueva("");
    setModalCarpetaAbierto(true);
  };

  const cerrarModalCarpeta = () => {
    if (creandoCarpeta) return;
    setModalCarpetaAbierto(false);
  };

  const crearCarpetaNueva = async () => {
    const nombre = String(nombreCarpetaNueva || "").trim();
    if (!nombre) {
      mostrarError("Debes escribir un nombre para la carpeta.");
      return;
    }

    setCreandoCarpeta(true);

    try {
      // ✅ Backend espera { nombre, padreId }
      // Si estás parado en carpeta S3, no se puede crear dentro de esa “carpeta”, así que se crea en raíz BD.
      const padreId =
        carpetaActual?.carpetaId && !carpetaActual?.esDestinoS3
          ? Number(carpetaActual.carpetaId)
          : null;

      // ⚠️ Ajusta este path si tu app.js monta el router con otro nombre
      await api.post(
        "/carpetas-archivos",
        { nombre, padreId },
        { withCredentials: true },
      );

      setModalCarpetaAbierto(false);
      await obtenerArbolArchivos();

      mostrarExito("Carpeta creada correctamente.");
    } catch (error) {
      console.error("Error creando carpeta:", error);
      mostrarError(
        error?.response?.data?.message ||
          "No se pudo crear la carpeta. Revisa backend/permisos.",
      );
    } finally {
      setCreandoCarpeta(false);
    }
  };

  /* ----------------------------------------------------------------------- */
  /* Ordenación                                                              */
  /* ----------------------------------------------------------------------- */
  const ordenar = useCallback(
    (a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === "carpeta" ? -1 : 1;
      const factor = orden.asc ? 1 : -1;

      switch (orden.campo) {
        case "tamanioBytes": {
          const tamanoA = a.tipo === "carpeta" ? 0 : a.tamanioBytes || 0;
          const tamanoB = b.tipo === "carpeta" ? 0 : b.tamanioBytes || 0;
          return factor * (tamanoA - tamanoB);
        }
        case "creadoEn": {
          const fechaA = a.tipo === "carpeta" ? 0 : new Date(a.creadoEn);
          const fechaB = b.tipo === "carpeta" ? 0 : new Date(b.creadoEn);
          return factor * (fechaA - fechaB);
        }
        default:
          return factor * a.nombre.localeCompare(b.nombre);
      }
    },
    [orden],
  );

  /* ----------------------------------------------------------------------- */
  /* Render recursivo                                                        */
  /* ----------------------------------------------------------------------- */
  const renderizarNodo = useCallback(
    (nodo, nivel = 0) => {
      const tieneCoincidencia = coincideBusqueda(nodo.nombre);

      if (terminoBusqueda && nodo.tipo === "archivo" && !tieneCoincidencia) {
        return [];
      }

      const sangriaPx = 16 + nivel * 24;

      if (nodo.tipo === "carpeta") {
        const hijosFiltrados = (Array.isArray(nodo.hijos) ? nodo.hijos : [])
          .sort(ordenar)
          .flatMap((h) => renderizarNodo(h, nivel + 1));

        const tieneHijosCoincidentes = hijosFiltrados.length > 0;

        if (terminoBusqueda && !tieneCoincidencia && !tieneHijosCoincidentes) {
          return [];
        }

        const abierta = !!nodosExpandidos[nodo.ruta] || terminoBusqueda;

        const filaCarpeta = (
          <tr
            key={nodo.ruta}
            className="cursor-pointer hover:bg-gray-700/50 transition-colors duration-200 select-none group"
            onClick={() => {
              const rutaNodo = String(nodo.ruta || "");
              const estabaAbierta = !!nodosExpandidos[rutaNodo];

              // 1) Alternar el nodo (abre / cierra)
              alternarNodo(rutaNodo);

              // 2) Si se está cerrando → volver a raíz
              if (estabaAbierta) {
                irARaiz();
                return;
              }

              // 3) Si se está abriendo → seleccionar como destino
              const tieneCarpetaBd = nodo.carpetaId != null;

              // ✅ NUEVO: si NO tiene carpetaId, es carpeta virtual (proviene del orden S3)
              const esDestinoS3 = !tieneCarpetaBd;

              const prefijoS3 = esDestinoS3
                ? String(rutaNodo)
                    .replace(/^\/+/, "") // quita "/" inicial
                    .replace(/\/+$/, "") // quita "/" final
                : "";

              setCarpetaActual({
                carpetaId: tieneCarpetaBd ? Number(nodo.carpetaId) : null,
                esDestinoS3,
                prefijoS3,
                ruta: rutaNodo,
                nombre: nodo.nombre || "Carpeta",
              });
            }}
          >
            <td
              className="py-3 flex items-center gap-2 font-medium text-gray-50 group-hover:text-white"
              style={{ paddingLeft: sangriaPx }}
            >
              {abierta ? (
                <ChevronDown size={16} className="text-blue-400" />
              ) : (
                <ChevronRight
                  size={16}
                  className="text-gray-400 group-hover:text-gray-300"
                />
              )}
              <Folder size={18} className="text-blue-400 flex-shrink-0" />
              <span className="truncate max-w-[12rem] sm:max-w-[24rem]">
                {nodo.nombre.replace(/_/g, " ")}
              </span>
            </td>
            <td className="text-sm text-gray-300 whitespace-nowrap group-hover:text-gray-100 hidden sm:table-cell">
              {"-"}
            </td>
            <td className="text-sm text-gray-300 pr-6 text-right group-hover:text-gray-100 hidden sm:table-cell">
              {"-"}
            </td>
          </tr>
        );

        if (!abierta) return [filaCarpeta];
        return [filaCarpeta, ...hijosFiltrados];
      }

      return [
        <tr
          key={nodo.ruta}
          className="hover:bg-gray-700/40 transition-colors duration-200 cursor-pointer group"
          onClick={() => navegar(`/gestor-archivos/archivo/${nodo.id}`)}
        >
          <td
            className="py-3 flex items-center gap-2 text-gray-100 group-hover:text-white"
            style={{ paddingLeft: sangriaPx }}
          >
            {iconoPorExtension(nodo.extension)}
            <span className="truncate max-w-[12rem] sm:max-w-[24rem]">
              {nodo.nombre}
            </span>
          </td>
          <td className="text-sm text-gray-300 whitespace-nowrap group-hover:text-gray-100 hidden sm:table-cell">
            {formatoFecha(nodo.creadoEn)}
          </td>
          <td className="text-sm text-gray-300 pr-6 text-right group-hover:text-gray-100 hidden sm:table-cell">
            {formatoTamano(nodo.tamanioBytes)}
          </td>
        </tr>,
      ];
    },
    [terminoBusqueda, nodosExpandidos, ordenar],
  );

  const filas = useMemo(() => {
    return Array.isArray(arbolArchivos)
      ? arbolArchivos.sort(ordenar).flatMap((n) => renderizarNodo(n))
      : [];
  }, [
    arbolArchivos,
    nodosExpandidos,
    terminoBusqueda,
    orden,
    ordenar,
    renderizarNodo,
  ]);

  if (cargando) {
    return (
      <div className="w-full bg-gray-800 rounded-xl p-4 animate-pulse h-64 shadow-lg" />
    );
  }

  return (
    <div className="w-full bg-gray-800 rounded-xl shadow-xl overflow-hidden border border-gray-700">
      {/* Barra de herramientas */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 sm:p-5 sm:pb-3 bg-gray-800 border-b border-gray-700">
        <input
          type="text"
          placeholder="Buscar archivos o carpetas."
          value={terminoBusqueda}
          onChange={(e) => setTerminoBusqueda(e.target.value)}
          className="w-full sm:w-80 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 shadow-inner"
        />

        <div className="flex gap-2 text-sm text-gray-300 overflow-x-auto pb-2 sm:pb-0 items-center">
          <button
            onClick={() => setOrden({ campo: "nombre", asc: !orden.asc })}
            className={`px-3 py-2 rounded-lg transition-colors duration-200 flex items-center gap-1 flex-shrink-0 ${
              orden.campo === "nombre"
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "hover:bg-gray-700/50 border border-gray-600"
            }`}
          >
            <span>Nombre</span>
            {orden.campo === "nombre" && (orden.asc ? "↑" : "↓")}
          </button>

          <button
            onClick={irARaiz}
            className="px-3 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2 flex-shrink-0 bg-gray-700/40 text-gray-200 border border-gray-600 hover:bg-gray-700/70"
            title="Volver a raíz"
          >
            <Home size={16} />
            <span>Raíz</span>
          </button>

          {/* ✅ Nueva carpeta (BD) */}
          {puedeEditarArchivos && (
            <button
              onClick={abrirModalCarpeta}
              className="px-3 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2 flex-shrink-0 bg-gray-700/40 text-gray-200 border border-gray-600 hover:bg-gray-700/70"
            >
              <FolderPlus size={16} />
              <span>Nueva carpeta</span>
            </button>
          )}

          {/* Destino actual */}
          <div className="px-3 py-2 rounded-lg border border-gray-600 bg-gray-700/40 text-gray-200 flex items-center gap-2 flex-shrink-0">
            <span className="text-gray-400">Destino:</span>
            <span className="truncate max-w-[10rem] sm:max-w-[18rem]">
              {carpetaActual?.ruta && carpetaActual.ruta !== "/"
                ? carpetaActual.esDestinoS3
                  ? `s3:/${carpetaActual.prefijoS3}`
                  : carpetaActual.ruta
                : "Raíz"}
            </span>
          </div>

          {/* Subir archivo */}
          {puedeEditarArchivos && (
            <button
              onClick={abrirModalSubida}
              className="px-3 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2 flex-shrink-0 bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30"
            >
              <Upload size={16} />
              <span>Subir archivo</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="w-full">
        <table className="min-w-full w-full text-left border-collapse text-sm table-fixed">
          <thead className="bg-gray-700 border-b border-gray-600">
            <tr className="text-gray-300 font-medium">
              <th className="py-3 pl-4 sm:pl-6 text-base font-semibold text-gray-200">
                Nombre
              </th>
              <th className="py-3 w-56 text-base font-semibold text-gray-200 hidden sm:table-cell">
                Última modificación
              </th>
              <th className="py-3 w-32 pr-4 sm:pr-6 text-right text-base font-semibold text-gray-200 hidden sm:table-cell">
                Tamaño
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {filas.length ? (
              filas
            ) : (
              <tr>
                <td
                  colSpan={3}
                  className="py-12 text-center text-gray-400 px-4"
                >
                  {terminoBusqueda
                    ? "No se encontraron resultados para tu búsqueda"
                    : "No hay archivos que mostrar"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal crear carpeta */}
      {puedeEditarArchivos && modalCarpetaAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-xl bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-gray-100">
                Crear carpeta
              </h3>
              <button
                onClick={cerrarModalCarpeta}
                className="p-2 rounded-lg hover:bg-gray-700 text-gray-300"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-sm text-gray-300">
                Se creará en:{" "}
                <span className="text-gray-100 font-medium">
                  {carpetaActual?.carpetaId && !carpetaActual?.esDestinoS3
                    ? carpetaActual.ruta
                    : "Raíz"}
                </span>
                {carpetaActual?.esDestinoS3 && (
                  <span className="ml-2 text-amber-300">
                    (Carpeta S3 seleccionada: se creará en BD raíz)
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm text-gray-300">Nombre</label>
                <input
                  type="text"
                  value={nombreCarpetaNueva}
                  onChange={(e) => setNombreCarpetaNueva(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 shadow-inner"
                  placeholder="Ej: Reportes, 2026, Facturas..."
                  disabled={creandoCarpeta}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={cerrarModalCarpeta}
                  disabled={creandoCarpeta}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-100 border border-gray-600 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={crearCarpetaNueva}
                  disabled={creandoCarpeta}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  {creandoCarpeta ? "Creando..." : "Crear"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal subida */}
      {puedeEditarArchivos && modalSubidaAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-xl bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-gray-100">
                Subir archivo al repositorio
              </h3>
              <button
                onClick={cerrarModalSubida}
                className="p-2 rounded-lg hover:bg-gray-700 text-gray-300"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-sm text-gray-300">
                Destino:{" "}
                <span className="text-gray-100 font-medium">
                  {carpetaActual?.ruta && carpetaActual.ruta !== "/"
                    ? carpetaActual.esDestinoS3
                      ? `s3:/${carpetaActual.prefijoS3}`
                      : carpetaActual.ruta
                    : "Raíz"}
                </span>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEstaArrastrando(true);
                }}
                onDragLeave={() => setEstaArrastrando(false)}
                onDrop={onDropArchivo}
                className={`w-full rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  estaArrastrando
                    ? "border-blue-400 bg-blue-500/10"
                    : "border-gray-600 bg-gray-900/20"
                }`}
              >
                <p className="text-gray-200 font-medium">
                  Arrastra tu archivo aquí
                </p>
                <p className="text-gray-400 text-sm mt-1">
                  o usa el botón para seleccionar desde tu PC
                </p>

                <div className="mt-4 flex items-center justify-center gap-3">
                  <input
                    ref={inputArchivoRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => onSeleccionarArchivo(e.target.files?.[0])}
                  />
                  <button
                    onClick={() => inputArchivoRef.current?.click()}
                    className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-100 border border-gray-600"
                    disabled={subiendoArchivo}
                  >
                    Seleccionar archivo
                  </button>
                </div>

                {archivoSeleccionado && (
                  <div className="mt-4 text-sm text-gray-200">
                    <span className="text-gray-400">Seleccionado:</span>{" "}
                    {archivoSeleccionado.name}{" "}
                    <span className="text-gray-400">
                      ({formatoTamano(archivoSeleccionado.size)})
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={cerrarModalSubida}
                  disabled={subiendoArchivo}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-100 border border-gray-600 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={subirArchivoAlRepositorio}
                  disabled={subiendoArchivo}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  {subiendoArchivo ? "Subiendo..." : "Subir"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Modales globales (tú agregas import) */}
      <ModalExito
        visible={modalExitoVisible}
        onClose={() => setModalExitoVisible(false)}
        titulo={tituloModalExito}
        mensaje={mensajeModalExito}
        textoBoton="Continuar"
      />

      <ModalError
        visible={modalErrorVisible}
        onClose={() => setModalErrorVisible(false)}
        titulo={tituloModalError}
        mensaje={mensajeModalError}
        textoBoton="Cerrar"
      />
    </div>
  );
}

export default TablaArchivos;
