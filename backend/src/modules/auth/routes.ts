import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { signAccessToken, signRefreshToken } from '../../utils/jwt.js';
import { requireAuth, AuthRequest } from '../../middleware/auth.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').isLength({ min: 8 })],
  async (req: AuthRequest, res: any) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
      if (!user || !user.isActive) return res.status(401).json({ message: 'Credenciales inválidas' });

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ message: 'Credenciales inválidas' });

      const payload = { sub: user.id, role: user.role.name, email: user.email };
      return res.json({
        accessToken: signAccessToken(payload),
        refreshToken: signRefreshToken(payload),
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

authRouter.post(
  '/refresh',
  [body('refreshToken').isString().isLength({ min: 20 })],
  async (req: AuthRequest, res: any) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const payload = jwt.verify(req.body.refreshToken, env.JWT_REFRESH_SECRET) as { sub: string; role: string; email: string };
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
      if (!user || !user.isActive) return res.status(401).json({ message: 'Usuario inválido' });

      const nextPayload = { sub: user.id, role: user.role.name, email: user.email };
      return res.json({ accessToken: signAccessToken(nextPayload) });
    } catch {
      return res.status(401).json({ message: 'Refresh token inválido o expirado' });
    }
  }
);

// Perfil del usuario autenticado
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
      createdAt: user.createdAt
    });
  } catch (err) {
    console.error('[AUTH/ME]', err);
    return res.status(500).json({ message: 'Error al obtener perfil' });
  }
});

// Logout (sin estado en servidor — solo confirma al cliente que limpie tokens)
authRouter.post('/logout', requireAuth as any, (_req, res) => {
  res.json({ message: 'Sesión cerrada correctamente' });
});
