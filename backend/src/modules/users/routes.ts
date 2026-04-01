import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('ADMIN'));

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ include: { role: true } });
  res.json(users);
});

usersRouter.post('/', async (req, res) => {
  const { email, password, firstName, lastName, roleName } = req.body;
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return res.status(400).json({ message: 'Rol inválido' });

  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 10), firstName, lastName, roleId: role.id }
  });
  res.status(201).json(user);
});
