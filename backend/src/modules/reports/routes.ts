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

    // A6: Check if another doctor already has an active report for this study
    const parallelReport = await prisma.report.findFirst({
      where: {
        studyId:    parsed.data.studyId,
        doctorId:   { not: req.user!.sub },
        isAddendum: false,
        status:     { notIn: [ReportStatus.SIGNED] } // SIGNED reports are final — allow addenda
      },
      include: { doctor: { select: { firstName: true, lastName: true } } }
    });

    if (parallelReport) {
      const doctorName = `${parallelReport.doctor.firstName} ${parallelReport.doctor.lastName}`;
      if (!env.ALLOW_PARALLEL_REPORTS) {
        return res.status(409).json({
          message: `Este estudio ya tiene un informe activo creado por otro médico. Contacte al Dr. ${doctorName} para coordinar.`,
          existingReportId:   parallelReport.id,
          assignedDoctorName: doctorName
        });
      }
      // ALLOW_PARALLEL_REPORTS=true — log warning but allow creation
      await logAudit(req, 'PARALLEL_REPORT_WARNED', 'REPORT', parallelReport.id, {
        studyId:    parsed.data.studyId,
        doctorId:   req.user!.sub,
        conflictingDoctorId: parallelReport.doctorId
      });
    }

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

/**
 * PUT /reports/:id — Updates a DRAFT report with optimistic locking (M6).
 * Requires `updatedAt` in the body to detect concurrent edits.
 * Wraps measurement soft-delete and re-creation in a single transaction (C6).
 */
reportsRouter.put('/:id', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  const bodySchema = draftSchema.partial().omit({ studyId: true }).extend({
    updatedAt: z.string().optional() // M6: optimistic concurrency token
  });
  const parsed = bodySchema.safeParse(req.body);
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

    // M6: Optimistic concurrency check — reject if another user modified the report
    if (parsed.data.updatedAt && report.updatedAt.toISOString() !== parsed.data.updatedAt) {
      return res.status(409).json({ message: 'El informe fue modificado por otro usuario. Recargue e intente nuevamente.' });
    }

    // C6: Wrap the report update + measurement soft-delete + measurement creation
    // in a single transaction to prevent partial updates if any step fails.
    const fresh = await prisma.$transaction(async (tx) => {
      // Update core report fields
      const updated = await tx.report.update({
        where: { id: String(req.params.id) },
        data: {
          findings:       parsed.data.findings,
          conclusion:     parsed.data.conclusion,
          patientSummary: parsed.data.patientSummary,
          aiUsed:         parsed.data.aiUsed,
          aiModel:        parsed.data.aiModel,
          aiSessions:     parsed.data.aiSessions as any
        }
      });

      // ── Granular measurement update (inside transaction) ─────────────────
      if (parsed.data.measurements !== undefined) {
        const current = await tx.reportMeasurement.findMany({
          where: { reportId: updated.id, isActive: true }
        });

        if (current.length > 0) {
          await tx.reportMeasurement.updateMany({
            where: { reportId: updated.id, isActive: true },
            data:  { isActive: false, deletedAt: new Date(), deletedByUserId: req.user!.sub }
          });
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
          // C6: Single createMany instead of N individual creates
          await tx.reportMeasurement.createMany({ data: newMeasData });
        }
      }

      return tx.report.findUnique({
        where:   { id: updated.id },
        include: { measurements: { where: { isActive: true } }, keyImages: true }
      });
    });

    await logAudit(req, 'REPORT_UPDATED', 'REPORT', String(req.params.id), {
      aiUsed:           parsed.data.aiUsed,
      measurementCount: parsed.data.measurements?.length ?? 0
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

    // A3: If this is an addendum being finalized, regenerate the parent report's PDF
    // with a banner indicating the correction so patients see the updated version.
    if (report.isAddendum && report.parentReportId) {
      await regenerateParentPdfWithAddendumBanner(report.parentReportId, report.id, report.versionNumber);
    }

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

/**
 * POST /reports/:id/sign — Signs a FINAL report with a SHA-256 content hash.
 *
 * A1 - DISCLAIMER: This constitutes a "firma electrónica simple" under Argentine
 * Law 25.506. It is NOT a legally valid digital signature (firma digital) as
 * defined by ANMAT Disposición 7304/2012, which requires X.509 certificates
 * issued by a CA recognised by the Argentine government (AFIP, OCA, etc.).
 *
 * TODO (long-term): Integrate with a PKCS#7/CMS signing workflow using
 * doctor-specific certificates for full Ley 25.506 compliance.
 */
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

    // A3: If this is an addendum being signed, regenerate the parent PDF
    if (report.isAddendum && report.parentReportId) {
      await regenerateParentPdfWithAddendumBanner(report.parentReportId, report.id, report.versionNumber);
    }

    await logAudit(req, 'REPORT_SIGNED', 'REPORT', report.id, {
      doctorId:    req.user!.sub,
      contentHash,
      signedAt:    new Date().toISOString()
    });

    // A1: Include the legal disclaimer in the sign response
    const disclaimer = 'FIRMA ELECTRÓNICA SIMPLE — Este informe no constituye firma digital con validez legal plena según Ley 25.506. Válido únicamente para uso interno y como registro clínico preliminar.';
    return res.json({ ...updated, disclaimer });
  } catch (err) {
    console.error('[REPORTS/SIGN]', err);
    return res.status(500).json({ message: 'Error al firmar informe' });
  }
});

// ─── Addendum — corrige informe finalizado o firmado sin sobreescribirlo ──────

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
    // A2: Allow addendum on both SIGNED and FINAL status reports.
    // FINAL reports are already visible to patients — corrections must be possible.
    if (parent.status !== ReportStatus.SIGNED && parent.status !== ReportStatus.FINAL) {
      return res.status(422).json({ message: 'Solo se puede crear addendum sobre informes finalizados o firmados' });
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

// ─── A3: Helper — regenerate parent PDF with addendum banner ──────────────────

/**
 * When an addendum is finalized or signed, regenerate the parent report's PDF
 * with a visible banner informing the patient that a correction was issued.
 * This ensures any cached/downloaded copies of the original PDF are superseded.
 *
 * A3 — ANMAT compliance: patient must be informed when a published report is corrected.
 */
async function regenerateParentPdfWithAddendumBanner(
  parentReportId: string,
  addendumId:     string,
  addendumVersion: number
): Promise<void> {
  try {
    const parent = await prisma.report.findUnique({
      where: { id: parentReportId },
      include: {
        study:  { include: { patient: true } },
        doctor: { select: { id: true, firstName: true, lastName: true, licenseNumber: true, specialty: true } },
        measurements: { where: { isActive: true } }
      }
    });
    if (!parent || !parent.pdfPath) return;

    const { patient } = parent.study;
    const addendumDate = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const addendumNotice = `ATENCIÓN: Este informe fue corregido por Addendum Nº ${addendumVersion} el ${addendumDate}. Consulte el informe ${addendumId.slice(0, 8).toUpperCase()} para la versión actualizada.`;

    await generateClinicalPdf({
      reportId:             parent.id,
      patientName:          `${patient.firstName} ${patient.lastName}`,
      patientCode:          patient.internalCode,
      patientDni:           patient.documentId,
      patientCuil:          patient.cuil || undefined,
      patientDob:           patient.dateOfBirth?.toISOString(),
      patientSex:           patient.sex,
      healthInsurance:      patient.healthInsurance || undefined,
      healthInsurancePlan:  patient.healthInsurancePlan || undefined,
      healthInsuranceMemberId: patient.healthInsuranceMemberId || undefined,
      studyDate:            parent.study.studyDate?.toISOString(),
      studyModality:        parent.study.modality,
      studyDescription:     parent.study.description || parent.study.modality,
      requestingDoctorName: parent.study.requestingDoctorName || undefined,
      insuranceOrderNumber: parent.study.insuranceOrderNumber || undefined,
      doctorName:           `${parent.doctor.firstName} ${parent.doctor.lastName}`,
      doctorLicense:        (parent.doctor as any).licenseNumber || undefined,
      doctorSpecialty:      (parent.doctor as any).specialty || undefined,
      findings:             parent.findings,
      conclusion:           parent.conclusion,
      patientSummary:       parent.patientSummary || undefined,
      aiUsed:               parent.aiUsed,
      measurements:         parent.measurements.map((m) => ({
        label:          m.label,
        value:          m.value,
        unit:           m.unit,
        sopInstanceUid: m.sopInstanceUid ?? undefined,
        instanceNumber: m.instanceNumber ?? undefined,
        frameIndex:     m.frameIndex ?? undefined
      })),
      addendumNotice
    });
  } catch (err) {
    // Non-fatal — log but don't fail the main request
    console.error('[REPORTS/ADDENDUM-BANNER] Error al regenerar PDF padre:', err);
  }
}
