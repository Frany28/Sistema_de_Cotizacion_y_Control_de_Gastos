// Navbar.jsx
import { useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { LogOut, User } from "lucide-react";
import imagenEmpresa from "../../Styles/img/Point Technology.png";
import { verificarPermisoFront } from "../../../utils/verificarPermisoFront";

function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [puedeVerUsuarios, setPuedeVerUsuarios] = useState(false);
  const [puedeVerGestorEventos, setPuedeVerGestorEventos] = useState(false);
  const dropdownRef = useRef();
  const mobileMenuRef = useRef();

  const usuario =
    JSON.parse(localStorage.getItem("usuario")) ||
    JSON.parse(sessionStorage.getItem("usuario"));

  const esAdminOSupervisor = () => {
    const rolId = usuario?.rol_id ?? usuario?.rolId;
    const rolSlug = (usuario?.rolSlug || usuario?.rol || "")
      .toString()
      .toLowerCase();
    const porId = rolId === 1 || rolId === 2;
    const porSlug = rolSlug === "admin" || rolSlug === "supervisor";
    return Boolean(porId || porSlug);
  };

  const toggleDropdown = (dropdownName) => {
    setOpenDropdown(openDropdown === dropdownName ? null : dropdownName);
  };

  const toggleUserDropdown = () => {
    setUserDropdownOpen(!userDropdownOpen);
  };

  const obtenerIniciales = (nombre = "") => {
    const partes = nombre.trim().split(" ");
    const primera = partes[0]?.charAt(0).toUpperCase() || "";
    const segunda = partes[1]?.charAt(0).toUpperCase() || "";
    return primera + segunda;
  };

  const iniciales = obtenerIniciales(usuario?.nombre);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const cerrarSesion = () => {
    localStorage.clear();
    sessionStorage.clear();
    navigate("/login");
  };

  const handleClickOutside = (event) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
      setUserDropdownOpen(false);
    }
    if (
      mobileMenuRef.current &&
      !mobileMenuRef.current.contains(event.target)
    ) {
      setIsMobileMenuOpen(false);
    }
  };

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    let activo = true;

    const cargarPermisosNavbar = async () => {
      const [tienePermisoUsuarios, tienePermisoGestorEventos] =
        await Promise.all([
          verificarPermisoFront("verUsuarios"),
          verificarPermisoFront("verEventosArchivos"),
        ]);

      if (!activo) return;

      setPuedeVerUsuarios(tienePermisoUsuarios);
      setPuedeVerGestorEventos(
        esAdminOSupervisor() && tienePermisoGestorEventos
      );
    };

    cargarPermisosNavbar();
    return () => {
      activo = false;
    };
  }, []);

  const navItems = [
    { path: "/Dashboard", label: "Principal", type: "link" },
    {
      label: "Administración",
      type: "dropdown",
      items: [
        { path: "/administracion/clientes", label: "Clientes" },
        {
          path: "/administracion/Servicios-productos",
          label: "Servicios/Productos",
        },
        { path: "/administracion/proveedores", label: "Proveedores" },
        { path: "/administracion/bancos", label: "Bancos" },
        { path: "/administracion/sucursales", label: "Sucursales" },
        ...(puedeVerUsuarios
          ? [{ path: "/administracion/usuarios", label: "Usuarios" }]
          : []),
      ],
    },
    {
      label: "Operaciones",
      type: "dropdown",
      items: [
        { path: "/operaciones/cotizaciones", label: "Cotizaciones" },
        { path: "/operaciones/gastos", label: "Gastos" },
        { path: "/operaciones/solicitudes-pago", label: "Solicitudes de Pago" },
        { path: "/operaciones/cxc", label: "CxC" },
      ],
    },
    {
      label: "Archivos",
      type: "dropdown",
      items: [
        { path: "/archivos", label: "Administrador de Archivos" },
        // Mostrar Gestor de Eventos solo a admin/supervisor
        ...(puedeVerGestorEventos
          ? [{ path: "/gestor-eventos", label: "Gestor de Eventos" }]
          : []),
      ],
    },
    { label: "Crear Registro", path: "/crearRegistro", type: "link" },
  ];

  return (
    <nav className=" border-gray-200 bg-gray-800 sticky top-0 left-0 w-full z-50">
      <div className="max-w-screen-xl mx-auto flex items-center justify-between p-4">
        {/* Logo */}
        <div className="flex">
          <img
            src={imagenEmpresa}
            className="mr-3 h-8"
            alt="Point Technology"
          />
        </div>

        <div className="flex items-center md:order-2">
          <div className="flex items-center gap-3 relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={toggleUserDropdown}
              className=" cursor-pointer flex items-center text-sm bg-gray-600 rounded-full w-8 h-8 justify-center font-semibold text-white focus:ring-4  focus:ring-gray-600"
            >
              <span className="sr-only">Open user menu</span>
              {iniciales || "US"}
            </button>

            {userDropdownOpen && (
              <div className="z-50 absolute top-12 right-0 w-56 text-base list-none  divide-y  rounded-lg shadow bg-gray-700 divide-gray-600">
                <div className="px-4 py-3">
                  <span className="block text-sm  text-white">
                    {usuario?.nombre || "Usuario"}
                  </span>
                  <span className="block text-sm truncate text-gray-500:text-gray-400">
                    {usuario?.email || "correo@ejemplo.com"}
                  </span>
                </div>
                <ul className="py-2" aria-labelledby="user-menu-button">
                  <li>
                    <a
                      href="/perfil"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-200 hover:bg-gray-600"
                    >
                      <User size={16} /> Perfil
                    </a>
                  </li>

                  <li>
                    <button
                      onClick={cerrarSesion}
                      className=" cursor-pointer w-full text-left flex items-center gap-2 px-4 py-2 text-sm  text-red-400 hover:bg-red-800"
                    >
                      <LogOut size={16} /> Cerrar sesión
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
          {/* Botón hamburguesa*/}
          <div className="md:hidden ml-2">
            <button
              onClick={toggleMobileMenu}
              type="button"
              className=" cursor-pointer inline-flex items-center p-2 w-10 h-10 justify-center text-sm  rounded-lg  focus:outline-none focus:ring-2  text-gray-400 hover:bg-gray-700 focus:ring-gray-600 "
            >
              <span className="sr-only">Open main menu</span>
              <svg
                className="w-5 h-5"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 17 14"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M1 1h15M1 7h15M1 13h15"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Menú móvil */}
        {isMobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            className="md:hidden absolute top-16 left-0 right-0 z-40 bg-gray-700 shadow-lg "
          >
            <ul className="font-medium flex flex-col p-4">
              {navItems.map((item) => {
                if (item.type === "link") {
                  const isActive = location.pathname === item.path;
                  return (
                    <li key={item.path}>
                      <a
                        href={item.path}
                        className={`block py-2 px-3 rounded-sm ${
                          isActive
                            ? "text-blue-700 font-bold border-b-2 border-blue-700"
                            : " hover:text-blue-700 text-white"
                        }`}
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                } else if (item.type === "dropdown") {
                  const isActive = item.items.some(
                    (subItem) => location.pathname === subItem.path
                  );
                  return (
                    <li key={item.label} className="relative">
                      <button
                        onClick={() => toggleDropdown(item.label)}
                        className={`cursor-pointer flex items-center justify-between w-full py-2 px-3 rounded-sm ${
                          isActive
                            ? "text-blue-700 font-bold"
                            : " hover:text-blue-700 text-white"
                        }`}
                      >
                        {item.label}
                        <svg
                          className={`w-2.5 h-2.5 ms-2.5 transform ${
                            openDropdown === item.label ? "rotate-180" : ""
                          }`}
                          aria-hidden="true"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 10 6"
                        >
                          <path
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="m1 1 4 4 4-4"
                          />
                        </svg>
                      </button>
                      {openDropdown === item.label && (
                        <div className="pl-4 py-2">
                          {item.items.map((subItem) => {
                            const isSubActive =
                              location.pathname === subItem.path;
                            return (
                              <a
                                key={subItem.path}
                                href={subItem.path}
                                className={`block px-4 py-2 text-sm rounded-sm ${
                                  isSubActive
                                    ? " bg-gray-500 text-white"
                                    : " text-gray-300 hover:bg-gray-600"
                                }`}
                              >
                                {subItem.label}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                }
                return null;
              })}
            </ul>
          </div>
        )}

        {/* Navegación para desktop */}
        <div className="hidden md:flex md:items-center md:justify-center md:w-auto">
          <ul className="font-medium flex flex-col md:flex-row md:space-x-6 p-4 md:p-0 mt-4 md:mt-0 bg-transparent">
            {navItems.map((item) => {
              if (item.type === "link") {
                const isActive = location.pathname === item.path;
                return (
                  <li key={item.path}>
                    <a
                      href={item.path}
                      className={`block py-2 px-3 rounded-sm md:p-0 ${
                        isActive
                          ? "text-blue-700 font-bold border-b-2 border-blue-700"
                          : "text-white hover:text-blue-700"
                      }`}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              } else if (item.type === "dropdown") {
                const isActive = item.items.some(
                  (subItem) => location.pathname === subItem.path
                );
                return (
                  <li key={item.label} className="relative group">
                    <button
                      className={`cursor-pointer flex items-center py-2 px-3 rounded-sm md:p-0 ${
                        isActive
                          ? "text-blue-700 font-bold"
                          : "text-white hover:text-blue-700"
                      }`}
                    >
                      {item.label}
                      <svg
                        className="w-2.5 h-2.5 ms-2.5 transition-transform duration-200 group-hover:rotate-180"
                        aria-hidden="true"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 10 6"
                      >
                        <path
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="m1 1 4 4 4-4"
                        />
                      </svg>
                    </button>
                    <div className="absolute z-10 mt-2 w-56 origin-top-right rounded-md  shadow-lg  focus:outline-none bg-gray-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform group-hover:translate-y-0 translate-y-1">
                      <div className="py-1">
                        {item.items.map((subItem) => {
                          const isSubActive =
                            location.pathname === subItem.path;
                          return (
                            <a
                              key={subItem.path}
                              href={subItem.path}
                              className={`block px-4 py-2 text-sm ${
                                isSubActive
                                  ? " bg-gray-500 text-white"
                                  : " text-gray-300 hover:bg-gray-600"
                              }`}
                            >
                              {subItem.label}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                );
              }
              return null;
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
