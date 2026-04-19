import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { insensitive } from '../../config/db.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';

export const patientsRouter = Router();
patientsRouter.use(requireAuth as any);

const patientSchema = z.object({
  internalCode: z.string().min(3).max(20),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  documentId: z.string().min(5).max(30),
  cuil: z
    .string()
    .regex(/^\d{2}-\d{7,8}-\d$/, 'CUIL inválido. Formato esperado: XX-XXXXXXXX-X')
    .optional()
    .nullable(),
  dateOfBirth: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Fecha inválida' }),
  sex: z.enum(['M', 'F', 'X']),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  healthInsurance: z.string().max(100).optional().nullable(),
  healthInsurancePlan: z.string().max(100).optional().nullable(),
  healthInsuranceMemberId: z.string().max(50).optional().nullable()
});

// Listar y buscar pacientes (con paginación)
patientsRouter.get('/', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    // Sanitize search: max 100 chars, strip regex-dangerous characters
    const search = String(req.query.search || '').trim().slice(0, 100);
    const page   = Math.max(1, parseInt(String(req.query.page  ?? '1')));
    const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'))));
    const skip   = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { firstName:    { contains: search, ...insensitive() } },
            { lastName:     { contains: search, ...insensitive() } },
            { internalCode: { contains: search, ...insensitive() } },
            { documentId:   { contains: search, ...insensitive() } }
          ]
        }
      : undefined;

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        include: { _count: { select: { studies: true } } },
        orderBy: { lastName: 'asc' },
        skip,
        take: limit
      }),
      prisma.patient.count({ where })
    ]);

    return res.json({ data: patients, total, page, limit });
  } catch (err) {
    console.error('[PATIENTS/GET]', err);
    return res.status(500).json({ message: 'Error al obtener pacientes' });
  }
});

// Detalle de un paciente
patientsRouter.get('/:id', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: String(req.params.id) },
      include: {
        studies: {
          include: { reports: true },
          orderBy: { studyDate: 'desc' }
        },
        patientAccess: true
      }
    });
    if (!patient) return res.status(404).json({ message: 'Paciente no encontrado' });
    return res.json(patient);
  } catch (err) {
    console.error('[PATIENTS/GET/:id]', err);
    return res.status(500).json({ message: 'Error al obtener paciente' });
  }
});

// Crear paciente
patientsRouter.post('/', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.flatten() });

  try {
    const patient = await prisma.patient.create({
      data: {
        ...parsed.data,
        dateOfBirth: new Date(parsed.data.dateOfBirth),
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        cuil: parsed.data.cuil ?? null,
        healthInsurance: parsed.data.healthInsurance ?? null,
        healthInsurancePlan: parsed.data.healthInsurancePlan ?? null,
        healthInsuranceMemberId: parsed.data.healthInsuranceMemberId ?? null
      }
    });
    await logAudit(req, 'PATIENT_CREATED', 'PATIENT', patient.id);
    return res.status(201).json(patient);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const field = err.meta?.target?.[0] ?? 'campo';
      return res.status(409).json({ message: `El ${field} ya está en uso` });
    }
    console.error('[PATIENTS/POST]', err);
    return res.status(500).json({ message: 'Error al crear paciente' });
  }
});

// Actualizar paciente
patientsRouter.put('/:id', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = patientSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.flatten() });

  try {
    const patient = await prisma.patient.update({
      where: { id: String(req.params.id) },
      data: {
        ...parsed.data,
        dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : undefined,
        cuil: parsed.data.cuil !== undefined ? (parsed.data.cuil ?? null) : undefined,
        healthInsurance: parsed.data.healthInsurance !== undefined ? (parsed.data.healthInsurance ?? null) : undefined,
        healthInsurancePlan: parsed.data.healthInsurancePlan !== undefined ? (parsed.data.healthInsurancePlan ?? null) : undefined,
        healthInsuranceMemberId: parsed.data.healthInsuranceMemberId !== undefined ? (parsed.data.healthInsuranceMemberId ?? null) : undefined
      }
    });
    await logAudit(req, 'PATIENT_UPDATED', 'PATIENT', patient.id);
    return res.json(patient);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ message: 'Paciente no encontrado' });
    if (err?.code === 'P2002') return res.status(409).json({ message: 'Código o documento ya existe' });
    console.error('[PATIENTS/PUT]', err);
    return res.status(500).json({ message: 'Error al actualizar paciente' });
  }
});

// ─── Sección 8: Historial de estudios e informes del paciente ────────────────

/**
 * GET /patients/:id/history — Returns patient study and report history.
 * Used by the "Estudios previos de comparación" panel in the report editor.
 */
patientsRouter.get('/:id/history', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const patient = await prisma.patient.findUnique({ where: { id: String(req.params.id) } });
    if (!patient) return res.status(404).json({ message: 'Paciente no encontrado' });

    const studies = await prisma.study.findMany({
      where:   { patientId: patient.id },
      orderBy: { studyDate: 'desc' },
      take:    20,
      select: {
        id:          true,
        modality:    true,
        studyDate:   true,
        description: true,
        status:      true,
        reports: {
          where:   { isAddendum: false },
          orderBy: { createdAt: 'desc' },
          take:    1,
          select: {
            id:          true,
            status:      true,
            clinicalIndication: true,
            findings:    true,
            conclusion:  true,
            finalizedAt: true,
            signedAt:    true,
            pdfPath:     true,
            doctor:      { select: { firstName: true, lastName: true } }
          }
        }
      }
    });

    return res.json({ patientId: patient.id, studies });
  } catch (err) {
    console.error('[PATIENTS/HISTORY]', err);
    return res.status(500).json({ message: 'Error al obtener historial del paciente' });
  }
});
