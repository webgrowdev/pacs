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
  dateOfBirth: z.string().refine((v) => !isNaN(Date.parse(v)), { message: 'Fecha inválida' }),
  sex: z.enum(['M', 'F', 'X']),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable()
});

// Listar y buscar pacientes
patientsRouter.get('/', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const search = String(req.query.search || '').trim();
    const patients = await prisma.patient.findMany({
      where: search
        ? {
            OR: [
              { firstName: { contains: search, ...insensitive() } },
              { lastName: { contains: search, ...insensitive() } },
              { internalCode: { contains: search, ...insensitive() } },
              { documentId: { contains: search, ...insensitive() } }
            ]
          }
        : undefined,
      include: { _count: { select: { studies: true } } },
      orderBy: { lastName: 'asc' }
    });
    return res.json(patients);
  } catch (err) {
    console.error('[PATIENTS/GET]', err);
    return res.status(500).json({ message: 'Error al obtener pacientes' });
  }
});

// Detalle de un paciente
patientsRouter.get('/:id', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
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
        phone: parsed.data.phone ?? null
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
      where: { id: req.params.id },
      data: {
        ...parsed.data,
        dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : undefined
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
