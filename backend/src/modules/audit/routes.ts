import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';

export const auditRouter = Router();
auditRouter.use(requireAuth as any, requireRole('ADMIN') as any);

auditRouter.get('/export', async (req: AuthRequest, res: any) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
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
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
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
