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

// GET /api/analytics/tat — TAT dashboard
analyticsRouter.get('/tat', async (req: AuthRequest, res: any) => {
  try {
    const fromRaw = req.query.from   ? new Date(String(req.query.from))   : new Date(Date.now() - 30 * 86400000);
    const toRaw   = req.query.to     ? new Date(String(req.query.to))     : new Date();
    const modality = req.query.modality ? String(req.query.modality) : undefined;
    const doctorId = req.query.doctorId ? String(req.query.doctorId) : undefined;

    if (isNaN(fromRaw.getTime()) || isNaN(toRaw.getTime())) {
      return res.status(400).json({ message: 'Parámetros from/to inválidos' });
    }

    const where: any = {
      finalizedAt: { gte: fromRaw, lte: toRaw },
      tatMinutes:  { not: null },
      status:      { in: ['FINAL', 'SIGNED'] }
    };
    if (modality) where.study = { modality };
    if (doctorId) where.doctorId = doctorId;

    const SLA_THRESHOLD = 120; // minutes

    const reports = await prisma.report.findMany({
      where,
      select: {
        id: true,
        tatMinutes: true,
        doctorId: true,
        doctor: { select: { firstName: true, lastName: true } }
      }
    });

    if (reports.length === 0) {
      return res.json({ totalReports: 0, averageTatMinutes: null, medianTatMinutes: null, p95TatMinutes: null, slaBreaches: 0, breakdown: [] });
    }

    const tats = reports.map(r => r.tatMinutes!).sort((a, b) => a - b);
    const avg  = Math.round(tats.reduce((s, v) => s + v, 0) / tats.length);
    const midIdx = Math.floor(tats.length / 2);
    const median = tats.length % 2 === 0
      ? Math.round((tats[midIdx - 1] + tats[midIdx]) / 2)
      : tats[midIdx];
    const p95    = tats[Math.floor(tats.length * 0.95)];
    const slaBreaches = tats.filter(t => t > SLA_THRESHOLD).length;

    const doctorMap = new Map<string, { name: string; tats: number[] }>();
    for (const r of reports) {
      if (!doctorMap.has(r.doctorId)) {
        doctorMap.set(r.doctorId, {
          name: `${r.doctor.firstName} ${r.doctor.lastName}`,
          tats: []
        });
      }
      doctorMap.get(r.doctorId)!.tats.push(r.tatMinutes!);
    }
    const breakdown = Array.from(doctorMap.entries()).map(([id, d]) => ({
      doctorId:   id,
      doctorName: d.name,
      count:      d.tats.length,
      avg:        Math.round(d.tats.reduce((s, v) => s + v, 0) / d.tats.length)
    }));

    return res.json({ totalReports: reports.length, averageTatMinutes: avg, medianTatMinutes: median, p95TatMinutes: p95, slaBreaches, slaThresholdMinutes: SLA_THRESHOLD, breakdown });
  } catch (err) {
    console.error('[ANALYTICS/TAT]', err);
    return res.status(500).json({ message: 'Error al obtener TAT' });
  }
});

// GET /api/analytics/quality-indicators — JCI/IRAM/ISO 15189 quality metrics
analyticsRouter.get('/quality-indicators', async (req: AuthRequest, res: any) => {
  try {
    const period = String(req.query.period ?? '30d');
    const days   = period === '90d' ? 90 : period === '365d' ? 365 : 30;
    const since  = new Date(Date.now() - days * 86400000);

    const [totalStudies, totalReports, criticalReports, peerReviews, reports] = await Promise.all([
      prisma.study.count({ where: { createdAt: { gte: since } } }),
      prisma.report.count({ where: { createdAt: { gte: since }, status: { in: ['FINAL', 'SIGNED'] } } }),
      prisma.report.findMany({
        where: { createdAt: { gte: since }, isCritical: true },
        select: { id: true, criticalAcknowledgedAt: true }
      }),
      prisma.peerReview.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, discrepancyLevel: true }
      }),
      prisma.report.findMany({
        where: { createdAt: { gte: since }, status: { in: ['FINAL', 'SIGNED'] } },
        select: { id: true, tatMinutes: true, aiUsed: true, isAddendum: true, study: { select: { modality: true } } }
      })
    ]);

    const reportingRate = totalStudies > 0 ? +(totalReports / totalStudies * 100).toFixed(1) : 0;
    const tatsWithData  = reports.filter(r => r.tatMinutes != null);
    const avgTat = tatsWithData.length > 0
      ? Math.round(tatsWithData.reduce((s, r) => s + r.tatMinutes!, 0) / tatsWithData.length)
      : null;
    const slaBreaches = tatsWithData.filter(r => r.tatMinutes! > 120).length;
    const slaBreachRate = tatsWithData.length > 0 ? +(slaBreaches / tatsWithData.length * 100).toFixed(1) : 0;
    const criticalAckRate = criticalReports.length > 0
      ? +(criticalReports.filter(r => r.criticalAcknowledgedAt).length / criticalReports.length * 100).toFixed(1)
      : 100;
    const discrepantReviews = peerReviews.filter(r => r.status === 'DISCREPANT').length;
    const peerReviewDiscrepancyRate = peerReviews.length > 0
      ? +(discrepantReviews / peerReviews.length * 100).toFixed(1)
      : 0;
    const aiUsageRate = totalReports > 0
      ? +(reports.filter(r => r.aiUsed).length / totalReports * 100).toFixed(1)
      : 0;
    const addendumRate = totalReports > 0
      ? +(reports.filter(r => r.isAddendum).length / totalReports * 100).toFixed(1)
      : 0;

    const modalityMap = new Map<string, { count: number; tats: number[] }>();
    for (const r of reports) {
      const mod = r.study.modality;
      if (!modalityMap.has(mod)) modalityMap.set(mod, { count: 0, tats: [] });
      const entry = modalityMap.get(mod)!;
      entry.count++;
      if (r.tatMinutes != null) entry.tats.push(r.tatMinutes);
    }
    const byModality = Array.from(modalityMap.entries()).map(([modality, d]) => ({
      modality,
      count: d.count,
      avgTat: d.tats.length > 0 ? Math.round(d.tats.reduce((s,v) => s+v, 0) / d.tats.length) : null
    }));

    return res.json({
      period,
      totalStudies,
      totalReports,
      reportingRate,
      avgTatMinutes: avgTat,
      slaBreachRate,
      criticalFindingsCount:          criticalReports.length,
      criticalAckRate,
      peerReviewDiscrepancyRate,
      aiUsageRate,
      addendumRate,
      byModality
    });
  } catch (err) {
    console.error('[ANALYTICS/QUALITY]', err);
    return res.status(500).json({ message: 'Error al obtener indicadores de calidad' });
  }
});
