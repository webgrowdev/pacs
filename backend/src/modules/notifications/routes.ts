import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, AuthRequest } from '../../middleware/auth.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/my', async (req: AuthRequest, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(notifications);
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
