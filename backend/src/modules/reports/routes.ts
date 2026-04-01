import { Router } from 'express';
import { ReportStatus, StudyStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { generateClinicalPdf } from './pdf-service.js';
import { logAudit } from '../../middleware/audit.js';
import { createNotification } from '../notifications/service.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get('/', requireRole('ADMIN', 'DOCTOR'), async (_req, res) => {
  const reports = await prisma.report.findMany({ include: { study: { include: { patient: true } }, doctor: true, measurements: true } });
  res.json(reports);
});

const draftSchema = z.object({
  studyId: z.string().min(5),
  findings: z.string().min(5),
  conclusion: z.string().min(5),
  patientSummary: z.string().optional(),
  measurements: z.array(z.object({ type: z.string(), label: z.string(), value: z.number(), unit: z.string() })).optional()
});

reportsRouter.post('/', requireRole('DOCTOR', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

  const report = await prisma.report.create({
    data: {
      studyId: parsed.data.studyId,
      doctorId: req.user!.sub,
      findings: parsed.data.findings,
      conclusion: parsed.data.conclusion,
      patientSummary: parsed.data.patientSummary,
      status: ReportStatus.DRAFT,
      draftedAt: new Date(),
      measurements: parsed.data.measurements?.length ? { create: parsed.data.measurements } : undefined
    },
    include: { measurements: true }
  });
  await logAudit(req, 'REPORT_CREATED', 'REPORT', report.id);
  res.status(201).json(report);
});

reportsRouter.put('/:id', requireRole('DOCTOR', 'ADMIN'), async (req: AuthRequest, res) => {
  const parsed = draftSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

  const report = await prisma.report.update({
    where: { id: req.params.id },
    data: {
      findings: parsed.data.findings,
      conclusion: parsed.data.conclusion,
      patientSummary: parsed.data.patientSummary,
      updatedAt: new Date()
    }
  });

  if (parsed.data.measurements) {
    await prisma.reportMeasurement.deleteMany({ where: { reportId: report.id } });
    if (parsed.data.measurements.length) {
      await prisma.reportMeasurement.createMany({ data: parsed.data.measurements.map((m) => ({ ...m, reportId: report.id })) });
    }
  }

  await logAudit(req, 'REPORT_UPDATED', 'REPORT', report.id);
  res.json(report);
});

reportsRouter.post('/:id/finalize', requireRole('DOCTOR', 'ADMIN'), async (req: AuthRequest, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id }, include: { study: { include: { patient: true } }, doctor: true, measurements: true } });
  if (!report) return res.status(404).json({ message: 'Informe no encontrado' });

  const pdfPath = await generateClinicalPdf({
    reportId: report.id,
    patientName: `${report.study.patient.firstName} ${report.study.patient.lastName}`,
    patientCode: report.study.patient.internalCode,
    studyDescription: report.study.description || report.study.modality,
    doctorName: `${report.doctor.firstName} ${report.doctor.lastName}`,
    findings: report.findings,
    conclusion: report.conclusion,
    measurements: report.measurements.map((m) => ({ label: m.label, value: m.value, unit: m.unit }))
  });

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: { status: ReportStatus.FINAL, finalizedAt: new Date(), pdfPath }
  });
  await prisma.generatedDocument.create({ data: { reportId: report.id, type: 'REPORT_PDF', filePath: pdfPath, generatedById: req.user!.sub } });
  await prisma.study.update({ where: { id: report.studyId }, data: { status: StudyStatus.REPORTED } });

  const patientAccess = await prisma.patientPortalAccess.findUnique({ where: { patientId: report.study.patientId } });
  if (patientAccess) {
    await createNotification(patientAccess.userId, 'Nuevo informe disponible', 'Su informe médico fue publicado en el portal.', 'REPORT_PUBLISHED');
  }

  await logAudit(req, 'REPORT_FINALIZED', 'REPORT', report.id);
  res.json(updated);
});
