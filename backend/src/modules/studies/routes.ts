import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import dicomParser from 'dicom-parser';
import { z } from 'zod';
import { StudyStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { studyStoragePath } from '../../storage/file-storage.js';
import { logAudit } from '../../middleware/audit.js';
import { createNotification } from '../notifications/service.js';

const upload = multer({ dest: path.resolve(process.cwd(), 'storage/tmp') });
export const studiesRouter = Router();
studiesRouter.use(requireAuth);


studiesRouter.get('/worklist', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : undefined;
  const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : undefined;

  const where: any = {
    status: status as any,
    studyDate: dateFrom || dateTo ? { gte: dateFrom, lte: dateTo } : undefined
  };

  if (req.user?.role === 'DOCTOR') {
    where.OR = [{ assignedDoctorId: req.user.sub }, { assignedDoctorId: null }];
  }

  const studies = await prisma.study.findMany({
    where,
    include: { patient: true, assignedDoctor: true, reports: true },
    orderBy: { studyDate: 'desc' }
  });

  res.json(studies);
});

studiesRouter.post('/:id/assign', requireRole('ADMIN'), async (req: AuthRequest, res) => {
  const doctorId = String(req.body.doctorId || '');
  const doctor = await prisma.user.findUnique({ where: { id: doctorId }, include: { role: true } });
  if (!doctor || doctor.role.name !== 'DOCTOR') return res.status(400).json({ message: 'Doctor inválido' });

  const study = await prisma.study.update({ where: { id: req.params.id }, data: { assignedDoctorId: doctorId, status: StudyStatus.IN_REVIEW } });
  await createNotification(doctorId, 'Nuevo estudio asignado', `Tiene un nuevo estudio (${study.id}) para informar.`, 'STUDY_ASSIGNED');
  await logAudit(req, 'STUDY_ASSIGNED', 'STUDY', study.id, { doctorId });
  res.json(study);
});

studiesRouter.get('/', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  const where = req.user?.role === 'DOCTOR'
    ? { OR: [{ assignedDoctorId: req.user.sub }, { assignedDoctorId: null }] }
    : undefined;

  const studies = await prisma.study.findMany({ where, include: { patient: true, reports: true } });
  res.json(studies);
});

studiesRouter.get('/:id', requireRole('ADMIN', 'DOCTOR'), async (req: AuthRequest, res) => {
  const study = await prisma.study.findUnique({ where: { id: req.params.id }, include: { patient: true, dicomFiles: true, reports: true } });
  if (!study) return res.status(404).json({ message: 'Estudio no encontrado' });
  if (req.user?.role === 'DOCTOR' && study.assignedDoctorId && study.assignedDoctorId !== req.user.sub) {
    return res.status(403).json({ message: 'No autorizado para este estudio' });
  }
  res.json(study);
});

const uploadSchema = z.object({
  patientId: z.string().min(5),
  modality: z.string().min(1),
  studyDate: z.string().datetime(),
  description: z.string().optional(),
  assignedDoctorId: z.string().optional()
});

studiesRouter.post('/upload', requireRole('ADMIN', 'DOCTOR'), upload.array('files', 400), async (req: AuthRequest, res) => {
  const parsedBody = uploadSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ message: 'Payload inválido', errors: parsedBody.error.flatten() });

  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) return res.status(400).json({ message: 'Debe subir al menos un archivo DICOM o ZIP' });

  const { patientId, modality, studyDate, description, assignedDoctorId } = parsedBody.data;
  const study = await prisma.study.create({
    data: {
      patientId,
      modality,
      studyDate: new Date(studyDate),
      description,
      assignedDoctorId: assignedDoctorId || null,
      uploadedById: req.user!.sub
    }
  });

  const storageFolder = studyStoragePath(study.id);
  let persistedFiles = 0;

  for (const file of files) {
    if (file.originalname.endsWith('.zip')) {
      const zip = new AdmZip(file.path);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const entryData = entry.getData();
        const parsed = safeParseDicom(entryData);
        const out = path.join(storageFolder, entry.entryName.replace(/\//g, '_'));
        fs.writeFileSync(out, entryData);
        await persistDicom(study.id, out, entry.entryName, entryData.length, parsed);
        persistedFiles += 1;
      }
    } else {
      const data = fs.readFileSync(file.path);
      const parsed = safeParseDicom(data);
      const out = path.join(storageFolder, file.originalname);
      fs.copyFileSync(file.path, out);
      await persistDicom(study.id, out, file.originalname, file.size, parsed);
      persistedFiles += 1;
    }
    fs.unlinkSync(file.path);
  }

  if (study.assignedDoctorId) {
    await createNotification(study.assignedDoctorId, 'Estudio cargado', `Se cargó un estudio ${modality} asignado a usted.`, 'STUDY_UPLOADED');
  }
  await logAudit(req, 'STUDY_UPLOADED', 'STUDY', study.id, { persistedFiles, modality });
  res.status(201).json({ studyId: study.id, files: persistedFiles });
});

async function persistDicom(studyId: string, filePath: string, fileName: string, fileSize: number, parsed: ReturnType<typeof safeParseDicom>) {
  let seriesId: string | null = null;
  if (parsed.seriesInstanceUid) {
    let series = await prisma.studySeries.findFirst({ where: { studyId, seriesInstanceUid: parsed.seriesInstanceUid } });
    if (!series) {
      series = await prisma.studySeries.create({
        data: {
          studyId,
          seriesInstanceUid: parsed.seriesInstanceUid,
          modality: parsed.modality || undefined
        }
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
      metadataJson: parsed
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
      modality: dataSet.string('x00080060') || null
    };
  } catch {
    return { studyInstanceUid: null, seriesInstanceUid: null, sopInstanceUid: null, instanceNumber: null, modality: null };
  }
}
