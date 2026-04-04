import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth as any, requireRole('ADMIN', 'DOCTOR') as any);

analyticsRouter.get('/', async (req: AuthRequest, res: any) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      studiesByStatus,
      studiesByModality,
      totalStudies,
      totalPatients,
      totalFinalReports,
      recentStudies,
      topDoctorsRaw
    ] = await Promise.all([
      prisma.study.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.study.groupBy({ by: ['modality'], _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 8 }),
      prisma.study.count(),
      prisma.patient.count(),
      prisma.report.count({ where: { status: { in: ['FINAL', 'SIGNED'] } } }),
      prisma.study.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.report.groupBy({
        by: ['doctorId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5
      })
    ]);

    // Group recent studies by date
    const dateMap = new Map<string, number>();
    recentStudies.forEach((s) => {
      const day = s.createdAt.toISOString().split('T')[0];
      dateMap.set(day, (dateMap.get(day) ?? 0) + 1);
    });
    const studiesByDate = Array.from(dateMap.entries()).map(([date, count]) => ({ date, count }));

    // Get doctor names for top doctors
    const doctorIds = topDoctorsRaw.map((d) => d.doctorId);
    const doctors = await prisma.user.findMany({
      where: { id: { in: doctorIds } },
      select: { id: true, firstName: true, lastName: true }
    });
    const topDoctors = topDoctorsRaw.map((d) => {
      const doc = doctors.find((u) => u.id === d.doctorId);
      return {
        doctorId: d.doctorId,
        name: doc ? `${doc.firstName} ${doc.lastName}` : 'Desconocido',
        reports: d._count.id
      };
    });

    return res.json({
      studiesByStatus: studiesByStatus.map((s) => ({ status: s.status, count: s._count.id })),
      studiesByModality: studiesByModality.map((s) => ({ modality: s.modality, count: s._count.id })),
      studiesByDate,
      topDoctors,
      totals: { studies: totalStudies, patients: totalPatients, finalReports: totalFinalReports }
    });
  } catch (err) {
    console.error('[ANALYTICS]', err);
    return res.status(500).json({ message: 'Error al obtener métricas' });
  }
});
