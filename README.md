# Sistema de Cotización y Control de Gastos

Aplicación web full stack para la gestión de clientes, cotizaciones, gastos y solicitudes de pago.

El sistema permite centralizar procesos administrativos y financieros mediante una interfaz web conectada a una API REST y una base de datos MySQL.

## Arquitectura

El proyecto está dividido en dos aplicaciones:

- `Frontend/` — SPA desarrollada con React y Vite.
- `Backend/` — API REST desarrollada con Node.js y Express.

## Tecnologías

### Frontend

- React 19
- Vite 7
- Tailwind CSS 4
- React Router
- Axios
- Framer Motion
- Recharts
- Flowbite
- Styled Components
- Lucide React

### Backend

- Node.js 22
- Express 5
- MySQL
- Sequelize
- Redis
- bcrypt
- Express Session
- Multer
- AWS S3
- PDFKit
- Puppeteer
- Node Cron

## Funcionalidades

- Gestión de clientes.
- Creación y administración de cotizaciones.
- Registro y control de gastos.
- Gestión de solicitudes de pago.
- Autenticación y manejo de sesiones.
- Almacenamiento de documentos y archivos.
- Generación de documentos PDF.
- Visualización de información mediante gráficos.
- Gestión de comprobantes y facturas.
- Integración con almacenamiento en AWS S3.
- API REST para comunicación entre frontend y backend.

## Estructura del proyecto

```text
Sistema_de_Cotizacion_y_gastos/
├── Backend/
│   └── src/
│       ├── api/
│       ├── config/
│       ├── controllers/
│       ├── jobs/
│       ├── Middleware/
│       ├── routes/
│       ├── services/
│       └── utils/
│
├── Frontend/
│   └── src/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       ├── pages/
│       ├── services/
│       └── Styles/
│
├── netlify.toml
└── README.md
