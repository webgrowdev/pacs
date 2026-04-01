import { prisma } from '../config/prisma.js';
import { AuthRequest } from './auth.js';

export async function logAudit(req: AuthRequest, action: string, entityType: string, entityId?: string, payload?: object) {
  await prisma.auditLog.create({
    data: {
      userId: req.user?.sub,
      action,
      entityType,
      entityId,
      payload
    }
  });
}
