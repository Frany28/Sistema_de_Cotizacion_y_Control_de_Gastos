import React from "react";

const OPERACIONES_SUGERIDAS = ["Importación", "Exportación"];

export default function DatosGeneralesCotizacion({
  datos,
  onChange,
  mostrarCamposOperacion,
}) {
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    onChange((prevDatos) => ({
      ...prevDatos,
      [name]: name === "observaciones" ? value.trim() : value,
    }));
  };

  return (
    <div className="bg-gray-800 p-4 rounded-xl shadow-md mb-4 text-white">
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="fecha" className="block text-sm font-medium mb-1">
            Fecha de Cotización
          </label>
          <input
            type="date"
            id="fecha"
            name="fecha"
            value={datos.fecha}
            onChange={handleInputChange}
            className="w-full p-2 rounded-md bg-gray-700 border border-gray-600 text-white"
          />
        </div>
      </div>

      {/* Mostrar campos de operación solo si corresponde */}
      {mostrarCamposOperacion && (
        <>
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="operacion"
                className="block text-sm font-medium mb-1"
              >
                Tipo de Operación
              </label>
              <input
                type="text"
                id="operacion"
                list="operaciones-sugeridas-cotizacion"
                name="operacion"
                value={datos.operacion || ""}
                onChange={handleInputChange}
                placeholder="Escriba o seleccione un tipo de operación"
                className="w-full p-2 rounded-md bg-gray-700 border border-gray-600 text-white"
              />
              <datalist id="operaciones-sugeridas-cotizacion">
                {OPERACIONES_SUGERIDAS.map((operacion) => (
                  <option key={operacion} value={operacion} />
                ))}
              </datalist>
            </div>

            <div>
              <label
                htmlFor="puerto"
                className="block text-sm font-medium mb-1"
              >
                Puerto
              </label>
              <input
                type="text"
                id="puerto"
                placeholder="ej: Puerto la Palma"
                name="puerto"
                value={datos.puerto || ""}
                onChange={handleInputChange}
                className="w-full p-2 rounded-md bg-gray-700 border border-gray-600 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="bl" className="block text-sm font-medium mb-1">
                BL
              </label>
              <input
                type="text"
                id="bl"
                name="bl"
                placeholder="ej: 123456789"
                value={datos.bl || ""}
                onChange={handleInputChange}
                className="w-full p-2 rounded-md bg-gray-700 border border-gray-600 text-white"
              />
            </div>

            <div>
              <label
                htmlFor="mercancia"
                className="block text-sm font-medium mb-1"
              >
                Mercancía
              </label>
              <input
                type="text"
                id="mercancia"
                name="mercancia"
                placeholder="descripción de la mercancía"
                value={datos.mercancia || ""}
                onChange={handleInputChange}
                className="w-full p-2 rounded-md bg-gray-700 border border-gray-600 text-white"
              />
            </div>

            <div>
              <label
                htmlFor="contenedor"
                className="block text-sm font-medium mb-1"
              >
                Contenedor
              </label>
              <input
                type="text"
                id="contenedor"
                name="contenedor"
                placeholder="ej: 123456789"
                value={datos.contenedor || ""}
                onChange={handleInputChange}
                className="w-full p-2 rounded-md bg-gray-700 border border-gray-600 text-white"
              />
            </div>
          </div>
        </>
      )}

      <div className="pt-4">
        <label
          htmlFor="observaciones"
          className="block text-sm font-medium mb-1"
        >
          Observaciones
        </label>
        <textarea
          id="observaciones"
          name="observaciones"
          rows="3"
          placeholder="Observaciones adicionales"
          value={datos.observaciones ?? ""}
          onChange={(e) => {
            const { name, value } = e.target;
            onChange((prevDatos) => ({
              ...prevDatos,
              [name]: value,
            }));
          }}
          className="w-full p-2 rounded-md bg-gray-700 border border-gray-600 text-white resize-none"
        ></textarea>
      </div>
    </div>
  );
}
