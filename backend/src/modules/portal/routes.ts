import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';
import { toFileUrl } from '../../storage/file-storage.js';
import { env } from '../../config/env.js';

export const portalRouter = Router();
portalRouter.use(requireAuth as any, requireRole('PATIENT') as any);

// Estudios del paciente con informes
portalRouter.get('/my-results', async (req: AuthRequest, res: any) => {
  try {
    const access = await prisma.patientPortalAccess.findUnique({ where: { userId: req.user!.sub } });
    if (!access) return res.status(403).json({ message: 'Sin perfil de paciente asociado' });

    // Actualizar última visita
    await prisma.patientPortalAccess.update({
      where: { userId: req.user!.sub },
      data: { lastLoginAt: new Date() }
    });

    const studies = await prisma.study.findMany({
      where: { patientId: access.patientId },
      include: {
        reports: {
          where: { status: { in: ['FINAL', 'SIGNED'] } },
          select: {
            id: true,
            status: true,
            finalizedAt: true,
            pdfPath: true,
            conclusion: true,
            patientSummary: true,
            doctor: { select: { firstName: true, lastName: true } }
          }
        }
      },
      orderBy: { studyDate: 'desc' }
    });

    await logAudit(req, 'PORTAL_ACCESS', 'PATIENT', access.patientId);

    return res.json(
      studies.map((s) => ({
        studyId: s.id,
        modality: s.modality,
        studyDate: s.studyDate,
        description: s.description,
        status: s.status,
        report: s.reports[0]
          ? {
              id: s.reports[0].id,
              status: s.reports[0].status,
              finalizedAt: s.reports[0].finalizedAt,
              conclusion: s.reports[0].conclusion,
              patientSummary: s.reports[0].patientSummary,
              doctorName: `${s.reports[0].doctor.firstName} ${s.reports[0].doctor.lastName}`,
              pdfUrl: s.reports[0].pdfPath
                ? toFileUrl(s.reports[0].pdfPath, env.APP_BASE_URL)
                : null
            }
          : null
      }))
    );
  } catch (err) {
    console.error('[PORTAL/MY-RESULTS]', err);
    return res.status(500).json({ message: 'Error al obtener resultados' });
  }
});

// Perfil del paciente
portalRouter.get('/my-profile', async (req: AuthRequest, res: any) => {
  try {
    const access = await prisma.patientPortalAccess.findUnique({
      where: { userId: req.user!.sub },
      include: { patient: true }
    });
    if (!access) return res.status(403).json({ message: 'Sin perfil de paciente' });
    return res.json(access.patient);
  } catch (err) {
    console.error('[PORTAL/PROFILE]', err);
    return res.status(500).json({ message: 'Error al obtener perfil' });
  }
});
