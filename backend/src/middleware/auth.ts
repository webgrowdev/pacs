import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { prisma } from '../config/prisma.js';

export type AuthRequest = Request & { user?: { sub: string; role: string; email: string; iat?: number } };

/**
 * Verifies the Bearer access token and, for C3 compliance, checks that it was
 * issued AFTER the most recent password change.  A token issued before a password
 * change is rejected even if the JWT signature is still valid.
 *
 * HIPAA §164.312(a)(2)(i): session must be invalidated when credentials change.
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No autenticado' });
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const payload = verifyAccessToken(token);
    req.user = payload;

    // C3: If the user changed their password, tokens issued before that moment are invalid.
    if (payload.iat && payload.sub) {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { passwordChangedAt: true, isActive: true }
      });
      if (!user || !user.isActive) {
        return res.status(401).json({ message: 'Token inválido' });
      }
      if (user.passwordChangedAt) {
        const changedAtMs = user.passwordChangedAt.getTime();
        const issuedAtMs  = payload.iat * 1000;
        if (issuedAtMs < changedAtMs) {
          return res.status(401).json({ message: 'Sesión invalidada. Por favor inicie sesión nuevamente.' });
        }
      }
    }

    next();
  } catch {
    res.status(401).json({ message: 'Token inválido' });
  }
}

export const requireRole = (...allowed: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ message: 'Sin permisos' });
    }
    next();
  };
