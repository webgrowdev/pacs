import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { body, validationResult } from 'express-validator';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { signAccessToken, signRefreshToken } from '../../utils/jwt.js';
import { requireAuth, invalidateAuthCache, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';
import { validatePasswordComplexity, generateSecureToken } from '../../utils/security.js';
import { sendPasswordResetEmail } from '../../utils/email.js';

// ─── Refresh token cookie settings ───────────────────────────────────────────
// httpOnly + Secure = XSS cannot read it; SameSite=Strict = CSRF protection
// HIPAA §164.312(a)(2)(i): authentication credentials must be protected
const REFRESH_COOKIE_NAME = 'pacsRefreshToken';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly:  true,
  secure:    env.NODE_ENV === 'production', // only HTTPS in production
  sameSite:  'strict' as const,
  maxAge:    7 * 24 * 60 * 60 * 1000,      // 7 days in ms
  path:      '/api/auth'                   // cookie only sent to auth endpoints
};

export const authRouter = Router();

// ─── Rate limiting — HIPAA §164.308(a)(5)(ii)(C) account lockout ─────────────
// Max 10 login attempts per 15 minutes per IP — blocks brute force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de inicio de sesión. Intente en 15 minutos.' },
  skipSuccessfulRequests: true  // Only count failed requests
});

// Max 5 refresh attempts per minute per IP
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: 'Demasiadas solicitudes de refresco de token.' }
});

// ─── Helper: hash a token for DB storage ─────────────────────────────────────
/**
 * Returns the SHA-256 hex digest of a raw token string.
 * The raw token is never stored — only the hash is persisted (C1, A4).
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Persists a hashed refresh token record in the database (C1).
 * @param rawToken - The raw JWT refresh token string
 * @param userId   - The user the token belongs to
 */
async function persistRefreshToken(rawToken: string, userId: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await prisma.refreshToken.create({ data: { tokenHash, userId, expiresAt } });
}

// ─── Login ────────────────────────────────────────────────────────────────────
authRouter.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 })
  ],
  async (req: AuthRequest, res: any) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Email o contraseña con formato inválido' });
    }

    try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });

      // Constant-time response — don't reveal whether user exists or password is wrong
      if (!user || !user.isActive) {
        // Still compare to prevent timing attacks
        await bcrypt.compare(password, '$2a$12$invalidhashtopreventtimingattack00000000000000000000');
        // Log failed attempt (no userId — we don't confirm existence)
        await logAudit(req, 'LOGIN_FAILED', 'USER', undefined, { email, reason: 'user_not_found' });
        return res.status(401).json({ message: 'Credenciales inválidas' });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        await logAudit(req, 'LOGIN_FAILED', 'USER', user.id, { email, reason: 'wrong_password' });
        return res.status(401).json({ message: 'Credenciales inválidas' });
      }

      const payload = { sub: user.id, role: user.role.name, email: user.email };
      await logAudit(req, 'LOGIN_SUCCESS', 'USER', user.id);

      // Set refresh token as httpOnly cookie — never exposed to JavaScript
      // Access token is returned in body (short-lived, 15min — less sensitive)
      const rawRefreshToken = signRefreshToken(payload);
      res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, REFRESH_COOKIE_OPTIONS);

      // C1: Persist hashed refresh token record for server-side revocation
      await persistRefreshToken(rawRefreshToken, user.id);

      return res.json({
        accessToken: signAccessToken(payload),
        mustChangePassword: user.mustChangePassword,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role.name
        }
      });
    } catch (err: any) {
      // B1: Log only code/message — never the full Prisma error (may contain PHI/query values)
      console.error('[AUTH/LOGIN] code=%s message=%s', err?.code, err?.message);
      return res.status(500).json({ message: 'Error interno al autenticar' });
    }
  }
);

// ─── Refresh token — reads ONLY from httpOnly cookie ─────────────────────────
// C2: The req.body?.refreshToken fallback has been removed — it nullified the
// httpOnly cookie protection by allowing XSS to re-submit intercepted tokens.
authRouter.post('/refresh', refreshLimiter, async (req: AuthRequest, res: any) => {
  // Only accept token from httpOnly cookie (XSS-safe)
  const rawToken: string | undefined = req.cookies?.[REFRESH_COOKIE_NAME];

  if (!rawToken || rawToken.length < 20) {
    return res.status(401).json({ message: 'Token de refresco no encontrado' });
  }

  try {
    const payload = jwt.verify(rawToken, env.JWT_REFRESH_SECRET) as { sub: string; role: string; email: string };

    // C1: Verify the token record exists and has not been revoked
    const tokenHash   = hashToken(rawToken);
    const tokenRecord = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!tokenRecord || tokenRecord.revokedAt !== null || tokenRecord.expiresAt < new Date()) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      return res.status(401).json({ message: 'Token de refresco inválido o revocado' });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (!user || !user.isActive) return res.status(401).json({ message: 'Usuario inválido' });

    const nextPayload = { sub: user.id, role: user.role.name, email: user.email };

    // C1: Rotate refresh token — revoke old record, issue and persist new one
    await prisma.refreshToken.update({
      where: { tokenHash },
      data:  { revokedAt: new Date() }
    });

    const newRawToken = signRefreshToken(nextPayload);
    res.cookie(REFRESH_COOKIE_NAME, newRawToken, REFRESH_COOKIE_OPTIONS);
    await persistRefreshToken(newRawToken, user.id);

    return res.json({ accessToken: signAccessToken(nextPayload) });
  } catch {
    // Clear invalid cookie
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    return res.status(401).json({ message: 'Refresh token inválido o expirado' });
  }
});

// ─── Change password ──────────────────────────────────────────────────────────
// Required on first login for portal patients (mustChangePassword flow)
authRouter.post('/change-password', requireAuth as any, async (req: AuthRequest, res: any) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Se requieren contraseña actual y nueva' });
  }

  // Enforce password complexity (HIPAA §164.308(a)(5)(ii)(A))
  const complexity = validatePasswordComplexity(newPassword);
  if (!complexity.valid) {
    return res.status(400).json({ message: 'La nueva contraseña no cumple los requisitos de seguridad', errors: complexity.errors });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      await logAudit(req, 'PASSWORD_CHANGE_FAILED', 'USER', user.id, { reason: 'wrong_current_password' });
      return res.status(401).json({ message: 'Contraseña actual incorrecta' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'La nueva contraseña debe ser diferente a la actual' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const now = new Date();

    // C3: Set passwordChangedAt to invalidate all existing tokens issued before this moment
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: now }
    });

    // C3: Revoke all active refresh tokens for this user
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data:  { revokedAt: now }
    });

    // N1: Invalidate the auth cache so the next request re-fetches the new passwordChangedAt
    invalidateAuthCache(user.id);

    // Clear the current refresh cookie so the client knows to re-authenticate
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });

    await logAudit(req, 'PASSWORD_CHANGED', 'USER', user.id);
    return res.json({ message: 'Contraseña actualizada correctamente. Por favor inicie sesión nuevamente.' });
  } catch (err: any) {
    // B1: Log only code/message — never the full Prisma error
    console.error('[AUTH/CHANGE-PASSWORD] code=%s message=%s', err?.code, err?.message);
    return res.status(500).json({ message: 'Error al cambiar contraseña' });
  }
});

// ─── Perfil del usuario autenticado ──────────────────────────────────────────
authRouter.get('/me', requireAuth as any, async (req: AuthRequest, res: any) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      include: { role: true }
    });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    return res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role.name,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt
    });
  } catch (err) {
    console.error('[AUTH/ME]', err);
    return res.status(500).json({ message: 'Error al obtener perfil' });
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
authRouter.post('/logout', requireAuth as any, async (req: AuthRequest, res: any) => {
  await logAudit(req, 'LOGOUT', 'USER', req.user!.sub).catch(() => {});

  // C1: Revoke the refresh token server-side so it cannot be reused after logout
  const rawToken: string | undefined = req.cookies?.[REFRESH_COOKIE_NAME];
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    await prisma.refreshToken
      .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
      .catch(() => {}); // ignore if record not found (e.g., already revoked)
  }

  // Clear httpOnly refresh cookie immediately
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.json({ message: 'Sesión cerrada correctamente' });
});

// ─── Forgot password ──────────────────────────────────────────────────────────
// A4: Generates a single-use reset token, stores a hashed record, and e-mails
// the reset link. Always returns 200 to prevent user enumeration.
authRouter.post(
  '/forgot-password',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { message: 'Demasiadas solicitudes.' } }),
  async (req: AuthRequest, res: any) => {
    const { email } = req.body;
    // Always respond 200 — do not reveal whether the email exists (HIPAA anti-enumeration)
    const genericOk = () => res.json({ message: 'Si el correo existe en el sistema, recibirá un enlace de recuperación.' });

    if (!email || typeof email !== 'string' || !email.trim()) return genericOk();
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (!user || !user.isActive) return genericOk();

      // Generate a cryptographically secure raw token
      const rawToken  = generateSecureToken(32);
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Invalidate any previous unused reset tokens for this user
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data:  { usedAt: new Date() }
      });

      await prisma.passwordResetToken.create({
        data: { tokenHash, userId: user.id, expiresAt }
      });

      // Send reset email — link carries the raw token (not the hash)
      sendPasswordResetEmail(user.email, user.firstName, rawToken).catch((err) => {
        console.error('[AUTH/FORGOT-PASSWORD] Error enviando email:', err?.message);
      });

      await logAudit(req, 'PASSWORD_RESET_REQUESTED', 'USER', user.id, { email });
      return genericOk();
    } catch (err: any) {
      console.error('[AUTH/FORGOT-PASSWORD] code=%s message=%s', err?.code, err?.message);
      return genericOk(); // Still return 200 to prevent enumeration
    }
  }
);

// ─── Reset password ───────────────────────────────────────────────────────────
// A4: Validates the single-use token, updates the password, marks token as used,
// and invalidates all existing sessions for the user.
authRouter.post(
  '/reset-password',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { message: 'Demasiadas solicitudes.' } }),
  async (req: AuthRequest, res: any) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ message: 'Se requiere token y nueva contraseña' });
    }

    const complexity = validatePasswordComplexity(newPassword);
    if (!complexity.valid) {
      return res.status(400).json({ message: 'La contraseña no cumple los requisitos de seguridad', errors: complexity.errors });
    }

    try {
      const tokenHash   = hashToken(String(token));
      const tokenRecord = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

      if (!tokenRecord || tokenRecord.usedAt !== null || tokenRecord.expiresAt < new Date()) {
        return res.status(400).json({ message: 'Token inválido, expirado o ya utilizado' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      const now          = new Date();

      // Update password and set passwordChangedAt to invalidate all existing JWTs (C3)
      await prisma.user.update({
        where: { id: tokenRecord.userId },
        data:  { passwordHash, mustChangePassword: false, passwordChangedAt: now }
      });

      // Mark token as used (single-use enforcement)
      await prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data:  { usedAt: now }
      });

      // C3: Revoke all active refresh tokens for the user
      await prisma.refreshToken.updateMany({
        where: { userId: tokenRecord.userId, revokedAt: null },
        data:  { revokedAt: now }
      });

      // N1: Invalidate the auth cache so the next request re-fetches the new passwordChangedAt
      invalidateAuthCache(tokenRecord.userId);

      await logAudit(req, 'PASSWORD_RESET_COMPLETED', 'USER', tokenRecord.userId);
      return res.json({ message: 'Contraseña actualizada correctamente. Por favor inicie sesión.' });
    } catch (err: any) {
      console.error('[AUTH/RESET-PASSWORD] code=%s message=%s', err?.code, err?.message);
      return res.status(500).json({ message: 'Error al restablecer contraseña' });
    }
  }
);
