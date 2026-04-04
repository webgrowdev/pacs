import { Router } from 'express';
import { ReportStatus, StudyStatus } from '@prisma/client';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { generateClinicalPdf } from './pdf-service.js';
import { logAudit } from '../../middleware/audit.js';
import { createNotification } from '../notifications/service.js';
import { sendReportFinalizedEmail } from '../../utils/email.js';
import { toFileUrl } from '../../storage/file-storage.js';
import { env } from '../../config/env.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth as any);

// Listar informes (con paginación — admin ve todos, médico ve los suyos)
reportsRouter.get('/', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const where = req.user?.role === 'DOCTOR' ? { doctorId: req.user.sub } : {};
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1')));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'))));
    const skip  = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        include: {
          study: {
            include: {
              patient: { select: { id: true, firstName: true, lastName: true, internalCode: true } }
            }
          },
          doctor: { select: { id: true, firstName: true, lastName: true } },
          measurements: true
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.report.count({ where })
    ]);

    return res.json({ data: reports, total, page, limit });
  } catch (err) {
    console.error('[REPORTS/GET]', err);
    return res.status(500).json({ message: 'Error al obtener informes' });
  }
});

// Detalle de un informe
reportsRouter.get('/:id', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: String(req.params.id) },
      include: {
        study: { include: { patient: true } },
        doctor: { select: { id: true, firstName: true, lastName: true } },
        measurements: true,
        documents: true
      }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });
    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para ver este informe' });
    }
    return res.json(report);
  } catch (err) {
    console.error('[REPORTS/GET/:id]', err);
    return res.status(500).json({ message: 'Error al obtener informe' });
  }
});

const draftSchema = z.object({
  studyId: z.string().min(5),
  findings: z.string().min(5).max(10000),
  conclusion: z.string().min(5).max(5000),
  patientSummary: z.string().max(2000).optional(),
  measurements: z
    .array(z.object({ type: z.string(), label: z.string().min(1), value: z.number(), unit: z.string().min(1) }))
    .optional()
});

// Crear borrador de informe
reportsRouter.post('/', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

  try {
    // Verificar que el estudio existe y el médico tiene acceso
    const study = await prisma.study.findUnique({ where: { id: parsed.data.studyId } });
    if (!study) return res.status(404).json({ message: 'Estudio no encontrado' });
    if (req.user?.role === 'DOCTOR' && study.assignedDoctorId && study.assignedDoctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para informar este estudio' });
    }

    // Solo un informe por estudio (un médico por estudio)
    const existing = await prisma.report.findFirst({ where: { studyId: parsed.data.studyId, doctorId: req.user!.sub } });
    if (existing) return res.status(409).json({ message: 'Ya existe un informe para este estudio', reportId: existing.id });

    const report = await prisma.report.create({
      data: {
        studyId: parsed.data.studyId,
        doctorId: req.user!.sub,
        findings: parsed.data.findings,
        conclusion: parsed.data.conclusion,
        patientSummary: parsed.data.patientSummary || null,
        status: ReportStatus.DRAFT,
        draftedAt: new Date(),
        measurements: parsed.data.measurements?.length
          ? { create: parsed.data.measurements }
          : undefined
      },
      include: { measurements: true }
    });

    await logAudit(req, 'REPORT_CREATED', 'REPORT', report.id);
    return res.status(201).json(report);
  } catch (err) {
    console.error('[REPORTS/POST]', err);
    return res.status(500).json({ message: 'Error al crear informe' });
  }
});

// Actualizar borrador
reportsRouter.put('/:id', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = draftSchema.partial().omit({ studyId: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

  try {
    const report = await prisma.report.findUnique({ where: { id: String(req.params.id) } });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });

    // Solo el médico dueño o admin pueden editar
    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para editar este informe' });
    }

    // No se puede editar un informe ya finalizado
    if (report.status === ReportStatus.FINAL || report.status === ReportStatus.SIGNED) {
      return res.status(422).json({ message: 'El informe ya fue finalizado y no puede ser editado' });
    }

    const updated = await prisma.report.update({
      where: { id: String(req.params.id) },
      data: {
        findings: parsed.data.findings,
        conclusion: parsed.data.conclusion,
        patientSummary: parsed.data.patientSummary
      },
      include: { measurements: true }
    });

    // Actualizar mediciones si se envían
    if (parsed.data.measurements !== undefined) {
      await prisma.reportMeasurement.deleteMany({ where: { reportId: updated.id } });
      if (parsed.data.measurements.length) {
        await prisma.reportMeasurement.createMany({
          data: parsed.data.measurements.map((m) => ({ ...m, reportId: updated.id }))
        });
      }
    }

    await logAudit(req, 'REPORT_UPDATED', 'REPORT', updated.id);
    return res.json(updated);
  } catch (err) {
    console.error('[REPORTS/PUT]', err);
    return res.status(500).json({ message: 'Error al actualizar informe' });
  }
});

// Finalizar informe y generar PDF
reportsRouter.post('/:id/finalize', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: String(req.params.id) },
      include: {
        study: { include: { patient: true } },
        doctor: true,
        measurements: true
      }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });

    // Solo el dueño o admin
    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para finalizar este informe' });
    }

    // Ya finalizado
    if (report.status === ReportStatus.FINAL || report.status === ReportStatus.SIGNED) {
      return res.status(422).json({ message: 'El informe ya fue finalizado' });
    }

    const { patient } = report.study;

    const pdfRelativePath = await generateClinicalPdf({
      reportId: report.id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      patientCode: patient.internalCode,
      patientDob: patient.dateOfBirth?.toISOString(),
      patientSex: patient.sex,
      studyDate: report.study.studyDate?.toISOString(),
      studyModality: report.study.modality,
      studyDescription: report.study.description || report.study.modality,
      doctorName: `${report.doctor.firstName} ${report.doctor.lastName}`,
      findings: report.findings,
      conclusion: report.conclusion,
      patientSummary: report.patientSummary || undefined,
      measurements: report.measurements.map((m) => ({ label: m.label, value: m.value, unit: m.unit }))
    });

    const updated = await prisma.report.update({
      where: { id: report.id },
      data: { status: ReportStatus.FINAL, finalizedAt: new Date(), pdfPath: pdfRelativePath }
    });

    await prisma.generatedDocument.create({
      data: { reportId: report.id, type: 'REPORT_PDF', filePath: pdfRelativePath, generatedById: req.user!.sub }
    });

    await prisma.study.update({
      where: { id: report.studyId },
      data: { status: StudyStatus.REPORTED }
    });

    // Notificar al paciente si tiene portal
    const patientAccess = await prisma.patientPortalAccess.findUnique({ where: { patientId: patient.id } });
    if (patientAccess) {
      await createNotification(patientAccess.userId, 'Nuevo informe disponible', 'Su informe médico fue publicado en el portal.', 'REPORT_PUBLISHED').catch(() => {});
    }

    if (patient.email) {
      sendReportFinalizedEmail(patient.email, updated).catch(() => {});
    }

    // ANMAT Disposición 2318/02 — detailed finalization audit with content hash for integrity
    const contentHash = crypto
      .createHash('sha256')
      .update(`${report.findings}|${report.conclusion}`)
      .digest('hex');

    await logAudit(req, 'REPORT_FINALIZED', 'REPORT', report.id, {
      previousStatus:  report.status,
      newStatus:       ReportStatus.FINAL,
      doctorId:        req.user!.sub,
      patientId:       patient.id,
      pdfPath:         pdfRelativePath,
      contentHash,               // SHA-256 of findings+conclusion for tamper detection
      patientNotified: !!patient.email
    });

    return res.json({
      ...updated,
      pdfUrl: toFileUrl(pdfRelativePath, env.APP_BASE_URL)
    });
  } catch (err) {
    console.error('[REPORTS/FINALIZE]', err);
    return res.status(500).json({ message: 'Error al finalizar informe' });
  }
});
