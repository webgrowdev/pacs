import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';

export const systemRouter = Router();

// ── GET /api/system/modules — lista todos los módulos (ADMIN) ─────────────────
systemRouter.get(
  '/modules',
  requireAuth as any,
  requireRole('ADMIN') as any,
  async (_req: AuthRequest, res: any) => {
    try {
      const modules = await prisma.module.findMany({ orderBy: { code: 'asc' } });
      return res.json(modules);
    } catch (err) {
      console.error('[SYSTEM/modules]', err);
      return res.status(500).json({ message: 'Error al obtener módulos' });
    }
  }
);

// ── GET /api/system/tenants — lista todos los tenants (ADMIN) ─────────────────
systemRouter.get(
  '/tenants',
  requireAuth as any,
  requireRole('ADMIN') as any,
  async (_req: AuthRequest, res: any) => {
    try {
      const tenants = await prisma.tenant.findMany({
        include: { modules: { include: { module: true } } },
        orderBy: { name: 'asc' }
      });
      return res.json(tenants);
    } catch (err) {
      console.error('[SYSTEM/tenants]', err);
      return res.status(500).json({ message: 'Error al obtener tenants' });
    }
  }
);

// ── GET /api/system/tenants/:id/modules — módulos de un tenant (ADMIN) ────────
systemRouter.get(
  '/tenants/:id/modules',
  requireAuth as any,
  requireRole('ADMIN') as any,
  async (req: AuthRequest, res: any) => {
    try {
      const tenantId = String(req.params.id);
      const tenantModules = await prisma.tenantModule.findMany({
        where: { tenantId },
        include: { module: true }
      });
      return res.json(tenantModules);
    } catch (err) {
      console.error('[SYSTEM/tenant-modules]', err);
      return res.status(500).json({ message: 'Error al obtener módulos del tenant' });
    }
  }
);

// ── PUT /api/system/tenants/:id/modules/:moduleCode/toggle (ADMIN) ────────────
systemRouter.put(
  '/tenants/:id/modules/:moduleCode/toggle',
  requireAuth as any,
  requireRole('ADMIN') as any,
  async (req: AuthRequest, res: any) => {
    try {
      const tenantId   = String(req.params.id);
      const moduleCode = String(req.params.moduleCode);

      const mod = await prisma.module.findUnique({ where: { code: moduleCode } });
      if (!mod) return res.status(404).json({ message: 'Módulo no encontrado' });

      const existing = await prisma.tenantModule.findUnique({
        where: { tenantId_moduleId: { tenantId, moduleId: mod.id } }
      });

      if (existing) {
        const updated = await prisma.tenantModule.update({
          where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
          data:  { isActive: !existing.isActive }
        });
        return res.json(updated);
      }

      // If no row exists yet, create it as active
      const created = await prisma.tenantModule.create({
        data: { tenantId, moduleId: mod.id, isActive: true }
      });
      return res.json(created);
    } catch (err) {
      console.error('[SYSTEM/toggle]', err);
      return res.status(500).json({ message: 'Error al cambiar estado del módulo' });
    }
  }
);

// ── GET /api/system/my-modules — módulos activos para el usuario actual ────────
// En esta versión devuelve todos los módulos con isActive=true en la tabla Module.
// En el futuro se filtrará por tenant del usuario.
systemRouter.get(
  '/my-modules',
  requireAuth as any,
  async (_req: AuthRequest, res: any) => {
    try {
      const modules = await prisma.module.findMany({
        where:   { isActive: true },
        select:  { code: true, name: true, version: true },
        orderBy: { code: 'asc' }
      });
      return res.json(modules);
    } catch (err) {
      console.error('[SYSTEM/my-modules]', err);
      return res.status(500).json({ message: 'Error al obtener módulos activos' });
    }
  }
);
