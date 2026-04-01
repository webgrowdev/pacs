# Arquitectura técnica del PACS MVP

## 1) Resumen ejecutivo
Producto MVP vendible orientado a centros de diagnóstico por imágenes con foco en tres experiencias: operación clínica (admin), lectura e informe (médico) y acceso seguro a resultados (paciente). Incluye una asistencia IA editorial para acelerar redacción y resumen sin diagnóstico automático.

## 2) Arquitectura propuesta
- Frontend SPA React/TypeScript con diseño institucional (glass + motion moderado).
- Backend API REST modular (Express) con RBAC estricto.
- PostgreSQL + Prisma para trazabilidad transaccional.
- File storage abstracto (local por carpeta estructurada, listo para migrar a S3).
- Visor DICOM web embebido con Cornerstone3.
- Generación PDF clínica con PDFKit.

## 3) Stack y justificación
- **React + TypeScript + Vite**: rapidez de iteración y excelente DX para MVP.
- **Express + Prisma**: alta productividad y estructura clara para módulos médicos.
- **PostgreSQL**: robustez ACID y buen soporte para JSON metadatos DICOM.
- **Cornerstone3**: estándar OSS maduro para visualización DICOM web.
- **PDFKit**: generación controlada de PDF clínicos server-side.

## 4) Módulos funcionales
- Auth + RBAC.
- Usuarios y roles.
- Pacientes.
- Estudios (upload DICOM/ZIP, parseo metadatos, almacenamiento).
- Visor DICOM con herramientas base (zoom/pan/WL/length).
- Informes (draft/final, mediciones, PDF).
- Portal de paciente con aislamiento por identidad.
- IA editorial (sugerencia de redacción y resumen).
- Auditoría.

## 5) Roles y permisos
- **ADMIN**: CRUD completo en usuarios, pacientes, estudios e informes.
- **DOCTOR**: consulta estudios, visualiza imágenes, crea/edita/finaliza informes.
- **PATIENT**: solo lista y descarga sus resultados.

## 6) Modelo de datos
Entidades: roles, users, patients, studies, study_series, dicom_files, reports, report_measurements, patient_portal_access, generated_documents, audit_logs.

Relaciones clave:
- Paciente 1..N Estudios.
- Estudio 1..N DICOM Files.
- Estudio 1..N Reportes (MVP normalmente 1 activo).
- Reporte 1..N Mediciones y 1..N documentos generados.
- User(Role PATIENT) 1..1 PatientPortalAccess.

## 7) Flujo operativo end-to-end
1. Admin/doctor autentica.
2. Carga archivos DICOM/ZIP.
3. Backend parsea tags claves y persiste metadata.
4. Estudio queda en estado `UPLOADED/IN_REVIEW`.
5. Médico abre viewer + panel de informe.
6. Usa IA editorial para sugerencia opcional.
7. Guarda borrador.
8. Finaliza informe => genera PDF y registra documento.
9. Portal paciente muestra estudio y habilita descarga PDF.

## 8) Diseño de storage
- `storage/dicom/<study_id>/<archivo>`.
- `storage/pdfs/<report_id>.pdf`.
- `storage/tmp/` para staging de uploads.

## 9) Endpoints base
- `POST /api/auth/login`
- `GET/POST /api/users`
- `GET/POST/PUT /api/patients`
- `GET /api/studies`, `GET /api/studies/:id`, `POST /api/studies/upload`
- `GET/POST/PUT /api/reports`, `POST /api/reports/:id/finalize`
- `POST /api/ai/suggest-report`, `POST /api/ai/patient-summary`
- `GET /api/portal/my-results`

## 10) Pantallas principales
- Login seguro.
- Dashboard admin/médico.
- Listado pacientes.
- Listado estudios.
- Detalle estudio: viewer + informe.
- Listado informes.
- Portal paciente de resultados.

## 11) Autenticación y autorización
- JWT access token en header Bearer.
- Guardas por rol a nivel endpoint.
- Restricción de portal por `patient_portal_access`.

## 12) Logs y auditoría
- Tabla `audit_logs` con actor, acción, entidad y payload JSON.
- Eventos críticos: creación/edición paciente, creación/finalización informe, carga estudio.

## 13) Backups
- PostgreSQL: backup diario + WAL según entorno productivo.
- Storage: snapshot incremental diario de `dicom/` y `pdfs/`.
- Restore drills trimestrales.

## 14) Roadmap
- **Fase 1 (MVP)**: core clínico, viewer, informe, PDF, portal, auditoría.
- **Fase 2**: worklists avanzadas, colas de asignación, notificaciones.
- **Fase 3**: IA de consistencia, resúmenes multilingües, plantillas por modalidad.
- **Fase 4**: escalado S3/Cloud, multi-tenant, integración DICOMweb/RIS futura.
