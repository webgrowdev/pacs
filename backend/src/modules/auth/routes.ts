import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { signAccessToken, signRefreshToken } from '../../utils/jwt.js';

export const authRouter = Router();

authRouter.post('/login', [body('email').isEmail(), body('password').isLength({ min: 8 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user || !user.isActive) return res.status(401).json({ message: 'Credenciales inválidas' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ message: 'Credenciales inválidas' });

  const payload = { sub: user.id, role: user.role.name, email: user.email };
  res.json({ accessToken: signAccessToken(payload), refreshToken: signRefreshToken(payload), user: payload });
});

authRouter.post('/refresh', [body('refreshToken').isString().isLength({ min: 20 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const payload = jwt.verify(req.body.refreshToken, env.JWT_REFRESH_SECRET) as { sub: string; role: string; email: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (!user || !user.isActive) return res.status(401).json({ message: 'Usuario inválido' });

    const nextPayload = { sub: user.id, role: user.role.name, email: user.email };
    res.json({ accessToken: signAccessToken(nextPayload) });
  } catch {
    res.status(401).json({ message: 'Refresh token inválido' });
  }
});
