import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { env } from '../../config/env.js';

export const worklistRouter = Router();
worklistRouter.use(requireAuth as any, requireRole('ADMIN', 'DOCTOR') as any);

worklistRouter.get('/', async (req: AuthRequest, res: any) => {
  try {
    const windowDays = env.MWL_WINDOW_DAYS;
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const studies = await prisma.study.findMany({
      where: {
        status: { in: ['UPLOADED', 'IN_REVIEW'] },
        studyDate: { gte: since }
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, internalCode: true, documentId: true, dateOfBirth: true, sex: true } }
      },
      orderBy: { studyDate: 'asc' }
    });

    return res.json({
      windowDays,
      since: since.toISOString(),
      data: studies.map(s => ({
        studyId: s.id,
        studyInstanceUid: s.studyInstanceUid || s.id,
        accessionNumber: s.id.slice(0, 16),
        modality: s.modality,
        description: s.description,
        studyDate: s.studyDate,
        status: s.status,
        patient: s.patient
      }))
    });
  } catch (err) {
    console.error('[WORKLIST]', err);
    return res.status(500).json({ message: 'Error al obtener worklist MWL' });
  }
});
