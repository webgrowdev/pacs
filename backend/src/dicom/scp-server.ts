/**
 * DICOM C-STORE SCP Server — para equipos viejos (CT, MRI, RX, etc.)
 *
 * Escucha en TCP (puerto configurable, default 11112).
 * Los equipos de imagen configuran:
 *   - IP del servidor
 *   - Puerto: 11112 (o 104 si corres como root)
 *   - AE Title destino: valor de DICOM_AE_TITLE en .env
 *
 * Flujo por cada imagen enviada:
 *   Equipo → Association Request → C-STORE RQ (dataset DICOM) → C-STORE RSP (Success) → Release
 *   → processDicomBuffer() → Paciente + Estudio + Serie + Archivo en disco
 */

import dcmjsDimse from 'dcmjs-dimse';
const { Server, Scp, Dataset, constants, association, responses } = dcmjsDimse;
import { processDicomBuffer } from './study-processor.js';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { StudySource } from '@prisma/client';
import { logSystemAudit } from '../middleware/audit.js';

const { TransferSyntax } = constants;
const { Association } = association;
const { CStoreResponse } = responses;

// ─── AE Title propio del PACS ─────────────────────────────────────────────────
const PACS_AE_TITLE = env.DICOM_AE_TITLE;

// ─── Usuario sistema para atribuir los estudios recibidos ────────────────────
let cachedSystemUserId: string | null = null;

async function getSystemUserId(): Promise<string> {
  if (cachedSystemUserId) return cachedSystemUserId;
  const admin = await prisma.user.findFirst({
    where: { role: { name: 'ADMIN' }, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  if (!admin) throw new Error('[SCP] No hay usuario ADMIN para asignar estudios recibidos');
  cachedSystemUserId = admin.id;
  return admin.id;
}

// ─── SCP Handler ─────────────────────────────────────────────────────────────

class PacsScp extends Scp {
  private callingAe = '';

  constructor(socket: any, opts: any) {
    super(socket, opts);
  }

  associationRequested(assoc: InstanceType<typeof Association>) {
    this.callingAe = assoc.getCallingAeTitle()?.trim() ?? 'UNKNOWN';
    const called   = assoc.getCalledAeTitle()?.trim() ?? '';

    console.log(`[SCP] Asociación entrante: ${this.callingAe} → ${called}`);

    // Verificar AE Title (si viene vacío, lo aceptamos de todos modos)
    if (called && called !== PACS_AE_TITLE) {
      console.warn(`[SCP] AE Title incorrecto: se esperaba "${PACS_AE_TITLE}", llegó "${called}"`);
      this.sendAssociationReject();
      return;
    }

    // Aceptar todos los Presentation Contexts de Storage (C-STORE)
    const presentationContexts = assoc.getPresentationContexts();
    presentationContexts.forEach((pc: any) => {
      const transferSyntaxes: string[] = pc.getTransferSyntaxUids?.() ?? [];

      // Preferir Explicit VR Little Endian; si no, aceptar el primero disponible
      const preferred = [
        TransferSyntax.ExplicitVRLittleEndian,
        TransferSyntax.ImplicitVRLittleEndian,
      ];
      const accepted = transferSyntaxes.find((ts) => preferred.includes(ts as any))
        ?? transferSyntaxes[0]
        ?? TransferSyntax.ImplicitVRLittleEndian;

      pc.setResult(0, accepted);  // 0 = Acceptance
    });

    this.sendAssociationAccept();
  }

  associationReleaseRequested() {
    this.sendAssociationReleaseResponse();
  }

  cStoreRequest(request: any, callback: (response: any) => void) {
    try {
      const dataset: InstanceType<typeof Dataset> = request.getDataset();
      const buffer: Buffer   = dataset.getDenaturalizedDataset() as unknown as Buffer;
      const callingAe        = this.callingAe;

      // Procesar de forma asíncrona — respondemos al equipo de inmediato (Success)
      getSystemUserId()
        .then(async (userId) => {
          const result = await processDicomBuffer({
            buffer,
            source: StudySource.DICOM_SCP,
            callingAeTitle: callingAe,
            systemUserId: userId,
          });
          // ANMAT Disposición 2318/02 — audit every DICOM file received via SCP
          await logSystemAudit(
            'DICOM_SCP_RECEIVED',
            'STUDY',
            result.studyId,
            {
              callingAeTitle: callingAe,
              patientId:      result.patientId,
              isNewStudy:     result.isNewStudy,
              isNewPatient:   result.isNewPatient,
              dicomFileId:    result.dicomFileId
            },
            callingAe  // store AE title as "source IP" for SCP audit
          );
          console.log(
            `[SCP] Almacenado → estudio: ${result.studyId} paciente: ${result.patientId}` +
            (result.isNewStudy   ? ' [NUEVO ESTUDIO]'   : '') +
            (result.isNewPatient ? ' [NUEVO PACIENTE]' : '')
          );
          return result;
        })
        .catch((err) => {
          console.error('[SCP] Error procesando imagen:', err);
          logSystemAudit('DICOM_SCP_ERROR', 'STUDY', undefined, { callingAeTitle: callingAe, error: String(err) }, callingAe).catch(() => {});
        });

      // Responder Success al equipo sin bloquear
      const response = CStoreResponse.fromRequest(request);
      response.setStatus(0x0000); // Success
      callback(response);
    } catch (err) {
      console.error('[SCP] Error en C-STORE handler:', err);
      const response = CStoreResponse.fromRequest(request);
      response.setStatus(0xa700); // Out of resources
      callback(response);
    }
  }
}

// ─── Iniciar servidor ─────────────────────────────────────────────────────────

export function startScpServer(): void {
  const port = env.DICOM_SCP_PORT;

  const server = new Server(PacsScp);
  server.listen(port);

  console.log(`✓ DICOM SCP escuchando en TCP :${port} [AE Title: ${PACS_AE_TITLE}]`);
  console.log(`  → Configura tus equipos con IP del servidor y puerto ${port}`);

  server.on('error', (err: Error) => {
    console.error('[SCP] Error de servidor:', err.message);
  });
}
