import { Router } from 'express';
import fs from 'node:fs';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { env } from '../../config/env.js';

export const backupRouter = Router();
backupRouter.use(requireAuth as any, requireRole('ADMIN') as any);

backupRouter.get('/status', async (_req: AuthRequest, res: any) => {
  try {
    const statusFile = env.BACKUP_STATUS_FILE;
    if (!fs.existsSync(statusFile)) {
      return res.json({ status: 'MISSING', lastBackupAt: null, lastBackupSizeGb: null });
    }
    const raw  = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    const lastAt = new Date(raw.lastBackupAt);
    const ageHours = (Date.now() - lastAt.getTime()) / 3_600_000;
    const status = ageHours > env.BACKUP_MAX_AGE_HOURS ? 'OVERDUE' : 'OK';
    const sizeGb = raw.lastBackupSizeBytes ? +(raw.lastBackupSizeBytes / 1e9).toFixed(3) : null;
    return res.json({ status, lastBackupAt: raw.lastBackupAt, lastBackupSizeGb: sizeGb, ageHours: +ageHours.toFixed(1) });
  } catch (err) {
    console.error('[BACKUP/STATUS]', err);
    return res.status(500).json({ message: 'Error al verificar estado del backup' });
  }
});
