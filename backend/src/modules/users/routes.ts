import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';

export const usersRouter = Router();
usersRouter.use(requireAuth as any, requireRole('ADMIN') as any);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  roleName: z.enum(['ADMIN', 'DOCTOR', 'PATIENT'])
});

// Listar usuarios
usersRouter.get('/', async (_req: AuthRequest, res: any) => {
  try {
    // Prisma no permite include + select al mismo nivel - usar solo include
    const users = await prisma.user.findMany({
      include: { role: true },
      orderBy: { createdAt: 'desc' }
    });
    // Omitir passwordHash antes de enviar
    const safeUsers = users.map(({ passwordHash: _, ...u }) => u);
    return res.json(safeUsers);
  } catch (err) {
    console.error('[USERS/GET]', err);
    return res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

// Crear usuario
usersRouter.post('/', async (req: AuthRequest, res: any) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.flatten() });

  try {
    const role = await prisma.role.findUnique({ where: { name: parsed.data.roleName } });
    if (!role) return res.status(400).json({ message: 'Rol inválido' });

    const user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        passwordHash: await bcrypt.hash(parsed.data.password, 12),
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        roleId: role.id
      },
      include: { role: true }
    });

    await logAudit(req, 'USER_CREATED', 'USER', user.id, { email: user.email, role: parsed.data.roleName });

    // Omitir passwordHash en la respuesta
    const { passwordHash: _, ...safeUser } = user as any;
    return res.status(201).json(safeUser);
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ message: 'El email ya está registrado' });
    console.error('[USERS/POST]', err);
    return res.status(500).json({ message: 'Error al crear usuario' });
  }
});

// Activar/desactivar usuario
usersRouter.patch('/:id/toggle-active', async (req: AuthRequest, res: any) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive },
      include: { role: true }
    });

    await logAudit(req, updated.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'USER', updated.id);

    const { passwordHash: _, ...safeUser } = updated as any;
    return res.json(safeUser);
  } catch (err) {
    console.error('[USERS/TOGGLE]', err);
    return res.status(500).json({ message: 'Error al actualizar estado de usuario' });
  }
});

// Listar médicos (para asignación)
usersRouter.get('/doctors', async (_req: AuthRequest, res: any) => {
  try {
    const doctorRole = await prisma.role.findUnique({ where: { name: 'DOCTOR' } });
    if (!doctorRole) return res.json([]);
    const doctors = await prisma.user.findMany({
      where: { roleId: doctorRole.id, isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true }
    });
    return res.json(doctors);
  } catch (err) {
    console.error('[USERS/DOCTORS]', err);
    return res.status(500).json({ message: 'Error al obtener médicos' });
  }
});
