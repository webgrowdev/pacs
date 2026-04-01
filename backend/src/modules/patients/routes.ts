import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';

export const patientsRouter = Router();
patientsRouter.use(requireAuth);

patientsRouter.get('/', requireRole('ADMIN', 'DOCTOR'), async (req, res) => {
  const search = String(req.query.search || '');
  const patients = await prisma.patient.findMany({
    where: search
      ? { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { internalCode: { contains: search } }] }
      : undefined,
    include: { studies: true }
  });
  res.json(patients);
});

patientsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const patient = await prisma.patient.create({ data: req.body });
  await logAudit(req as any, 'PATIENT_CREATED', 'PATIENT', patient.id);
  res.status(201).json(patient);
});

patientsRouter.put('/:id', requireRole('ADMIN'), async (req, res) => {
  const patient = await prisma.patient.update({ where: { id: req.params.id }, data: req.body });
  await logAudit(req as any, 'PATIENT_UPDATED', 'PATIENT', patient.id);
  res.json(patient);
});
