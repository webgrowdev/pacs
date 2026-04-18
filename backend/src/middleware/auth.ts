import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { prisma } from '../config/prisma.js';

export type AuthRequest = Request & { user?: { sub: string; role: string; email: string; iat?: number } };

/** TTL for the per-user auth cache (milliseconds). */
const AUTH_CACHE_TTL_MS = 60_000;

interface AuthCacheEntry {
  passwordChangedAt: Date | null;
  isActive: boolean;
  expiresAt: number;
}

/**
 * Short-lived in-memory cache that stores user auth fields keyed by user ID.
 * Reduces the extra DB query introduced by the C3 password-change check from
 * one per request down to at most one per TTL window per user.
 *
 * Call invalidateAuthCache(userId) whenever a user's password or active status
 * changes so that the next request re-fetches fresh data immediately.
 */
const _authCache = new Map<string, AuthCacheEntry>();

export function invalidateAuthCache(userId: string): void {
  _authCache.delete(userId);
}

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
      const now = Date.now();
      let cached = _authCache.get(payload.sub);

      if (!cached || cached.expiresAt <= now) {
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { passwordChangedAt: true, isActive: true }
        });

        if (!user) {
          return res.status(401).json({ message: 'Token inválido' });
        }

        cached = {
          passwordChangedAt: user.passwordChangedAt,
          isActive: user.isActive,
          expiresAt: now + AUTH_CACHE_TTL_MS
        };
        _authCache.set(payload.sub, cached);
      }

      if (!cached.isActive) {
        return res.status(401).json({ message: 'Token inválido' });
      }
      if (cached.passwordChangedAt) {
        const changedAtMs = cached.passwordChangedAt.getTime();
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
