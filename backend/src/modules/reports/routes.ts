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

// ─── Measurement schema with full primary evidence references ─────────────────

const measurementSchema = z.object({
  // Primary evidence references
  sopInstanceUid:      z.string().optional(),
  seriesInstanceUid:   z.string().optional(),
  studyInstanceUid:    z.string().optional(),
  frameOfReferenceUid: z.string().optional(),
  instanceNumber:      z.number().int().optional(),
  frameIndex:          z.number().int().min(0).optional(),
  // Geometry
  coordinatesJson:     z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  imageWidth:          z.number().int().optional(),
  imageHeight:         z.number().int().optional(),
  // Tool & result
  toolName:            z.string().max(80).optional(),
  type:                z.string().min(1),
  label:               z.string().min(1),
  value:               z.number(),
  unit:                z.string().min(1),
  extraStatsJson:      z.record(z.number()).optional()
});

// ─── AI session schema (tracked per interaction) ──────────────────────────────

const aiSessionSchema = z.object({
  requestedAt: z.string(),
  model:       z.string(),
  section:     z.enum(['findings', 'conclusion', 'patientSummary', 'consistency']),
  action:      z.enum(['accepted', 'modified', 'discarded']),
  editedByUser: z.boolean().optional()
});

// ─── Draft schema ─────────────────────────────────────────────────────────────

const draftSchema = z.object({
  studyId:       z.string().min(5),
  findings:      z.string().min(5).max(10000),
  conclusion:    z.string().min(5).max(5000),
  patientSummary: z.string().max(2000).optional(),
  measurements:  z.array(measurementSchema).optional(),
  // AI attribution
  aiUsed:        z.boolean().optional(),
  aiModel:       z.string().max(80).optional(),
  aiSessions:    z.array(aiSessionSchema).optional()
});

// ─── Listar informes ──────────────────────────────────────────────────────────

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
          measurements: { where: { isActive: true } }
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

// ─── Detalle de un informe ────────────────────────────────────────────────────

reportsRouter.get('/:id', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: String(req.params.id) },
      include: {
        study:  { include: { patient: true } },
        doctor: { select: { id: true, firstName: true, lastName: true } },
        measurements: { where: { isActive: true } },
        documents: true,
        keyImages: true,
        childReports: { select: { id: true, versionNumber: true, isAddendum: true, status: true, createdAt: true } }
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

// ─── Crear borrador ───────────────────────────────────────────────────────────

reportsRouter.post('/', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

  try {
    const study = await prisma.study.findUnique({ where: { id: parsed.data.studyId } });
    if (!study) return res.status(404).json({ message: 'Estudio no encontrado' });
    if (req.user?.role === 'DOCTOR' && study.assignedDoctorId && study.assignedDoctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para informar este estudio' });
    }

    // Only one active (non-addendum) report per study per doctor
    const existing = await prisma.report.findFirst({
      where: { studyId: parsed.data.studyId, doctorId: req.user!.sub, isAddendum: false }
    });
    if (existing) return res.status(409).json({ message: 'Ya existe un informe para este estudio', reportId: existing.id });

    const measData = parsed.data.measurements?.map((m) => ({
      ...m,
      coordinatesJson: m.coordinatesJson as any,
      extraStatsJson:  m.extraStatsJson  as any,
      createdByUserId: req.user!.sub,
      isActive:        true
    }));

    const report = await prisma.report.create({
      data: {
        studyId:        parsed.data.studyId,
        doctorId:       req.user!.sub,
        findings:       parsed.data.findings,
        conclusion:     parsed.data.conclusion,
        patientSummary: parsed.data.patientSummary || null,
        status:         ReportStatus.DRAFT,
        draftedAt:      new Date(),
        aiUsed:         parsed.data.aiUsed ?? false,
        aiModel:        parsed.data.aiModel ?? null,
        aiSessions:     parsed.data.aiSessions as any ?? null,
        measurements:   measData?.length ? { create: measData } : undefined
      },
      include: { measurements: { where: { isActive: true } } }
    });

    await logAudit(req, 'REPORT_CREATED', 'REPORT', report.id, {
      studyId:          parsed.data.studyId,
      measurementCount: measData?.length ?? 0,
      aiUsed:           parsed.data.aiUsed ?? false
    });
    return res.status(201).json(report);
  } catch (err) {
    console.error('[REPORTS/POST]', err);
    return res.status(500).json({ message: 'Error al crear informe' });
  }
});

// ─── Actualizar borrador ──────────────────────────────────────────────────────

reportsRouter.put('/:id', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = draftSchema.partial().omit({ studyId: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

  try {
    const report = await prisma.report.findUnique({ where: { id: String(req.params.id) } });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });

    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para editar este informe' });
    }
    if (report.status === ReportStatus.FINAL || report.status === ReportStatus.SIGNED) {
      return res.status(422).json({ message: 'El informe ya fue finalizado y no puede ser editado. Use addendum.' });
    }

    const updated = await prisma.report.update({
      where: { id: String(req.params.id) },
      data: {
        findings:       parsed.data.findings,
        conclusion:     parsed.data.conclusion,
        patientSummary: parsed.data.patientSummary,
        aiUsed:         parsed.data.aiUsed,
        aiModel:        parsed.data.aiModel,
        aiSessions:     parsed.data.aiSessions as any
      },
      include: { measurements: { where: { isActive: true } } }
    });

    // ── Granular measurement update ──────────────────────────────────────────
    if (parsed.data.measurements !== undefined) {
      // Soft-delete all current active measurements with audit trail
      const current = await prisma.reportMeasurement.findMany({
        where: { reportId: updated.id, isActive: true }
      });

      if (current.length > 0) {
        await prisma.reportMeasurement.updateMany({
          where: { reportId: updated.id, isActive: true },
          data:  { isActive: false, deletedAt: new Date(), deletedByUserId: req.user!.sub }
        });
        // Log individual deletions for audit
        for (const m of current) {
          await logAudit(req, 'MEASUREMENT_SOFT_DELETED', 'MEASUREMENT', m.id, {
            reportId: m.reportId,
            label:    m.label,
            value:    m.value,
            unit:     m.unit,
            sopInstanceUid: m.sopInstanceUid
          });
        }
      }

      if (parsed.data.measurements.length > 0) {
        const newMeasData = parsed.data.measurements.map((m) => ({
          ...m,
          coordinatesJson: m.coordinatesJson as any,
          extraStatsJson:  m.extraStatsJson  as any,
          reportId:        updated.id,
          createdByUserId: req.user!.sub,
          isActive:        true
        }));
        const created = await prisma.$transaction(
          newMeasData.map((d) => prisma.reportMeasurement.create({ data: d }))
        );
        // Log individual creations
        for (const m of created) {
          await logAudit(req, 'MEASUREMENT_CREATED', 'MEASUREMENT', m.id, {
            reportId:       m.reportId,
            label:          m.label,
            value:          m.value,
            unit:           m.unit,
            toolName:       m.toolName,
            sopInstanceUid: m.sopInstanceUid,
            instanceNumber: m.instanceNumber,
            frameIndex:     m.frameIndex
          });
        }
      }
    }

    await logAudit(req, 'REPORT_UPDATED', 'REPORT', updated.id, {
      aiUsed:           parsed.data.aiUsed,
      measurementCount: parsed.data.measurements?.length ?? 0
    });

    // Return fresh data with active measurements
    const fresh = await prisma.report.findUnique({
      where:   { id: updated.id },
      include: { measurements: { where: { isActive: true } }, keyImages: true }
    });
    return res.json(fresh);
  } catch (err) {
    console.error('[REPORTS/PUT]', err);
    return res.status(500).json({ message: 'Error al actualizar informe' });
  }
});

// ─── Finalizar informe ────────────────────────────────────────────────────────

reportsRouter.post('/:id/finalize', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: String(req.params.id) },
      include: {
        study:    { include: { patient: true } },
        doctor:   { select: { id: true, firstName: true, lastName: true, licenseNumber: true, specialty: true } },
        measurements: { where: { isActive: true } },
        keyImages: true
      }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });
    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para finalizar este informe' });
    }
    if (report.status === ReportStatus.FINAL || report.status === ReportStatus.SIGNED) {
      return res.status(422).json({ message: 'El informe ya fue finalizado' });
    }

    const { patient } = report.study;

    const pdfRelativePath = await generateClinicalPdf({
      reportId:             report.id,
      patientName:          `${patient.firstName} ${patient.lastName}`,
      patientCode:          patient.internalCode,
      patientDni:           patient.documentId,
      patientCuil:          patient.cuil || undefined,
      patientDob:           patient.dateOfBirth?.toISOString(),
      patientSex:           patient.sex,
      healthInsurance:      patient.healthInsurance || undefined,
      healthInsurancePlan:  patient.healthInsurancePlan || undefined,
      healthInsuranceMemberId: patient.healthInsuranceMemberId || undefined,
      studyDate:            report.study.studyDate?.toISOString(),
      studyModality:        report.study.modality,
      studyDescription:     report.study.description || report.study.modality,
      requestingDoctorName: report.study.requestingDoctorName || undefined,
      insuranceOrderNumber: report.study.insuranceOrderNumber || undefined,
      doctorName:           `${report.doctor.firstName} ${report.doctor.lastName}`,
      doctorLicense:        (report.doctor as any).licenseNumber || undefined,
      doctorSpecialty:      (report.doctor as any).specialty || undefined,
      findings:             report.findings,
      conclusion:           report.conclusion,
      patientSummary:       report.patientSummary || undefined,
      aiUsed:               report.aiUsed,
      measurements:         report.measurements.map((m) => ({
        label:          m.label,
        value:          m.value,
        unit:           m.unit,
        sopInstanceUid: m.sopInstanceUid ?? undefined,
        instanceNumber: m.instanceNumber ?? undefined,
        frameIndex:     m.frameIndex ?? undefined
      }))
    });

    // Store SHA-256 content hash on the Report for tamper detection
    const contentHash = crypto
      .createHash('sha256')
      .update(`${report.findings}|${report.conclusion}`)
      .digest('hex');

    const updated = await prisma.report.update({
      where: { id: report.id },
      data:  { status: ReportStatus.FINAL, finalizedAt: new Date(), pdfPath: pdfRelativePath, signatureHash: contentHash }
    });

    await prisma.generatedDocument.create({
      data: { reportId: report.id, type: 'REPORT_PDF', filePath: pdfRelativePath, generatedById: req.user!.sub }
    });
    await prisma.study.update({ where: { id: report.studyId }, data: { status: StudyStatus.REPORTED } });

    const patientAccess = await prisma.patientPortalAccess.findUnique({ where: { patientId: patient.id } });
    if (patientAccess) {
      await createNotification(patientAccess.userId, 'Nuevo informe disponible', 'Su informe médico fue publicado en el portal.', 'REPORT_PUBLISHED').catch(() => {});
    }
    if (patient.email) sendReportFinalizedEmail(patient.email, updated).catch(() => {});

    await logAudit(req, 'REPORT_FINALIZED', 'REPORT', report.id, {
      previousStatus: report.status,
      newStatus:      ReportStatus.FINAL,
      doctorId:       req.user!.sub,
      patientId:      patient.id,
      pdfPath:        pdfRelativePath,
      contentHash,
      patientNotified: !!patient.email
    });

    return res.json({ ...updated, pdfUrl: toFileUrl(pdfRelativePath, env.APP_BASE_URL) });
  } catch (err) {
    console.error('[REPORTS/FINALIZE]', err);
    return res.status(500).json({ message: 'Error al finalizar informe' });
  }
});

// ─── Firmar informe ───────────────────────────────────────────────────────────

reportsRouter.post('/:id/sign', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({ where: { id: String(req.params.id) } });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });
    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para firmar este informe' });
    }
    if (report.status !== ReportStatus.FINAL) {
      return res.status(422).json({ message: 'Solo se pueden firmar informes en estado FINAL' });
    }

    const contentHash = crypto
      .createHash('sha256')
      .update(`${report.findings}|${report.conclusion}`)
      .digest('hex');

    const updated = await prisma.report.update({
      where: { id: report.id },
      data:  { status: ReportStatus.SIGNED, signatureHash: contentHash }
    });

    await logAudit(req, 'REPORT_SIGNED', 'REPORT', report.id, {
      doctorId:    req.user!.sub,
      contentHash,
      signedAt:    new Date().toISOString()
    });

    return res.json(updated);
  } catch (err) {
    console.error('[REPORTS/SIGN]', err);
    return res.status(500).json({ message: 'Error al firmar informe' });
  }
});

// ─── Addendum — corrige informe firmado sin sobreescribirlo ──────────────────

const addendumSchema = z.object({
  findings:      z.string().min(5).max(10000),
  conclusion:    z.string().min(5).max(5000),
  patientSummary: z.string().max(2000).optional(),
  addendumReason: z.string().min(5).max(1000),
  measurements:  z.array(measurementSchema).optional(),
  aiUsed:        z.boolean().optional(),
  aiModel:       z.string().max(80).optional(),
  aiSessions:    z.array(aiSessionSchema).optional()
});

reportsRouter.post('/:id/addendum', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = addendumSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

  try {
    const parent = await prisma.report.findUnique({
      where:   { id: String(req.params.id) },
      include: { measurements: { where: { isActive: true } } }
    });
    if (!parent) return res.status(404).json({ message: 'Informe original no encontrado' });
    if (req.user?.role === 'DOCTOR' && parent.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para crear addendum en este informe' });
    }
    if (parent.status !== ReportStatus.SIGNED) {
      return res.status(422).json({ message: 'Solo se puede crear addendum sobre informes firmados' });
    }

    const measData = parsed.data.measurements?.map((m) => ({
      ...m,
      coordinatesJson: m.coordinatesJson as any,
      extraStatsJson:  m.extraStatsJson  as any,
      createdByUserId: req.user!.sub,
      isActive:        true
    }));

    const addendum = await prisma.report.create({
      data: {
        studyId:          parent.studyId,
        doctorId:         req.user!.sub,
        findings:         parsed.data.findings,
        conclusion:       parsed.data.conclusion,
        patientSummary:   parsed.data.patientSummary || null,
        status:           ReportStatus.DRAFT,
        draftedAt:        new Date(),
        versionNumber:    parent.versionNumber + 1,
        parentReportId:   parent.id,
        isAddendum:       true,
        addendumReason:   parsed.data.addendumReason,
        addendumAt:       new Date(),
        addendumByUserId: req.user!.sub,
        aiUsed:           parsed.data.aiUsed ?? false,
        aiModel:          parsed.data.aiModel ?? null,
        aiSessions:       parsed.data.aiSessions as any ?? null,
        measurements:     measData?.length ? { create: measData } : undefined
      },
      include: { measurements: { where: { isActive: true } } }
    });

    await logAudit(req, 'REPORT_ADDENDUM_CREATED', 'REPORT', addendum.id, {
      parentReportId:   parent.id,
      versionNumber:    addendum.versionNumber,
      addendumReason:   parsed.data.addendumReason,
      addendumByUserId: req.user!.sub,
      measurementCount: measData?.length ?? 0
    });

    return res.status(201).json(addendum);
  } catch (err) {
    console.error('[REPORTS/ADDENDUM]', err);
    return res.status(500).json({ message: 'Error al crear addendum' });
  }
});

