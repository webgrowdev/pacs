import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function studyStoragePath(studyId: string): string {
  const folder = path.resolve(process.cwd(), env.STORAGE_ROOT, 'dicom', studyId);
  ensureDir(folder);
  return folder;
}

export function pdfStoragePath(): string {
  const folder = path.resolve(process.cwd(), env.STORAGE_ROOT, 'pdfs');
  ensureDir(folder);
  return folder;
}

/**
 * Convierte una ruta absoluta de almacenamiento a ruta relativa al STORAGE_ROOT.
 * Ej: /abs/storage/pdfs/xyz.pdf → pdfs/xyz.pdf
 */
export function toRelativePath(absolutePath: string): string {
  const root = path.resolve(process.cwd(), env.STORAGE_ROOT);
  return path.relative(root, absolutePath);
}

/**
 * URL pública para servir el archivo (requiere auth en /files)
 */
export function toFileUrl(relativePath: string, baseUrl: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  return `${baseUrl}/files/${normalized}`;
}

/**
 * Resolves a storage-relative path to an absolute filesystem path.
 * All DicomFile.filePath values are stored relative to STORAGE_ROOT.
 */
export function resolveStoragePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.resolve(process.cwd(), env.STORAGE_ROOT, relativePath);
}
