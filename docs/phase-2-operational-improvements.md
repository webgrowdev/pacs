# Fase 2 implementada: mejoras operativas

Se implementó una primera capa operativa sobre el MVP:

1. **Worklist médica**
   - Endpoint `GET /api/studies/worklist` con filtros por estado/fecha.
   - Vista frontend `/worklist` para priorización de lectura.

2. **Asignación de estudios**
   - Endpoint `POST /api/studies/:id/assign` (solo ADMIN).
   - Notificación automática al médico asignado.

3. **Notificaciones internas**
   - Nueva entidad `Notification`.
   - Endpoints `GET /api/notifications/my` y `POST /api/notifications/:id/read`.
   - Panel de notificaciones en dashboard.

4. **Publicación de informe más robusta**
   - Al finalizar informe se cambia estado de estudio a `REPORTED`.
   - Si existe acceso de portal, se notifica al paciente sobre nuevo informe disponible.

> Esto cubre una Fase 2 pragmática para operación diaria sin agregar complejidad enterprise.
