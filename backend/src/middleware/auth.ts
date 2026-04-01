import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';

export type AuthRequest = Request & { user?: { sub: string; role: string; email: string } };

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No autenticado' });
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    req.user = verifyAccessToken(token);
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
