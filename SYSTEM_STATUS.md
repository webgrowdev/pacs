# 🏥 PACsMed — Estado del Sistema

> **Última actualización:** 2026-04-05 | **Versión del sistema:** 0.3.0
> **Mantenido por:** equipo de desarrollo | **Repositorio:** webgrowdev/pacs

---

## 📦 Estado de Módulos

> Actualizado: 2026-04-05 | Versión del sistema: 0.3.0

| # | Módulo | Código | Versión | Estado | Descripción | Próximos pasos |
|---|--------|--------|---------|--------|-------------|----------------|
| 1 | 🗄️ Almacenamiento PACS | `PACS` | 1.0.0 | ✅ Activo | DICOMweb (WADO-RS/STOW-RS/QIDO-RS), SCP Server, carga de archivos y carpetas, DICOMDIR | Integrar Orthanc para producción enterprise |
| 2 | 📝 Informes Radiológicos | `INFORMES` | 1.0.0 | ✅ Activo | Visor CornerstoneJS v3 extendido, redacción, firma, PDF, IA editorial | Firma digital real (PKCS#7), DICOM SR |
| 3 | 📅 Agenda y Turnos | `AGENDA` | 0.0.0 | 🔴 Pendiente | Turnos, recursos, modalidades, calendario | Diseño DB → API → UI calendario |
| 4 | 🏥 Admisión y Recepción | `ADMISION` | 0.0.0 | 🔴 Pendiente | Registro pacientes, órdenes, DICOM MWL | Requiere módulo AGENDA |
| 5 | 📡 Comunicación Equipos | `COMUNICACION` | 0.1.0 | 🟡 Parcial | SCP Server activo, DICOMweb implementado | MPPS, HL7 ADT, MWL completo |
| 6 | 💰 Facturación Argentina | `FACTURACION` | 0.0.0 | 🔴 Pendiente | AFIP/ARCA, obras sociales, nomenclador AMB/PMC | Investigar API ARCA, obras sociales |
| 7 | 👤 Portal Paciente | `PORTAL_PACIENTE` | 0.5.0 | 🟡 Parcial | Ver estudios, descargar PDF, resumen IA | Notificaciones email, acceso por link |
| 8 | 👨‍⚕️ Portal Médico | `PORTAL_MEDICO` | 0.0.0 | 🔴 Pendiente | Derivaciones, acceso estudios externos | Token de acceso temporal, API REST |
| 9 | ⚙️ Sistema Modular | `SYSTEM` | 1.0.0 | ✅ Activo | Registro de módulos, activación por tenant, guards UI | Multitenancy completo, licenciamiento |

### Leyenda de estados
| Ícono | Estado | Significado |
|-------|--------|-------------|
| ✅ | Activo | Implementado y en producción |
| 🟡 | Parcial | En desarrollo o implementación incompleta |
| 🔴 | Pendiente | No iniciado |
| 🚧 | En construcción | PR abierto activamente |

---

## 🏗️ Estado por Capa Técnica

| Capa | Componente | Estado | Notas |
|------|-----------|--------|-------|
| **Backend** | Express + TypeScript | ✅ | Node.js, ESM, ts-node |
| **Backend** | Prisma ORM | ✅ | MySQL / PostgreSQL (configurable) |
| **Backend** | Auth (JWT) | ✅ | Access 15min + Refresh 7d (httpOnly cookie) |
| **Backend** | DICOM SCP Server | ✅ | `dicom-server` package |
| **Backend** | DICOMweb (WADO/STOW/QIDO) | ✅ | Endpoints `/wado/*` |
| **Backend** | IA asistente | 🟡 | OpenAI GPT-4o, sólo texto |
| **Backend** | Sistema Modular API | ✅ | `/api/system/*` |
| **Frontend** | React 19 + Vite + TS | ✅ | |
| **Frontend** | CornerstoneJS v3 | ✅ | Visor DICOM completo |
| **Frontend** | Visor herramientas extendidas | ✅ | 11 herramientas, presets, controles de vista |
| **Frontend** | Carga de carpeta DICOM | ✅ | `webkitdirectory`, DICOMDIR support |
| **Frontend** | Portal Paciente | 🟡 | Funcional, sin notificaciones |
| **Frontend** | Sistema Modular UI | ✅ | `useModules`, `ModuleGuard`, admin page |
| **DB** | MySQL | ✅ | Default provider |
| **DB** | PostgreSQL | ✅ | Cambiar `DATABASE_PROVIDER=postgresql` |
| **Infra** | Docker Compose | 🟡 | Solo DB, backend sin contenedor propio aún |
| **Infra** | HTTPS/TLS | 🔴 | Requiere reverse proxy (nginx/caddy) |

---

## 🏛️ Arquitectura Modular

```
┌───────────────────────────────────────────────────────────────┐
│                        CORE / KERNEL                          │
│         Auth (JWT) · Usuarios · Roles · Config Módulos        │
│         Audit Log · Notificaciones · Sistema Modular          │
└───────────────────────┬───────────────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    [PACS]         [INFORMES]    [PORTAL_PACIENTE]   ← Módulos activos
         │              │
         ▼              ▼
  DICOMweb         CornerstoneJS v3
  SCP Server       Visor extendido
  File Storage     IA editorial
                   PDF generator

    [AGENDA]    [ADMISION]  [COMUNICACION]  [FACTURACION]  ← Pendientes
    🔴           🔴           🟡              🔴
```

### Flujo de autenticación
```
Usuario → POST /auth/login
        ← accessToken (memoria) + refreshToken (httpOnly cookie)
        
Cada request → Authorization: Bearer <accessToken>
Token expirado → POST /auth/refresh (auto via interceptor)
Inactividad 30min → auto-logout (HIPAA workstation standard)
```

### Flujo de módulos
```
Login exitoso → GET /api/system/my-modules
             ← ['PACS', 'INFORMES', 'PORTAL_PACIENTE']
             → sessionStorage.setItem('pacsModules', ...)
             
<ModuleGuard module="AGENDA"> → hasModule('AGENDA') === false
                              → renderiza "Módulo no disponible"
```

---

## 🔌 API Endpoints

### Implementados ✅

| Método | Endpoint | Autenticación | Descripción |
|--------|----------|---------------|-------------|
| POST | `/api/auth/login` | Pública | Login con email/password |
| POST | `/api/auth/refresh` | Cookie | Renovar access token |
| POST | `/api/auth/logout` | Auth | Cerrar sesión |
| GET | `/api/users` | ADMIN | Listar usuarios |
| POST | `/api/users` | ADMIN | Crear usuario |
| PUT | `/api/users/:id` | ADMIN | Actualizar usuario |
| DELETE | `/api/users/:id` | ADMIN | Eliminar usuario |
| GET | `/api/patients` | Auth | Listar pacientes (paginado) |
| POST | `/api/patients` | ADMIN | Crear paciente |
| GET | `/api/patients/:id` | Auth | Detalle paciente |
| PUT | `/api/patients/:id` | ADMIN | Actualizar paciente |
| GET | `/api/studies` | Auth | Listar estudios (paginado) |
| POST | `/api/studies/upload` | Auth | Cargar estudio (files/folder) |
| GET | `/api/studies/:id` | Auth | Detalle estudio |
| GET | `/api/reports` | Auth | Listar informes |
| POST | `/api/reports` | DOCTOR/ADMIN | Crear informe |
| PUT | `/api/reports/:id` | DOCTOR/ADMIN | Actualizar informe |
| POST | `/api/reports/:id/finalize` | DOCTOR/ADMIN | Finalizar informe |
| POST | `/api/reports/:id/pdf` | Auth | Generar PDF |
| POST | `/api/ai/suggest` | DOCTOR/ADMIN | Sugerencia IA |
| GET | `/api/portal/studies` | PATIENT | Estudios del paciente |
| GET | `/api/notifications` | Auth | Notificaciones del usuario |
| GET | `/api/analytics/overview` | ADMIN | Estadísticas generales |
| GET | `/api/audit` | ADMIN | Log de auditoría |
| GET | `/api/system/modules` | ADMIN | Listar módulos del sistema |
| GET | `/api/system/tenants` | ADMIN | Listar tenants |
| GET | `/api/system/tenants/:id/modules` | ADMIN | Módulos de un tenant |
| PUT | `/api/system/tenants/:id/modules/:code/toggle` | ADMIN | Toggle módulo en tenant |
| GET | `/api/system/my-modules` | Auth | Módulos activos del usuario |
| GET | `/wado/rs/studies` | Auth/Token | QIDO-RS |
| GET | `/wado/rs/studies/:uid/series/:uid/instances/:uid` | Auth/Token | WADO-RS |
| POST | `/wado/rs/studies` | Auth/Token | STOW-RS |

### Planificados 🔴

| Método | Endpoint | Módulo | Descripción |
|--------|----------|--------|-------------|
| GET | `/api/agenda/slots` | AGENDA | Turnos disponibles |
| POST | `/api/agenda/appointments` | AGENDA | Crear turno |
| GET | `/api/mwl/worklist` | ADMISION | DICOM Worklist |
| POST | `/api/billing/invoices` | FACTURACION | Crear factura AFIP |
| GET | `/api/portal-medico/studies` | PORTAL_MEDICO | Estudios para médico externo |

---

## 🛠️ Stack Tecnológico

### Backend
| Tecnología | Versión | Uso |
|-----------|---------|-----|
| Node.js | 20+ | Runtime |
| Express | 4.x | HTTP server |
| TypeScript | 5.x | Lenguaje |
| Prisma ORM | 5.x | Base de datos |
| MySQL / PostgreSQL | 8.x / 15.x | Base de datos |
| JWT (jsonwebtoken) | 9.x | Autenticación |
| bcryptjs | 2.x | Hash de contraseñas |
| multer | 1.x | Upload de archivos |
| dcmjs | latest | Parseo DICOM |
| Helmet | 7.x | Security headers (HIPAA) |
| Zod | 3.x | Validación de datos |

### Frontend
| Tecnología | Versión | Uso |
|-----------|---------|-----|
| React | 19.x | UI framework |
| Vite | 5.x | Build tool |
| TypeScript | 5.x | Lenguaje |
| CornerstoneJS | v3 | Visor DICOM |
| @cornerstonejs/tools | v3 | Herramientas DICOM |
| React Router | 6.x | Navegación |
| Framer Motion | 11.x | Animaciones |
| Axios | 1.x | HTTP client |

---

## 🗺️ Roadmap

### Fase 1 — PACS Core ✅
- [x] Auth JWT con httpOnly cookies
- [x] Gestión de usuarios y roles
- [x] Gestión de pacientes
- [x] Carga de estudios DICOM (archivos + carpetas)
- [x] Visor DICOM CornerstoneJS v3 extendido
- [x] DICOMweb (WADO-RS/STOW-RS/QIDO-RS)
- [x] SCP Server (recepción desde equipos)
- [x] Sistema de informes radiológicos
- [x] Generación de PDF
- [x] IA editorial (sugerencias)
- [x] Portal paciente básico
- [x] Sistema de módulos (registro + activación por tenant)
- [x] Auditoría de acciones

### Fase 2 — Integración Clínica 🟡
- [x] DICOMweb completo
- [x] SCP Server estable
- [ ] DICOM Modality Worklist (MWL)
- [ ] MPPS (Modality Performed Procedure Step)
- [ ] HL7 ADT (admisión/alta)
- [ ] Agenda y turnos básicos
- [ ] Admisión y recepción
- [ ] Portal médico (derivantes)

### Fase 3 — Facturación y Multitenancy 🔴
- [ ] Facturación electrónica AFIP/ARCA
- [ ] Nomenclador AMB/PMC
- [ ] Liquidación a obras sociales
- [ ] Multitenancy completo (un backend, múltiples hospitales)
- [ ] Licenciamiento por módulo

### Fase 4 — Enterprise 🔴
- [ ] Integración Orthanc (PACS enterprise)
- [ ] DICOM SR (Structured Reports)
- [ ] Firma digital real (PKCS#7)
- [ ] HL7 FHIR
- [ ] CDN para archivos DICOM
- [ ] Alta disponibilidad / clustering

---

## 🔧 Cómo mantener este archivo

Este archivo es la fuente de verdad del estado del sistema. **Debe actualizarse en cada PR** que:
- Implemente un nuevo módulo o feature
- Cambie el estado de un módulo (Pendiente → Parcial → Activo)
- Agregue nuevos endpoints a la API
- Modifique la arquitectura

### Pasos al completar un módulo
1. Actualizar la versión en la tabla de módulos
2. Cambiar el estado (🔴 → 🟡 → ✅)
3. Actualizar la fecha de "Actualizado" en el header
4. Actualizar la tabla de API endpoints si corresponde
5. Mover los items completados del roadmap
6. Actualizar la versión en `backend/package.json` y `frontend/package.json`

### Estructura recomendada para un nuevo módulo

**Backend:**
```
backend/src/modules/<nombre>/
├── routes.ts          # Endpoints Express
├── service.ts         # Lógica de negocio (opcional)
└── types.ts           # Tipos TypeScript del módulo
```

**Frontend:**
```
frontend/src/features/<nombre>/
├── <Nombre>Page.tsx   # Página principal
└── components/        # Componentes específicos del módulo
```

**Checklist para un módulo nuevo:**
- [ ] Agregar modelo(s) en `backend/prisma/schema.prisma`
- [ ] Crear migración: `npx prisma migrate dev --name add_<nombre>`
- [ ] Agregar seed en `backend/prisma/seed.ts`
- [ ] Crear `backend/src/modules/<nombre>/routes.ts`
- [ ] Registrar router en `backend/src/index.ts`
- [ ] Crear página(s) en `frontend/src/features/<nombre>/`
- [ ] Agregar ruta en `frontend/src/app/router.tsx`
- [ ] Agregar enlace en el menú (`frontend/src/components/AppLayout.tsx`)
- [ ] Envolver con `<ModuleGuard module="CODIGO">` si es opcional
- [ ] Actualizar la tabla de módulos en `backend/prisma/seed.ts` (version y estado)
- [ ] Actualizar este archivo `SYSTEM_STATUS.md`

---

## 🔐 Variables de Entorno

### Backend (`backend/.env`)
```env
# Base de datos
DATABASE_PROVIDER=mysql        # mysql | postgresql
DATABASE_URL=mysql://user:pass@localhost:3306/pacs

# Servidor
PORT=3001
APP_VERSION=0.3.0
NODE_ENV=development

# Seguridad
JWT_SECRET=<secreto-largo-y-aleatorio>
JWT_REFRESH_SECRET=<otro-secreto-largo>
CORS_ORIGIN=http://localhost:5173

# Almacenamiento
STORAGE_ROOT=./storage

# DICOM SCP
DICOM_AE_TITLE=PACS_SCP
DICOM_SCP_PORT=11112
DICOM_SYSTEM_TOKEN=          # token para equipos DICOM
DICOM_ALLOWED_IPS=           # IPs permitidas (separadas por coma)

# IA (opcional)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Email (opcional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

### Frontend (`frontend/.env`)
```env
VITE_API_URL=http://localhost:3001/api
```

---

## 📁 Estructura del Repositorio

```
pacs/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma         # Modelos de base de datos
│   │   └── seed.ts               # Datos iniciales
│   └── src/
│       ├── index.ts              # Entry point, registro de routers
│       ├── config/               # env, prisma, db
│       ├── dicom/                # SCP server, SFTP watcher
│       ├── middleware/           # auth, audit
│       ├── modules/
│       │   ├── auth/             # Login, refresh, logout
│       │   ├── users/            # CRUD usuarios
│       │   ├── patients/         # CRUD pacientes
│       │   ├── studies/          # CRUD estudios, upload
│       │   ├── reports/          # Informes, PDF
│       │   ├── ai/               # Asistencia IA
│       │   ├── portal/           # Portal paciente
│       │   ├── notifications/    # Notificaciones
│       │   ├── dicomweb/         # WADO/STOW/QIDO
│       │   ├── analytics/        # Estadísticas
│       │   ├── audit/            # Auditoría
│       │   └── system/           # Módulos y tenants
│       ├── storage/              # Gestión de archivos
│       └── utils/                # JWT, email, security
├── frontend/
│   └── src/
│       ├── app/
│       │   └── router.tsx        # Rutas React
│       ├── components/           # Layout, ProtectedRoute, ModuleGuard
│       ├── features/
│       │   ├── admin/            # AdminPage, ModulesAdminPage
│       │   ├── auth/             # Login, ChangePassword
│       │   ├── dashboard/        # Dashboard principal
│       │   ├── patients/         # Pacientes
│       │   ├── portal/           # Portal paciente
│       │   ├── reports/          # Informes
│       │   └── studies/          # Estudios, DicomViewer
│       └── lib/
│           ├── api.ts            # Axios + interceptors
│           ├── auth.tsx          # AuthContext, useAuth
│           └── modules.ts        # ModulesContext, useModules
├── storage/                      # Archivos DICOM almacenados
├── docs/                         # Documentación adicional
├── scripts/                      # Scripts de utilidad
└── SYSTEM_STATUS.md              # Este archivo ← fuente de verdad
```
