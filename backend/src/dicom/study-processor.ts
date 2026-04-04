/**
 * Procesador DICOM compartido
 * Usado por: SCP server (equipos viejos) y DICOMweb STOW-RS (equipos nuevos)
 *
 * Dado un buffer DICOM:
 *  1. Extrae tags del dataset
 *  2. Busca o crea el paciente por PatientID (tag 00100020)
 *  3. Agrupa por StudyInstanceUID — un estudio por UID
 *  4. Agrupa series por SeriesInstanceUID
 *  5. Persiste el archivo en disco y registra DicomFile en DB
 */

import fs from 'node:fs';
import path from 'node:path';
import dicomParser from 'dicom-parser';
import { prisma } from '../config/prisma.js';
import { studyStoragePath } from '../storage/file-storage.js';
import { StudySource } from '@prisma/client';

export interface ProcessDicomOptions {
  buffer: Buffer;
  source: StudySource;
  /** AE Title del equipo que envió (solo SCP) */
  callingAeTitle?: string;
  /** ID del usuario sistema que representa al equipo (para uploadedById) */
  systemUserId: string;
}

export interface ProcessDicomResult {
  studyId: string;
  seriesId: string | null;
  dicomFileId: string;
  patientId: string;
  isNewStudy: boolean;
  isNewPatient: boolean;
}

// ─── Tag helpers ─────────────────────────────────────────────────────────────

function str(ds: dicomParser.DataSet, tag: string): string | null {
  try { return ds.string(tag) || null; } catch { return null; }
}

function intTag(ds: dicomParser.DataSet, tag: string): number | null {
  try { const v = ds.string(tag); return v ? parseInt(v, 10) : null; } catch { return null; }
}

export function parseDicomTags(buffer: Buffer) {
  try {
    const ds = dicomParser.parseDicom(buffer as unknown as Uint8Array);
    return {
      patientId:         str(ds, 'x00100020'),
      patientName:       str(ds, 'x00100010'),
      patientBirthDate:  str(ds, 'x00100030'),  // YYYYMMDD
      patientSex:        str(ds, 'x00100040'),
      studyInstanceUid:  str(ds, 'x0020000d'),
      seriesInstanceUid: str(ds, 'x0020000e'),
      sopInstanceUid:    str(ds, 'x00080018'),
      sopClassUid:       str(ds, 'x00080016'),
      modality:          str(ds, 'x00080060'),
      studyDate:         str(ds, 'x00080020'),  // YYYYMMDD
      studyDescription:  str(ds, 'x00081030'),
      seriesNumber:      intTag(ds, 'x00200011'),
      instanceNumber:    intTag(ds, 'x00200013'),
    };
  } catch {
    return null;
  }
}

// ─── Conversión fecha DICOM YYYYMMDD → Date ───────────────────────────────────

function dicomDateToDate(dicomDate: string | null): Date {
  if (dicomDate && /^\d{8}$/.test(dicomDate)) {
    const y = dicomDate.slice(0, 4);
    const m = dicomDate.slice(4, 6);
    const d = dicomDate.slice(6, 8);
    return new Date(`${y}-${m}-${d}T00:00:00Z`);
  }
  return new Date();
}

// ─── Nombre de archivo seguro ────────────────────────────────────────────────

function safeFileName(sopUid: string | null, index: number): string {
  const base = sopUid ? sopUid.replace(/[^a-zA-Z0-9._-]/g, '_') : `instance_${index}`;
  return `${base}.dcm`;
}

// ─── Procesador principal ────────────────────────────────────────────────────

let instanceCounter = 0;

export async function processDicomBuffer(opts: ProcessDicomOptions): Promise<ProcessDicomResult> {
  const { buffer, source, callingAeTitle, systemUserId } = opts;

  const tags = parseDicomTags(buffer);
  if (!tags) throw new Error('Buffer no es un archivo DICOM válido');

  // ── 1. Paciente ────────────────────────────────────────────────────────────
  let isNewPatient = false;
  let patient = tags.patientId
    ? await prisma.patient.findFirst({ where: { documentId: tags.patientId } })
    : null;

  if (!patient) {
    isNewPatient = true;
    // Nombre: DICOM usa "Apellido^Nombre", normalizar
    const rawName = (tags.patientName || 'Desconocido^Desconocido').replace(/\^+/g, ' ').trim();
    const nameParts = rawName.split(/\s+/);
    const lastName  = nameParts[0] || 'Desconocido';
    const firstName = nameParts.slice(1).join(' ') || 'Desconocido';

    const docId = tags.patientId || `AUTO-${Date.now()}`;
    // internalCode único
    const internalCode = `AE-${docId.slice(0, 12).toUpperCase()}`;

    patient = await prisma.patient.upsert({
      where: { documentId: docId },
      update: {},
      create: {
        documentId:    docId,
        internalCode:  internalCode,
        firstName,
        lastName,
        dateOfBirth:   dicomDateToDate(tags.patientBirthDate),
        sex:           tags.patientSex || 'U',
      }
    });
  }

  // ── 2. Estudio ─────────────────────────────────────────────────────────────
  let isNewStudy = false;
  let study = tags.studyInstanceUid
    ? await prisma.study.findFirst({ where: { studyInstanceUid: tags.studyInstanceUid } })
    : null;

  if (!study) {
    isNewStudy = true;
    study = await prisma.study.create({
      data: {
        patientId:       patient.id,
        modality:        tags.modality || 'OT',
        studyDate:       dicomDateToDate(tags.studyDate),
        description:     tags.studyDescription || null,
        studyInstanceUid: tags.studyInstanceUid || null,
        source,
        callingAeTitle:  callingAeTitle || null,
        uploadedById:    systemUserId,
      }
    });
  }

  // ── 3. Serie ───────────────────────────────────────────────────────────────
  let seriesId: string | null = null;
  if (tags.seriesInstanceUid) {
    let series = await prisma.studySeries.findFirst({
      where: { studyId: study.id, seriesInstanceUid: tags.seriesInstanceUid }
    });
    if (!series) {
      series = await prisma.studySeries.create({
        data: {
          studyId:          study.id,
          seriesInstanceUid: tags.seriesInstanceUid,
          seriesNumber:     tags.seriesNumber || null,
          modality:         tags.modality || null,
        }
      });
    }
    seriesId = series.id;
  }

  // ── 4. Archivo en disco ────────────────────────────────────────────────────
  const storageFolder = studyStoragePath(study.id);
  const fileName = safeFileName(tags.sopInstanceUid, ++instanceCounter);
  const filePath = path.join(storageFolder, fileName);
  fs.writeFileSync(filePath, buffer);

  // ── 5. DicomFile en DB ─────────────────────────────────────────────────────
  const dicomFile = await prisma.dicomFile.create({
    data: {
      studyId:       study.id,
      seriesId,
      filePath,
      fileName,
      mimeType:      'application/dicom',
      fileSize:      buffer.length,
      sopInstanceUid: tags.sopInstanceUid || null,
      instanceNumber: tags.instanceNumber || null,
      metadataJson:  tags as any,
    }
  });

  return {
    studyId:      study.id,
    seriesId,
    dicomFileId:  dicomFile.id,
    patientId:    patient.id,
    isNewStudy,
    isNewPatient,
  };
}
