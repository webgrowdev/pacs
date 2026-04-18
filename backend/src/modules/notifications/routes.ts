import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, AuthRequest } from '../../middleware/auth.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/**
 * GET /notifications/my — Returns the authenticated user's notifications.
 * M4: Supports pagination via `page` (default 1) and `limit` (default 20, max 100).
 * Returns a { data, total, page, limit, totalPages } envelope.
 */
notificationsRouter.get('/my', async (req: AuthRequest, res) => {
  try {
    const page      = Math.max(1, parseInt(String(req.query.page  ?? '1')));
    const limit     = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'))));
    const skip      = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.sub },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.notification.count({ where: { userId: req.user!.sub } })
    ]);

    res.json({
      data:       notifications,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('[NOTIFICATIONS/GET]', err);
    res.status(500).json({ message: 'Error al obtener notificaciones' });
  }
});

notificationsRouter.post('/:id/read', async (req: AuthRequest, res) => {
  try {
    const updated = await prisma.notification.updateMany({
      where: { id: String(req.params.id), userId: req.user!.sub },
      data: { isRead: true }
    });
    if (updated.count === 0) {
      return res.status(404).json({ message: 'Notificación no encontrada' });
    }
    res.json({ updated: updated.count });
  } catch (err) {
    console.error('[NOTIFICATIONS/POST]', err);
    res.status(500).json({ message: 'Error al marcar notificación' });
  }
});
