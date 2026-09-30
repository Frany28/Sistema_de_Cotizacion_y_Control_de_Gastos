import React, { useState, useEffect, useCallback } from "react";
import api from "../../api/index.js";
import AgregarGasto from "../../components/AgregarGasto";
import AgregarCotizacion from "../../components/AgregarCotizacion";
import ModalExito from "../../components/Modals/ModalExito";
import ModalError from "../../components/Modals/ModalError";
import Loader from "../../components/general/Loader";
import { verificarPermisoFront } from "../../../utils/verificarPermisoFront";

const CrearRegistro = () => {
  const [servicios, setServicios] = useState([]);
  const [tipoRegistro, setTipoRegistro] = useState("");
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [itemsAgregados, setItemsAgregados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalExito, setModalExito] = useState(false);
  const [modalError, setModalError] = useState({ visible: false, mensaje: "" });
  const [categoriasGastos, setCategoriasGastos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [usuarioId, setUsuarioId] = useState(null);
  const [vistaPreviaCargando, setVistaPreviaCargando] = useState(false);

  const [mensajeExito, setMensajeExito] = useState(
    "Registro creado exitosamente."
  );

  useEffect(() => {
    try {
      const usuarioGuardado =
        JSON.parse(localStorage.getItem("usuario")) ||
        JSON.parse(sessionStorage.getItem("usuario"));

      if (usuarioGuardado?.id) {
        setUsuarioId(usuarioGuardado.id);
      } else {
        console.warn(" Usuario no encontrado en localStorage.");
      }
    } catch (error) {
      console.error(" No se puede acceder a localStorage:", error);
    }
  }, []);

  // NUEVO: función reutilizable para recargar cotizaciones bajo demanda
  const recargarCotizaciones = useCallback(async () => {
    try {
      const { data } = await api.get("/cotizaciones?page=1&limit=1000");
      setCotizaciones(
        Array.isArray(data?.cotizaciones) ? data.cotizaciones : []
      );
    } catch (error) {
      console.error("Error al cargar cotizaciones:", error);
    }
  }, []);

  // Cargar cotizaciones al montar (usando la función reutilizable)
  useEffect(() => {
    recargarCotizaciones();
  }, [recargarCotizaciones]);

  const [form, setForm] = useState({
    fecha: new Date().toISOString().split("T")[0],
    observaciones: "",
    operacion: "",
    puerto: "",
    bl: "",
    mercancia: "",
    contenedor: "",
  });
  const [datosGeneralesPreview, setDatosGeneralesPreview] = useState(form);

  useEffect(() => {
    const obtenerProveedores = async () => {
      try {
        const { data } = await api.get("/proveedores?page=1&limit=1000");

        setProveedores(data.proveedores);
      } catch (error) {
        console.error("Error al obtener proveedores:", error);
      }
    };
    obtenerProveedores();
  }, []);

  useEffect(() => {
    const inicializar = async () => {
      try {
        setLoading(true);

        const response = await api.get("/registros", {
          withCredentials: true,
        });
        setServicios(response.data.servicios);
        setClientes(response.data.clientes);
        setCategoriasGastos(response.data.categorias || []);
      } catch (err) {
        console.error("Error al cargar los datos iniciales:", err);
        setModalError({
          visible: true,
          mensaje: "Error al cargar los datos iniciales",
        });
      } finally {
        setLoading(false);
      }
    };

    inicializar();
  }, []);

  const crearCotizacion = async (datosGenerales) => {
    try {
      setLoading(true);

      const hayProducto = itemsAgregados.some(
        (item) => item.tipo === "producto"
      );

      if (!clienteSeleccionado) {
        setModalError({
          visible: true,
          mensaje: "Debe seleccionar un cliente.",
        });
        setLoading(false);
        return;
      }

      if (itemsAgregados.length === 0) {
        setModalError({
          visible: true,
          mensaje: "Debe agregar al menos un servicio o producto.",
        });
        setLoading(false);
        return;
      }

      if (!datosGenerales.fecha) {
        setModalError({
          visible: true,
          mensaje: "Debe seleccionar una fecha.",
        });
        setLoading(false);
        return;
      }

      if (hayProducto) {
        const camposObligatorios = [
          { campo: "operacion", nombre: "Operación" },
          { campo: "mercancia", nombre: "Mercancía" },
          { campo: "puerto", nombre: "Puerto" },
          { campo: "bl", nombre: "BL" },
          { campo: "contenedor", nombre: "Contenedor" },
        ];

        const camposFaltantes = camposObligatorios
          .filter(
            ({ campo }) =>
              !datosGenerales[campo] || datosGenerales[campo] === "N/A"
          )
          .map(({ nombre }) => nombre);

        if (camposFaltantes.length > 0) {
          setModalError({
            visible: true,
            mensaje:
              `Faltan completar campos obligatorios para productos:\n\n` +
              camposFaltantes.map((c) => `- ${c}`).join("\n"),
          });
          setLoading(false);
          return;
        }
      }

      const subtotalSinIva = itemsAgregados.reduce(
        (sum, item) => sum + (item.precio || 0) * (item.cantidad || 0),
        0
      );
      const totalImpuestos = itemsAgregados.reduce((sum, item) => {
        const porcentaje = item.porcentaje_iva || 0;
        const subtotalItem = (item.precio || 0) * (item.cantidad || 0);
        return sum + (subtotalItem * porcentaje) / 100;
      }, 0);
      const totalCotizacion = subtotalSinIva + totalImpuestos;

      const datosCotizacion = {
        tipo: "cotizacion",
        cliente_id: clienteSeleccionado.id,
        creadoPor: usuarioId,
        usuario: usuarioId,
        estado: "pendiente",
        confirmacion_cliente: 0,
        observaciones: datosGenerales.observaciones || "",
        fecha: datosGenerales.fecha,
        total: totalCotizacion,
        operacion: hayProducto ? datosGenerales.operacion || "N/A" : "N/A",
        mercancia: hayProducto ? datosGenerales.mercancia || "N/A" : "N/A",
        puerto: hayProducto ? datosGenerales.puerto || "N/A" : "N/A",
        bl: hayProducto ? datosGenerales.bl || "N/A" : "N/A",
        contenedor: hayProducto ? datosGenerales.contenedor || "N/A" : "N/A",
        detalle: itemsAgregados.map((item) => ({
          servicio_productos_id: item.id,
          cantidad: item.cantidad,
          precio_unitario: item.precio,
          porcentaje_iva: item.porcentaje_iva,
          tipo: item.tipo,
        })),
      };

      await api.post("/registros", datosCotizacion, {
        withCredentials: true,
      });

      // NUEVO: refrescar la lista para que la nueva cotización aparezca inmediatamente
      await recargarCotizaciones();

      setMensajeExito("¡Cotización registrada correctamente!");
      setModalExito(true);
      setItemsAgregados([]);
      setTipoRegistro("");
      setClienteSeleccionado(null);
      setForm({
        fecha: new Date().toISOString().split("T")[0],
        observaciones: "",
        operacion: "",
        puerto: "",
        bl: "",
        mercancia: "",
        contenedor: "",
      });
    } catch (error) {
      console.error("Error al crear cotización", error);

      const mensajeBase =
        error.response?.data?.message ||
        "No se pudo crear la cotización. Intenta nuevamente.";

      const erroresDetalles = error.response?.data?.errores;

      const mensajeFinal = erroresDetalles
        ? `${mensajeBase}\n\n${erroresDetalles.map((e) => `- ${e}`).join("\n")}`
        : mensajeBase;

      setModalError({
        visible: true,
        mensaje: mensajeFinal,
      });
    } finally {
      setLoading(false);
    }
  };

  const verVistaPrevia = async (datosGenerales) => {
    try {
      setVistaPreviaCargando(true);
      const usuarioGuardado =
        JSON.parse(localStorage.getItem("usuario")) ||
        JSON.parse(sessionStorage.getItem("usuario"));
      const nombreDeclarante = usuarioGuardado?.nombre || "Usuario Desconocido";

      const subtotalSinIva = itemsAgregados.reduce(
        (sum, item) => sum + (item.precio || 0) * (item.cantidad || 0),
        0
      );
      const totalImpuestos = itemsAgregados.reduce((sum, item) => {
        const porcentaje = item.porcentaje_iva || 0;
        const subtotalItem = (item.precio || 0) * (item.cantidad || 0);
        return sum + (subtotalItem * porcentaje) / 100;
      }, 0);
      const totalCotizacion = subtotalSinIva + totalImpuestos;

      const servicios = itemsAgregados
        .filter((item) => item.tipo === "servicio")
        .map((servicio) => ({
          nombre: servicio.nombre,
          cantidad: servicio.cantidad,
          precioUnitario: servicio.precio,
          iva:
            (servicio.precio *
              servicio.cantidad *
              (servicio.porcentaje_iva || 0)) /
            100,
          total:
            servicio.precio * servicio.cantidad +
            (servicio.precio *
              servicio.cantidad *
              (servicio.porcentaje_iva || 0)) /
              100,
        }));

      const productos = itemsAgregados
        .filter((item) => item.tipo === "producto")
        .map((producto) => ({
          nombre: producto.nombre,
          cantidad: producto.cantidad,
          precioUnitario: producto.precio,
          iva:
            (producto.precio *
              producto.cantidad *
              (producto.porcentaje_iva || 0)) /
            100,
          total:
            producto.precio * producto.cantidad +
            (producto.precio *
              producto.cantidad *
              (producto.porcentaje_iva || 0)) /
              100,
        }));

      const response = await api.post(
        "/registros/cotizaciones/vista-previa",
        {
          datos: {
            cliente_nombre: clienteSeleccionado?.nombre,
            fecha_emision: datosGenerales.fecha,
            declarante: nombreDeclarante,
            operacion: datosGenerales.operacion || "N/A",
            mercancia: datosGenerales.mercancia || "N/A",
            bl: datosGenerales.bl || "N/A",
            contenedor: datosGenerales.contenedor || "N/A",
            puerto: datosGenerales.puerto || "N/A",
            servicios,
            productos,
            subtotal: subtotalSinIva,
            impuesto: totalImpuestos,
            total: totalCotizacion,
          },
        },
        { responseType: "blob" }
      );

      const pdfBlob = new Blob([response.data], { type: "application/pdf" });
      const pdfUrl = window.URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, "_blank");
    } catch (error) {
      console.error("Error generando vista previa:", error);
    } finally {
      setVistaPreviaCargando(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center bg-opacity-50 z-50">
        <Loader />
      </div>
    );
  }

  const crearGasto = async (datosGasto) => {
    try {
      setLoading(true);

      // Validaciones iniciales
      if (!usuarioId) {
        setModalError({ visible: true, mensaje: "Debes iniciar sesión" });
        setLoading(false);
        return;
      }

      if (!datosGasto.documento) {
        setModalError({
          visible: true,
          mensaje: "El comprobante es obligatorio",
        });
        setLoading(false);
        return;
      }

      const formData = new FormData();

      // 2. Campos obligatorios
      formData.append("tipo", "gasto");
      formData.append("tipo_gasto_id", datosGasto.tipo_gasto_id);
      formData.append("concepto_pago", datosGasto.concepto_pago || "N/A");
      formData.append("subtotal", datosGasto.subtotal);
      formData.append("porcentaje_iva", datosGasto.porcentaje_iva || 0);
      formData.append(
        "fecha",
        new Date(datosGasto.fecha).toISOString().split("T")[0]
      );
      formData.append("documento", datosGasto.documento);
      formData.append("creadoPor", usuarioId);
      formData.append("usuario", String(parseInt(usuarioId, 10)));
      formData.append("moneda", datosGasto.moneda || "USD");

      // 3. Campos opcionales
      if (datosGasto.proveedor_id) {
        formData.append("proveedor_id", datosGasto.proveedor_id);
      }
      if (datosGasto.descripcion) {
        formData.append("descripcion", datosGasto.descripcion);
      }
      if (datosGasto.cotizacion_id) {
        formData.append("cotizacion_id", datosGasto.cotizacion_id);
      }
      if (datosGasto.moneda === "VES" && datosGasto.tasa_cambio) {
        formData.append("tasa_cambio", datosGasto.tasa_cambio);
      }

      await api.post("/registros", formData, {
        withCredentials: true,
      });

      setMensajeExito("¡Gasto registrado correctamente!");
      setModalExito(true);
      setTipoRegistro("");
    } catch (error) {
      console.error("Error:", error.response?.data || error);

      const mensajeBase =
        error.response?.data?.message || "Error al registrar el gasto.";

      const erroresDetalles = error.response?.data?.errores;

      const mensajeFinal = erroresDetalles
        ? `${mensajeBase}\n\n${erroresDetalles.map((e) => `- ${e}`).join("\n")}`
        : mensajeBase;

      setModalError({
        visible: true,
        mensaje: mensajeFinal,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pt-5 pl-5 pr-5">
      <div className=" bg-gray-800 text-white rounded-lg shadow-md p-3.5">
        <ModalExito
          visible={modalExito}
          mensaje={mensajeExito}
          onClose={() => setModalExito(false)}
        />
        <ModalError
          visible={modalError.visible}
          mensaje={modalError.mensaje}
          onClose={() => setModalError({ visible: false, mensaje: "" })}
        />

        <h1 className="text-2xl font-bold mb-6">Nuevo Registro</h1>

        <div className="mb-6">
          <label className="block text-sm font-medium text-white mb-2">
            Tipo de registro *
          </label>
          <select
            value={tipoRegistro}
            onChange={async (e) => {
              const tipo = e.target.value;

              if (tipo === "cotizacion") {
                const tienePermiso = await verificarPermisoFront(
                  "crearCotizacion"
                );
                if (!tienePermiso) {
                  setModalError({
                    visible: true,
                    mensaje:
                      "No tienes permiso para crear cotizaciones con tu rol actual.",
                  });
                  return;
                }
              }

              if (tipo === "gasto") {
                const tienePermiso = await verificarPermisoFront("crearGasto");
                if (!tienePermiso) {
                  setModalError({
                    visible: true,
                    mensaje:
                      "No tienes permiso para registrar gastos con tu rol actual.",
                  });
                  return;
                }
                // NUEVO: refrescamos cotizaciones justo al entrar a “Gasto”
                await recargarCotizaciones();
              }

              setTipoRegistro(tipo);
              setItemsAgregados([]);
            }}
            className="cursor-pointer bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
            required
          >
            <option value="">Seleccione un tipo de registro</option>
            <option value="cotizacion">Cotización</option>
            <option value="gasto">Gasto</option>
          </select>
        </div>

        {tipoRegistro === "cotizacion" && (
          <>
            <AgregarCotizacion
              servicios={servicios}
              clientes={clientes}
              setClientes={setClientes}
              setClienteSeleccionado={setClienteSeleccionado}
              clienteSeleccionado={clienteSeleccionado}
              loading={loading}
              itemsAgregados={itemsAgregados}
              setItemsAgregados={setItemsAgregados}
              onGenerarCotizacion={(datosGenerales) => {
                setForm(datosGenerales);
                crearCotizacion(datosGenerales);
              }}
              onActualizarDatos={setDatosGeneralesPreview}
            />

            {clienteSeleccionado && itemsAgregados.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => verVistaPrevia(datosGeneralesPreview)}
                  disabled={vistaPreviaCargando}
                  className={`cursor-pointer px-4 py-2 rounded text-white transition-colors
                  ${
                    vistaPreviaCargando
                      ? "bg-yellow-500 hover:bg-yellow-500 cursor-wait"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {vistaPreviaCargando ? "Cargando…" : "Ver Vista Previa (PDF)"}
                </button>
              </div>
            )}
          </>
        )}

        {tipoRegistro === "gasto" && (
          <AgregarGasto
            categoriasGastos={categoriasGastos}
            proveedores={proveedores}
            setProveedores={setProveedores}
            cotizaciones={cotizaciones}
            crearGasto={crearGasto}
            onAgregarGasto={(nuevoGasto) => {
              setItemsAgregados((prevItems) => [...prevItems, nuevoGasto]);
              setModalExito(true);
            }}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
};

export default CrearRegistro;
