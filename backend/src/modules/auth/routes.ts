import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { signAccessToken, signRefreshToken } from '../../utils/jwt.js';
import { requireAuth, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';
import { validatePasswordComplexity } from '../../utils/security.js';

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
      res.cookie(REFRESH_COOKIE_NAME, signRefreshToken(payload), REFRESH_COOKIE_OPTIONS);

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
    } catch (err) {
      console.error('[AUTH/LOGIN]', err);
      return res.status(500).json({ message: 'Error interno al autenticar' });
    }
  }
);

// ─── Refresh token — reads from httpOnly cookie (preferred) or body (fallback) ─
authRouter.post('/refresh', refreshLimiter, async (req: AuthRequest, res: any) => {
  // Primary: read from httpOnly cookie (XSS-safe)
  // Fallback: accept from body for backward-compatibility with non-browser clients
  const rawToken: string | undefined =
    req.cookies?.[REFRESH_COOKIE_NAME] ?? req.body?.refreshToken;

  if (!rawToken || rawToken.length < 20) {
    return res.status(401).json({ message: 'Token de refresco no encontrado' });
  }

  try {
    const payload = jwt.verify(rawToken, env.JWT_REFRESH_SECRET) as { sub: string; role: string; email: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (!user || !user.isActive) return res.status(401).json({ message: 'Usuario inválido' });

    const nextPayload = { sub: user.id, role: user.role.name, email: user.email };

    // Rotate refresh token — old cookie replaced with new one
    res.cookie(REFRESH_COOKIE_NAME, signRefreshToken(nextPayload), REFRESH_COOKIE_OPTIONS);
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
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false }
    });

    await logAudit(req, 'PASSWORD_CHANGED', 'USER', user.id);
    return res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('[AUTH/CHANGE-PASSWORD]', err);
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
  // Clear httpOnly refresh cookie immediately
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.json({ message: 'Sesión cerrada correctamente' });
});
