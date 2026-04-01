import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';

export const portalRouter = Router();
portalRouter.use(requireAuth, requireRole('PATIENT'));

portalRouter.get('/my-results', async (req: AuthRequest, res) => {
  const access = await prisma.patientPortalAccess.findUnique({ where: { userId: req.user!.sub } });
  if (!access) return res.status(403).json({ message: 'Sin perfil de paciente' });

  const studies = await prisma.study.findMany({
    where: { patientId: access.patientId },
    include: { reports: true }
  });

  res.json(studies.map((s) => ({
    studyId: s.id,
    modality: s.modality,
    status: s.status,
    reportStatus: s.reports[0]?.status || null,
    pdfPath: s.reports[0]?.pdfPath || null
  })));
});
