# PACS — Pendientes para alcanzar grado médico

> **Contexto del proyecto**
> Stack: React 19 + Vite (frontend) · Express 4 + TypeScript + Prisma ORM + MySQL (backend)
> Raíz del proyecto: `C:\Users\josue\Documents\GitHub\pacs\`
>
> **Qué ya está implementado y NO tocar:**
> - DICOM C-STORE SCP (`backend/src/dicom/scp-server.ts`) — recibe imágenes de equipos
> - Firma digital PKCS#7 — **DESHABILITADA hasta primeras pruebas** (no modificar)
> - Sistema de informes completo (BIRADS/TIRADS/PIRADS/LIRADS, peer review, hallazgos críticos, PDF/A-3, FHIR R4, DICOM SR, dictado por voz, spell check, addendum, TAT, integridad)
> - Portal de paciente (`backend/src/modules/portal/routes.ts`) — completo
> - Notificaciones de borradores vencidos (`backend/src/jobs/stale-draft-alerts.ts`) — completo
> - Audit log básico (`backend/src/middleware/audit.ts` + modelo `AuditLog` en schema) — existe, necesita extensión ATNA

---

## PENDIENTE 1 — DICOM Modality Worklist (MWL) SCP
**Prioridad: 🔴 CRÍTICA**
**Por qué:** Sin MWL, los técnicos tipean datos del paciente manualmente en el equipo → errores de identidad. Es el flujo estándar en cualquier hospital.

### Estado actual
El archivo `backend/src/dicom/scp-server.ts` ya tiene un SCP C-STORE funcional usando la librería `dcmjs-dimse`. Solo maneja `C-STORE`. No existe ningún handler para `C-FIND` (requerido por MWL).

### Implementación requerida

**Archivo a modificar:** `backend/src/dicom/scp-server.ts`

Agregar dentro de la clase `PacsScp` el método `cFindRequest` para responder consultas de worklist. El equipo enviará una consulta con `(0008,0052) = WORKLIST` y espera recibir una lista de estudios programados.

```typescript
// Agregar en la clase PacsScp — método para MWL C-FIND
async cFindRequest(request: any, callback: (response: any) => void) {
  // 1. Leer dataset de la consulta (filtros que manda el equipo)
  // 2. Buscar en prisma.study donde status = 'UPLOADED' o status = 'IN_REVIEW'
  //    y studyDate >= hoy - 7 días (ventana configurable)
  // 3. Por cada study, construir un Dataset con los tags MWL obligatorios:
  //    (0010,0010) PatientName — formato "Apellido^Nombre"
  //    (0010,0020) PatientID — patient.internalCode o patient.documentId
  //    (0010,0030) PatientBirthDate — YYYYMMDD
  //    (0010,0040) PatientSex — M/F/O
  //    (0020,000D) StudyInstanceUID — study.studyInstanceUid
  //    (0008,0050) AccessionNumber — study.id.slice(0,16)
  //    (0008,0060) Modality — study.modality
  //    (0032,1070) RequestedProcedureDescription — study.description
  //    (0040,0100) ScheduledProcedureStepSequence:
  //      (0040,0001) ScheduledStationAETitle — env.DICOM_AE_TITLE
  //      (0040,0002) ScheduledProcedureStepStartDate — yyyyMMdd
  //      (0008,0060) Modality — study.modality
  // 4. Enviar un CFindResponse por cada resultado con status Pending
  // 5. Enviar CFindResponse final con status Success
}
```

**Agregar variable de entorno** en `backend/src/config/env.ts`:
```typescript
MWL_WINDOW_DAYS: z.coerce.number().default(7),  // días hacia atrás en el worklist
```

**Nuevo endpoint admin** (agregar en `backend/src/modules/studies/routes.ts` o crear `backend/src/modules/worklist/routes.ts`):
- `GET /api/worklist` — Devuelve estudios del worklist (misma query que el MWL SCP)
- Útil para que el frontend muestre qué estudios están en cola para los equipos

---

## PENDIENTE 2 — ATNA Audit Log (IHE ITI-20)
**Prioridad: 🔴 CRÍTICA**
**Por qué:** Requisito legal en cualquier sistema con PHI (HIPAA §164.312(b), ANMAT Disp. 2318/02 art. 6). El log actual registra datos pero no tiene el formato estándar ATNA que exigen auditorías hospitalarias.

### Estado actual
Existe `backend/src/middleware/audit.ts` con `logAudit()` y `logSystemAudit()`.
Existe el modelo `AuditLog` en `backend/prisma/schema.prisma` (línea 274):
```prisma
model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  action     String
  entityType String
  entityId   String?
  ipAddress  String?
  userAgent  String?
  payload    Json?
  createdAt  DateTime @default(now())
}
```

### Implementación requerida

**Paso 1 — Extender el modelo** en `backend/prisma/schema.prisma`:
```prisma
model AuditLog {
  id              String   @id @default(cuid())
  userId          String?
  user            User?    @relation(fields: [userId], references: [id])
  action          String                    // e.g. "PHI_ACCESS", "REPORT_FINALIZED", "DICOM_SCP_RECEIVED"
  entityType      String                    // "STUDY" | "REPORT" | "PATIENT" | "USER"
  entityId        String?
  ipAddress       String?
  userAgent       String?
  // ATNA extensions (IHE ITI-20 / RFC 3881)
  eventActionCode String?                   // "C"=Create "R"=Read "U"=Update "D"=Delete "E"=Execute
  eventOutcome    Int?                      // 0=Success 4=MinorFailure 8=SeriousFailure 12=MajorFailure
  participantObjectId String?               // PHI identifier: patientId, studyId, etc.
  participantObjectTypeCode Int?            // 1=Person 2=SystemObject
  networkAccessPoint String?               // IP del cliente
  payload         Json?
  createdAt       DateTime @default(now())

  @@index([createdAt])
  @@index([userId])
  @@index([action])
  @@index([entityId])
}
```

**Paso 2 — Correr migración:**
```bash
cd backend && npx prisma migrate dev --name add_atna_audit_fields
```

**Paso 3 — Actualizar `backend/src/middleware/audit.ts`:**
Modificar la firma de `logAudit()` para aceptar opciones ATNA:
```typescript
interface AuditOptions {
  eventActionCode?: 'C' | 'R' | 'U' | 'D' | 'E';
  eventOutcome?: 0 | 4 | 8 | 12;
  participantObjectId?: string;    // patientId o studyId según contexto
  participantObjectTypeCode?: 1 | 2;
}

export async function logAudit(
  req: AuthRequest,
  action: string,
  entityType: string,
  entityId?: string,
  payload?: object,
  atna?: AuditOptions   // ← nuevo parámetro opcional
): Promise<void>
```

**Paso 4 — Decorar las rutas críticas** con los campos ATNA correctos:
- `GET /api/studies/:id` → `eventActionCode: 'R'`, `participantObjectId: patientId`
- `POST /api/reports` → `eventActionCode: 'C'`
- `POST /api/reports/:id/finalize` → `eventActionCode: 'E'`
- `POST /api/reports/:id/mark-critical` → `eventActionCode: 'E'`, `eventOutcome: 0`
- `GET /api/portal/my-results` → ya tiene `logAudit`, agregar `eventActionCode: 'R'`

**Paso 5 — Dashboard de auditoría** (agregar en `backend/src/modules/audit/routes.ts`):
- `GET /api/audit/logs?page=&action=&userId=&from=&to=` — lista paginada para admins
- `GET /api/audit/logs/export?from=&to=` — exportar CSV para compliance officer

**Frontend** — Agregar tabla de logs en `frontend/src/features/admin/AdminPage.tsx`:
- Sección "Registro de Auditoría" con filtros por acción, usuario, rango de fechas
- Botón "Exportar CSV"

---

## PENDIENTE 3 — HL7 v2.x Integration (ORU^R01 outbound)
**Prioridad: 🟠 ALTA**
**Por qué:** El 95% de los HIS/RIS hospitalarios en Argentina hablan HL7 v2. Sin esto, el médico solicitante no recibe el resultado automáticamente en su sistema.

### Implementación requerida

**Instalar dependencia** en `backend/`:
```bash
npm install node-hl7-client
```

**Crear nuevo módulo:** `backend/src/modules/hl7/`

```
backend/src/modules/hl7/
  hl7-service.ts       ← lógica de construcción del mensaje
  hl7-sender.ts        ← envío TCP MLLP al servidor HL7
```

**`hl7-service.ts`** — Construir mensaje ORU^R01 al finalizar informe:
```typescript
// Campos mínimos requeridos:
// MSH — cabecera (sender: "PACS", receiver: env.HL7_RECEIVER_APP, datetime, msgId)
// PID — datos del paciente (patientId, name, dob, sex, documentId)
// PV1 — visita/orden
// ORC — orden común (status: "RE"=Results)
// OBR — observación (studyId, modality, datetime, doctorId)
// OBX — resultado (type: "TX", value: conclusion del informe, status: "F"=Final)
// Segundo OBX — URL del PDF (type: "RP", value: pdfUrl)
```

**`hl7-sender.ts`** — Envío MLLP (Minimum Lower Layer Protocol):
```typescript
// MLLP framing: \x0B + mensaje_hl7 + \x1C\x0D
// Conectar a env.HL7_HOST:env.HL7_PORT via TCP
// Si falla: reintentar 3 veces con backoff exponencial
// Guardar en AuditLog con action: 'HL7_ORU_SENT'
```

**Agregar variables de entorno** en `backend/src/config/env.ts`:
```typescript
HL7_ENABLED: z.coerce.boolean().default(false),
HL7_HOST: z.string().optional(),
HL7_PORT: z.coerce.number().default(2575),
HL7_SENDER_APP: z.string().default('PACS'),
HL7_SENDER_FACILITY: z.string().default('PACSMED'),
HL7_RECEIVER_APP: z.string().optional(),
HL7_RECEIVER_FACILITY: z.string().optional(),
```

**Trigger:** En `backend/src/modules/reports/routes.ts`, en el handler de `POST /:id/finalize`, después de generar el PDF, agregar:
```typescript
if (env.HL7_ENABLED) {
  sendHl7ORU(report, study, patient).catch((err) =>
    console.error('[HL7] Error enviando ORU^R01:', err)
  );
}
```

**Frontend** — En `frontend/src/features/admin/AdminPage.tsx`, sección de configuración:
- Toggle "Integración HL7 v2 activa"
- Campos: Host, Puerto, App receptora
- Botón "Enviar mensaje de prueba" → `POST /api/admin/hl7/test`

---

## PENDIENTE 4 — PHI De-identification (anonimización para docencia/investigación)
**Prioridad: 🟠 ALTA**
**Por qué:** Permite usar casos reales en capacitación y publicaciones sin violar privacidad del paciente. Requerido para cualquier uso académico.

### Implementación requerida

**Nuevo endpoint** en `backend/src/modules/studies/routes.ts`:
```
POST /api/studies/:id/deidentify
```

**Lógica:**
1. Verificar que el informe esté en estado `FINAL` o `SIGNED`
2. Cargar todos los archivos DICOM del estudio desde disco (`storage/dicom/:studyId/`)
3. Para cada archivo DICOM, usar `dcmjs` para reemplazar los tags PHI:
   - `(0010,0010)` PatientName → `"ANONIMO^CASO_{cuidShort}"`
   - `(0010,0020)` PatientID → UUID nuevo
   - `(0010,0030)` PatientBirthDate → solo año (ej: `19800101`)
   - `(0010,0040)` PatientSex → conservar
   - `(0008,0020)` StudyDate → conservar
   - `(0008,1030)` StudyDescription → conservar
   - Eliminar: `(0010,1040)` PatientAddress, `(0010,2154)` PatientPhone, `(0010,1000)` OtherPatientIDs
4. Guardar los archivos anonimizados en `storage/deidentified/:newStudyId/`
5. Crear un nuevo registro `Study` en la base de datos con `patientId` → paciente genérico "ANONIMO"
6. Crear un registro `AuditLog` con `action: 'PHI_DEIDENTIFIED'`, `entityId: originalStudyId`
7. Devolver la URL de descarga del ZIP con los DICOMs anonimizados

**Control de acceso:** Solo rol `ADMIN`. Agregar `RESEARCHER` como nuevo rol opcional en `backend/prisma/schema.prisma` si se necesita que investigadores tengan acceso sin ser admins.

**Frontend** — Botón en `frontend/src/features/studies/StudyDetailPage.tsx` (solo visible para ADMIN en modo finalizado):
```
🔬 Anonimizar para docencia
```

---

## PENDIENTE 5 — Acknowledgment de hallazgos críticos (ACR Practice Parameter)
**Prioridad: 🟠 ALTA**
**Por qué:** El estándar ACR requiere no solo notificar al médico solicitante, sino registrar que el médico **confirmó** haber recibido la notificación, con timestamp. Sin esto el flujo crítico está incompleto.

### Estado actual
El modelo `Report` tiene `isCritical`, `criticalAt`, `criticalReason`. Falta el lado del acknowledgment.

### Implementación requerida

**Paso 1 — Modificar schema** en `backend/prisma/schema.prisma`, dentro del modelo `Report`:
```prisma
// Agregar dentro del modelo Report, después de criticalReason:
criticalAcknowledgedAt       DateTime?
criticalAcknowledgedById     String?
criticalAcknowledgedBy       User?     @relation("CriticalAcknowledgments", fields: [criticalAcknowledgedById], references: [id])
criticalAcknowledgmentNote   String?   @db.Text
```

Agregar también en el modelo `User`:
```prisma
criticalAcknowledgments Report[] @relation("CriticalAcknowledgments")
```

**Paso 2 — Migración:**
```bash
cd backend && npx prisma migrate dev --name add_critical_acknowledgment
```

**Paso 3 — Nuevo endpoint** en `backend/src/modules/reports/routes.ts`:
```
POST /api/reports/:id/acknowledge-critical
Body: { note?: string }
```
- Solo puede llamarlo el médico solicitante del estudio o cualquier DOCTOR/ADMIN
- Setea `criticalAcknowledgedAt = new Date()`, `criticalAcknowledgedById = req.user.sub`
- Registra en AuditLog con `action: 'CRITICAL_ACKNOWLEDGED'`
- Devuelve el report actualizado

**Paso 4 — Frontend** en `frontend/src/features/studies/StudyDetailPage.tsx`:
En la sección del banner rojo de hallazgo crítico (línea ~1046), si `report.isCritical && !report.criticalAcknowledgedAt`, mostrar botón:
```
✅ Confirmar recepción de hallazgo crítico
```
Si ya tiene `criticalAcknowledgedAt`, mostrar: `✓ Recibido por Dr/a. [nombre] el [fecha]`

---

## PENDIENTE 6 — TAT (Turnaround Time) persistido en base de datos
**Prioridad: 🟡 MEDIA**
**Por qué:** El campo TAT se calcula dinámicamente en el endpoint `GET /reports/:id/tat` pero nunca se persiste. Esto impide generar reportes de SLA históricos y dashboards de rendimiento.

### Estado actual
El endpoint `GET /reports/:id/tat` en `backend/src/modules/reports/routes.ts` (línea ~1281) calcula el TAT al vuelo comparando `study.studyDate` con `report.finalizedAt`. Nunca se guarda.

### Implementación requerida

**Paso 1 — Modificar schema** en `backend/prisma/schema.prisma`, modelo `Report`:
```prisma
// Agregar después de finalizedAt:
tatMinutes   Int?   // Tiempo desde studyDate hasta finalizedAt en minutos
```

**Paso 2 — Migración:**
```bash
cd backend && npx prisma migrate dev --name add_tat_minutes_to_report
```

**Paso 3 — Calcular y persistir en finalización**, en el handler de `POST /reports/:id/finalize`:
```typescript
// Después de generar el PDF, antes del return:
const studyDate = report.study.studyDate;  // DateTime de la query
if (studyDate && report.finalizedAt) {
  const tatMinutes = Math.round(
    (report.finalizedAt.getTime() - studyDate.getTime()) / 60_000
  );
  await prisma.report.update({
    where: { id: report.id },
    data: { tatMinutes }
  });
}
```

**Paso 4 — Dashboard de TAT** (crear o extender `backend/src/modules/analytics/`):
```
GET /api/analytics/tat?from=&to=&modality=&doctorId=
```
Respuesta:
```json
{
  "averageTatMinutes": 87,
  "medianTatMinutes": 72,
  "p95TatMinutes": 210,
  "slaBreaches": 3,      // informes con TAT > 120 min (configurable)
  "totalReports": 45,
  "breakdown": [{ "doctorName": "...", "avg": 65, "count": 12 }]
}
```

**Frontend** — Agregar card de TAT en `frontend/src/features/admin/AdminPage.tsx` o crear `frontend/src/features/admin/TatDashboard.tsx`:
- Card: "TAT promedio últimos 30 días: XX min"
- Gráfico de barras por médico
- Alerta si hay informes con TAT > umbral configurable

---

## PENDIENTE 7 — Seguridad: hardening de headers HTTP + rate limiting
**Prioridad: 🟠 ALTA**
**Por qué:** Un sistema con PHI médico expuesto a internet necesita protección mínima antes de producción. Actualmente faltan headers de seguridad críticos.

### Verificar e implementar en `backend/src/index.ts`:

**Instalar si no está:**
```bash
npm install helmet express-rate-limit
```

**Agregar antes de todas las rutas:**
```typescript
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Security headers (HIPAA §164.312(e)(1) — transmission security)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // necesario para Vite en dev
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"]
    }
  },
  hsts: { maxAge: 31_536_000, includeSubDomains: true },  // solo producción
  noSniff: true,
  xssFilter: true
}));

// Rate limiting global (prevenir brute force)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas solicitudes. Intente en 15 minutos.' }
});
app.use('/api', globalLimiter);

// Rate limiting estricto para autenticación
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Demasiados intentos de login. Intente en 15 minutos.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh', authLimiter);
```

**Frontend** — En `frontend/vite.config.ts` o headers del servidor de producción, agregar:
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

---

## PENDIENTE 8 — Script de backup y política de retención
**Prioridad: 🟠 ALTA**
**Por qué:** Las imágenes médicas tienen retención legal obligatoria: 10 años para adultos, hasta mayoría de edad para menores (Ley 26.529 art. 14, Argentina). Sin backup automatizado, cualquier falla de disco es una pérdida de datos médicos irreversible.

### Implementación requerida

**Crear `scripts/backup.sh`:**
```bash
#!/usr/bin/env bash
# PACS Medical Backup Script
# Ejecutar como cron: 0 2 * * * /path/to/backup.sh >> /var/log/pacs-backup.log 2>&1

BACKUP_ROOT="/backups/pacs"
DATE=$(date +%Y%m%d_%H%M%S)
STORAGE_ROOT="../storage"
RETENTION_DAYS=3650   # 10 años

# 1. Backup MySQL
mysqldump $DATABASE_URL > "$BACKUP_ROOT/db/pacs_$DATE.sql"
gzip "$BACKUP_ROOT/db/pacs_$DATE.sql"

# 2. Backup storage (DICOM files)
rsync -av --delete "$STORAGE_ROOT/" "$BACKUP_ROOT/files/"

# 3. Verificar integridad del backup
md5sum "$BACKUP_ROOT/db/pacs_$DATE.sql.gz" > "$BACKUP_ROOT/db/pacs_$DATE.sql.gz.md5"

# 4. Limpiar backups DB más viejos que RETENTION_DAYS
find "$BACKUP_ROOT/db/" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "[BACKUP] Completado: $DATE"
```

**Crear `scripts/backup-check.ts`** — Endpoint admin para verificar el último backup:
```
GET /api/admin/backup/status
```
Devuelve: `{ lastBackupAt, lastBackupSizeGb, status: 'OK' | 'OVERDUE' | 'MISSING' }`

**Agregar variable de entorno:**
```typescript
BACKUP_MAX_AGE_HOURS: z.coerce.number().default(25),  // alertar si el backup tiene más de 25h
BACKUP_STATUS_FILE: z.string().default('/backups/pacs/last_backup.json'),
```

**Frontend** — Widget en `frontend/src/features/admin/AdminPage.tsx`:
- "Último backup: hace X horas" (verde < 25h, rojo > 25h)
- Botón "Forzar backup ahora" → `POST /api/admin/backup/run`

---

## PENDIENTE 9 — DICOM C-FIND SCU (consulta a PACS externos / Orthanc)
**Prioridad: 🟡 MEDIA**
**Por qué:** Permite consultar estudios previos del paciente en otros PACS de la red hospitalaria (ej: el PACS de otra sede, Orthanc). La variable `ORTHANC_URL` ya está en `env.ts` pero no se usa en ningún módulo.

### Implementación requerida

**Crear `backend/src/dicom/scu-client.ts`:**
```typescript
// C-FIND SCU — consulta estudios de un paciente en un PACS remoto vía DICOMweb (WADO-RS/QIDO-RS)
// Usar la REST API de Orthanc si ORTHANC_URL está definido (más simple que DIMSE puro)

export async function queryRemoteStudies(patientId: string): Promise<RemoteStudy[]>
// GET {ORTHANC_URL}/dicom-web/studies?PatientID={patientId}

export async function fetchRemoteStudyMetadata(studyInstanceUid: string): Promise<DicomMetadata>
// GET {ORTHANC_URL}/dicom-web/studies/{uid}/metadata
```

**Nuevo endpoint** en `backend/src/modules/studies/routes.ts`:
```
GET /api/studies/:id/remote-prior-studies
```
- Si `ORTHANC_URL` no está configurado, devolver `{ available: false }`
- Si está configurado, consultar Orthanc por el `patientId` del estudio y devolver lista de estudios previos con su modalidad, fecha y número de series

**Frontend** — En `frontend/src/features/studies/StudyDetailPage.tsx`, en el panel de historia del paciente (`showHistoryPanel`), agregar una pestaña "Red DICOM (Orthanc)" si `available: true`.

---

## PENDIENTE 10 — Indicadores de calidad en el dashboard principal
**Prioridad: 🟡 MEDIA**
**Por qué:** Cualquier acreditación hospitalaria (JCI, IRAM, ISO 15189) requiere métricas de calidad del servicio de radiología visibles para el jefe de servicio.

### Implementación requerida

**Crear o extender `backend/src/modules/analytics/routes.ts`** con:
```
GET /api/analytics/quality-indicators?period=30d
```
Devuelve:
```json
{
  "period": "30d",
  "totalStudies": 342,
  "totalReports": 318,
  "reportingRate": 93.0,        // % de estudios con informe
  "avgTatMinutes": 87,
  "slaBreachRate": 4.2,         // % de informes con TAT > 120 min
  "criticalFindingsCount": 7,
  "criticalAckRate": 100.0,     // % de críticos con acknowledgment
  "peerReviewDiscrepancyRate": 2.1,
  "aiUsageRate": 34.5,          // % de informes con asistencia IA
  "addendumRate": 1.8,          // % de informes con addendum
  "byModality": [
    { "modality": "CT", "count": 120, "avgTat": 65 },
    { "modality": "RX", "count": 198, "avgTat": 45 }
  ]
}
```

**Frontend** — Crear `frontend/src/features/admin/QualityDashboard.tsx`:
- Tarjetas con los indicadores principales
- Tendencia (últimos 30/90/365 días)
- Exportar a PDF para presentar en reuniones de servicio

---

## RESUMEN DE IMPLEMENTACIÓN SUGERIDA

| # | Pendiente | Archivo(s) principal(es) | Migración DB |
|---|---|---|---|
| 1 | DICOM MWL SCP | `backend/src/dicom/scp-server.ts` | No |
| 2 | ATNA Audit Log | `backend/prisma/schema.prisma`, `backend/src/middleware/audit.ts` | **Sí** |
| 3 | HL7 v2 ORU^R01 | `backend/src/modules/hl7/` (nuevo) | No |
| 4 | PHI De-identification | `backend/src/modules/studies/routes.ts` | No |
| 5 | Critical Acknowledgment | `backend/prisma/schema.prisma`, `backend/src/modules/reports/routes.ts` | **Sí** |
| 6 | TAT persistido | `backend/prisma/schema.prisma`, `backend/src/modules/reports/routes.ts` | **Sí** |
| 7 | HTTP Security Hardening | `backend/src/index.ts` | No |
| 8 | Backup Script | `scripts/backup.sh`, `backend/src/modules/admin/` | No |
| 9 | DICOM C-FIND SCU (Orthanc) | `backend/src/dicom/scu-client.ts` (nuevo) | No |
| 10 | Quality Dashboard | `backend/src/modules/analytics/routes.ts`, `frontend/src/features/admin/QualityDashboard.tsx` | No |

**Migraciones requeridas (ejecutar en orden):**
```bash
cd backend
npx prisma migrate dev --name add_atna_audit_fields        # Pendiente 2
npx prisma migrate dev --name add_critical_acknowledgment  # Pendiente 5
npx prisma migrate dev --name add_tat_minutes_to_report    # Pendiente 6
```

## LO QUE NO SE DEBE TOCAR
- `backend/src/modules/reports/routes.ts` → bloque de firma digital (`POST /:id/sign`, `GET /:id/verify-integrity`) — **DESHABILITADO hasta primeras pruebas**
- `frontend/src/features/studies/StudyDetailPage.tsx` → `showSignModal`, `signReport()`, botón "✍ Firmar informe" — **dejar como está**
