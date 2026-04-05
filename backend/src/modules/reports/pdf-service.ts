import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { pdfStoragePath, toRelativePath } from '../../storage/file-storage.js';

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
  findings: string;
  conclusion: string;
  patientSummary?: string;
  measurements: Array<{ label: string; value: number; unit: string }>;
}

const BRAND_COLOR = '#1e3a5f';
const ACCENT_COLOR = '#2563eb';
const LIGHT_GRAY = '#f1f5f9';
const TEXT_COLOR = '#1e293b';
const SUBTITLE_COLOR = '#64748b';

export async function generateClinicalPdf(input: PdfInput): Promise<string> {
  const dir = pdfStoragePath();
  const absoluteOutput = path.join(dir, `${input.reportId}.pdf`);

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

    // ─── DATOS DEL PACIENTE ───────────────────────────────────────────────────
    const boxY = 110;
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

    // ─── SEPARADOR ────────────────────────────────────────────────────────────
    const contentStart = studyY + studyBoxH + 8;
    doc.y = contentStart;

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

    // ─── MEDICIONES ───────────────────────────────────────────────────────────
    if (input.measurements.length > 0) {
      sectionTitle(doc, 'MEDICIONES', pageWidth);
      input.measurements.forEach((m) => {
        doc.fill(ACCENT_COLOR).fontSize(10).font('Helvetica-Bold').text('▸ ', { continued: true });
        doc.fill(TEXT_COLOR).font('Helvetica').text(`${m.label}: `, { continued: true });
        doc.font('Helvetica-Bold').text(`${m.value} ${m.unit}`);
      });
      doc.moveDown(1.2);
    }

    // ─── RESUMEN PARA EL PACIENTE ─────────────────────────────────────────────
    if (input.patientSummary) {
      const summaryText = stripHtml(input.patientSummary);
      sectionTitle(doc, 'RESUMEN PARA EL PACIENTE', pageWidth);
      doc.rect(50, doc.y, pageWidth, estimateTextHeight(summaryText) + 20).fill('#f0fdf4');
      doc.fill('#166534').fontSize(10).font('Helvetica-Oblique')
         .text(summaryText, 62, doc.y + 10, { width: pageWidth - 24, lineGap: 2 });
      doc.moveDown(1.5);
    }

    // ─── FIRMA DEL MÉDICO ─────────────────────────────────────────────────────
    doc.moveDown(2);
    const sigY = doc.y;
    const sigBoxH = 60 + (input.doctorLicense ? 12 : 0) + (input.doctorSpecialty ? 12 : 0);
    doc.rect(col2 - 10, sigY, 200, sigBoxH).fill(LIGHT_GRAY);
    let sigTextY = sigY + 8;
    doc.fill(BRAND_COLOR).fontSize(10).font('Helvetica-Bold')
       .text(`Dr/a. ${input.doctorName}`, col2, sigTextY, { width: 180, align: 'center' });
    sigTextY += 14;
    if (input.doctorSpecialty) {
      doc.fill(SUBTITLE_COLOR).fontSize(8).font('Helvetica')
         .text(input.doctorSpecialty, col2, sigTextY, { width: 180, align: 'center' });
      sigTextY += 12;
    }
    if (input.doctorLicense) {
      doc.fill(SUBTITLE_COLOR).fontSize(8).font('Helvetica')
         .text(`Mat. ${input.doctorLicense}`, col2, sigTextY, { width: 180, align: 'center' });
      sigTextY += 12;
    }
    doc.fill(SUBTITLE_COLOR).fontSize(8).font('Helvetica')
       .text('Médico informante', col2, sigTextY, { width: 180, align: 'center' });
    sigTextY += 12;
    doc.fill(SUBTITLE_COLOR).fontSize(8)
       .text(`Firmado: ${formatDate(new Date())}`, col2, sigTextY, { width: 180, align: 'center' });

    // ─── DISCLAIMER IA ────────────────────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8fafc');
    doc.rect(50, 50, pageWidth, 80).fill('#fef9c3');
    doc.fill('#854d0e').fontSize(9).font('Helvetica-Bold')
       .text('⚠ NOTA SOBRE ASISTENCIA DE INTELIGENCIA ARTIFICIAL', 65, 65);
    doc.fill('#713f12').fontSize(8.5).font('Helvetica')
       .text(
         'Este informe puede haber utilizado herramientas de asistencia editorial basadas en inteligencia artificial. ' +
         'Dichas herramientas asisten en la redacción y estructuración del texto únicamente. ' +
         'La validación clínica, los hallazgos, la conclusión diagnóstica y la firma son de exclusiva responsabilidad ' +
         'del médico informante. La IA no genera diagnósticos automáticos ni reemplaza el criterio médico profesional.',
         65, 82, { width: pageWidth - 30, lineGap: 1.5 }
       );

    // ─── FOOTER ───────────────────────────────────────────────────────────────
    addFooter(doc, pageWidth);

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

function addFooter(doc: PDFKit.PDFDocument, pageWidth: number) {
  const y = doc.page.height - 50;
  doc.rect(0, y, doc.page.width, 50).fill(BRAND_COLOR);
  doc.fill('rgba(255,255,255,0.7)').fontSize(7.5).font('Helvetica')
     .text('Documento generado electrónicamente. Válido sin firma manuscrita con autenticación digital.', 50, y + 10, { width: pageWidth, align: 'center' });
  doc.fill('rgba(255,255,255,0.5)').fontSize(7)
     .text('Este documento es confidencial y de uso exclusivo del paciente y profesionales autorizados.', 50, y + 24, { width: pageWidth, align: 'center' });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateStr(s: string): string {
  return new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function estimateTextHeight(text: string): number {
  return Math.ceil(text.length / 90) * 13;
}

/** Strip HTML tags from rich-text content before inserting into PDF */
export function stripHtml(html: string): string {
  return html
    // Remove script and style blocks entirely (content + tags)
    .replace(/<script\b[^]*?<\/script>/gi, '')
    .replace(/<style\b[^]*?<\/style>/gi, '')
    // Normalize block-level elements to newlines before stripping tags
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    // Strip remaining tags
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
