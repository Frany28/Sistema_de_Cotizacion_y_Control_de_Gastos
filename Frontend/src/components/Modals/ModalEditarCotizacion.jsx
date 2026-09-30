// src/components/Modals/ModalEditarCotizacion.jsx
import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Pencil, Search, ChevronDown, Trash2, Plus } from "lucide-react";
import ModalExito from "../Modals/ModalExito";

const OPERACIONES_SUGERIDAS = ["Importación", "Exportación"];
// Eliminado ModalError: usaremos aviso inline
// import ModalError from "../Modals/ModalError";

export default function ModalEditarCotizacion({
  titulo = "Editar Cotización",
  visible,
  onClose,
  onSubmit,
  cotizacion,
  sucursales = [],
  serviciosProductos = [],
  clientes = [],
}) {
  const [formulario, setFormulario] = useState({
    cliente_id: "",
    sucursal_id: "",
    estado: "pendiente",
    confirmacion_cliente: "0",
    observaciones: "",
    operacion: "",
    mercancia: "",
    bl: "",
    contenedor: "",
    puerto: "",
    detalle: [],
  });

  // UI / feedback
  const [enviando, setEnviando] = useState(false);
  const [mostrarExito, setMostrarExito] = useState(false);
  const [mensajeExito, setMensajeExito] = useState("");
  const [errorServidor, setErrorServidor] = useState("");

  // Dropdowns por fila (servicios) + búsquedas por fila
  const [serviciosAbiertos, setServiciosAbiertos] = useState({}); // { [index]: boolean }
  const [busquedaServicioFila, setBusquedaServicioFila] = useState({}); // { [index]: string }

  // Dropdowns simples para clientes y sucursales
  const [buscarCliente, setBuscarCliente] = useState("");
  const [buscarSucursal, setBuscarSucursal] = useState("");
  const [clientesAbierto, setClientesAbierto] = useState(false);
  const [sucursalesAbierto, setSucursalesAbierto] = useState(false);

  // Cargar datos de la cotización
  useEffect(() => {
    if (!cotizacion) return;
    setFormulario({
      cliente_id: cotizacion.cliente_id?.toString() || "",
      sucursal_id: cotizacion.sucursal_id?.toString() || "",
      estado: cotizacion.estado || "pendiente",
      confirmacion_cliente: cotizacion.confirmacion_cliente ? "1" : "0",
      observaciones: cotizacion.observaciones || "",
      operacion: cotizacion.operacion || "",
      mercancia: cotizacion.mercancia || "",
      bl: cotizacion.bl || "",
      contenedor: cotizacion.contenedor || "",
      puerto: cotizacion.puerto || "",
      detalle: Array.isArray(cotizacion.detalle)
        ? cotizacion.detalle.map((d) => ({
            servicio_productos_id: d.servicio_productos_id?.toString() || "",
            cantidad: Number(d.cantidad || 1),
            precio_unitario: Number(d.precio_unitario || 0),
            porcentaje_iva: Number(
              d.porcentaje_iva === "" || d.porcentaje_iva == null
                ? 16
                : d.porcentaje_iva
            ),
            subtotal: Number(d.subtotal || 0),
            impuesto: Number(d.impuesto || 0),
            total: Number(d.total || 0),
          }))
        : [],
    });
    // limpiar visibilidad de dropdowns de servicios al abrir
    setServiciosAbiertos({});
    setBusquedaServicioFila({});
    setErrorServidor("");
  }, [cotizacion, visible]);

  // Helpers de UI
  const obtenerNombre = (id, lista, campo = "nombre") => {
    if (!id) return "";
    const it = (lista || []).find((x) => x.id?.toString() === id?.toString());
    return it ? it[campo] : "";
  };

  const filtrarPorTexto = (lista, texto, campo = "nombre") => {
    if (!Array.isArray(lista)) return [];
    const q = (texto || "").toLowerCase();
    return lista.filter((x) =>
      (x[campo] || "").toString().toLowerCase().includes(q)
    );
  };

  // Servicios ya seleccionados (para excluir en otros ítems)
  const serviciosSeleccionados = useMemo(() => {
    return new Set(
      (formulario.detalle || [])
        .map((d) => d.servicio_productos_id?.toString())
        .filter(Boolean)
    );
  }, [formulario.detalle]);

  // Servicios disponibles para una fila (excluye los usados en otras filas, pero permite el actual)
  const serviciosDisponiblesParaFila = (index) => {
    const actualId =
      formulario.detalle[index]?.servicio_productos_id?.toString();
    return (serviciosProductos || []).filter((sp) => {
      const idSp = sp.id?.toString();
      // si ya está usado en otra fila, lo excluimos
      if (serviciosSeleccionados.has(idSp) && idSp !== actualId) return false;
      return true;
    });
  };

  // Cambiar campos simples
  const manejarCambio = (e) => {
    const { name, value } = e.target;
    setFormulario((f) => ({ ...f, [name]: value }));
    if (errorServidor) setErrorServidor("");
  };

  // Añadir / eliminar líneas
  const agregarLinea = () => {
    setFormulario((f) => ({
      ...f,
      detalle: [
        ...(Array.isArray(f.detalle) ? f.detalle : []),
        {
          servicio_productos_id: "",
          cantidad: 1,
          precio_unitario: 0,
          porcentaje_iva: 16,
          subtotal: 0,
          impuesto: 0,
          total: 0,
        },
      ],
    }));
  };

  const eliminarLinea = (index) => {
    setFormulario((f) => ({
      ...f,
      detalle: (f.detalle || []).filter((_, i) => i !== index),
    }));
    // cerrar dropdown y limpiar búsqueda de esa fila
    setServiciosAbiertos((s) => ({ ...s, [index]: false }));
    setBusquedaServicioFila((s) => ({ ...s, [index]: "" }));
  };

  // Recalcular importes de una fila
  const recalcularFila = (item) => {
    const cantidad = Math.max(0, Number(item.cantidad) || 0);
    const precio = Math.max(0, Number(item.precio_unitario) || 0);
    const iva = Math.max(0, Number(item.porcentaje_iva) || 0);

    const subtotal = cantidad * precio;
    const impuesto = subtotal * (iva / 100);
    const total = subtotal + impuesto;

    return {
      ...item,
      cantidad,
      precio_unitario: precio,
      porcentaje_iva: iva,
      subtotal,
      impuesto,
      total,
    };
  };

  const manejarDetalleCambio = (index, campo, valor) => {
    setFormulario((f) => {
      const nuevoDetalle = [...(f.detalle || [])];
      let item = { ...nuevoDetalle[index] };

      if (campo === "servicio_productos_id") {
        item.servicio_productos_id = valor?.toString() || "";

        const servSel = (serviciosProductos || []).find(
          (sp) => sp.id?.toString() === item.servicio_productos_id
        );

        const precioBase = Number(servSel?.precio) || 0;
        const ivaBase = Number(servSel?.porcentaje_iva ?? 16) || 0;

        item.precio_unitario = precioBase;
        item.porcentaje_iva = ivaBase;
        item = recalcularFila(item);
      } else if (
        campo === "cantidad" ||
        campo === "precio_unitario" ||
        campo === "porcentaje_iva"
      ) {
        item[campo] = valor;
        item = recalcularFila(item);
      }

      nuevoDetalle[index] = item;
      return { ...f, detalle: nuevoDetalle };
    });
    if (errorServidor) setErrorServidor("");
  };

  // Totales de la cotización
  const totales = useMemo(() => {
    const detalle = formulario.detalle || [];
    const subtotal = detalle.reduce(
      (acc, it) => acc + (Number(it.subtotal) || 0),
      0
    );
    const impuesto = detalle.reduce(
      (acc, it) => acc + (Number(it.impuesto) || 0),
      0
    );
    const total = detalle.reduce((acc, it) => acc + (Number(it.total) || 0), 0);
    return {
      subtotal: subtotal.toFixed(2),
      impuesto: impuesto.toFixed(2),
      total: total.toFixed(2),
    };
  }, [formulario.detalle]);

  // Validación del formulario (mensajes claros)
  const validar = () => {
    const errores = [];

    if (!formulario.cliente_id) {
      errores.push("Debe seleccionar un cliente.");
    }

    if (!Array.isArray(formulario.detalle) || formulario.detalle.length === 0) {
      errores.push("Debe agregar al menos un ítem al detalle.");
    } else {
      formulario.detalle.forEach((it, idx) => {
        const etiqueta = `Ítem #${idx + 1}`;
        if (!it.servicio_productos_id) {
          errores.push(`${etiqueta}: seleccione un servicio/producto.`);
        }
        if (Number(it.cantidad) < 1) {
          errores.push(`${etiqueta}: la cantidad debe ser al menos 1.`);
        }
        if (Number(it.precio_unitario) < 0) {
          errores.push(
            `${etiqueta}: el precio unitario no puede ser negativo.`
          );
        }
      });
    }

    if (errores.length > 0) {
      setErrorServidor(
        ["Se encontraron errores de validación:", ...errores].join("\n")
      );
      return false;
    }
    setErrorServidor("");
    return true;
  };

  // Enviar
  const manejarSubmit = async (e) => {
    e.preventDefault();
    if (!validar()) return;

    setEnviando(true);
    try {
      // Enviar con números normalizados
      const payload = {
        ...formulario,
        cliente_id: formulario.cliente_id?.toString(),
        sucursal_id: formulario.sucursal_id
          ? formulario.sucursal_id.toString()
          : "",
        confirmacion_cliente:
          formulario.confirmacion_cliente === "1" ? "1" : "0",
        detalle: (formulario.detalle || []).map((it) => ({
          servicio_productos_id: it.servicio_productos_id?.toString(),
          cantidad: Number(it.cantidad) || 0,
          precio_unitario: Number(it.precio_unitario) || 0,
          porcentaje_iva: Number(it.porcentaje_iva) || 0,
          subtotal: Number(it.subtotal) || 0,
          impuesto: Number(it.impuesto) || 0,
          total: Number(it.total) || 0,
        })),
      };

      await onSubmit(payload);
      setMensajeExito("La cotización se actualizó correctamente.");
      setMostrarExito(true);
    } catch (err) {
      // Mostrar siempre como aviso inline legible
      const data = err?.response?.data;
      const plano =
        data?.message ||
        data?.error ||
        (typeof data === "string" ? data : "") ||
        "Hubo un error al actualizar la cotización.";
      setErrorServidor(plano);
    } finally {
      setEnviando(false);
    }
  };

  // Render
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-gray-800 text-white rounded-lg shadow-lg w-full max-w-6xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
          >
            {/* Header */}
            <div className="sticky top-0 bg-gray-800 p-6 border-b border-gray-700 z-10">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Pencil className="w-6 h-6 text-blue-500" />
                  <h2 className="text-xl font-semibold">{titulo}</h2>
                </div>
                <button
                  onClick={onClose}
                  className="cursor-pointer text-gray-400 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <form onSubmit={manejarSubmit} className="p-6 space-y-6">
              {/* Aviso inline de validación/errores backend */}
              {errorServidor && (
                <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded whitespace-pre-line">
                  {errorServidor}
                </div>
              )}

              {/* Datos generales */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Cliente */}
                <div className="relative">
                  <label className="block text-sm font-medium mb-1">
                    Cliente *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={obtenerNombre(formulario.cliente_id, clientes)}
                      readOnly
                      onClick={() => {
                        setClientesAbierto((v) => !v);
                        setSucursalesAbierto(false);
                      }}
                      className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white cursor-pointer"
                      placeholder="Seleccione cliente"
                    />
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    {clientesAbierto && (
                      <div className="absolute z-10 mt-1 w-full bg-gray-700 rounded-md shadow-lg border border-gray-600 max-h-60 overflow-y-auto">
                        <div className="p-2 border-b border-gray-600 sticky top-0 bg-gray-700">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={buscarCliente}
                              onChange={(e) => setBuscarCliente(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 bg-gray-800 text-white rounded focus:outline-none"
                              placeholder="Buscar cliente..."
                              autoFocus
                            />
                          </div>
                        </div>
                        {(filtrarPorTexto(clientes, buscarCliente) || []).map(
                          (cli) => (
                            <div
                              key={cli.id}
                              className={`px-4 py-2 hover:bg-gray-600 cursor-pointer ${
                                formulario.cliente_id === cli.id?.toString()
                                  ? "bg-blue-600"
                                  : ""
                              }`}
                              onClick={() => {
                                setFormulario((f) => ({
                                  ...f,
                                  cliente_id: cli.id?.toString(),
                                }));
                                setClientesAbierto(false);
                                setBuscarCliente("");
                              }}
                            >
                              {cli.nombre}
                            </div>
                          )
                        )}
                        {filtrarPorTexto(clientes, buscarCliente).length ===
                          0 && (
                          <div className="px-4 py-2 text-gray-400">
                            No hay resultados
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sucursal */}
                <div className="relative">
                  <label className="block text-sm font-medium mb-1">
                    Sucursal
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={obtenerNombre(formulario.sucursal_id, sucursales)}
                      readOnly
                      onClick={() => {
                        setSucursalesAbierto((v) => !v);
                        setClientesAbierto(false);
                      }}
                      className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white cursor-pointer"
                      placeholder="Seleccione sucursal"
                    />
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    {sucursalesAbierto && (
                      <div className="absolute z-10 mt-1 w-full bg-gray-700 rounded-md shadow-lg border border-gray-600 max-h-60 overflow-y-auto">
                        <div className="p-2 border-b border-gray-600 sticky top-0 bg-gray-700">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={buscarSucursal}
                              onChange={(e) =>
                                setBuscarSucursal(e.target.value)
                              }
                              className="w-full pl-10 pr-4 py-2 bg-gray-800 text-white rounded focus:outline-none"
                              placeholder="Buscar sucursal..."
                              autoFocus
                            />
                          </div>
                        </div>
                        {(
                          filtrarPorTexto(sucursales, buscarSucursal) || []
                        ).map((suc) => (
                          <div
                            key={suc.id}
                            className={`px-4 py-2 hover:bg-gray-600 cursor-pointer ${
                              formulario.sucursal_id === suc.id?.toString()
                                ? "bg-blue-600"
                                : ""
                            }`}
                            onClick={() => {
                              setFormulario((f) => ({
                                ...f,
                                sucursal_id: suc.id?.toString(),
                              }));
                              setSucursalesAbierto(false);
                              setBuscarSucursal("");
                            }}
                          >
                            {suc.nombre}
                          </div>
                        ))}
                        {filtrarPorTexto(sucursales, buscarSucursal).length ===
                          0 && (
                          <div className="px-4 py-2 text-gray-400">
                            No hay resultados
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Estado */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Estado
                  </label>
                  <select
                    name="estado"
                    value={formulario.estado}
                    onChange={manejarCambio}
                    className="cursor-pointer w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="aprobada">Aprobada</option>
                    <option value="rechazada">Rechazada</option>
                  </select>
                </div>

                {/* Confirmación cliente */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Confirmación Cliente
                  </label>
                  <select
                    name="confirmacion_cliente"
                    value={formulario.confirmacion_cliente}
                    onChange={manejarCambio}
                    className="cursor-pointer w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  >
                    <option value="0">No confirmado</option>
                    <option value="1">Confirmado</option>
                  </select>
                </div>

                {/* Metadatos adicionales */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Operación
                  </label>
                  <input
                    type="text"
                    list="operaciones-sugeridas-editar-cotizacion"
                    name="operacion"
                    value={formulario.operacion}
                    onChange={manejarCambio}
                    placeholder="Escriba o seleccione un tipo de operación"
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  />
                  <datalist id="operaciones-sugeridas-editar-cotizacion">
                    {OPERACIONES_SUGERIDAS.map((operacion) => (
                      <option key={operacion} value={operacion} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Mercancía
                  </label>
                  <input
                    type="text"
                    name="mercancia"
                    value={formulario.mercancia}
                    onChange={manejarCambio}
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">BL</label>
                  <input
                    type="text"
                    name="bl"
                    value={formulario.bl}
                    onChange={manejarCambio}
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Contenedor
                  </label>
                  <input
                    type="text"
                    name="contenedor"
                    value={formulario.contenedor}
                    onChange={manejarCambio}
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Puerto
                  </label>
                  <input
                    type="text"
                    name="puerto"
                    value={formulario.puerto}
                    onChange={manejarCambio}
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  />
                </div>
              </div>

              {/* Observaciones */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Observaciones
                </label>
                <textarea
                  name="observaciones"
                  value={formulario.observaciones}
                  onChange={manejarCambio}
                  className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  rows={3}
                />
              </div>

              {/* Detalle de Ítems */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium">Detalle de Ítems</h3>
                  <button
                    type="button"
                    onClick={agregarLinea}
                    className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Agregar línea
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-gray-300">
                    <thead className="bg-gray-700 text-gray-100">
                      <tr>
                        <th className="px-4 py-2">Servicio/Producto</th>
                        <th className="px-4 py-2 text-right">Cantidad</th>
                        <th className="px-4 py-2 text-right">
                          Precio Unitario
                        </th>
                        <th className="px-4 py-2 text-right">% IVA</th>
                        <th className="px-4 py-2 text-right">Subtotal</th>
                        <th className="px-4 py-2 text-right">Impuesto</th>
                        <th className="px-4 py-2 text-right">Total</th>
                        <th className="px-4 py-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(formulario.detalle || []).map((item, index) => {
                        const abierto = !!serviciosAbiertos[index];
                        const textoBusqueda = busquedaServicioFila[index] || "";
                        // Lista filtrada para ESTA fila (sin duplicar lo ya elegido en otras filas)
                        const listaBase = serviciosDisponiblesParaFila(index);
                        const listaFiltrada = filtrarPorTexto(
                          listaBase,
                          textoBusqueda,
                          "nombre"
                        );

                        return (
                          <tr key={index} className="border-b border-gray-700">
                            {/* Servicio/Producto */}
                            <td className="px-4 py-2 align-top">
                              <div className="relative">
                                <input
                                  type="text"
                                  value={obtenerNombre(
                                    item.servicio_productos_id,
                                    serviciosProductos
                                  )}
                                  readOnly
                                  onClick={() =>
                                    setServiciosAbiertos((s) => ({
                                      ...s,
                                      [index]: !s[index],
                                    }))
                                  }
                                  className="w-full px-3 py-2 border rounded bg-gray-700 text-white cursor-pointer"
                                  placeholder="Seleccione servicio"
                                />
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                                {abierto && (
                                  <div className="absolute z-20 mt-1 w-full bg-gray-700 rounded-md shadow-lg border border-gray-600 max-h-60 overflow-y-auto">
                                    <div className="p-2 border-b border-gray-600 sticky top-0 bg-gray-700">
                                      <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <input
                                          type="text"
                                          value={textoBusqueda}
                                          onChange={(e) =>
                                            setBusquedaServicioFila((b) => ({
                                              ...b,
                                              [index]: e.target.value,
                                            }))
                                          }
                                          className="w-full pl-10 pr-4 py-2 bg-gray-800 text-white rounded focus:outline-none"
                                          placeholder="Buscar servicio..."
                                          autoFocus
                                        />
                                      </div>
                                    </div>

                                    {listaFiltrada.length > 0 ? (
                                      listaFiltrada.map((serv) => (
                                        <div
                                          key={serv.id}
                                          className={`px-4 py-2 hover:bg-gray-600 cursor-pointer ${
                                            item.servicio_productos_id ===
                                            serv.id?.toString()
                                              ? "bg-blue-600"
                                              : ""
                                          }`}
                                          onClick={() => {
                                            manejarDetalleCambio(
                                              index,
                                              "servicio_productos_id",
                                              serv.id?.toString()
                                            );
                                            setServiciosAbiertos((s) => ({
                                              ...s,
                                              [index]: false,
                                            }));
                                            setBusquedaServicioFila((b) => ({
                                              ...b,
                                              [index]: "",
                                            }));
                                          }}
                                        >
                                          {serv.nombre}
                                        </div>
                                      ))
                                    ) : (
                                      <div className="px-4 py-2 text-gray-400">
                                        No hay resultados
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Cantidad */}
                            <td className="px-4 py-2 align-top">
                              <input
                                type="number"
                                className="w-full px-3 py-2 border rounded bg-gray-700 text-white text-right"
                                value={item.cantidad}
                                min={1}
                                onChange={(e) =>
                                  manejarDetalleCambio(
                                    index,
                                    "cantidad",
                                    Number(e.target.value)
                                  )
                                }
                              />
                            </td>

                            {/* Precio Unitario */}
                            <td className="px-4 py-2 align-top">
                              <input
                                type="number"
                                className="w-full px-3 py-2 border rounded bg-gray-700 text-white text-right"
                                value={item.precio_unitario}
                                min={0}
                                step="0.01"
                                onChange={(e) =>
                                  manejarDetalleCambio(
                                    index,
                                    "precio_unitario",
                                    Number(e.target.value)
                                  )
                                }
                              />
                            </td>

                            {/* % IVA */}
                            <td className="px-4 py-2 align-top">
                              <select
                                className="cursor-pointer w-full px-3 py-2 border rounded bg-gray-700 text-white text-right"
                                value={item.porcentaje_iva}
                                onChange={(e) =>
                                  manejarDetalleCambio(
                                    index,
                                    "porcentaje_iva",
                                    Number(e.target.value)
                                  )
                                }
                              >
                                <option value={0}>0%</option>
                                <option value={8}>8%</option>
                                <option value={16}>16%</option>
                              </select>
                            </td>

                            {/* Subtotal */}
                            <td className="px-4 py-2 align-top text-right">
                              {Number(item.subtotal || 0).toFixed(2)}
                            </td>

                            {/* Impuesto */}
                            <td className="px-4 py-2 align-top text-right">
                              {Number(item.impuesto || 0).toFixed(2)}
                            </td>

                            {/* Total */}
                            <td className="px-4 py-2 align-top text-right font-semibold">
                              {Number(item.total || 0).toFixed(2)}
                            </td>

                            {/* Acciones */}
                            <td className="px-4 py-2 align-top">
                              <button
                                type="button"
                                onClick={() => eliminarLinea(index)}
                                className="cursor-pointer inline-flex items-center gap-1 text-red-400 hover:text-red-300"
                                title="Eliminar línea"
                              >
                                <Trash2 className="w-4 h-4" />
                                Eliminar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totales */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-700 p-4 rounded">
                <div className="text-right">
                  <span className="font-medium">Subtotal:</span>{" "}
                  {totales.subtotal}
                </div>
                <div className="text-right">
                  <span className="font-medium">Impuesto:</span>{" "}
                  {totales.impuesto}
                </div>
                <div className="text-right font-bold">
                  <span className="font-medium">Total:</span> {totales.total}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex justify-end gap-4 pt-6">
                <button
                  type="button"
                  onClick={onClose}
                  className="cursor-pointer px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={enviando}
                  className="cursor-pointer flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {enviando ? "Guardando cambios..." : "Guardar cambios"}
                </button>
              </div>
            </form>

            {/* Éxito */}
            <ModalExito
              visible={mostrarExito}
              onClose={() => setMostrarExito(false)}
              titulo="¡Éxito!"
              mensaje={mensajeExito}
            />
            {/* Sin ModalError: errores se muestran arriba como aviso inline */}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
