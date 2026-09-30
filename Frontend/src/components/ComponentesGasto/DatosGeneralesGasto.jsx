import React from "react";

const DatosBasicosGasto = ({ gasto, setGasto }) => {
  const handleChange = (e) => {
    const { name, value } = e.target;
    setGasto((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const tiposValidos = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ];
    if (!tiposValidos.includes(file.type)) {
      alert("Solo se permiten imagenes (png, jpg, webp) o PDF.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert("El archivo no puede superar los 2 MB.");
      return;
    }

    setGasto((prev) => ({ ...prev, documento: file }));
  };

  return (
    <div className="grid grid-cols-1 gap-6 bg-gray-800 p-6 rounded-xl shadow-md text-white">
      <div>
        <label className="text-sm mb-1 block text-white">
          Concepto del Gasto *
        </label>
        <input
          type="text"
          name="concepto_pago"
          value={gasto.concepto_pago || ""}
          onChange={handleChange}
          placeholder="Ej: Servicios generales"
          className="w-full p-2 rounded bg-gray-700 border border-gray-600"
          required
        />
      </div>

      <div>
        <label className="text-sm mb-1 block text-white">
          Fecha del Gasto *
        </label>
        <input
          type="date"
          name="fecha"
          defaultValue={gasto.fecha || new Date().toISOString().split("T")[0]}
          onChange={handleChange}
          className="w-full p-2 rounded bg-gray-700 border border-gray-600 text-white"
          required
        />
      </div>

      <div className="col-span-1 md:col-span-2">
        <label className="text-sm mb-1 block text-white">Descripcion</label>
        <textarea
          name="descripcion"
          value={gasto.descripcion || ""}
          onChange={handleChange}
          className="w-full p-2 rounded bg-gray-700 border border-gray-600 text-white"
          placeholder="Detalle adicional del gasto..."
          rows={3}
        />
      </div>

      <div className="col-span-1">
        <label className="block mb-1 text-sm font-medium text-white">
          Documento (imagen o PDF) *
        </label>
        <input
          type="file"
          accept="image/*,application/pdf"
          name="documento"
          onChange={handleFileChange}
          required
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
    </div>
  );
};

export default DatosBasicosGasto;
