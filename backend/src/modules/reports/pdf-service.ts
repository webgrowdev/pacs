import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { pdfStoragePath, toRelativePath } from '../../storage/file-storage.js';

export interface StructuredScores {
  birads?: {
    category: number;            // 0-6
    density?: string;            // A, B, C, D
    laterality?: string;         // bilateral, left, right
    massShape?: string;
    assessment?: string;
  };
  tirads?: {
    category: number;            // 1-5
    points?: number;
    composition?: string;
    echogenicity?: string;
    shape?: string;
    margin?: string;
    echogenicFoci?: string;
    recommendation?: string;
  };
  pirads?: {
    category: number;            // 1-5
    zone?: string;               // PZ, TZ, AS, SV
    dcePositive?: boolean;
    assessment?: string;
  };
  lirads?: {
    category: string;            // LR-1 to LR-M or LR-TIV
    size?: number;               // mm
    arterialEnhancement?: boolean;
    assessment?: string;
  };
  chest?: {
    opacity?: boolean;
    pleuralEffusion?: boolean;
    pneumothorax?: boolean;
    cardiomegaly?: boolean;
    infiltrate?: boolean;
    consolidation?: boolean;
    atelectasis?: boolean;
    findings?: string;
  };
}

export interface RadiationDose {
  ctdiVol?: number;       // mGy
  dlp?: number;           // mGy·cm
  effectiveDose?: number; // mSv
  source?: string;        // "DICOM_RDSR", "manual"
}

export interface PdfInput {
  reportId: string;
  patientName: string;
  patientCode: string;
  patientDni?: string;
  patientCuil?: string;
  patientDob?: string;
  patientSex?: string;
  healthInsurance?: string;
  healthInsurancePlan?: string;
  healthInsuranceMemberId?: string;
  studyDate?: string;
  studyModality?: string;
  studyDescription: string;
  requestingDoctorName?: string;
  insuranceOrderNumber?: string;
  institutionName?: string;
  doctorName: string;
  doctorLicense?: string;
  doctorSpecialty?: string;
  clinicalIndication?: string;
  findings: string;
  conclusion: string;
  patientSummary?: string;
  aiUsed?: boolean;
  isCritical?: boolean;
  criticalReason?: string;
  structuredScores?: StructuredScores;
  radiationDose?: RadiationDose;
  verifyUrl?: string;     // URL for QR code verification
  /** A3: Banner shown on parent reports when an addendum was issued. */
  addendumNotice?: string;
  measurements: Array<{
    label: string;
    value: number;
    unit: string;
    sopInstanceUid?: string;
    instanceNumber?: number;
    frameIndex?: number;
  }>;
}

const BRAND_COLOR = '#1e3a5f';
const ACCENT_COLOR = '#2563eb';
const LIGHT_GRAY = '#f1f5f9';
const TEXT_COLOR = '#1e293b';
const SUBTITLE_COLOR = '#64748b';
const CRITICAL_COLOR = '#dc2626';
const CRITICAL_BG = '#fef2f2';
const CRITICAL_BORDER = '#fca5a5';

export async function generateClinicalPdf(input: PdfInput): Promise<string> {
  const dir = pdfStoragePath();
  const absoluteOutput = path.join(dir, `${input.reportId}.pdf`);

  // Pre-generate QR code buffer if a verify URL is provided
  let qrBuffer: Buffer | null = null;
  if (input.verifyUrl) {
    try {
      qrBuffer = await QRCode.toBuffer(input.verifyUrl, { type: 'png', width: 80, margin: 1 });
    } catch {
      // Non-fatal: QR generation failure won't block PDF creation
    }
  }

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4', info: { Title: 'Informe Médico', Author: input.doctorName } });
    const stream = fs.createWriteStream(absoluteOutput);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const pageWidth = doc.page.width - 100; // left + right margin

    // ─── HEADER ───────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 90).fill(BRAND_COLOR);

    doc.fill('#ffffff').fontSize(20).font('Helvetica-Bold')
       .text('INFORME DE DIAGNÓSTICO POR IMÁGENES', 50, 22, { width: pageWidth - 120 });

    doc.fill('rgba(255,255,255,0.7)').fontSize(10).font('Helvetica')
       .text(input.institutionName || 'Centro de Diagnóstico por Imágenes', 50, 50, { width: pageWidth - 120 });

    doc.fill('#ffffff').fontSize(9)
       .text(`Informe Nº ${input.reportId.slice(0, 8).toUpperCase()}`, 50, 66);

    // Fecha en esquina derecha
    doc.fill('rgba(255,255,255,0.9)').fontSize(9)
       .text(`Emitido: ${formatDate(new Date())}`, doc.page.width - 200, 66, { width: 150, align: 'right' });

    doc.fill(TEXT_COLOR).moveDown(4);

    // ─── ALERTA CRÍTICA (si aplica) ───────────────────────────────────────────
    let currentY = 100;
    if (input.isCritical) {
      const criticalBoxH = 36 + (input.criticalReason ? 14 : 0);
      doc.rect(50, currentY, pageWidth, criticalBoxH).fill(CRITICAL_BG)
         .rect(50, currentY, 4, criticalBoxH).fill(CRITICAL_COLOR);
      doc.fill(CRITICAL_COLOR).fontSize(10).font('Helvetica-Bold')
         .text('🚨 HALLAZGO CRÍTICO / STAT', 62, currentY + 8);
      if (input.criticalReason) {
        doc.fill('#7f1d1d').fontSize(9).font('Helvetica')
           .text(input.criticalReason, 62, currentY + 22, { width: pageWidth - 20 });
      }
      doc.fill('#7f1d1d').fontSize(8).font('Helvetica-Oblique')
         .text('Este hallazgo requiere comunicación inmediata al médico solicitante. ACR Practice Parameter para comunicación urgente.',
           62, currentY + (input.criticalReason ? 36 : 22), { width: pageWidth - 20 });
      currentY += criticalBoxH + 8;
    }

    // ─── DATOS DEL PACIENTE ───────────────────────────────────────────────────
    const boxY = currentY + 10;
    // Calculate box height based on fields present
    const patientRows = 2 + (input.healthInsurance ? 1 : 0);
    const patientBoxH = 20 + patientRows * 18;
    doc.rect(50, boxY, pageWidth, patientBoxH).fill(LIGHT_GRAY);

    doc.fill(BRAND_COLOR).fontSize(9).font('Helvetica-Bold')
       .text('DATOS DEL PACIENTE', 62, boxY + 10);

    doc.fill(TEXT_COLOR).fontSize(10).font('Helvetica');
    const col1 = 62, col2 = 280;
    let rowY = boxY + 24;

    doc.font('Helvetica-Bold').text('Paciente:', col1, rowY).font('Helvetica')
       .text(input.patientName, col1 + 60, rowY);
    doc.font('Helvetica-Bold').text('Código:', col2, rowY).font('Helvetica')
       .text(input.patientCode, col2 + 50, rowY);
    rowY += 18;

    if (input.patientDni || input.patientCuil) {
      if (input.patientDni) {
        doc.font('Helvetica-Bold').text('DNI:', col1, rowY).font('Helvetica')
           .text(input.patientDni, col1 + 30, rowY);
      }
      if (input.patientCuil) {
        doc.font('Helvetica-Bold').text('CUIL:', col2, rowY).font('Helvetica')
           .text(input.patientCuil, col2 + 38, rowY);
      }
      rowY += 18;
    }

    if (input.patientDob || input.patientSex) {
      if (input.patientDob) {
        doc.font('Helvetica-Bold').text('Fecha nac.:', col1, rowY).font('Helvetica')
           .text(formatDateStr(input.patientDob), col1 + 70, rowY);
      }
      if (input.patientSex) {
        doc.font('Helvetica-Bold').text('Sexo:', col2, rowY).font('Helvetica')
           .text(input.patientSex === 'M' ? 'Masculino' : input.patientSex === 'F' ? 'Femenino' : 'No especificado', col2 + 40, rowY);
      }
      rowY += 18;
    }

    if (input.healthInsurance) {
      doc.font('Helvetica-Bold').text('Cobertura:', col1, rowY).font('Helvetica')
         .text(input.healthInsurance + (input.healthInsurancePlan ? ` — Plan: ${input.healthInsurancePlan}` : ''), col1 + 65, rowY, { width: pageWidth - 70 });
      rowY += 18;
    }

    if (input.healthInsuranceMemberId) {
      doc.font('Helvetica-Bold').text('Nº afiliado:', col1, rowY).font('Helvetica')
         .text(input.healthInsuranceMemberId, col1 + 70, rowY);
      rowY += 18;
    }

    // ─── DATOS DEL ESTUDIO ────────────────────────────────────────────────────
    const studyY = boxY + patientBoxH + 6;
    const studyRows = 2 + (input.requestingDoctorName ? 1 : 0) + (input.insuranceOrderNumber ? 1 : 0);
    const studyBoxH = 20 + studyRows * 18;
    doc.rect(50, studyY, pageWidth, studyBoxH).fill('#e8f4fd');

    doc.fill(BRAND_COLOR).fontSize(9).font('Helvetica-Bold')
       .text('DATOS DEL ESTUDIO', 62, studyY + 10);

    doc.fill(TEXT_COLOR).fontSize(10).font('Helvetica');
    let sr = studyY + 24;

    doc.font('Helvetica-Bold').text('Descripción:', col1, sr).font('Helvetica')
       .text(input.studyDescription, col1 + 80, sr);
    if (input.studyModality) {
      doc.font('Helvetica-Bold').text('Modalidad:', col2, sr).font('Helvetica')
         .text(input.studyModality, col2 + 68, sr);
    }
    sr += 18;

    if (input.studyDate) {
      doc.font('Helvetica-Bold').text('Fecha estudio:', col1, sr).font('Helvetica')
         .text(formatDateStr(input.studyDate), col1 + 90, sr);
    }
    doc.font('Helvetica-Bold').text('Médico inf.:', col2, sr).font('Helvetica')
       .text(`Dr/a. ${input.doctorName}`, col2 + 72, sr);
    sr += 18;

    if (input.requestingDoctorName) {
      doc.font('Helvetica-Bold').text('Médico solic.:', col1, sr).font('Helvetica')
         .text(input.requestingDoctorName, col1 + 88, sr);
      sr += 18;
    }

    if (input.insuranceOrderNumber) {
      doc.font('Helvetica-Bold').text('Nº de orden:', col1, sr).font('Helvetica')
         .text(input.insuranceOrderNumber, col1 + 78, sr);
      sr += 18;
    }

    // ─── INDICACIÓN CLÍNICA ───────────────────────────────────────────────────
    const contentStart = studyY + studyBoxH + 8;
    doc.y = contentStart;

    if (input.clinicalIndication) {
      sectionTitle(doc, 'INDICACIÓN CLÍNICA', pageWidth);
      doc.fill(TEXT_COLOR).fontSize(10.5).font('Helvetica-Oblique')
         .text(stripHtml(input.clinicalIndication), { align: 'left', lineGap: 2 });
      doc.moveDown(1.2);
    }

    // ─── HALLAZGOS ────────────────────────────────────────────────────────────
    sectionTitle(doc, 'HALLAZGOS', pageWidth);
    doc.fill(TEXT_COLOR).fontSize(10.5).font('Helvetica')
       .text(stripHtml(input.findings), { align: 'justify', lineGap: 2 });
    doc.moveDown(1.2);

    // ─── CONCLUSIÓN ───────────────────────────────────────────────────────────
    sectionTitle(doc, 'CONCLUSIÓN', pageWidth);
    doc.fill(TEXT_COLOR).fontSize(10.5).font('Helvetica')
       .text(stripHtml(input.conclusion), { align: 'justify', lineGap: 2 });
    doc.moveDown(1.2);

    // ─── PUNTUACIONES ESTRUCTURADAS ───────────────────────────────────────────
    if (input.structuredScores) {
      const scores = input.structuredScores;
      const hasScores = scores.birads || scores.tirads || scores.pirads || scores.lirads || scores.chest;
      if (hasScores) {
        sectionTitle(doc, 'PUNTUACIONES ESTRUCTURADAS', pageWidth);

        if (scores.birads) {
          const b = scores.birads;
          doc.fill(ACCENT_COLOR).fontSize(10).font('Helvetica-Bold').text('BI-RADS ', { continued: true });
          doc.fill(TEXT_COLOR).font('Helvetica').text(`Categoría ${b.category}` +
            (b.density ? ` — Densidad: ${b.density}` : '') +
            (b.laterality ? ` — ${b.laterality}` : '') +
            (b.assessment ? ` — ${b.assessment}` : ''));
        }
        if (scores.tirads) {
          const t = scores.tirads;
          doc.fill(ACCENT_COLOR).fontSize(10).font('Helvetica-Bold').text('TI-RADS ', { continued: true });
          doc.fill(TEXT_COLOR).font('Helvetica').text(`Categoría ${t.category}` +
            (t.points != null ? ` (${t.points} pts)` : '') +
            (t.recommendation ? ` — ${t.recommendation}` : ''));
        }
        if (scores.pirads) {
          const p = scores.pirads;
          doc.fill(ACCENT_COLOR).fontSize(10).font('Helvetica-Bold').text('PI-RADS ', { continued: true });
          doc.fill(TEXT_COLOR).font('Helvetica').text(`Categoría ${p.category}` +
            (p.zone ? ` — Zona: ${p.zone}` : '') +
            (p.dcePositive != null ? ` — DCE: ${p.dcePositive ? 'positivo' : 'negativo'}` : '') +
            (p.assessment ? ` — ${p.assessment}` : ''));
        }
        if (scores.lirads) {
          const l = scores.lirads;
          doc.fill(ACCENT_COLOR).fontSize(10).font('Helvetica-Bold').text('LI-RADS ', { continued: true });
          doc.fill(TEXT_COLOR).font('Helvetica').text(`${l.category}` +
            (l.size ? ` — ${l.size} mm` : '') +
            (l.arterialEnhancement != null ? ` — Realce arterial: ${l.arterialEnhancement ? 'sí' : 'no'}` : '') +
            (l.assessment ? ` — ${l.assessment}` : ''));
        }
        if (scores.chest) {
          const c = scores.chest;
          const present: string[] = [];
          if (c.opacity) present.push('Opacidad');
          if (c.pleuralEffusion) present.push('Derrame pleural');
          if (c.pneumothorax) present.push('Neumotórax');
          if (c.cardiomegaly) present.push('Cardiomegalia');
          if (c.infiltrate) present.push('Infiltrado');
          if (c.consolidation) present.push('Consolidación');
          if (c.atelectasis) present.push('Atelectasia');
          doc.fill(ACCENT_COLOR).fontSize(10).font('Helvetica-Bold').text('Rx Tórax ', { continued: true });
          doc.fill(TEXT_COLOR).font('Helvetica').text(
            present.length ? present.join(', ') : 'Sin hallazgos patológicos'
          );
          if (c.findings) {
            doc.fill(SUBTITLE_COLOR).fontSize(9).font('Helvetica').text(`  ${c.findings}`);
          }
        }
        doc.moveDown(1.2);
      }
    }

    // ─── MEDICIONES ───────────────────────────────────────────────────────────
    if (input.measurements.length > 0) {
      sectionTitle(doc, 'MEDICIONES', pageWidth);
      input.measurements.forEach((m) => {
        doc.fill(ACCENT_COLOR).fontSize(10).font('Helvetica-Bold').text('▸ ', { continued: true });
        doc.fill(TEXT_COLOR).font('Helvetica').text(`${m.label}: `, { continued: true });
        doc.font('Helvetica-Bold').text(`${m.value} ${m.unit}`);
        // Show DICOM traceability reference when available
        if (m.sopInstanceUid) {
          const sopShort = m.sopInstanceUid.length > 24
            ? `${m.sopInstanceUid.slice(0, 24)}…`
            : m.sopInstanceUid;
          const ref = m.instanceNumber != null
            ? `Imagen ${m.instanceNumber}${m.frameIndex != null ? ` / frame ${m.frameIndex}` : ''} · SOP: ${sopShort}`
            : `SOP: ${sopShort}`;
          doc.fill(SUBTITLE_COLOR).fontSize(8).font('Helvetica').text(`   Ref: ${ref}`);
        }
      });
      doc.moveDown(1.2);
    }

    // ─── DOSIS DE RADIACIÓN ───────────────────────────────────────────────────
    if (input.radiationDose && (input.radiationDose.ctdiVol != null || input.radiationDose.dlp != null || input.radiationDose.effectiveDose != null)) {
      const rd = input.radiationDose;
      sectionTitle(doc, 'DOSIS DE RADIACIÓN', pageWidth);
      const doseY = doc.y;
      doc.rect(50, doseY, pageWidth, 30).fill('#f0f9ff');
      doc.fill('#075985').fontSize(9).font('Helvetica');
      const parts: string[] = [];
      if (rd.ctdiVol != null) parts.push(`CTDIvol: ${rd.ctdiVol.toFixed(2)} mGy`);
      if (rd.dlp != null) parts.push(`DLP: ${rd.dlp.toFixed(1)} mGy·cm`);
      if (rd.effectiveDose != null) parts.push(`Dosis efectiva: ${rd.effectiveDose.toFixed(3)} mSv`);
      doc.text(parts.join('   ·   '), 62, doseY + 10, { width: pageWidth - 24 });
      if (rd.source) {
        doc.fill(SUBTITLE_COLOR).fontSize(7.5).font('Helvetica-Oblique')
           .text(`Fuente: ${rd.source}`, 62, doseY + 22, { width: pageWidth - 24 });
      }
      doc.moveDown(2.2);
    }

    // ─── RESUMEN PARA EL PACIENTE ─────────────────────────────────────────────
    if (input.patientSummary) {
      const summaryText = stripHtml(input.patientSummary);
      sectionTitle(doc, 'RESUMEN PARA EL PACIENTE', pageWidth);
      doc.rect(50, doc.y, pageWidth, estimateTextHeight(summaryText, pageWidth) + 20).fill('#f0fdf4');
      doc.fill('#166534').fontSize(10).font('Helvetica-Oblique')
         .text(summaryText, 62, doc.y + 10, { width: pageWidth - 24, lineGap: 2 });
      doc.moveDown(1.5);
    }

    // ─── A3: ADDENDUM NOTICE — only shown on parent reports that have a correction ──
    if (input.addendumNotice) {
      doc.moveDown(0.5);
      const noticeY = doc.y;
      doc.rect(50, noticeY, pageWidth, 40).fill('#fef3c7');
      doc.fill('#92400e').fontSize(9).font('Helvetica-Bold')
         .text('⚠ AVISO:', 62, noticeY + 8);
      doc.fill('#78350f').fontSize(9).font('Helvetica')
         .text(input.addendumNotice, 62, noticeY + 22, { width: pageWidth - 24 });
      doc.moveDown(2.5);
    }

    // ─── A1: FIRMA ELECTRÓNICA SIMPLE DISCLAIMER ──────────────────────────────
    // ANMAT Disposición 7304/2012 / Ley 25.506 compliance note.
    // TODO (long-term): Replace with PKCS#7/CMS digital signature using X.509
    // certificates issued by an Argentine government-recognised CA (AFIP, OCA).
    doc.moveDown(0.5);
    const disclaimerY = doc.y;
    doc.rect(50, disclaimerY, pageWidth, 28).fill('#f1f5f9');
    doc.fill('#475569').fontSize(7.5).font('Helvetica-Oblique')
       .text(
         'FIRMA ELECTRÓNICA SIMPLE — Este informe no constituye firma digital con validez legal plena ' +
         'según Ley 25.506. Válido únicamente para uso interno y como registro clínico preliminar.',
         62, disclaimerY + 8, { width: pageWidth - 24, lineGap: 1.5 }
       );
    doc.moveDown(2);

    // ─── FIRMA DEL MÉDICO ─────────────────────────────────────────────────────
    doc.moveDown(2);
    const sigY = doc.y;
    const sigBoxH = 60 + (input.doctorLicense ? 12 : 0) + (input.doctorSpecialty ? 12 : 0);
    const sigBoxX = qrBuffer ? col2 - 10 : col2 - 10;
    const sigBoxW = qrBuffer ? 160 : 200;
    doc.rect(sigBoxX, sigY, sigBoxW, sigBoxH).fill(LIGHT_GRAY);
    let sigTextY = sigY + 8;
    doc.fill(BRAND_COLOR).fontSize(10).font('Helvetica-Bold')
       .text(`Dr/a. ${input.doctorName}`, sigBoxX + 4, sigTextY, { width: sigBoxW - 8, align: 'center' });
    sigTextY += 14;
    if (input.doctorSpecialty) {
      doc.fill(SUBTITLE_COLOR).fontSize(8).font('Helvetica')
         .text(input.doctorSpecialty, sigBoxX + 4, sigTextY, { width: sigBoxW - 8, align: 'center' });
      sigTextY += 12;
    }
    if (input.doctorLicense) {
      doc.fill(SUBTITLE_COLOR).fontSize(8).font('Helvetica')
         .text(`Mat. ${input.doctorLicense}`, sigBoxX + 4, sigTextY, { width: sigBoxW - 8, align: 'center' });
      sigTextY += 12;
    }
    doc.fill(SUBTITLE_COLOR).fontSize(8).font('Helvetica')
       .text('Médico informante', sigBoxX + 4, sigTextY, { width: sigBoxW - 8, align: 'center' });
    sigTextY += 12;
    doc.fill(SUBTITLE_COLOR).fontSize(8)
       .text(`Firmado: ${formatDate(new Date())}`, sigBoxX + 4, sigTextY, { width: sigBoxW - 8, align: 'center' });

    // ─── QR de verificación ────────────────────────────────────────────────────
    if (qrBuffer) {
      try {
        doc.image(qrBuffer, col1, sigY, { width: 80, height: 80 });
        doc.fill(SUBTITLE_COLOR).fontSize(7).font('Helvetica')
           .text('Verificar autenticidad', col1, sigY + 82, { width: 80, align: 'center' });
      } catch {
        // Non-fatal: QR image embedding failure
      }
    }

    // ─── DISCLAIMER IA — only shown when AI was actually used ────────────────
    if (input.aiUsed) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8fafc');
      doc.rect(50, 50, pageWidth, 80).fill('#fef9c3');
      doc.fill('#854d0e').fontSize(9).font('Helvetica-Bold')
         .text('⚠ NOTA SOBRE ASISTENCIA DE INTELIGENCIA ARTIFICIAL', 65, 65);
      doc.fill('#713f12').fontSize(8.5).font('Helvetica')
         .text(
           'Este informe utilizó herramientas de asistencia editorial basadas en inteligencia artificial. ' +
           'Dichas herramientas asisten en la redacción y estructuración del texto únicamente. ' +
           'La validación clínica, los hallazgos, la conclusión diagnóstica y la firma son de exclusiva responsabilidad ' +
           'del médico informante. La IA no genera diagnósticos automáticos ni reemplaza el criterio médico profesional.',
           65, 82, { width: pageWidth - 30, lineGap: 1.5 }
         );
    }

    // ─── FOOTER ───────────────────────────────────────────────────────────────
    addFooter(doc, pageWidth, input.verifyUrl);

    doc.end();
  });

  return toRelativePath(absoluteOutput);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, pageWidth: number) {
  doc.rect(50, doc.y, pageWidth, 18).fill(BRAND_COLOR);
  doc.fill('#ffffff').fontSize(9).font('Helvetica-Bold')
     .text(title, 58, doc.y - 14);
  doc.moveDown(0.6);
  doc.fill(TEXT_COLOR);
}

function addFooter(doc: PDFKit.PDFDocument, pageWidth: number, verifyUrl?: string) {
  const y = doc.page.height - 50;
  doc.rect(0, y, doc.page.width, 50).fill(BRAND_COLOR);
  doc.fill('rgba(255,255,255,0.7)').fontSize(7.5).font('Helvetica')
     .text('Documento generado electrónicamente. Conservar junto con el historial clínico del paciente.', 50, y + 10, { width: pageWidth, align: 'center' });
  if (verifyUrl) {
    doc.fill('rgba(255,255,255,0.6)').fontSize(7)
       .text(`Verificar autenticidad: ${verifyUrl}`, 50, y + 22, { width: pageWidth, align: 'center' });
  } else {
    doc.fill('rgba(255,255,255,0.5)').fontSize(7)
       .text('Este documento es confidencial y de uso exclusivo del paciente y profesionales autorizados.', 50, y + 24, { width: pageWidth, align: 'center' });
  }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateStr(s: string): string {
  return new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * B5: Estimates the rendered height of a block of text in the PDF.
 *
 * Improvement over the basic heuristic: accounts for explicit line breaks,
 * word-wrap at the given column width (assuming ~6px average char width for
 * 10pt Helvetica), and a configurable line-height multiplier.
 *
 * @param text        - Plain text (no HTML) to estimate height for
 * @param columnWidth - Available width in PDF points (default 450 for A4 with margins)
 * @param fontSize    - Font size in points (default 10)
 * @param lineHeight  - Line height multiplier (default 1.4)
 */
function estimateTextHeight(text: string, columnWidth = 450, fontSize = 10, lineHeight = 1.4): number {
  const avgCharWidth = fontSize * 0.55; // approximate for Helvetica
  const charsPerLine = Math.max(1, Math.floor(columnWidth / avgCharWidth));
  const lineHeightPx = fontSize * lineHeight;

  let totalLines = 0;
  for (const paragraph of text.split('\n')) {
    // Each paragraph wraps independently; empty paragraphs count as one blank line
    const wrappedLines = Math.max(1, Math.ceil(paragraph.length / charsPerLine));
    totalLines += wrappedLines;
  }

  return Math.ceil(totalLines * lineHeightPx);
}

/** Strip HTML tags from rich-text content before inserting into PDF.
 *
 * Security note: this function produces plain text for PDFKit — it is NOT
 * an HTML sanitizer for rendering. The output is never interpreted as HTML.
 * The stripping is defensive-in-depth: the primary XSS defense for stored
 * content is DOMPurify in the RichTextEditor on the client side.
 */
export function stripHtml(html: string): string {
  return html
    // Remove script blocks: match opening tag + any content + closing tag.
    // Use a permissive closing-tag pattern to handle `</script >` variants.
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
    // Normalize block-level elements to newlines before stripping tags
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    // Strip all remaining HTML tags (angle-bracket content)
    .replace(/<[^>]*>/g, '')
    // Decode HTML entities (order: named before &amp; to avoid double decode)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    // Collapse excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
