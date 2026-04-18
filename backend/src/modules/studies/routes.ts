import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import AdmZip from 'adm-zip';
import dicomParser from 'dicom-parser';
import { z } from 'zod';
import { StudyStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { studyStoragePath } from '../../storage/file-storage.js';
import { logAudit } from '../../middleware/audit.js';
import { createNotification } from '../notifications/service.js';
import { sendStudyAssignedEmail } from '../../utils/email.js';

const upload = multer({
  dest: path.resolve(process.cwd(), 'storage/tmp'),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB per file
});

export const studiesRouter = Router();
studiesRouter.use(requireAuth as any);

// Valid enum values for validation
const VALID_STATUSES  = ['UPLOADED', 'IN_REVIEW', 'REPORTED', 'PUBLISHED'] as const;
const VALID_MODALITIES = ['CT', 'MRI', 'RX', 'US', 'PET', 'NM', 'MG', 'XA', 'CR', 'DR', 'DX', 'PT', 'SC', 'OT'] as const;

// Worklist para médicos y admins con filtros (con paginación)
studiesRouter.get('/worklist', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const statusParam   = req.query.status   ? String(req.query.status)   : undefined;
    const modalityParam = req.query.modality ? String(req.query.modality) : undefined;

    // Validate enum values — reject unknown values to prevent injection/enumeration
    if (statusParam && !VALID_STATUSES.includes(statusParam as any)) {
      return res.status(400).json({ message: `Estado inválido. Valores permitidos: ${VALID_STATUSES.join(', ')}` });
    }

    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : undefined;
    const dateTo   = req.query.dateTo   ? new Date(String(req.query.dateTo))   : undefined;

    // Validate dates
    if (dateFrom && isNaN(dateFrom.getTime())) return res.status(400).json({ message: 'dateFrom inválido' });
    if (dateTo   && isNaN(dateTo.getTime()))   return res.status(400).json({ message: 'dateTo inválido' });

    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1')));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '100'))));
    const skip  = (page - 1) * limit;

    const where: any = {};
    if (statusParam)   where.status   = statusParam;
    if (modalityParam) where.modality = modalityParam;
    if (dateFrom || dateTo) where.studyDate = { gte: dateFrom, lte: dateTo };

    if (req.user?.role === 'DOCTOR') {
      where.OR = [{ assignedDoctorId: req.user.sub }, { assignedDoctorId: null }];
    }

    const [studies, total] = await Promise.all([
      prisma.study.findMany({
        where,
        include: {
          patient:        { select: { id: true, firstName: true, lastName: true, internalCode: true, documentId: true } },
          assignedDoctor: { select: { id: true, firstName: true, lastName: true } },
          reports:        { select: { id: true, status: true } }
        },
        orderBy: { studyDate: 'desc' },
        skip,
        take: limit
      }),
      prisma.study.count({ where })
    ]);

    return res.json({ data: studies, total, page, limit });
  } catch (err) {
    console.error('[STUDIES/WORKLIST]', err);
    return res.status(500).json({ message: 'Error al cargar worklist' });
  }
});

// Asignar médico a estudio
studiesRouter.post('/:id/assign', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  try {
    const doctorId = String(req.body.doctorId || '');
    const doctor = await prisma.user.findUnique({ where: { id: doctorId }, include: { role: true } });
    if (!doctor || doctor.role.name !== 'DOCTOR') return res.status(400).json({ message: 'Doctor inválido' });

    const study = await prisma.study.update({
      where: { id: String(req.params.id) },
      data: { assignedDoctorId: doctorId, status: StudyStatus.IN_REVIEW }
    });
    await createNotification(doctorId, 'Nuevo estudio asignado', `Tiene un nuevo estudio (${study.id.slice(0, 8)}) para informar.`, 'STUDY_ASSIGNED');
    sendStudyAssignedEmail(doctor, study).catch(() => {});
    await logAudit(req, 'STUDY_ASSIGNED', 'STUDY', study.id, { doctorId });
    return res.json(study);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ message: 'Estudio no encontrado' });
    console.error('[STUDIES/ASSIGN]', err);
    return res.status(500).json({ message: 'Error al asignar médico' });
  }
});

// Listar estudios (con paginación)
studiesRouter.get('/', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const patientId = req.query.patientId ? String(req.query.patientId) : undefined;
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1')));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '100'))));
    const skip  = (page - 1) * limit;

    const where: any = {};
    if (patientId) where.patientId = patientId;
    if (req.user?.role === 'DOCTOR') {
      where.OR = [{ assignedDoctorId: req.user.sub }, { assignedDoctorId: null }];
    }

    const [studies, total] = await Promise.all([
      prisma.study.findMany({
        where,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, internalCode: true } },
          reports: { select: { id: true, status: true } }
        },
        orderBy: { studyDate: 'desc' },
        skip,
        take: limit
      }),
      prisma.study.count({ where })
    ]);

    return res.json({ data: studies, total, page, limit });
  } catch (err) {
    console.error('[STUDIES/GET]', err);
    return res.status(500).json({ message: 'Error al obtener estudios' });
  }
});

// Detalle de un estudio
studiesRouter.get('/:id', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const study = await prisma.study.findUnique({
      where: { id: String(req.params.id) },
      include: {
        patient: true,
        dicomFiles: { orderBy: { instanceNumber: 'asc' } },
        series: true,
        reports: {
          include: {
            doctor: { select: { id: true, firstName: true, lastName: true } },
            measurements: true
          }
        },
        assignedDoctor: { select: { id: true, firstName: true, lastName: true } },
        uploadedBy: { select: { id: true, firstName: true, lastName: true } }
      }
    });
    if (!study) return res.status(404).json({ message: 'Estudio no encontrado' });

    // Médico solo ve estudios asignados a él o sin asignar
    if (req.user?.role === 'DOCTOR' && study.assignedDoctorId && study.assignedDoctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para este estudio' });
    }

    await logAudit(req, 'STUDY_VIEWED', 'STUDY', study.id);
    return res.json(study);
  } catch (err) {
    console.error('[STUDIES/GET/:id]', err);
    return res.status(500).json({ message: 'Error al obtener estudio' });
  }
});

// Schema de carga de estudio
const uploadSchema = z.object({
  patientId: z.string().min(5),
  // M1: Use the canonical modality enum — rejects invalid strings like "RAD", "IMG", etc.
  modality: z.enum(VALID_MODALITIES as unknown as [string, ...string[]]),
  studyDate: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Fecha inválida' }),
  description: z.string().max(500).optional(),
  assignedDoctorId: z.string().optional(),
  requestingDoctorName: z.string().max(200).optional(),
  insuranceOrderNumber: z.string().max(100).optional()
});

// Carga de estudio DICOM
studiesRouter.post('/upload', requireRole('ADMIN', 'DOCTOR') as any, upload.array('files', 400), async (req: AuthRequest, res: any) => {
  const parsedBody = uploadSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ message: 'Payload inválido', errors: parsedBody.error.flatten() });

  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) return res.status(400).json({ message: 'Debe subir al menos un archivo DICOM, ZIP o TAR' });

  const { patientId, modality, studyDate, description, assignedDoctorId, requestingDoctorName, insuranceOrderNumber } = parsedBody.data;

  // Verificar que el paciente existe
  try {
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      cleanupTmpFiles(files);
      return res.status(400).json({ message: 'Paciente no encontrado' });
    }
  } catch (err) {
    cleanupTmpFiles(files);
    return res.status(500).json({ message: 'Error al verificar paciente' });
  }

  let study: any;
  try {
    study = await prisma.study.create({
      data: {
        patientId,
        modality,
        studyDate: new Date(studyDate),
        description: description || null,
        assignedDoctorId: assignedDoctorId || null,
        requestingDoctorName: requestingDoctorName || null,
        insuranceOrderNumber: insuranceOrderNumber || null,
        uploadedById: req.user!.sub
      }
    });
  } catch (err) {
    cleanupTmpFiles(files);
    console.error('[STUDIES/UPLOAD create]', err);
    return res.status(500).json({ message: 'Error al crear estudio' });
  }

  const storageFolder = studyStoragePath(study.id);
  let persistedFiles = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      const lowerName = file.originalname.toLowerCase();

      if (lowerName.endsWith('.zip')) {
        // ── ZIP ──────────────────────────────────────────────────────────────
        // ZIP bomb protection: reject any single entry whose uncompressed size
        // exceeds 200 MB to prevent memory exhaustion (DoS).
        const MAX_ENTRY_BYTES = 200 * 1024 * 1024; // 200 MB
        const zip = new AdmZip(file.path);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          // Security: use basename only — prevents path traversal via entry names
          // that contain '../', absolute paths, or Windows backslashes.
          const name = path.basename(entry.entryName);
          if (!name) continue; // skip entries with no usable filename
          // ZIP bomb guard: check uncompressed size before decompressing.
          // adm-zip 0.5.x exposes `header.size` as the uncompressed byte count.
          // Using `as any` because the TypeScript types ship without this property
          // declared, but it is a stable part of the adm-zip implementation.
          if ((entry.header as any).size > MAX_ENTRY_BYTES) {
            console.warn(`[STUDIES/UPLOAD zip] Entrada "${entry.entryName}" excede ${MAX_ENTRY_BYTES} bytes descomprimidos, ignorada`);
            continue;
          }
          const entryData = entry.getData();
          // M3: Validate DICOM preamble (bytes 128–131 must equal 'DICM')
          if (!isDicomFile(entryData)) {
            errors.push(`${name} — Archivo no es un DICOM válido (preamble inválido)`);
            continue;
          }
          const parsed = safeParseDicom(entryData);
          const out = path.join(storageFolder, name);
          fs.writeFileSync(out, entryData);
          await persistDicom(study.id, out, name, entryData.length, parsed);
          persistedFiles += 1;
        }

      } else if (
        lowerName.endsWith('.tar.bz2') || lowerName.endsWith('.tbz2') ||
        lowerName.endsWith('.tbz')     || lowerName.endsWith('.tar.gz') ||
        lowerName.endsWith('.tgz')     || lowerName.endsWith('.tar')
      ) {
        // ── TAR (bz2 / gz / plain) — uses node-tar (cross-platform, no shell dependency) ──
        const extractDir = path.join(
          path.resolve(process.cwd(), 'storage/tmp'),
          `tar_${Date.now()}_${Math.random().toString(36).slice(2)}`
        );
        fs.mkdirSync(extractDir, { recursive: true });
        try {
          // M2: node-tar handles gzip, bzip2 and plain tar natively
          // without relying on a system 'tar' binary (cross-platform safe).
          await tar.x({ file: file.path, cwd: extractDir });
          const dcmFiles = walkDicomFiles(extractDir);
          if (dcmFiles.length === 0) {
            console.warn('[STUDIES/UPLOAD tar] No se encontraron archivos DICOM en', file.originalname);
          }
          for (const dcmPath of dcmFiles) {
            const data = fs.readFileSync(dcmPath);
            // M3: Validate DICOM preamble before persisting
            if (!isDicomFile(data)) {
              errors.push(`${path.basename(dcmPath)} — Archivo no es un DICOM válido (preamble inválido)`);
              continue;
            }
            const parsed = safeParseDicom(data);
            // Flatten name: use only the basename to avoid path traversal
            const name = path.basename(dcmPath);
            const out = path.join(storageFolder, name);
            fs.copyFileSync(dcmPath, out);
            await persistDicom(study.id, out, name, data.length, parsed);
            persistedFiles += 1;
          }
        } finally {
          fs.rmSync(extractDir, { recursive: true, force: true });
        }

      } else {
        // ── Single DICOM file ──────────────────────────────────────────────
        const data = fs.readFileSync(file.path);
        // M3: Validate DICOM preamble before persisting
        if (!isDicomFile(data)) {
          errors.push(`${file.originalname} — Archivo no es un DICOM válido (preamble inválido)`);
          continue;
        }
        const parsed = safeParseDicom(data);
        // Security: use basename only — prevents path traversal via originalname
        const safeName = path.basename(file.originalname);
        const out = path.join(storageFolder, safeName);
        fs.copyFileSync(file.path, out);
        await persistDicom(study.id, out, safeName, file.size, parsed);
        persistedFiles += 1;
      }
    } catch (e) {
      errors.push(file.originalname);
      console.error('[STUDIES/UPLOAD file]', file.originalname, e);
    } finally {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }

  if (study.assignedDoctorId) {
    await createNotification(study.assignedDoctorId, 'Estudio cargado', `Se cargó un estudio ${modality} asignado a usted.`, 'STUDY_UPLOADED').catch(() => {});
  }
  await logAudit(req, 'STUDY_UPLOADED', 'STUDY', study.id, { persistedFiles, modality, errors });

  return res.status(201).json({
    studyId: study.id,
    files: persistedFiles,
    errors: errors.length ? errors : undefined
  });
});

/**
 * Recursively collect all DICOM files (.dcm / .dicom) inside a directory.
 * Used after extracting a tar archive.
 */
function walkDicomFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDicomFiles(full));
    } else {
      const lower = entry.name.toLowerCase();
      // Accept .dcm, .dicom, or files with no extension (common in DICOM exports)
      if (lower.endsWith('.dcm') || lower.endsWith('.dicom') || !lower.includes('.')) {
        results.push(full);
      }
    }
  }
  return results;
}

function cleanupTmpFiles(files: Express.Multer.File[]) {
  for (const f of files) {
    try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {}
  }
}

async function persistDicom(
  studyId: string,
  filePath: string,
  fileName: string,
  fileSize: number,
  parsed: ReturnType<typeof safeParseDicom>
) {
  let seriesId: string | null = null;
  if (parsed.seriesInstanceUid) {
    let series = await prisma.studySeries.findFirst({ where: { studyId, seriesInstanceUid: parsed.seriesInstanceUid } });
    if (!series) {
      series = await prisma.studySeries.create({
        data: { studyId, seriesInstanceUid: parsed.seriesInstanceUid, modality: parsed.modality || undefined }
      });
    }
    seriesId = series.id;
  }

  await prisma.dicomFile.create({
    data: {
      studyId,
      seriesId,
      filePath,
      fileName,
      mimeType: 'application/dicom',
      fileSize,
      sopInstanceUid: parsed.sopInstanceUid,
      instanceNumber: parsed.instanceNumber || null,
      metadataJson: parsed as any
    }
  });
}

function safeParseDicom(buffer: Buffer) {
  try {
    const dataSet = dicomParser.parseDicom(buffer as unknown as Uint8Array);
    return {
      studyInstanceUid: dataSet.string('x0020000d') || null,
      seriesInstanceUid: dataSet.string('x0020000e') || null,
      sopInstanceUid: dataSet.string('x00080018') || null,
      instanceNumber: Number(dataSet.string('x00200013') || 0),
      modality: dataSet.string('x00080060') || null,
      patientName: dataSet.string('x00100010') || null,
      studyDescription: dataSet.string('x00081030') || null
    };
  } catch {
    return {
      studyInstanceUid: null,
      seriesInstanceUid: null,
      sopInstanceUid: null,
      instanceNumber: null,
      modality: null,
      patientName: null,
      studyDescription: null
    };
  }
}

/**
 * M3: Validates the DICOM preamble (Part 10 format).
 * A valid DICOM file has the ASCII bytes 'D','I','C','M' at offsets 128–131.
 * Files that fail this check are not persisted to the medical storage.
 */
function isDicomFile(buffer: Buffer): boolean {
  if (buffer.length < 132) return false;
  return (
    buffer[128] === 0x44 && // 'D'
    buffer[129] === 0x49 && // 'I'
    buffer[130] === 0x43 && // 'C'
    buffer[131] === 0x4d    // 'M'
  );
}

// ─── M5: Patient reassignment ─────────────────────────────────────────────────

/**
 * PATCH /studies/:id/patient — Admin-only endpoint to reassign a study to a
 * different patient. Useful when a study is uploaded with the wrong patient ID.
 * Logs the change to the audit log with old and new patient IDs.
 */
studiesRouter.patch('/:id/patient', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  const { patientId } = req.body;
  if (!patientId || typeof patientId !== 'string') {
    return res.status(400).json({ message: 'Se requiere patientId' });
  }

  try {
    const [study, patient] = await Promise.all([
      prisma.study.findUnique({ where: { id: String(req.params.id) } }),
      prisma.patient.findUnique({ where: { id: patientId } })
    ]);

    if (!study) return res.status(404).json({ message: 'Estudio no encontrado' });
    if (!patient) return res.status(404).json({ message: 'Paciente no encontrado' });
    if (study.patientId === patientId) {
      return res.status(400).json({ message: 'El estudio ya está asignado a este paciente' });
    }

    const oldPatientId = study.patientId;
    const updated = await prisma.study.update({
      where: { id: study.id },
      data:  { patientId }
    });

    await logAudit(req, 'STUDY_PATIENT_REASSIGNED', 'STUDY', study.id, {
      oldPatientId,
      newPatientId: patientId
    });

    return res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ message: 'Estudio no encontrado' });
    console.error('[STUDIES/PATCH/PATIENT]', err);
    return res.status(500).json({ message: 'Error al reasignar paciente' });
  }
});
