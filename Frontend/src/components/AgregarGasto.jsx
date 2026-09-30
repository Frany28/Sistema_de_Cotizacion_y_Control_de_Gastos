import React, { useState, useEffect } from "react";
import TipoGastoSelector from "../components/ComponentesGasto/TipoGastoSelector";
import DatosGeneralesGasto from "../components/ComponentesGasto/DatosGeneralesGasto";
import DatosMonetariosGasto from "../components/ComponentesGasto/DatosMonetarios";
import ProveedorSelector from "../components/ComponentesGasto/ProveedorSelector";
import CotizacionSelector from "../components/ComponentesGasto/CotizacionSelector";
import ResumenGasto from "../components/ComponentesGasto/ResumenGasto";

export default function AgregarGasto({
  proveedores = [],
  setProveedores,
  cotizaciones = [],
  crearGasto,
}) {
  // Estado inicial con todos los campos que usaremos
  const [gasto, setGasto] = useState({
    tipo_gasto_id: "",
    proveedor_id: null,
    cotizacion_id: null,
    concepto_pago: "",
    fecha: new Date().toISOString().split("T")[0],
    descripcion: "",
    subtotal: "",
    porcentaje_iva: 0,
    tasa_cambio: "",
    moneda: "USD",
    documento: null,
  });

  const [tipoGastoSeleccionado, setTipoGastoSeleccionado] = useState(null);
  const [cotizacionSeleccionada, setCotizacionSeleccionada] = useState(null);

  // Cuando el usuario elige una cotización, guardamos su id en gasto
  useEffect(() => {
    if (cotizacionSeleccionada) {
      setGasto((prev) => ({
        ...prev,
        cotizacion_id: cotizacionSeleccionada.id,
      }));
    }
  }, [cotizacionSeleccionada]);

  const nombreTipo = tipoGastoSeleccionado?.nombre?.toLowerCase() || "";

  // 🔹 NUEVO: detectar explícitamente si es gasto Operativo (id = 1)
  const esGastoOperativo = tipoGastoSeleccionado?.id === 1;

  // 🔹 Ajustado: incluir Operativo dentro de los tipos que requieren proveedor
  const esProveedor =
    esGastoOperativo ||
    nombreTipo.includes("proveedor") ||
    nombreTipo.includes("servicio prestado");

  const esRentable = tipoGastoSeleccionado?.rentable === 1;

  const handleRegistrar = () => {
    crearGasto(gasto);
  };

  return (
    <div className="mx-auto p-6 rounded-lg bg-gray-900">
      <h2 className="text-xl font-semibold mb-6 text-white">
        Crear Solicitud de Gasto
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 1. Selector de Tipo de Gasto */}
        <TipoGastoSelector
          tipoGastoSeleccionado={tipoGastoSeleccionado}
          onSeleccionar={(tipo) => {
            setTipoGastoSeleccionado(tipo);
            setGasto((prev) => ({
              ...prev,
              tipo_gasto_id: tipo.id,
            }));
          }}
        />

        {/* 2. Selector de Proveedor (ahora también para Operativo) */}
        {esProveedor && (
          <ProveedorSelector
            proveedores={proveedores}
            setProveedores={setProveedores}
            proveedorSeleccionado={
              proveedores.find((p) => p.id === gasto.proveedor_id) || null
            }
            onSeleccionar={(prov) =>
              setGasto((prev) => ({
                ...prev,
                proveedor_id: prov.id,
              }))
            }
          />
        )}

        {/* 3. Selector de Cotización (solo si es rentable) */}
        {esRentable && (
          <CotizacionSelector
            cotizaciones={cotizaciones}
            cotizacionSeleccionada={cotizacionSeleccionada}
            onSeleccionar={setCotizacionSeleccionada}
          />
        )}

        {/* 4. Datos Generales del Gasto */}
        <DatosGeneralesGasto
          gasto={gasto}
          setGasto={setGasto}
        />

        {/* 5. Datos Monetarios (subtotal, IVA, total) */}
        <DatosMonetariosGasto gasto={gasto} setGasto={setGasto} />

        {/* 6. Resumen y botón de registrar */}
        <ResumenGasto gasto={gasto} onRegistrar={handleRegistrar} />
      </div>
    </div>
  );
}
