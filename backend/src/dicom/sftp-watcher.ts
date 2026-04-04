import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/prisma.js';
import { processDicomBuffer } from './study-processor.js';
import { env } from '../config/env.js';
import { StudySource } from '@prisma/client';
import { logSystemAudit } from '../middleware/audit.js';

let cachedSystemUserId: string | null = null;

async function getSystemUserId(): Promise<string> {
  if (cachedSystemUserId) return cachedSystemUserId;
  const admin = await prisma.user.findFirst({
    where: { role: { name: 'ADMIN' }, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  if (!admin) throw new Error('[SFTP-WATCHER] No hay usuario ADMIN disponible');
  cachedSystemUserId = admin.id;
  return admin.id;
}

export function startSftpWatcher(): void {
  const dropFolder = path.resolve(process.cwd(), env.SFTP_DROP_FOLDER);
  const processedFolder = path.join(dropFolder, 'processed');
  const failedFolder = path.join(dropFolder, 'failed');

  // Crear carpetas si no existen
  [dropFolder, processedFolder, failedFolder].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const watcher = chokidar.watch(dropFolder, {
    persistent: true,
    ignoreInitial: false,
    ignored: [processedFolder, failedFolder, /(^|[/\\])\../],
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 }
  });

  watcher.on('add', async (filePath: string) => {
    if (!filePath.toLowerCase().endsWith('.dcm')) return;

    console.log(`[SFTP-WATCHER] Nuevo archivo detectado: ${path.basename(filePath)}`);
    const fileName = path.basename(filePath);
    try {
      const buffer = fs.readFileSync(filePath);
      const userId = await getSystemUserId();
      const result = await processDicomBuffer({ buffer, source: StudySource.MANUAL_UPLOAD, systemUserId: userId });

      // ANMAT Disposición 2318/02 — audit every DICOM file ingested via SFTP
      await logSystemAudit(
        'DICOM_SFTP_INGESTED',
        'STUDY',
        result.studyId,
        {
          fileName,
          patientId:   result.patientId,
          isNewStudy:  result.isNewStudy,
          isNewPatient: result.isNewPatient,
          dicomFileId: result.dicomFileId
        }
      );

      console.log(`[SFTP-WATCHER] Procesado → estudio: ${result.studyId}${result.isNewPatient ? ' [NUEVO PACIENTE]' : ''}`);

      // Mover a processed/
      const dest = path.join(processedFolder, `${Date.now()}_${fileName}`);
      fs.renameSync(filePath, dest);
    } catch (err) {
      console.error(`[SFTP-WATCHER] Error procesando ${fileName}:`, err);
      await logSystemAudit('DICOM_SFTP_ERROR', 'STUDY', undefined, { fileName, error: String(err) }).catch(() => {});
      try {
        const dest = path.join(failedFolder, `${Date.now()}_${fileName}`);
        fs.renameSync(filePath, dest);
      } catch {}
    }
  });

  watcher.on('error', (err: unknown) => console.error('[SFTP-WATCHER] Error del watcher:', err));

  console.log(`✓ SFTP Drop Watcher activo en: ${dropFolder}`);
}
