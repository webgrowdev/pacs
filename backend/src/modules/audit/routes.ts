import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { env } from '../../config/env.js';

export const auditRouter = Router();
auditRouter.use(requireAuth as any, requireRole('ADMIN') as any);

// ─── GET /api/audit/devices ───────────────────────────────────────────────────
// Returns all equipment (AE titles) that have connected via DICOM SCP,
// grouped by AE title with stats.  Used by the Admin monitoring panel.
auditRouter.get('/devices', async (_req: AuthRequest, res: any) => {
  try {
    const since72h = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const since5min = new Date(Date.now() - 5 * 60 * 1000);
    const since1h   = new Date(Date.now() - 60 * 60 * 1000);

    // Fetch all SCP received logs in the last 72 h + all errors
    const [received, errors] = await Promise.all([
      prisma.auditLog.findMany({
        where: { action: 'DICOM_SCP_RECEIVED', createdAt: { gte: since72h } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, payload: true, ipAddress: true }
      }),
      prisma.auditLog.findMany({
        where: { action: 'DICOM_SCP_ERROR', createdAt: { gte: since72h } },
        select: { createdAt: true, payload: true }
      })
    ]);

    // Group by AE title
    const deviceMap = new Map<string, {
      aeTitle: string;
      lastSeen: Date;
      firstSeen: Date;
      studies: Set<string>;
      imagesCount: number;
      ipAddress: string;
      errorCount: number;
    }>();

    for (const log of received) {
      const payload = (log.payload ?? {}) as Record<string, any>;
      const ae = (payload.callingAeTitle ?? log.ipAddress ?? 'UNKNOWN') as string;
      const studyId = (payload.studyId ?? '') as string;

      if (!deviceMap.has(ae)) {
        deviceMap.set(ae, {
          aeTitle: ae,
          lastSeen:   log.createdAt,
          firstSeen:  log.createdAt,
          studies:    new Set(),
          imagesCount: 0,
          ipAddress:  log.ipAddress ?? '—',
          errorCount: 0
        });
      }
      const d = deviceMap.get(ae)!;
      if (log.createdAt > d.lastSeen)  d.lastSeen  = log.createdAt;
      if (log.createdAt < d.firstSeen) d.firstSeen = log.createdAt;
      if (studyId) d.studies.add(studyId);
      d.imagesCount++;
      if (log.ipAddress && log.ipAddress !== '—') d.ipAddress = log.ipAddress;
    }

    for (const log of errors) {
      const payload = (log.payload ?? {}) as Record<string, any>;
      const ae = (payload.callingAeTitle ?? 'UNKNOWN') as string;
      if (deviceMap.has(ae)) {
        deviceMap.get(ae)!.errorCount++;
      }
    }

    const devices = Array.from(deviceMap.values()).map((d) => ({
      aeTitle:      d.aeTitle,
      ipAddress:    d.ipAddress,
      lastSeen:     d.lastSeen.toISOString(),
      firstSeen:    d.firstSeen.toISOString(),
      studiesCount: d.studies.size,
      imagesCount:  d.imagesCount,
      errorCount:   d.errorCount,
      // online = active in last 5 min, recent = last 1h, idle = last 72h
      status: d.lastSeen >= since5min ? 'online'
            : d.lastSeen >= since1h   ? 'recent'
            : 'idle'
    }));

    // Also include server info so the frontend can show connection instructions
    return res.json({
      devices,
      serverConfig: {
        aeTitle: env.DICOM_AE_TITLE,
        scpPort: env.DICOM_SCP_PORT,
        appBaseUrl: env.APP_BASE_URL,
      }
    });
  } catch (err) {
    console.error('[AUDIT/DEVICES]', err);
    return res.status(500).json({ message: 'Error al obtener dispositivos' });
  }
});

auditRouter.get('/export', async (req: AuthRequest, res: any) => {
  try {
    const fromRaw = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
    const toRaw   = req.query.to   ? new Date(String(req.query.to))   : new Date();

    // Reject invalid / non-parseable date strings to avoid Prisma crashes
    if (isNaN(fromRaw.getTime()) || isNaN(toRaw.getTime())) {
      return res.status(400).json({ message: 'Parámetros from/to inválidos. Use formato ISO 8601 (ej. 2024-01-01T00:00:00Z).' });
    }

    const from = fromRaw;
    const to   = toRaw;
    const format = req.query.format === 'json' ? 'json' : 'csv';

    const logs = await prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' }
    });

    if (format === 'json') {
      return res.json(logs);
    }

    // CSV
    function escapeCell(val: any): string {
      const str = String(val ?? '');
      // Formula injection guard: neutralize leading = + - @ (Excel/LibreOffice formulas)
      const sanitized = /^[=+\-@]/.test(str) ? `'${str}` : str;
      if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
        return `"${sanitized.replace(/"/g, '""')}"`;
      }
      return sanitized;
    }

    const headers = ['id', 'timestamp', 'userEmail', 'userName', 'action', 'entityType', 'entityId', 'payload'];
    const rows = logs.map((l) => [
      l.id,
      l.createdAt.toISOString(),
      l.user?.email ?? '',
      l.user ? `${l.user.firstName} ${l.user.lastName}` : '',
      l.action,
      l.entityType,
      l.entityId ?? '',
      JSON.stringify(l.payload ?? '')
    ].map(escapeCell).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = `audit-${from.toISOString().split('T')[0]}-to-${to.toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error('[AUDIT/EXPORT]', err);
    return res.status(500).json({ message: 'Error al exportar auditoría' });
  }
});
