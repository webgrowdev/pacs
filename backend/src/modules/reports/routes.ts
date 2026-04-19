import { Router } from 'express';
import { ReportStatus, StudyStatus } from '@prisma/client';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { generateClinicalPdf, StructuredScores, RadiationDose } from './pdf-service.js';
import { logAudit } from '../../middleware/audit.js';
import { createNotification } from '../notifications/service.js';
import { sendReportFinalizedEmail, sendCriticalFindingEmail, sendSignedReportEmail } from '../../utils/email.js';
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

// ─── Structured scores schema ─────────────────────────────────────────────────

const biRadsSchema = z.object({
  category:    z.number().int().min(0).max(6),
  density:     z.string().optional(),
  laterality:  z.string().optional(),
  massShape:   z.string().optional(),
  assessment:  z.string().optional()
}).optional();

const tiRadsSchema = z.object({
  category:      z.number().int().min(1).max(5),
  points:        z.number().optional(),
  composition:   z.string().optional(),
  echogenicity:  z.string().optional(),
  shape:         z.string().optional(),
  margin:        z.string().optional(),
  echogenicFoci: z.string().optional(),
  recommendation: z.string().optional()
}).optional();

const piRadsSchema = z.object({
  category:    z.number().int().min(1).max(5),
  zone:        z.string().optional(),
  dcePositive: z.boolean().optional(),
  assessment:  z.string().optional()
}).optional();

const liRadsSchema = z.object({
  category:            z.string(),
  size:                z.number().optional(),
  arterialEnhancement: z.boolean().optional(),
  assessment:          z.string().optional()
}).optional();

const chestSchema = z.object({
  opacity:         z.boolean().optional(),
  pleuralEffusion: z.boolean().optional(),
  pneumothorax:    z.boolean().optional(),
  cardiomegaly:    z.boolean().optional(),
  infiltrate:      z.boolean().optional(),
  consolidation:   z.boolean().optional(),
  atelectasis:     z.boolean().optional(),
  findings:        z.string().optional()
}).optional();

const structuredScoresSchema = z.object({
  birads:  biRadsSchema,
  tirads:  tiRadsSchema,
  pirads:  piRadsSchema,
  lirads:  liRadsSchema,
  chest:   chestSchema
}).optional();

// ─── Draft schema ─────────────────────────────────────────────────────────────

const draftSchema = z.object({
  studyId:            z.string().min(5),
  clinicalIndication: z.string().max(2000).optional(),
  findings:           z.string().min(5).max(10000),
  conclusion:         z.string().min(5).max(5000),
  patientSummary:     z.string().max(2000).optional(),
  measurements:       z.array(measurementSchema).optional(),
  structuredScores:   structuredScoresSchema,
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
        studyId:            parsed.data.studyId,
        doctorId:           req.user!.sub,
        clinicalIndication: parsed.data.clinicalIndication || null,
        findings:           parsed.data.findings,
        conclusion:         parsed.data.conclusion,
        patientSummary:     parsed.data.patientSummary || null,
        status:             ReportStatus.DRAFT,
        draftedAt:          new Date(),
        aiUsed:             parsed.data.aiUsed ?? false,
        aiModel:            parsed.data.aiModel ?? null,
        aiSessions:         parsed.data.aiSessions as any ?? null,
        structuredScores:   parsed.data.structuredScores as any ?? null,
        measurements:       measData?.length ? { create: measData } : undefined
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
          clinicalIndication: parsed.data.clinicalIndication,
          findings:           parsed.data.findings,
          conclusion:         parsed.data.conclusion,
          patientSummary:     parsed.data.patientSummary,
          aiUsed:             parsed.data.aiUsed,
          aiModel:            parsed.data.aiModel,
          aiSessions:         parsed.data.aiSessions as any,
          structuredScores:   parsed.data.structuredScores as any
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
      aiUsed:              parsed.data.aiUsed,
      measurementCount:    parsed.data.measurements?.length ?? 0,
      // C6: Measurements were updated atomically in a transaction.
      // Audit captures the final count rather than per-measurement events.
      measurementsUpdated: parsed.data.measurements !== undefined
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
    const verifyUrl = `${env.APP_BASE_URL}/reports/${report.id}/verify`;

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
      doctorLicense:        report.doctor.licenseNumber || undefined,
      doctorSpecialty:      report.doctor.specialty || undefined,
      clinicalIndication:   report.clinicalIndication || undefined,
      findings:             report.findings,
      conclusion:           report.conclusion,
      patientSummary:       report.patientSummary || undefined,
      aiUsed:               report.aiUsed,
      isCritical:           report.isCritical,
      criticalReason:       report.criticalReason || undefined,
      structuredScores:     (report.structuredScores as StructuredScores) || undefined,
      radiationDose:        (report.study.radiationDoseJson as RadiationDose) || undefined,
      verifyUrl,
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
 * POST /reports/:id/sign — Signs a FINAL report with identity confirmation.
 *
 * Requires password re-authentication before signing (Sección 4).
 * This constitutes a "firma electrónica simple" under Argentine Law 25.506.
 *
 * A1 - DISCLAIMER: This is NOT a legally valid digital signature (firma digital)
 * as defined by ANMAT Disposición 7304/2012. That requires X.509 certificates
 * issued by a CA recognised by the Argentine government (AFIP, OCA, etc.) with
 * PKCS#7/CMS signature embedded in the PDF.
 *
 * TODO (long-term): Integrate with a PKCS#7/CMS signing workflow using
 * doctor-specific certificates for full Ley 25.506 compliance.
 */
reportsRouter.post('/:id/sign', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  // Sección 4: Require password confirmation before signing
  const { password } = req.body;
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ message: 'Se requiere contraseña para confirmar la firma' });
  }

  try {
    // Verify doctor's password
    const signingUser = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!signingUser) return res.status(401).json({ message: 'Usuario no encontrado' });
    const passwordValid = await bcrypt.compare(password, signingUser.passwordHash);
    if (!passwordValid) {
      await logAudit(req, 'REPORT_SIGN_AUTH_FAILED', 'REPORT', String(req.params.id), { doctorId: req.user!.sub });
      return res.status(401).json({ message: 'Contraseña incorrecta. La firma requiere autenticación válida.' });
    }

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
      data:  { status: ReportStatus.SIGNED, signatureHash: contentHash, signedAt: new Date() }
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

    // Sección 13: Auto-distribute signed report to requesting doctor via email
    try {
      const fullReport = await prisma.report.findUnique({
        where: { id: report.id },
        include: { study: true }
      });
      if (fullReport?.study?.requestingDoctorEmail && fullReport.pdfPath) {
        sendSignedReportEmail(
          fullReport.study.requestingDoctorEmail,
          fullReport.study.requestingDoctorName || 'Médico solicitante',
          fullReport
        ).catch(() => {});
      }
    } catch {
      // Non-fatal — distribution failure should not block the sign operation
    }

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
    const verifyUrl = `${env.APP_BASE_URL}/reports/${parent.id}/verify`;

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
      doctorLicense:        parent.doctor.licenseNumber || undefined,
      doctorSpecialty:      parent.doctor.specialty || undefined,
      clinicalIndication:   parent.clinicalIndication || undefined,
      findings:             parent.findings,
      conclusion:           parent.conclusion,
      patientSummary:       parent.patientSummary || undefined,
      aiUsed:               parent.aiUsed,
      isCritical:           parent.isCritical,
      criticalReason:       parent.criticalReason || undefined,
      structuredScores:     (parent.structuredScores as StructuredScores) || undefined,
      radiationDose:        (parent.study.radiationDoseJson as RadiationDose) || undefined,
      verifyUrl,
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

// ─── Sección 5: Verificar integridad del informe ──────────────────────────────

/**
 * GET /reports/:id/verify-integrity — Verifies that the report content has not
 * been tampered with since it was finalized.
 *
 * Recomputes SHA-256(findings|conclusion) and compares with stored signatureHash.
 * A mismatch indicates the content was altered after finalization.
 */
reportsRouter.get('/:id/verify-integrity', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({ where: { id: String(req.params.id) } });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });

    if (!report.signatureHash) {
      return res.json({
        reportId: report.id,
        status:   'NOT_SIGNED',
        message:  'El informe aún no ha sido finalizado y no tiene hash de integridad.'
      });
    }

    const currentHash = crypto
      .createHash('sha256')
      .update(`${report.findings}|${report.conclusion}`)
      .digest('hex');

    const intact = currentHash === report.signatureHash;

    await logAudit(req, 'REPORT_INTEGRITY_CHECKED', 'REPORT', report.id, {
      intact,
      storedHash:  report.signatureHash,
      currentHash,
      checkedBy:   req.user!.sub
    });

    return res.json({
      reportId:    report.id,
      status:      intact ? 'INTACT' : 'TAMPERED',
      intact,
      storedHash:  report.signatureHash,
      currentHash,
      verifiedAt:  new Date().toISOString(),
      message:     intact
        ? 'El informe no ha sido alterado desde su firma.'
        : '⚠ El contenido del informe no coincide con el hash almacenado. Posible alteración post-firma.'
    });
  } catch (err) {
    console.error('[REPORTS/VERIFY-INTEGRITY]', err);
    return res.status(500).json({ message: 'Error al verificar integridad' });
  }
});

// ─── Sección 5: Endpoint público de verificación (sin login requerido) ────────

/**
 * GET /reports/:id/verify — Public endpoint to verify a report's authenticity.
 * Accessible via QR code printed on the PDF. Returns minimal public info.
 */
reportsRouter.get('/:id/verify', async (req: any, res: any) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: String(req.params.id) },
      select: {
        id:            true,
        status:        true,
        signatureHash: true,
        findings:      true,
        conclusion:    true,
        finalizedAt:   true,
        signedAt:      true,
        doctor:        { select: { firstName: true, lastName: true, licenseNumber: true } },
        study:         { select: { modality: true, studyDate: true, patient: { select: { firstName: true, lastName: true, internalCode: true } } } }
      }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });

    let intact: boolean | null = null;
    if (report.signatureHash) {
      const currentHash = crypto
        .createHash('sha256')
        .update(`${report.findings}|${report.conclusion}`)
        .digest('hex');
      intact = currentHash === report.signatureHash;
    }

    return res.json({
      reportId:       report.id,
      status:         report.status,
      intact,
      finalizedAt:    report.finalizedAt,
      signedAt:       report.signedAt,
      doctor:         `Dr/a. ${report.doctor.firstName} ${report.doctor.lastName}` + (report.doctor.licenseNumber ? ` — Mat. ${report.doctor.licenseNumber}` : ''),
      patient:        `${report.study.patient.lastName}, ${report.study.patient.firstName} — Cód. ${report.study.patient.internalCode}`,
      modality:       report.study.modality,
      studyDate:      report.study.studyDate,
      message:        intact === true
        ? 'Informe auténtico. El contenido no ha sido alterado.'
        : intact === false
        ? '⚠ El contenido del informe ha sido alterado post-firma.'
        : 'Informe sin firma digital.'
    });
  } catch (err) {
    console.error('[REPORTS/VERIFY]', err);
    return res.status(500).json({ message: 'Error al verificar informe' });
  }
});

// ─── Sección 1: Marcar hallazgo como crítico/STAT ─────────────────────────────

/**
 * POST /reports/:id/mark-critical — Marks a report as a critical finding (STAT).
 * Sends immediate internal notification + email to the requesting doctor.
 * Logs who notified and when (ACR Practice Parameter compliance).
 */
reportsRouter.post('/:id/mark-critical', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  const schema = z.object({
    reason: z.string().min(5).max(1000)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Debe especificar el motivo del hallazgo crítico', errors: parsed.error.flatten() });

  try {
    const report = await prisma.report.findUnique({
      where:   { id: String(req.params.id) },
      include: { study: { include: { patient: true } }, doctor: { select: { firstName: true, lastName: true } } }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });
    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado para marcar este informe como crítico' });
    }

    const updated = await prisma.report.update({
      where: { id: report.id },
      data:  { isCritical: true, criticalAt: new Date(), criticalReason: parsed.data.reason }
    });

    // Notify the requesting doctor (internal + email) if contact data is available
    const requestingDoctorEmail = report.study.requestingDoctorEmail;
    const requestingDoctorName  = report.study.requestingDoctorName;
    const patient = report.study.patient;

    if (requestingDoctorEmail) {
      sendCriticalFindingEmail(
        requestingDoctorEmail,
        requestingDoctorName || 'Médico solicitante',
        {
          reportId:    report.id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          modality:    report.study.modality,
          reason:      parsed.data.reason,
          doctorName:  `Dr/a. ${report.doctor.firstName} ${report.doctor.lastName}`
        }
      ).catch(() => {});

      // Record the critical notification; initially associate it with the doctor
      // who marked the finding (the current user). It will be updated below if
      // the requesting doctor has a user account in the system.
      const notifRecord = await prisma.criticalNotification.create({
        data: {
          reportId:      report.id,
          notifiedUserId: req.user!.sub, // doctor who marked the critical finding
          notifiedAt:    new Date()
        }
      });

      // Try to find the requesting doctor user account for a proper notification record
      const requestingUser = await prisma.user.findFirst({
        where: { email: requestingDoctorEmail, isActive: true }
      });
      if (requestingUser && requestingUser.id !== req.user!.sub) {
        await prisma.criticalNotification.update({
          where: { id: notifRecord.id },
          data:  { notifiedUserId: requestingUser.id }
        });
        await createNotification(
          requestingUser.id,
          `🚨 HALLAZGO CRÍTICO — ${patient.lastName}, ${patient.firstName}`,
          `${parsed.data.reason} — Informado por ${report.doctor.firstName} ${report.doctor.lastName}. Requiere atención inmediata.`,
          'CRITICAL_FINDING'
        ).catch(() => {});
      }
    }

    await logAudit(req, 'REPORT_MARKED_CRITICAL', 'REPORT', report.id, {
      doctorId:               req.user!.sub,
      reason:                 parsed.data.reason,
      requestingDoctorEmail:  requestingDoctorEmail ?? null,
      notifiedAt:             new Date().toISOString()
    });

    return res.json({ ...updated, criticalNotified: !!requestingDoctorEmail });
  } catch (err) {
    console.error('[REPORTS/MARK-CRITICAL]', err);
    return res.status(500).json({ message: 'Error al marcar hallazgo crítico' });
  }
});

// ─── Sección 12: Revisión por pares (Peer Review) ────────────────────────────

/**
 * POST /reports/:id/peer-review — A second radiologist reviews a FINAL/SIGNED report.
 * Can mark it as "REVIEWED" (concordant) or "DISCREPANT" with severity category.
 */
reportsRouter.post('/:id/peer-review', requireRole('DOCTOR', 'ADMIN') as any, async (req: AuthRequest, res: any) => {
  const schema = z.object({
    status:           z.enum(['REVIEWED', 'DISCREPANT']),
    discrepancyLevel: z.enum(['MINOR', 'MAJOR', 'CRITICAL']).optional(),
    comment:          z.string().max(2000).optional()
  }).refine((d) => d.status !== 'DISCREPANT' || d.discrepancyLevel != null, {
    message: 'El nivel de discrepancia es requerido cuando status es DISCREPANT'
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

  try {
    const report = await prisma.report.findUnique({
      where: { id: String(req.params.id) },
      include: { doctor: { select: { id: true, firstName: true, lastName: true } } }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });

    // Reviewer cannot be the author
    if (report.doctorId === req.user!.sub) {
      return res.status(409).json({ message: 'El médico informante no puede revisar su propio informe' });
    }
    if (report.status !== ReportStatus.FINAL && report.status !== ReportStatus.SIGNED) {
      return res.status(422).json({ message: 'Solo se pueden revisar informes finalizados o firmados' });
    }

    const peerReview = await prisma.peerReview.create({
      data: {
        reportId:         report.id,
        reviewerDoctorId: req.user!.sub,
        status:           parsed.data.status,
        discrepancyLevel: parsed.data.discrepancyLevel || null,
        comment:          parsed.data.comment || null
      }
    });

    // Notify the original doctor about the peer review
    await createNotification(
      report.doctorId,
      parsed.data.status === 'DISCREPANT'
        ? `⚠ Discrepancia en informe — ${parsed.data.discrepancyLevel}`
        : '✓ Revisión por pares completada',
      parsed.data.comment
        ? `${parsed.data.comment}`
        : `Su informe fue marcado como ${parsed.data.status === 'REVIEWED' ? 'revisado y concordante' : 'discrepante'}.`,
      'PEER_REVIEW'
    ).catch(() => {});

    await logAudit(req, 'REPORT_PEER_REVIEWED', 'REPORT', report.id, {
      reviewerDoctorId: req.user!.sub,
      status:           parsed.data.status,
      discrepancyLevel: parsed.data.discrepancyLevel,
      authorDoctorId:   report.doctorId
    });

    return res.status(201).json(peerReview);
  } catch (err) {
    console.error('[REPORTS/PEER-REVIEW]', err);
    return res.status(500).json({ message: 'Error al registrar revisión por pares' });
  }
});

// ─── Sección 15: FHIR DiagnosticReport ───────────────────────────────────────

/**
 * GET /reports/:id/fhir — Returns a FHIR R4 DiagnosticReport resource.
 * Standard interoperability format for integration with EMRs/HIS.
 */
reportsRouter.get('/:id/fhir', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({
      where:   { id: String(req.params.id) },
      include: {
        study:        { include: { patient: true } },
        doctor:       { select: { id: true, firstName: true, lastName: true, licenseNumber: true } },
        measurements: { where: { isActive: true } }
      }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });
    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const { patient } = report.study;

    // Map local status to FHIR DiagnosticReport.status
    const fhirStatus: Record<string, string> = {
      DRAFT:    'preliminary',
      FINAL:    'final',
      SIGNED:   'final',
      ADDENDUM: 'amended'
    };

    const fhirResource = {
      resourceType: 'DiagnosticReport',
      id:           report.id,
      meta: {
        versionId:   String(report.versionNumber),
        lastUpdated: report.updatedAt.toISOString(),
        profile:     ['http://hl7.org/fhir/StructureDefinition/DiagnosticReport']
      },
      status: fhirStatus[report.status] ?? 'unknown',
      category: [{
        coding: [{
          system:  'http://terminology.hl7.org/CodeSystem/v2-0074',
          code:    'RAD',
          display: 'Radiology'
        }]
      }],
      code: {
        coding: [{
          system:  'http://loinc.org',
          code:    '18748-4',
          display: 'Diagnostic imaging study'
        }],
        text: report.study.description || report.study.modality
      },
      subject: {
        reference: `Patient/${patient.id}`,
        display:   `${patient.firstName} ${patient.lastName}`
      },
      effectiveDateTime: report.study.studyDate?.toISOString(),
      issued:            report.finalizedAt?.toISOString() ?? report.updatedAt.toISOString(),
      performer: [{
        reference: `Practitioner/${report.doctor.id}`,
        display:   `Dr/a. ${report.doctor.firstName} ${report.doctor.lastName}`
      }],
      conclusion:     report.conclusion,
      conclusionCode: [],
      presentedForm: report.pdfPath ? [{
        contentType: 'application/pdf',
        url:         toFileUrl(report.pdfPath, env.APP_BASE_URL),
        title:       `Informe Nº ${report.id.slice(0, 8).toUpperCase()}`
      }] : undefined,
      extension: [
        {
          url:         'http://pacsmed.io/fhir/StructureDefinition/findings',
          valueString: report.findings
        },
        ...(report.clinicalIndication ? [{
          url:         'http://pacsmed.io/fhir/StructureDefinition/clinicalIndication',
          valueString: report.clinicalIndication
        }] : []),
        ...(report.isCritical ? [{
          url:          'http://pacsmed.io/fhir/StructureDefinition/criticalFinding',
          valueBoolean: true
        }] : [])
      ]
    };

    res.setHeader('Content-Type', 'application/fhir+json');
    return res.json(fhirResource);
  } catch (err) {
    console.error('[REPORTS/FHIR]', err);
    return res.status(500).json({ message: 'Error al generar FHIR DiagnosticReport' });
  }
});

// ─── Sección 16: DICOM Structured Report (SR) ────────────────────────────────

/**
 * GET /reports/:id/dicom-sr — Returns a DICOM SR (Basic Text SR) representation.
 * SOP Class: 1.2.840.10008.5.1.4.1.1.88.11 (Basic Text SR)
 */
reportsRouter.get('/:id/dicom-sr', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({
      where:   { id: String(req.params.id) },
      include: {
        study:        { include: { patient: true } },
        doctor:       { select: { firstName: true, lastName: true, licenseNumber: true } },
        measurements: { where: { isActive: true } }
      }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });
    if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const { patient } = report.study;
    const now = new Date();
    const dicomDate = now.toISOString().replace(/[-T:]/g, '').slice(0, 8);
    const dicomTime = now.toISOString().replace(/[-T:]/g, '').slice(9, 15);

    // Simplified DICOM SR representation as JSON (DICOM JSON Model per PS3.18 F)
    const dicomSr = {
      '00080016': { vr: 'UI', Value: ['1.2.840.10008.5.1.4.1.1.88.11'] },  // SOP Class UID: Basic Text SR
      '00080018': { vr: 'UI', Value: [`2.25.${report.id.replace(/-/g, '').slice(0, 20)}`] }, // SOP Instance UID
      '00080060': { vr: 'CS', Value: ['SR'] },           // Modality
      '00080020': { vr: 'DA', Value: [dicomDate] },       // Study Date
      '00080030': { vr: 'TM', Value: [dicomTime] },       // Study Time
      '00100010': { vr: 'PN', Value: [{ Alphabetic: `${patient.lastName}^${patient.firstName}` }] }, // Patient Name
      '00100020': { vr: 'LO', Value: [patient.internalCode] }, // Patient ID
      '0020000D': { vr: 'UI', Value: [report.study.studyInstanceUid ?? `2.25.study.${report.studyId.replace(/-/g, '').slice(0, 20)}`] }, // Study Instance UID
      '0020000E': { vr: 'UI', Value: [`2.25.series.${report.id.replace(/-/g, '').slice(0, 20)}`] }, // Series Instance UID
      '00400A040': { vr: 'CS', Value: ['CONTAINER'] },   // Value Type
      '00400A050': { vr: 'CS', Value: ['SEPARATE'] },    // Continuity Of Content
      '0040A730': {                                        // Content Sequence
        vr: 'SQ',
        Value: [
          {
            '00400A040': { vr: 'CS', Value: ['TEXT'] },
            '00400A043': { vr: 'SQ', Value: [{ '00080100': { vr: 'SH', Value: ['121070'] }, '00080102': { vr: 'SH', Value: ['DCM'] }, '00080104': { vr: 'LO', Value: ['Findings'] } }] },
            '00400A160': { vr: 'UT', Value: [report.findings] }
          },
          {
            '00400A040': { vr: 'CS', Value: ['TEXT'] },
            '00400A043': { vr: 'SQ', Value: [{ '00080100': { vr: 'SH', Value: ['121076'] }, '00080102': { vr: 'SH', Value: ['DCM'] }, '00080104': { vr: 'LO', Value: ['Conclusions'] } }] },
            '00400A160': { vr: 'UT', Value: [report.conclusion] }
          },
          ...(report.clinicalIndication ? [{
            '00400A040': { vr: 'CS', Value: ['TEXT'] },
            '00400A043': { vr: 'SQ', Value: [{ '00080100': { vr: 'SH', Value: ['121109'] }, '00080102': { vr: 'SH', Value: ['DCM'] }, '00080104': { vr: 'LO', Value: ['Indications for Procedure'] } }] },
            '00400A160': { vr: 'UT', Value: [report.clinicalIndication] }
          }] : [])
        ]
      }
    };

    res.setHeader('Content-Type', 'application/dicom+json');
    return res.json(dicomSr);
  } catch (err) {
    console.error('[REPORTS/DICOM-SR]', err);
    return res.status(500).json({ message: 'Error al generar DICOM SR' });
  }
});

// ─── Sección 10: Turnaround Time (TAT) ───────────────────────────────────────

/**
 * GET /reports/:id/tat — Returns TAT metrics for a report.
 */
reportsRouter.get('/:id/tat', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const report = await prisma.report.findUnique({
      where:   { id: String(req.params.id) },
      select:  { id: true, status: true, draftedAt: true, finalizedAt: true, signedAt: true, study: { select: { createdAt: true } } }
    });
    if (!report) return res.status(404).json({ message: 'Informe no encontrado' });

    const studyLoadedAt = report.study.createdAt;
    const diffMin = (a: Date | null, b: Date | null) =>
      a && b ? Math.round((b.getTime() - a.getTime()) / 60000) : null;

    return res.json({
      reportId:            report.id,
      status:              report.status,
      studyLoadedAt,
      draftedAt:           report.draftedAt,
      finalizedAt:         report.finalizedAt,
      signedAt:            report.signedAt,
      loadToDraft:         diffMin(studyLoadedAt, report.draftedAt),
      draftToFinalized:    diffMin(report.draftedAt, report.finalizedAt),
      finalizedToSigned:   diffMin(report.finalizedAt, report.signedAt),
      totalTat:            diffMin(studyLoadedAt, report.signedAt ?? report.finalizedAt),
      unit: 'minutes'
    });
  } catch (err) {
    console.error('[REPORTS/TAT]', err);
    return res.status(500).json({ message: 'Error al obtener TAT' });
  }
});

