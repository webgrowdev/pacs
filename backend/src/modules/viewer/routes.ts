/**
 * Viewer state + Key Images
 *
 * ViewerState  — persists each doctor's reading session per study so that
 *                annotations, W/L, zoom, frame index, etc. survive refresh /
 *                logout / reopen.
 *
 * KeyImage     — marks specific SOPInstances as clinically relevant images,
 *                associating them with a report (Key Object Selection equivalent).
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';

export const viewerRouter = Router();
viewerRouter.use(requireAuth as any);

// ─── ViewerState ──────────────────────────────────────────────────────────────

const viewerStateSchema = z.object({
  windowWidth:        z.number().optional(),
  windowCenter:       z.number().optional(),
  zoom:               z.number().optional(),
  panX:               z.number().optional(),
  panY:               z.number().optional(),
  rotation:           z.number().optional(),
  isInverted:         z.boolean().optional(),
  frameIndex:         z.number().int().min(0).optional(),
  activeTool:         z.string().max(60).optional(),
  annotationSnapshot: z.record(z.any()).optional()
});

/**
 * GET /api/viewer/:studyId/state
 * Returns the persisted viewer state for the calling user and given study.
 * Returns 204 when no state has been saved yet.
 */
viewerRouter.get(
  '/:studyId/state',
  requireRole('ADMIN', 'DOCTOR') as any,
  async (req: AuthRequest, res: any) => {
    try {
      const studyId = String(req.params.studyId);
      const state = await prisma.viewerState.findUnique({
        where: { studyId_userId: { studyId, userId: req.user!.sub } }
      });
      if (!state) return res.status(204).end();
      return res.json(state);
    } catch (err) {
      console.error('[VIEWER/STATE/GET]', err);
      return res.status(500).json({ message: 'Error al obtener estado del visor' });
    }
  }
);

/**
 * PUT /api/viewer/:studyId/state
 * Upserts (creates or updates) the viewer state for the calling user.
 */
viewerRouter.put(
  '/:studyId/state',
  requireRole('ADMIN', 'DOCTOR') as any,
  async (req: AuthRequest, res: any) => {
    const parsed = viewerStateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

    try {
      const studyId = String(req.params.studyId);
      const userId  = req.user!.sub;
      const state = await prisma.viewerState.upsert({
        where:  { studyId_userId: { studyId, userId } },
        update: { ...parsed.data, savedAt: new Date() },
        create: { studyId, userId, ...parsed.data }
      });
      return res.json(state);
    } catch (err) {
      console.error('[VIEWER/STATE/PUT]', err);
      return res.status(500).json({ message: 'Error al guardar estado del visor' });
    }
  }
);

/**
 * DELETE /api/viewer/:studyId/state
 * Clears the persisted viewer state (e.g. after a completed report).
 */
viewerRouter.delete(
  '/:studyId/state',
  requireRole('ADMIN', 'DOCTOR') as any,
  async (req: AuthRequest, res: any) => {
    try {
      const studyId = String(req.params.studyId);
      await prisma.viewerState.deleteMany({
        where: { studyId, userId: req.user!.sub }
      });
      return res.status(204).end();
    } catch (err) {
      console.error('[VIEWER/STATE/DELETE]', err);
      return res.status(500).json({ message: 'Error al eliminar estado del visor' });
    }
  }
);

// ─── KeyImage ─────────────────────────────────────────────────────────────────

const keyImageSchema = z.object({
  reportId:       z.string().min(1),
  studyId:        z.string().min(1),
  sopInstanceUid: z.string().min(1),
  instanceNumber: z.number().int().optional(),
  frameIndex:     z.number().int().min(0).optional(),
  description:    z.string().max(500).optional()
});

/**
 * GET /api/viewer/:studyId/key-images
 * Lists all key images for a given study (across all reports the user can access).
 */
viewerRouter.get(
  '/:studyId/key-images',
  requireRole('ADMIN', 'DOCTOR') as any,
  async (req: AuthRequest, res: any) => {
    try {
      const studyId = String(req.params.studyId);
      const keyImages = await prisma.keyImage.findMany({
        where: { studyId },
        orderBy: { createdAt: 'asc' }
      });
      return res.json(keyImages);
    } catch (err) {
      console.error('[VIEWER/KEY-IMAGES/GET]', err);
      return res.status(500).json({ message: 'Error al obtener imágenes clave' });
    }
  }
);

/**
 * POST /api/viewer/:studyId/key-images
 * Marks an image as a key image and associates it with a report.
 */
viewerRouter.post(
  '/:studyId/key-images',
  requireRole('ADMIN', 'DOCTOR') as any,
  async (req: AuthRequest, res: any) => {
    const studyId = String(req.params.studyId);
    const parsed = keyImageSchema.safeParse({ ...req.body, studyId });
    if (!parsed.success) return res.status(400).json({ message: 'Payload inválido', errors: parsed.error.flatten() });

    try {
      const report = await prisma.report.findUnique({ where: { id: parsed.data.reportId } });
      if (!report || report.studyId !== studyId) {
        return res.status(404).json({ message: 'Informe no encontrado para este estudio' });
      }
      if (req.user?.role === 'DOCTOR' && report.doctorId !== req.user.sub) {
        return res.status(403).json({ message: 'No autorizado' });
      }

      const keyImage = await prisma.keyImage.create({
        data: {
          reportId:       parsed.data.reportId,
          studyId:        parsed.data.studyId,
          sopInstanceUid: parsed.data.sopInstanceUid,
          instanceNumber: parsed.data.instanceNumber,
          frameIndex:     parsed.data.frameIndex,
          description:    parsed.data.description,
          createdByUserId: req.user!.sub
        }
      });

      await logAudit(req, 'KEY_IMAGE_MARKED', 'KEY_IMAGE', keyImage.id, {
        sopInstanceUid: keyImage.sopInstanceUid,
        reportId:       keyImage.reportId,
        studyId:        keyImage.studyId
      });

      return res.status(201).json(keyImage);
    } catch (err) {
      console.error('[VIEWER/KEY-IMAGES/POST]', err);
      return res.status(500).json({ message: 'Error al guardar imagen clave' });
    }
  }
);

/**
 * DELETE /api/viewer/:studyId/key-images/:id
 * Removes a key image mark.
 */
viewerRouter.delete(
  '/:studyId/key-images/:id',
  requireRole('ADMIN', 'DOCTOR') as any,
  async (req: AuthRequest, res: any) => {
    try {
      const studyId = String(req.params.studyId);
      const keyImageId = String(req.params.id);
      const keyImage = await prisma.keyImage.findUnique({ where: { id: keyImageId } });
      if (!keyImage || keyImage.studyId !== studyId) {
        return res.status(404).json({ message: 'Imagen clave no encontrada' });
      }
      if (req.user?.role === 'DOCTOR' && keyImage.createdByUserId !== req.user.sub) {
        return res.status(403).json({ message: 'No autorizado' });
      }
      await prisma.keyImage.delete({ where: { id: keyImageId } });
      await logAudit(req, 'KEY_IMAGE_REMOVED', 'KEY_IMAGE', keyImageId, {
        sopInstanceUid: keyImage.sopInstanceUid,
        studyId: keyImage.studyId
      });
      return res.status(204).end();
    } catch (err) {
      console.error('[VIEWER/KEY-IMAGES/DELETE]', err);
      return res.status(500).json({ message: 'Error al eliminar imagen clave' });
    }
  }
);
