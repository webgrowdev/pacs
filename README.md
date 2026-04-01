# PACS MVP - Estudios por Imágenes

Monorepo con base funcional de un producto SaaS médico para gestión de estudios DICOM, informes, PDF clínico y portal del paciente.

## Estructura
- `backend`: API REST con Express + Prisma + PostgreSQL.
- `frontend`: React + TypeScript + Framer Motion.
- `docs`: arquitectura, flujos, seguridad y roadmap.
- `storage`: raíz de archivos DICOM y PDFs.
- `scripts`: automatización inicial del entorno.

## Quickstart
1. Backend
   - `cd backend`
   - `cp .env.example .env`
   - `npm install`
   - `npx prisma migrate dev --name init`
   - `npm run prisma:seed`
   - `npm run dev`
2. Frontend
   - `cd frontend`
   - `npm install`
   - `npm run dev`

## Usuarios demo
- Admin: `admin@pacs.local` / `ChangeMe123!`
- Médico: `doctor@pacs.local` / `ChangeMe123!`
- Paciente: `paciente@pacs.local` / `ChangeMe123!`


## Fase 2 (operativa)
- Worklist médica (`/worklist`)
- Asignación de estudios (`POST /api/studies/:id/assign`)
- Notificaciones internas (`/api/notifications/*`)
