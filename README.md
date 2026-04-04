# PACsMed — Plataforma de Diagnóstico por Imágenes

Sistema web para gestión de estudios médicos DICOM, informes clínicos, generación de PDF y portal del paciente.

---

## Arquitectura general

```
pacs/
├── backend/          Express + Prisma ORM (API REST)
├── frontend/         React + TypeScript + Vite + CornerstoneJS
├── storage/          Archivos DICOM y PDFs (no versionar)
├── docs/             Documentación adicional
└── scripts/          Automatización de entorno
```

### Stack

| Capa | Tecnología |
|------|-----------|
| API | Node.js 20+ · Express 4 · TypeScript |
| Base de datos | **MySQL 8+ / MariaDB 10.6+** (principal) · PostgreSQL 15+ (soportado) |
| ORM | Prisma 6 (portable entre MySQL y PostgreSQL) |
| Autenticación | JWT (access 15m + refresh 7d) |
| DICOM upload | multer + adm-zip + dicom-parser |
| DICOM viewer | CornerstoneJS v3 + dicom-image-loader |
| PDF | pdfkit |
| Frontend | React 19 · React Router 7 · Framer Motion |
| Estilos | CSS puro (custom design system) |

---

## Compatibilidad de Base de Datos

El proyecto está diseñado para ser **database-portable**:

| Característica | MySQL | PostgreSQL |
|---------------|-------|------------|
| Soporte actual | **Principal** | Soportado |
| Migraciones Prisma | ✓ | ✓ |
| Enums | ✓ (ENUM nativo) | ✓ (ENUM nativo) |
| JSON fields | ✓ (JSON) | ✓ (JSONB) |
| Búsqueda case-insensitive | ✓ (collation utf8mb4) | ✓ (mode: insensitive) |
| Hosting compartido (Hostinger) | ✓ | — |

### Cambiar entre MySQL y PostgreSQL

```bash
cd backend

# 1. Editar .env
DATABASE_PROVIDER=postgresql                         # o mysql
DATABASE_URL=postgresql://user:pass@localhost:5432/pacs_mvp

# 2. Ejecutar el switch (actualiza schema.prisma y regenera Prisma Client)
npm run db:switch

# 3. Sincronizar la base de datos
npx prisma db push

# 4. Sembrar datos demo
npm run prisma:seed
```

O en un solo comando:
```bash
npm run db:setup
```

---

## Requisitos previos

### Para desarrollo local

- **Node.js 20+**
- **MySQL 8+** o **MariaDB 10.6+** (o PostgreSQL 15+ si prefieres)

### Para Hostinger (hosting compartido)

- Plan que incluya **MySQL/MariaDB** y acceso SSH o panel de administración de DB
- Node.js hosting o servidor externo que apunte a la BD de Hostinger

---

## Instalación rápida (MySQL — recomendado)

### 1. Clonar y preparar

```bash
git clone <repo-url> pacs
cd pacs
```

### 2. Backend

```bash
cd backend
cp .env.example .env
```

Editar `.env` con tus credenciales MySQL:
```env
DATABASE_PROVIDER=mysql
DATABASE_URL=mysql://root:tu_password@localhost:3306/pacs_mvp
JWT_ACCESS_SECRET=un_secret_largo_de_al_menos_32_caracteres
JWT_REFRESH_SECRET=otro_secret_diferente_de_32_caracteres
```

Crear la base de datos (si no existe):
```sql
CREATE DATABASE pacs_mvp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Instalar dependencias y configurar:
```bash
npm install
npm run db:setup    # Cambia provider, sincroniza schema, siembra datos demo
npm run dev         # Inicia en http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env   # Defaults: API en localhost:4000
npm install
npm run dev            # Inicia en http://localhost:5173
```

---

## Instalación con PostgreSQL

```bash
cd backend
cp .env.example .env
```

Editar `.env`:
```env
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pacs_mvp
```

```bash
npm install
npm run db:setup
npm run dev
```

---

## Despliegue en Hostinger (hosting compartido)

### 1. Crear base de datos MySQL

Desde el panel de Hostinger:
- Crear base de datos MySQL (ej: `u123456789_pacs`)
- Anotar: host, usuario, password, nombre de BD

### 2. Configurar .env de producción

```env
NODE_ENV=production
DATABASE_PROVIDER=mysql
DATABASE_URL=mysql://u123456789_user:password@localhost:3306/u123456789_pacs
JWT_ACCESS_SECRET=<generar con: openssl rand -base64 48>
JWT_REFRESH_SECRET=<generar con: openssl rand -base64 48>
APP_BASE_URL=https://tu-dominio.com
CORS_ORIGIN=https://tu-dominio.com
STORAGE_ROOT=../storage
```

### 3. Build y deploy del backend

```bash
cd backend
npm install --production
npm run db:switch      # Asegura provider=mysql en schema
npx prisma db push     # Sincroniza schema con la BD remota
npm run prisma:seed    # Datos iniciales (opcional)
npm run build          # Compila TypeScript a dist/
npm start              # O configurar PM2/supervisor
```

### 4. Build del frontend

```bash
cd frontend
VITE_API_URL=https://tu-dominio.com/api VITE_FILES_URL=https://tu-dominio.com/files npm run build
# Subir dist/ al hosting estático o configurar nginx/apache
```

---

## Variables de entorno

### Backend

| Variable | Descripción | Default | Requerida |
|----------|-------------|---------|-----------|
| `NODE_ENV` | Entorno | `development` | No |
| `PORT` | Puerto del servidor | `4000` | No |
| `DATABASE_PROVIDER` | Motor de BD: `mysql` o `postgresql` | `mysql` | No |
| `DATABASE_URL` | URL de conexión a la BD | — | **Sí** |
| `JWT_ACCESS_SECRET` | Secret para access tokens (mín 32 chars) | — | **Sí** |
| `JWT_REFRESH_SECRET` | Secret para refresh tokens (mín 32 chars) | — | **Sí** |
| `STORAGE_ROOT` | Raíz del almacenamiento de archivos | `../storage` | No |
| `APP_BASE_URL` | URL base del servidor | `http://localhost:4000` | No |
| `CORS_ORIGIN` | Orígenes permitidos (separados por coma) | `http://localhost:5173` | No |

### Frontend

| Variable | Descripción | Default |
|----------|-------------|---------|
| `VITE_API_URL` | URL base de la API | `http://localhost:4000/api` |
| `VITE_FILES_URL` | URL base de archivos | `http://localhost:4000/files` |

---

## Modelo de datos

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

## Usuarios demo

| Email | Password | Rol |
|-------|----------|-----|
| `admin@pacs.local` | `ChangeMe123!` | Administrador |
| `doctor@pacs.local` | `ChangeMe123!` | Médico |
| `paciente@pacs.local` | `ChangeMe123!` | Paciente |

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

---

## Scripts del backend

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Inicia en modo desarrollo (watch) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Ejecuta build de producción |
| `npm run db:switch` | Cambia provider en schema.prisma según `DATABASE_PROVIDER` |
| `npm run db:setup` | Switch + push schema + seed (setup completo) |
| `npm run db:reset` | Borra y recrea la BD + seed |
| `npm run prisma:migrate` | Crea migración Prisma |
| `npm run prisma:seed` | Siembra datos demo |
| `npm run prisma:generate` | Regenera Prisma Client |

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

1. **Paciente ingresa** con su usuario
2. **Ve sus estudios** → `GET /api/portal/my-results`
3. **Lee el resumen** en lenguaje simple
4. **Descarga el PDF** del informe finalizado

---

## Visor DICOM

El visor usa **CornerstoneJS v3** con:

- `@cornerstonejs/core` — renderizado de imágenes
- `@cornerstonejs/tools` — herramientas de interacción
- `@cornerstonejs/dicom-image-loader` — carga de DICOM via HTTP (WADO-URI)

| Herramienta | Botón ratón (default) |
|-------------|----------------------|
| Window/Level | Clic izquierdo |
| Mover (Pan) | Clic central |
| Zoom | Clic derecho |
| Medición lineal (Length) | Shift + clic izquierdo |

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

| Función | Endpoint | Descripción |
|---------|----------|-------------|
| Sugerir redacción | `POST /api/ai/suggest-report` | Genera hallazgos y conclusión a partir de notas clínicas |
| Resumen para paciente | `POST /api/ai/patient-summary` | Traduce la conclusión a lenguaje simple |
| Revisar consistencia | `POST /api/ai/check-consistency` | Detecta vacíos o inconsistencias en el informe |

**Importante:** La IA es editorial, no diagnóstica. El médico valida, edita y firma siempre.

---

## Auditoría

Acciones registradas automáticamente en `AuditLog`:

- `STUDY_UPLOADED` / `STUDY_ASSIGNED` / `STUDY_VIEWED`
- `REPORT_CREATED` / `REPORT_UPDATED` / `REPORT_FINALIZED`
- `PATIENT_CREATED` / `PATIENT_UPDATED`
- `USER_CREATED` / `USER_ACTIVATED` / `USER_DEACTIVATED`
- `PORTAL_ACCESS`

---

## Seguridad

- JWT con access token de 15 minutos y refresh de 7 días
- Archivos protegidos por `requireAuth` middleware (`/files` no es público)
- Separación estricta de roles en backend y frontend
- Validación con Zod en todos los endpoints
- CORS configurable por variable de entorno
- Helmet con headers de seguridad
- Error handler global que oculta stack traces en producción

---

## Notas de portabilidad MySQL ↔ PostgreSQL

### 100% portable (sin cambios al cambiar de motor)

- Todas las queries (usan Prisma ORM, 0 raw SQL)
- Modelos, relaciones, casts
- Seeds y lógica de negocio
- Enums (Prisma los mapea al tipo nativo de cada motor)
- Campos JSON (JSON en MySQL, JSONB en PostgreSQL)
- Booleans (`TINYINT(1)` en MySQL, `BOOLEAN` en PostgreSQL)
- DateTime, Float, Int — manejados por Prisma
- IDs con `cuid()` — generados client-side
- Validaciones con Zod — independientes del motor

### Punto sensible al motor (aislado)

| Punto | Archivo | Detalle |
|-------|---------|---------|
| Búsqueda case-insensitive | `src/config/db.ts` | Helper `insensitive()` que aplica `mode: 'insensitive'` solo en PostgreSQL. MySQL es case-insensitive por defecto con collation `utf8mb4_unicode_ci` |
| Provider en schema | `prisma/schema.prisma` | El campo `provider` debe coincidir con el motor. Se cambia automáticamente con `npm run db:switch` |

### Al cambiar de MySQL a PostgreSQL

1. Cambiar `DATABASE_PROVIDER=postgresql` en `.env`
2. Cambiar `DATABASE_URL` al formato PostgreSQL
3. Ejecutar `npm run db:setup`
4. Listo. No hay que tocar código.

---

## Troubleshooting

### Error: "mode insensitive is not supported" (MySQL)
Asegurate de que `DATABASE_PROVIDER=mysql` en `.env`. El helper `insensitive()` usa esta variable para omitir el modo en MySQL.

### Error: "Data too long for column" (MySQL)
Los campos largos (findings, conclusion, etc.) usan `@db.Text` en el schema. Si agregás campos nuevos de texto largo, anotálos con `@db.Text`.

### MySQL: "Specified key was too long" (index)
MySQL con utf8mb4 tiene un límite de 767 bytes por índice. Prisma usa `VARCHAR(191)` por defecto para `String`, lo cual cabe en ese límite. Si necesitás un índice sobre un campo `@db.Text`, creá un índice con prefijo manualmente.

### El seed falla con "duplicate entry"
El seed es idempotente (usa `upsert` y `findFirst`). Si sigue fallando, ejecutá `npm run db:reset` para empezar de cero.

---

## Creación de usuarios

```bash
# Via API (requiere token de admin)
curl -X POST http://localhost:4000/api/users \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{ "email": "nuevo@pacs.local", "password": "MiPass123!", "firstName": "Juan", "lastName": "García", "roleName": "DOCTOR" }'
```

---

## Roadmap (Fase 3)

- [ ] Firma del informe (SIGNED status)
- [ ] Integración con LLM real (OPENAI/GOOGLE) para IA editorial avanzada
- [ ] Gestión de acceso de portal desde el admin
- [ ] Notificaciones por email
- [ ] Visor DICOMweb (WADO-RS) con servidor Orthanc
- [ ] Dashboard analítico con métricas
- [ ] Exportación de auditoría
- [ ] Carga masiva vía SFTP

## Roadmap (Fase 4)

- [ ] Firma digital real del informe (SIGNED status)
- [ ] Multitenancy (múltiples instituciones)
- [ ] 2FA para médicos y admins
