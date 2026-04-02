# PACsMed — Plataforma de Diagnóstico por Imágenes

Sistema web para gestión de estudios médicos DICOM, informes clínicos, generación de PDF y portal del paciente.

---

## Arquitectura general

```
pacs/
├── backend/          Express + Prisma + PostgreSQL (API REST)
├── frontend/         React + TypeScript + Vite + CornerstoneJS
├── storage/          Archivos DICOM y PDFs (no versionar)
├── docs/             Documentación adicional
└── scripts/          Automatización de entorno
```

### Stack

| Capa | Tecnología |
|------|-----------|
| API | Node.js 22 · Express 4 · TypeScript |
| Base de datos | PostgreSQL 15+ · Prisma ORM |
| Autenticación | JWT (access 15m + refresh 7d) |
| DICOM upload | multer + adm-zip + dicom-parser |
| DICOM viewer | CornerstoneJS v3 + dicom-image-loader |
| PDF | pdfkit |
| Frontend | React 19 · React Router 7 · Framer Motion |
| Estilos | CSS puro (custom design system) |

---

## Modelo de datos (resumen)

```
User ←→ Role (ADMIN / DOCTOR / PATIENT)
Patient ←→ Study ←→ StudySeries ←→ DicomFile
Study ←→ Report ←→ ReportMeasurement
Study ←→ Report ←→ GeneratedDocument (PDF)
Patient ←→ PatientPortalAccess ←→ User (rol PATIENT)
User → Notification
User → AuditLog
```

---

## Roles y permisos

| Acción | ADMIN | DOCTOR | PATIENT |
|--------|-------|--------|---------|
| Crear pacientes | ✓ | — | — |
| Editar pacientes | ✓ | — | — |
| Ver pacientes | ✓ | ✓ | — |
| Cargar estudios | ✓ | ✓ | — |
| Asignar médico | ✓ | — | — |
| Ver worklist | ✓ | ✓ (propios) | — |
| Ver estudio/visor | ✓ | ✓ (asignados) | — |
| Crear informe | ✓ | ✓ (propios) | — |
| Finalizar/PDF | ✓ | ✓ (propios) | — |
| Portal paciente | — | — | ✓ (propios) |
| Ver notificaciones | ✓ | ✓ | ✓ |
| Gestionar usuarios | ✓ | — | — |
| Ver auditoría | ✓ | — | — |

---

## Instalación y ejecución

### Requisitos previos
- Node.js 20+
- PostgreSQL 15+

### 1. Backend

```bash
cd backend
cp .env.example .env
# Editar .env con sus credenciales de DB y secrets JWT

npm install
npx prisma migrate dev --name init
npm run prisma:seed    # Crea usuarios demo y datos iniciales
npm run dev            # Puerto 4000
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env   # Opcional: ya tiene defaults para desarrollo
npm install
npm run dev            # Puerto 5173
```

---

## Variables de entorno (backend)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Conexión PostgreSQL | `postgresql://user:pass@localhost:5432/pacs_mvp` |
| `JWT_ACCESS_SECRET` | Secret para access tokens (mín 32 chars) | `mi_secret_muy_seguro_123...` |
| `JWT_REFRESH_SECRET` | Secret para refresh tokens (mín 32 chars) | `otro_secret_diferente_456...` |
| `PORT` | Puerto del servidor | `4000` |
| `STORAGE_ROOT` | Raíz del almacenamiento de archivos | `../storage` |
| `APP_BASE_URL` | URL base del servidor | `http://localhost:4000` |
| `CORS_ORIGIN` | Orígenes permitidos (separados por coma) | `http://localhost:5173` |
| `NODE_ENV` | Entorno | `development` |

---

## Variables de entorno (frontend)

| Variable | Descripción | Default |
|----------|-------------|---------|
| `VITE_API_URL` | URL base de la API | `http://localhost:4000/api` |
| `VITE_FILES_URL` | URL base de archivos | `http://localhost:4000/files` |

---

## Usuarios demo

| Email | Password | Rol |
|-------|----------|-----|
| `admin@pacs.local` | `ChangeMe123!` | Administrador |
| `doctor@pacs.local` | `ChangeMe123!` | Médico |
| `paciente@pacs.local` | `ChangeMe123!` | Paciente |

---

## Flujo completo del sistema

### Flujo médico-clínico

1. **Admin crea el paciente** → `POST /api/patients`
2. **Admin o médico carga el estudio** → `POST /api/studies/upload` (DICOM .dcm o .zip)
3. **Admin asigna médico** (opcional) → `POST /api/studies/:id/assign`
4. **Médico accede a worklist** → `GET /api/studies/worklist`
5. **Médico abre el estudio** → visor DICOM con CornerstoneJS v3
6. **Médico redacta el informe** → `POST /api/reports` (borrador)
7. **Médico usa IA de apoyo** → sugerencia / resumen / revisión de consistencia
8. **Médico finaliza** → `POST /api/reports/:id/finalize` → genera PDF
9. **Paciente es notificado** automáticamente

### Flujo del portal del paciente

1. **Paciente ingresa** con su usuario (`paciente@dominio.com`)
2. **Ve sus estudios** → `GET /api/portal/my-results`
3. **Lee el resumen** en lenguaje simple
4. **Descarga el PDF** del informe finalizado

---

## API REST — Endpoints principales

```
POST   /api/auth/login
POST   /api/auth/refresh
GET    /api/auth/me
POST   /api/auth/logout

GET    /api/patients              ?search=
POST   /api/patients
GET    /api/patients/:id
PUT    /api/patients/:id

GET    /api/studies               ?patientId=
GET    /api/studies/worklist      ?status=&modality=&dateFrom=&dateTo=
POST   /api/studies/upload        (multipart/form-data)
GET    /api/studies/:id
POST   /api/studies/:id/assign

GET    /api/reports
GET    /api/reports/:id
POST   /api/reports
PUT    /api/reports/:id
POST   /api/reports/:id/finalize

POST   /api/ai/suggest-report
POST   /api/ai/patient-summary
POST   /api/ai/check-consistency

GET    /api/portal/my-results
GET    /api/portal/my-profile

GET    /api/notifications/my
POST   /api/notifications/:id/read

GET    /api/users                 (ADMIN)
POST   /api/users                 (ADMIN)
PATCH  /api/users/:id/toggle-active (ADMIN)
GET    /api/users/doctors         (ADMIN)

GET    /files/:path               (requiere Bearer token)
```

---

## Visor DICOM

El visor usa **CornerstoneJS v3** con:

- `@cornerstonejs/core` — renderizado de imágenes
- `@cornerstonejs/tools` — herramientas de interacción
- `@cornerstonejs/dicom-image-loader` — carga de DICOM via HTTP (WADO-URI)

### Herramientas disponibles
| Herramienta | Botón ratón (default) |
|-------------|----------------------|
| Window/Level | Clic izquierdo |
| Mover (Pan) | Clic central |
| Zoom | Clic derecho |
| Medición lineal (Length) | Shift + clic izquierdo |

### Autenticación del visor
El loader está configurado para enviar el `Authorization: Bearer <token>` en cada petición de imagen, garantizando que solo usuarios autenticados puedan acceder a los archivos DICOM.

---

## PDF clínico

Los informes finalizados generan un PDF con:
- Encabezado institucional
- Datos del paciente (nombre, código, fecha de nacimiento, sexo)
- Datos del estudio (modalidad, fecha, descripción)
- Hallazgos y conclusión
- Mediciones
- Resumen para el paciente (si se redactó)
- Firma del médico informante
- Aviso de asistencia IA
- Footer confidencial

Los PDFs se almacenan en `storage/pdfs/` y se referencian por ruta relativa en la base de datos.

---

## Funcionalidad IA

La IA de apoyo editorial incluye 3 funciones:

| Función | Endpoint | Descripción |
|---------|----------|-------------|
| Sugerir redacción | `POST /api/ai/suggest-report` | Genera hallazgos y conclusión a partir de notas clínicas |
| Resumen para paciente | `POST /api/ai/patient-summary` | Traduce la conclusión a lenguaje simple |
| Revisar consistencia | `POST /api/ai/check-consistency` | Detecta vacíos o inconsistencias en el informe |

**Importante:** La IA es editorial, no diagnóstica. El médico valida, edita y firma siempre. Todos los PDF incluyen un aviso explícito sobre el uso de IA.

La implementación actual usa lógica de plantillas inteligentes. La interfaz está diseñada para que pueda reemplazarse fácilmente por un LLM real (Anthropic Claude, OpenAI, etc.) sin cambiar el frontend.

---

## Auditoría

Acciones registradas automáticamente en `AuditLog`:

- `STUDY_UPLOADED` — carga de estudio
- `STUDY_ASSIGNED` — asignación de médico
- `STUDY_VIEWED` — apertura de estudio (médico)
- `REPORT_CREATED` — creación de borrador
- `REPORT_UPDATED` — edición de informe
- `REPORT_FINALIZED` — cierre y generación de PDF
- `PATIENT_CREATED` / `PATIENT_UPDATED` — gestión de pacientes
- `USER_CREATED` / `USER_ACTIVATED` / `USER_DEACTIVATED` — gestión de usuarios
- `PORTAL_ACCESS` — acceso del paciente a su portal

---

## Seguridad

- JWT con access token de 15 minutos y refresh de 7 días
- Archivos protegidos por `requireAuth` middleware (`/files` no es público)
- Separación estricta de roles en backend y frontend (ProtectedRoute)
- Validación con Zod en todos los endpoints
- Sanitización de inputs
- Paciente solo accede a sus propios estudios
- Médico solo accede a estudios asignados
- PDF paths almacenados como rutas relativas (sin información del servidor)
- CORS configurable por variable de entorno
- Helmet con headers de seguridad
- Error handler global que oculta stack traces en producción

---

## Creación de usuarios

```bash
# Via API (requiere token de admin)
curl -X POST http://localhost:4000/api/users \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{ "email": "nuevo@pacs.local", "password": "MiContraseña123!", "firstName": "Juan", "lastName": "García", "roleName": "DOCTOR" }'

# Para crear acceso de paciente al portal:
# 1. Crear paciente en /api/patients
# 2. Crear usuario con rol PATIENT en /api/users
# 3. El sistema necesita asociar ambos via PatientPortalAccess (actualmente vía seed o SQL directo)
```

---

## Roadmap siguiente (Fase 3)

- [ ] Firma digital real del informe (SIGNED status)
- [ ] Integración con LLM real (Claude API) para IA editorial avanzada
- [ ] Multitenancy (múltiples instituciones)
- [ ] Gestión de acceso de portal desde el admin (asociar paciente ↔ usuario)
- [ ] Notificaciones por email
- [ ] Visor DICOMweb (WADO-RS) con servidor Orthanc o similar
- [ ] Dashboard analítico con métricas
- [ ] Exportación de auditoría
- [ ] 2FA para médicos y admins
- [ ] Carga de estudios masiva vía SFTP
