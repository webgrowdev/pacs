/**
 * HL7 v2 ORU^R01 message builder — sends radiology results to HIS/RIS systems.
 * MLLP transport over TCP.
 */

import { randomUUID } from 'node:crypto';

function hl7Date(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 12);
}

function escapeHl7(val: string | null | undefined): string {
  return (val ?? '').replace(/\|/g, '\\F\\').replace(/\^/g, '\\S\\').replace(/&/g, '\\T\\');
}

export interface Hl7OruPayload {
  reportId:      string;
  studyId:       string;
  modality:      string;
  studyDate:     Date;
  patientId:     string;
  patientName:   string;   // "lastName^firstName"
  patientDob:    string;   // YYYYMMDD
  patientSex:    string;
  documentId:    string;
  conclusion:    string;
  doctorId:      string;
  doctorName:    string;
  finalizedAt:   Date;
  pdfUrl?:       string;
  senderApp:     string;
  senderFacility: string;
  receiverApp:   string;
  receiverFacility: string;
}

export function buildOruR01(payload: Hl7OruPayload): string {
  const now = hl7Date(new Date());
  const msgId = randomUUID().replace(/-/g, '').slice(0, 20);

  const msh = `MSH|^~\\&|${escapeHl7(payload.senderApp)}|${escapeHl7(payload.senderFacility)}|${escapeHl7(payload.receiverApp)}|${escapeHl7(payload.receiverFacility)}|${now}||ORU^R01|${msgId}|P|2.5`;
  const pid = `PID|1||${escapeHl7(payload.documentId)}^^^MR||${escapeHl7(payload.patientName)}||${escapeHl7(payload.patientDob)}|${escapeHl7(payload.patientSex)}`;
  const pv1 = `PV1|1|O`;
  const orc = `ORC|RE|${escapeHl7(payload.studyId)}|||||||${now}`;
  const obr = `OBR|1|${escapeHl7(payload.studyId)}||${escapeHl7(payload.modality)}^^^RAD|||${hl7Date(payload.studyDate)}|||||||||${escapeHl7(payload.doctorId)}^${escapeHl7(payload.doctorName)}|||${hl7Date(payload.finalizedAt)}|||F`;
  const obx1 = `OBX|1|TX|59380-7^^LN||${escapeHl7(payload.conclusion)}||||||F`;
  const obx2 = payload.pdfUrl
    ? `OBX|2|RP|PDF_REPORT^^LOCAL||${escapeHl7(payload.pdfUrl)}||||||F`
    : null;

  return [msh, pid, pv1, orc, obr, obx1, ...(obx2 ? [obx2] : [])].join('\r');
}
