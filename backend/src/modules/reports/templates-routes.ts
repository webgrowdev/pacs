import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';

export const reportTemplatesRouter = Router();
reportTemplatesRouter.use(requireAuth as any);

const templateSchema = z.object({
  name: z.string().min(1).max(200),
  modality: z.string().max(10).optional().nullable(),
  findingsTemplate: z.string().min(1).max(10000),
  conclusionTemplate: z.string().min(1).max(5000),
  isActive: z.boolean().optional()
});

// Listar plantillas (ADMIN y DOCTOR pueden leer)
reportTemplatesRouter.get('/', requireRole('ADMIN', 'DOCTOR') as any, async (req: AuthRequest, res: any) => {
  try {
    const modality = req.query.modality ? String(req.query.modality) : undefined;
    const where: any = { isActive: true };
    if (modality) where.OR = [{ modality }, { modality: null }];

    const templates = await prisma.reportTemplate.findMany({
      where,
      orderBy: [{ modality: 'asc' }, { name: 'asc' }]
    });
    return res.json(templates);
  } catch (err) {
    console.error('[TEMPLATES/GET]', err);
    return res.status(500).json({ message: 'Error al obtener plantillas' });
  }
});

// Obtener todas las plantillas incluyendo inactivas (solo ADMIN)
reportTemplatesRouter.get('/all', requireRole('ADMIN') as any, async (_req: AuthRequest, res: any) => {
  try {
    const templates = await prisma.reportTemplate.findMany({
      orderBy: [{ modality: 'asc' }, { name: 'asc' }]
    });
    return res.json(templates);
  } catch (err) {
    console.error('[TEMPLATES/GET/ALL]', err);
    return res.status(500).json({ message: 'Error al obtener plantillas' });
  }
});

// Crear plantilla (solo ADMIN)
reportTemplatesRouter.post('/', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.flatten() });

  try {
    const template = await prisma.reportTemplate.create({
      data: {
        name: parsed.data.name,
        modality: parsed.data.modality ?? null,
        findingsTemplate: parsed.data.findingsTemplate,
        conclusionTemplate: parsed.data.conclusionTemplate,
        isActive: parsed.data.isActive ?? true
      }
    });
    await logAudit(req, 'TEMPLATE_CREATED', 'REPORT_TEMPLATE', template.id);
    return res.status(201).json(template);
  } catch (err) {
    console.error('[TEMPLATES/POST]', err);
    return res.status(500).json({ message: 'Error al crear plantilla' });
  }
});

// Actualizar plantilla (solo ADMIN)
reportTemplatesRouter.put('/:id', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.flatten() });

  try {
    const template = await prisma.reportTemplate.update({
      where: { id: String(req.params.id) },
      data: {
        name: parsed.data.name,
        modality: parsed.data.modality !== undefined ? (parsed.data.modality ?? null) : undefined,
        findingsTemplate: parsed.data.findingsTemplate,
        conclusionTemplate: parsed.data.conclusionTemplate,
        isActive: parsed.data.isActive
      }
    });
    await logAudit(req, 'TEMPLATE_UPDATED', 'REPORT_TEMPLATE', template.id);
    return res.json(template);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ message: 'Plantilla no encontrada' });
    console.error('[TEMPLATES/PUT]', err);
    return res.status(500).json({ message: 'Error al actualizar plantilla' });
  }
});

// Eliminar plantilla (solo ADMIN — soft delete vía isActive=false)
reportTemplatesRouter.delete('/:id', requireRole('ADMIN') as any, async (req: AuthRequest, res: any) => {
  try {
    const template = await prisma.reportTemplate.update({
      where: { id: String(req.params.id) },
      data: { isActive: false }
    });
    await logAudit(req, 'TEMPLATE_DELETED', 'REPORT_TEMPLATE', template.id);
    return res.json({ message: 'Plantilla desactivada' });
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ message: 'Plantilla no encontrada' });
    console.error('[TEMPLATES/DELETE]', err);
    return res.status(500).json({ message: 'Error al eliminar plantilla' });
  }
});
