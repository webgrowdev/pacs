/**
 * DICOMweb STOW-RS — para equipos nuevos (CT, MRI, RX con soporte REST)
 *
 * Estándar: DICOM PS3.18 §10.5  (STOW-RS)
 * Endpoint: POST /wado/studies
 * Content-Type: multipart/related; type="application/dicom"
 *
 * Equipos compatibles configuran:
 *   - URL: http://<server>:<port>/wado/studies
 *   - Auth: Bearer token (obtenido desde /api/auth/login)  — o sin auth si es red interna cerrada
 *
 * Respuesta exitosa: 200 OK con XML según estándar STOW-RS
 */

import { Router, Request, Response } from 'express';
import { processDicomBuffer } from '../../dicom/study-processor.js';
import { prisma } from '../../config/prisma.js';
import { StudySource } from '@prisma/client';
import { logSystemAudit } from '../../middleware/audit.js';

// NOTE: Authentication for this router is handled at the app level via
// dicomWebAuthMiddleware in index.ts (Bearer token OR IP allowlist).
// Routes here add additional audit logging.

export const dicomwebRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSystemUserId(): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { role: { name: 'ADMIN' }, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  if (!admin) throw new Error('No hay usuario ADMIN disponible para STOW-RS');
  return admin.id;
}

/**
 * Parsea un body multipart/related y extrae cada parte como Buffer.
 * dcmjs-dimse no maneja HTTP; parseamos el multipart manualmente.
 */
function parseMultipart(body: Buffer, boundary: string): Buffer[] {
  const parts: Buffer[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from('\r\n');

  let pos = 0;
  while (pos < body.length) {
    const boundaryIdx = body.indexOf(boundaryBuf, pos);
    if (boundaryIdx === -1) break;

    // Saltar la línea del boundary
    pos = boundaryIdx + boundaryBuf.length;
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // "--" = fin

    // Saltar \r\n después del boundary
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;

    // Leer headers de la parte hasta doble CRLF
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    pos = headerEnd + 4;

    // Encontrar el siguiente boundary para delimitar el cuerpo
    const nextBoundary = body.indexOf(boundaryBuf, pos);
    if (nextBoundary === -1) {
      parts.push(body.subarray(pos));
      break;
    }

    // El cuerpo termina 2 bytes antes (\r\n antes del boundary)
    const partEnd = nextBoundary - 2;
    if (partEnd > pos) {
      parts.push(body.subarray(pos, partEnd));
    }
    pos = nextBoundary;
  }

  return parts;
}

function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
  return match ? match[1] : null;
}

// ─── STOW-RS: POST /wado/studies ─────────────────────────────────────────────

dicomwebRouter.post('/studies', async (req: Request, res: Response) => {
  const contentType = req.headers['content-type'] || '';

  if (!contentType.toLowerCase().includes('multipart/related')) {
    res.status(400).json({ message: 'Content-Type debe ser multipart/related; type="application/dicom"' });
    return;
  }

  const boundary = extractBoundary(contentType);
  if (!boundary) {
    res.status(400).json({ message: 'Content-Type no contiene boundary' });
    return;
  }

  let systemUserId: string;
  try {
    systemUserId = await getSystemUserId();
  } catch (err) {
    res.status(500).json({ message: 'Error interno al identificar usuario sistema' });
    return;
  }

  // El body llega como Buffer (rawBody middleware configurado en index.ts)
  const rawBody: Buffer = (req as any).rawBody;
  if (!rawBody || rawBody.length === 0) {
    res.status(400).json({ message: 'Body vacío' });
    return;
  }

  const parts = parseMultipart(rawBody, boundary);
  if (parts.length === 0) {
    res.status(400).json({ message: 'No se encontraron partes DICOM en el multipart' });
    return;
  }

  const successUids: string[] = [];
  const failedUids: string[]  = [];

  for (const part of parts) {
    try {
      const result = await processDicomBuffer({
        buffer: part,
        source: StudySource.DICOMWEB,
        systemUserId,
      });
      successUids.push(result.dicomFileId);

      // ANMAT §2318/02 — audit every DICOMweb ingestion
      await logSystemAudit(
        'DICOMWEB_STOW_RS_RECEIVED',
        'STUDY',
        result.studyId,
        {
          patientId:   result.patientId,
          isNewStudy:  result.isNewStudy,
          isNewPatient: result.isNewPatient,
          dicomFileId: result.dicomFileId
        },
        req.ip
      );

      console.log(
        `[STOW-RS] Imagen almacenada → estudio: ${result.studyId} | paciente: ${result.patientId}` +
        (result.isNewStudy   ? ' [NUEVO ESTUDIO]'   : '') +
        (result.isNewPatient ? ' [NUEVO PACIENTE]' : '')
      );
    } catch (err) {
      console.error('[STOW-RS] Error procesando parte DICOM:', err);
      failedUids.push('unknown');
    }
  }

  // Respuesta STOW-RS según PS3.18 — usamos JSON simplificado por compatibilidad
  if (failedUids.length > 0 && successUids.length === 0) {
    res.status(409).json({
      message: 'Todas las instancias fallaron',
      failed: failedUids.length
    });
    return;
  }

  res.status(200).json({
    stored:  successUids.length,
    failed:  failedUids.length,
    message: `${successUids.length} instancia(s) almacenada(s)${failedUids.length ? `, ${failedUids.length} con error` : ''}`
  });
});

// ─── WADO-RS: GET /wado/studies/:studyUid — recuperar estudio ─────────────────
// (para equipos o viewers que piden imágenes via DICOMweb)

dicomwebRouter.get('/studies/:studyUid', async (req: Request, res: Response) => {
  const { studyUid } = req.params;

  const study = await prisma.study.findFirst({
    where: { studyInstanceUid: String(studyUid) },
    include: { dicomFiles: true }
  });

  if (!study) {
    res.status(404).json({ message: 'Estudio no encontrado' });
    return;
  }

  // Respuesta con metadata del estudio en formato DICOMweb JSON (simplificado)
  const fullStudy = study as typeof study & { dicomFiles: { id: string }[] };
  res.json({
    studyInstanceUID: study.studyInstanceUid,
    studyId:          study.id,
    modality:         study.modality,
    studyDate:        study.studyDate,
    source:           study.source,
    instances:        fullStudy.dicomFiles?.length ?? 0,
  });
});
