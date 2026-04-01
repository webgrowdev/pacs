import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function studyStoragePath(studyId: string) {
  const folder = path.resolve(process.cwd(), env.STORAGE_ROOT, 'dicom', studyId);
  ensureDir(folder);
  return folder;
}

export function pdfStoragePath() {
  const folder = path.resolve(process.cwd(), env.STORAGE_ROOT, 'pdfs');
  ensureDir(folder);
  return folder;
}
