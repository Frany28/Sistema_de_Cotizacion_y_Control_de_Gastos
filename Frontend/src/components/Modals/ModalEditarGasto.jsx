import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pencil, Search, X } from "lucide-react";
import api from "../../api/index";
import ModalExito from "./ModalExito";
import ModalError from "./ModalError";

export default function ModalEditarGasto({
  visible,
  onClose,
  gasto,
  onSave,
  proveedores = [],
  tiposGasto = [],
  cotizacionesIniciales = [],
}) {
  const [form, setForm] = useState({
    id: "",
    tipo_gasto_id: "",
    proveedor_id: "",
    cotizacion_id: "",
    concepto_pago: "",
    descripcion: "",
    subtotal: "0.00",
    porcentaje_iva: 16,
    fecha: new Date().toISOString().split("T")[0],
    moneda: "USD",
    tasa_cambio: "",
    documento: null,
  });

  const [camposVisibles, setCamposVisibles] = useState({
    proveedor: false,
    cotizacion: false,
  });

  const [cotizaciones, setCotizaciones] = useState(cotizacionesIniciales);
  const [busquedaCotizacion, setBusquedaCotizacion] = useState("");
  const [showCotizaciones, setShowCotizaciones] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);
  const [documentoArchivo, setDocumentoArchivo] = useState(null);
  const [showExito, setShowExito] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleFileChange = (e) => {
    setDocumentoArchivo(e.target.files[0] || null);
  };

  // Formatea mientras escribe (0,00 → 0,08 → 8,50 → 85,00...)
  const formatearMontoLatam = (valor) => {
    if (!valor) return "0,00";

    // Eliminar todo lo que NO sea dígito
    const soloNumeros = valor.replace(/\D/g, "");

    // Si no hay número, devolver formato base
    if (!soloNumeros) return "0,00";

    // Convertir todo a centavos
    const numero = parseInt(soloNumeros, 10);

    // Convertir a formato decimal "real"
    const conDecimales = (numero / 100).toFixed(2);

    // Formato LATAM: miles con punto, decimales con coma
    return conDecimales.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  // Convierte "1.234,56" → 1234.56 (para backend)
  const parsearMontoLatam = (valor) => {
    if (!valor) return 0;
    return parseFloat(valor.replace(/\./g, "").replace(",", "."));
  };

  const actualizarCamposVisibles = (tipoGastoId) => {
    const tipoObj = (Array.isArray(tiposGasto) ? tiposGasto : []).find(
      (t) => t.id.toString() === tipoGastoId.toString()
    ) || { nombre: "", rentable: 0 };
    if (!tipoObj.nombre) return;

    const requiereProveedor = /proveedor|servicio\s+prestado|operativo/i.test(
      tipoObj.nombre
    );
    const requiereCotizacion =
      tipoObj.rentable === 1 || /servicio\s+prestado/i.test(tipoObj.nombre);

    setCamposVisibles({
      proveedor: requiereProveedor,
      cotizacion: requiereCotizacion,
    });

    // Limpiar campos que dejan de aplicar
    setForm((prev) => ({
      ...prev,
      proveedor_id:
        requiereProveedor || prev.proveedor_id ? prev.proveedor_id : "",
      cotizacion_id: requiereCotizacion ? prev.cotizacion_id : "",
    }));

    if (requiereCotizacion && cotizaciones.length === 0) {
      cargarCotizaciones();
    }
  };

  // Cerrar modal exito
  const handleDeleteExitoClose = () => {
    setShowExito(false);
  };
  // Cerrar modal error
  const handleDeleteErrorClose = () => {
    setShowError(false);
  };

  useEffect(() => {
    if (Array.isArray(cotizacionesIniciales) && cotizacionesIniciales.length) {
      setCotizaciones(cotizacionesIniciales);
    }
  }, [cotizacionesIniciales]);

  /** Descarga cotizaciones para el desplegable cuando es necesario */
  const cargarCotizaciones = async () => {
    try {
      const { data } = await api.get("/cotizaciones", {
        params: { page: 1, limit: 1000 },
      });

      const lista = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
        ? data
        : [];
      setCotizaciones(lista);
    } catch (err) {
      console.error("Error cargando cotizaciones:", err);
      setCotizaciones([]);
    }
  };

  const cargarListasAdicionales = async () => {
    setLoadingLists(true);
    try {
      const [prov, suc, tipos] = await Promise.all([
        proveedores.length === 0
          ? api.get("/proveedores")
          : Promise.resolve({ data: proveedores }),
        tiposGasto.length === 0
          ? api.get("/gastos/tipos")
          : Promise.resolve({ data: tiposGastoLocal }),
      ]);

      if (proveedoresLocal.length === 0) setProveedoresLocal(prov.data);
      if (tiposGastoLocal.length === 0) setTiposGastoLocal(tipos.data);
    } catch (e) {
      console.error("Error cargando listas adicionales:", e);
    } finally {
      setLoadingLists(false);
      if (form.tipo_gasto_id) actualizarCamposVisibles(form.tipo_gasto_id);
    }
  };

  /** Devuelve el nombre legible del ítem seleccionado para inputs readonly */
  const getNombreSeleccionado = (id, lista, campo = "nombre") => {
    if (!id || !Array.isArray(lista)) return "";
    const item = lista.find((el) => el.id.toString() === id.toString());
    return item ? item[campo] : "";
  };

  useEffect(() => {
    if (visible && gasto) {
      const fechaFormateada = gasto.fecha
        ? new Date(gasto.fecha).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];
      // Limpiar campos de búsqueda
      if (
        Array.isArray(cotizacionesIniciales) &&
        cotizacionesIniciales.length
      ) {
        setCotizaciones(cotizacionesIniciales);
      }

      // Inicializar el formulario con los datos del gasto
      setForm({
        id: gasto.id,
        concepto_pago: gasto.concepto_pago || "",
        descripcion: gasto.descripcion || "",
        subtotal: gasto.subtotal
          ? parseFloat(gasto.subtotal).toFixed(2)
          : "0.00",
        tipo_gasto_id: gasto.tipo_gasto_id?.toString() || "",
        proveedor_id: gasto.proveedor_id?.toString() || "",
        porcentaje_iva: parseFloat(gasto.porcentaje_iva) || 16,
        fecha: fechaFormateada,
        cotizacion_id: gasto.cotizacion_id?.toString() || "",
        moneda: gasto.moneda || "USD",
        tasa_cambio: gasto.tasa_cambio?.toString() || "",
        documento: gasto.documento || null,
      });

      if (
        proveedores.length === 0 ||
        tiposGasto.length === 0
      ) {
        cargarListasAdicionales();
      }
    }
  }, [visible, gasto]);

  useEffect(() => {
    if (visible && form.tipo_gasto_id) {
      actualizarCamposVisibles(form.tipo_gasto_id);
    }
  }, [tiposGasto, form.tipo_gasto_id, visible]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (name === "tipo_gasto_id") {
      actualizarCamposVisibles(value);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();

    // 1 Validaciones
    if (!form.tipo_gasto_id)
      return (
        setErrorMsg("Debe seleccionar un tipo de gasto"), setShowError(true)
      );

    if (!form.concepto_pago)
      return setErrorMsg("El concepto de pago es requerido"), setErrorMsg(true);
    if (!form.fecha)
      return setErrorMsg("La fecha es requerida"), setShowError(true);

    if (camposVisibles.proveedor && !form.proveedor_id) {
      return setErrorMsg("Debe seleccionar un proveedor");
    }
    if (camposVisibles.cotizacion && !form.cotizacion_id) {
      return setErrorMsg("Debe seleccionar una cotización");
    }

    const sub = parsearMontoLatam(form.subtotal);
    if (isNaN(sub) || sub <= 0)
      return setErrorMsg("El subtotal debe ser mayor a 0"), setShowError(true);

    const iva = parseFloat(form.porcentaje_iva);
    const impuesto = parseFloat(((sub * iva) / 100).toFixed(2));
    const total = parseFloat((sub + impuesto).toFixed(2));

    const data = new FormData();
    data.append("concepto_pago", form.concepto_pago);
    data.append("descripcion", form.descripcion);
    data.append("subtotal", String(sub.toFixed(2)));
    data.append("porcentaje_iva", String(iva));
    data.append("impuesto", String(impuesto));
    data.append("total", String(total));
    data.append("fecha", form.fecha);
    data.append("tipo_gasto_id", form.tipo_gasto_id);
    data.append("moneda", form.moneda);

    if (gasto?.estado === "rechazado") {
      data.append("estado", "pendiente");
      data.append("motivo_rechazo", "");
    }
    if (form.tasa_cambio) {
      data.append("tasa_cambio", String(parseFloat(form.tasa_cambio)));
    }

    if (camposVisibles.proveedor) {
      data.append("proveedor_id", form.proveedor_id);
    }
    if (camposVisibles.cotizacion) {
      data.append("cotizacion_id", form.cotizacion_id);
    }

    if (documentoArchivo) {
      data.append("documento", documentoArchivo);
    }

    // 4 Enviar
    try {
      const { data: resp } = await api.put(`/gastos/${form.id}`, data, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (onSave) onSave(resp.data || resp);
      setShowExito(true);
      onClose();
    } catch (err) {
      setErrorMsg(err.response?.data?.message || "Error al actualizar gasto");
      setShowError(true);
      onClose();
    }
  };

  return (
    <>
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
              className="bg-gray-800 text-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* CABECERA  */}
              <div className="sticky top-0 bg-gray-800 p-6 border-b border-gray-700 flex justify-between items-center z-10">
                <div className="flex items-center gap-3">
                  <Pencil className="w-6 h-6 text-blue-500" />
                  <h2 className="cursor-pointer text-xl font-semibold">
                    Editar Gasto
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="cursor-pointer text-gray-400 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/*FORMULARIO */}
              <form
                id="modal-form"
                onSubmit={handleSave}
                className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {/* Tipo de Gasto */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Tipo de Gasto *
                  </label>
                  <select
                    name="tipo_gasto_id"
                    value={form.tipo_gasto_id}
                    onChange={handleChange}
                    className="cursor-pointer w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                    required
                  >
                    <option value="">Seleccione tipo</option>
                    {(Array.isArray(tiposGasto) ? tiposGasto : []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Proveedor (condicional) */}
                {camposVisibles.proveedor && (
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Proveedor *
                    </label>
                    <select
                      name="proveedor_id"
                      value={form.proveedor_id}
                      onChange={handleChange}
                      className="cursor-pointer w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                      required={camposVisibles.proveedor}
                    >
                      <option value="">Seleccione proveedor</option>
                      {(Array.isArray(proveedores) ? proveedores : []).map(
                        (p) => (
                          <option key={p.id} value={p.id.toString()}>
                            {p.nombre}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                )}

                {/* Fecha */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Fecha *
                  </label>
                  <input
                    type="date"
                    name="fecha"
                    value={form.fecha}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                    required
                  />
                </div>

                {/* Moneda */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Moneda
                  </label>
                  <select
                    name="moneda"
                    value={form.moneda}
                    onChange={handleChange}
                    className="cursor-pointer w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  >
                    <option value="USD">USD - Dólares</option>
                    <option value="VES">VES - Bolívares</option>
                  </select>
                </div>

                {/* Subtotal */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Subtotal *
                  </label>
                  <input
                    type="text"
                    name="subtotal"
                    value={form.subtotal}
                    onChange={(e) => {
                      const valorFormateado = formatearMontoLatam(
                        e.target.value
                      );
                      setForm((prev) => ({
                        ...prev,
                        subtotal: valorFormateado,
                      }));
                    }}
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                    required
                  />
                </div>

                {/* % IVA */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    % IVA
                  </label>
                  <select
                    name="porcentaje_iva"
                    value={form.porcentaje_iva}
                    onChange={handleChange}
                    className="cursor-pointer w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  >
                    <option value="0">0% - Exento</option>
                    <option value="8">8% - Reducido</option>
                    <option value="16">16% - General</option>
                  </select>
                </div>


                {/* Cotización (condicional) */}
                {camposVisibles.cotizacion && (
                  <div className="col-span-2 relative">
                    <label className="block text-sm font-medium mb-1">
                      Cotización Relacionada
                    </label>
                    <input
                      type="text"
                      value={
                        getNombreSeleccionado(
                          form.cotizacion_id,
                          cotizaciones,
                          "codigo"
                        ) ||
                        gasto?.cotizacion_codigo ||
                        ""
                      }
                      readOnly
                      onClick={() => setShowCotizaciones(!showCotizaciones)}
                      className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white cursor-pointer"
                      placeholder="Seleccione cotización"
                    />
                    {showCotizaciones && (
                      <div className="absolute z-10 mt-1 w-full bg-gray-700 rounded-md shadow-lg border border-gray-600 max-h-60 overflow-y-auto">
                        <div className="p-2 border-b border-gray-600 sticky top-0 bg-gray-700">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={busquedaCotizacion}
                              onChange={(e) =>
                                setBusquedaCotizacion(e.target.value)
                              }
                              className="w-full pl-10 pr-4 py-2 bg-gray-800 text-white rounded focus:outline-none"
                              placeholder="Buscar cotización…"
                              autoFocus
                            />
                          </div>
                        </div>
                        {(() => {
                          const resultados = cotizaciones.filter((cot) =>
                            cot.codigo
                              .toLowerCase()
                              .includes(busquedaCotizacion.toLowerCase())
                          );

                          if (resultados.length === 0) {
                            return (
                              <div className="px-4 py-2 text-gray-400">
                                No hay resultados
                              </div>
                            );
                          }

                          return resultados.map((cot) => (
                            <div
                              key={cot.id}
                              className={`px-4 py-2 hover:bg-gray-600 cursor-pointer ${
                                form.cotizacion_id === cot.id.toString()
                                  ? "bg-blue-600"
                                  : ""
                              }`}
                              onClick={() => {
                                setForm((prev) => ({
                                  ...prev,
                                  cotizacion_id: cot.id.toString(),
                                }));
                                setShowCotizaciones(false);
                                setBusquedaCotizacion("");
                              }}
                            >
                              {cot.codigo}
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* Tasa de cambio (solo si la moneda VES) */}
                {form.moneda === "VES" && (
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Tasa de Cambio (BS/USD) *
                    </label>
                    <input
                      type="text"
                      name="tasa_cambio"
                      value={form.tasa_cambio}
                      onChange={(e) => {
                        // Permitir solo números y coma/punto
                        let v = e.target.value.replace(/[^0-9.,]/g, "");

                        // Convertimos cualquier coma a punto para decimales
                        v = v.replace(",", ".");

                        // Limitar a máximo 2 decimales
                        if (v.includes(".")) {
                          const [entero, dec] = v.split(".");
                          v = entero + "." + dec.slice(0, 2);
                        }

                        setForm((prev) => ({ ...prev, tasa_cambio: v }));
                      }}
                      className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                      required
                    />
                  </div>
                )}

                {/* Concepto de Pago */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    Concepto de Pago *
                  </label>
                  <input
                    type="text"
                    name="concepto_pago"
                    value={form.concepto_pago}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                    required
                  />
                </div>

                {/* Documento */}
                <div className="col-span-2">
                  <label className="block mb-1 text-sm font-medium text-white">
                    {form.documento && !documentoArchivo
                      ? "Documento previo"
                      : "Cambiar / subir documento (imagen o PDF)"}
                  </label>

                  {/* Enlace al archivo existente */}
                  {form.documento && !documentoArchivo && (
                    <a
                      href={gasto?.urlFacturaFirmada || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block underline text-blue-500 mb-2"
                    >
                      {form.documento.split("/").pop()}
                    </a>
                  )}

                  {/* Input para subir o reemplazar */}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileChange}
                    className="
                  block w-full p-2.5 text-gray-200 rounded
                  file:px-4 file:py-2
                  file:bg-gray-600 file:text-gray-200
                  file:border file:border-gray-500
                  file:rounded file:cursor-pointer
                  file:hover:bg-gray-500
                  transition duration-200 ease-in-out
                "
                  />
                </div>

                {/* Descripción */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">
                    Descripción
                  </label>
                  <textarea
                    name="descripcion"
                    value={form.descripcion}
                    onChange={handleChange}
                    rows="3"
                    className="w-full px-3 py-2 border rounded-md bg-gray-700 text-white"
                  />
                </div>
              </form>

              <div className="sticky bottom-0 bg-gray-800 p-4 border-t border-gray-700 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="cursor-pointer px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="modal-form"
                  className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                >
                  Guardar Cambios
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ModalExito
        visible={showExito}
        onClose={() => {
          setShowExito(false);
        }}
        titulo="¡Gasto actualizado!"
        mensaje="Los cambios se han guardado correctamente."
      />

      <ModalError
        visible={showError}
        onClose={handleDeleteErrorClose}
        titulo="Error"
        mensaje={errorMsg}
      />
    </>
  );
}
