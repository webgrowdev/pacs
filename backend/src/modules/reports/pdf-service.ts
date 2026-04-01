import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { pdfStoragePath } from '../../storage/file-storage.js';

export async function generateClinicalPdf(input: {
  reportId: string;
  patientName: string;
  patientCode: string;
  studyDescription: string;
  doctorName: string;
  findings: string;
  conclusion: string;
  measurements: Array<{ label: string; value: number; unit: string }>;
}) {
  const dir = pdfStoragePath();
  const output = path.join(dir, `${input.reportId}.pdf`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(output));
  doc.fontSize(18).text('Informe de Diagnóstico por Imágenes', { align: 'center' });
  doc.moveDown();
  doc.fontSize(11).text(`Paciente: ${input.patientName} (${input.patientCode})`);
  doc.text(`Estudio: ${input.studyDescription}`);
  doc.text(`Médico informante: ${input.doctorName}`);
  doc.text(`Fecha: ${new Date().toLocaleString('es-AR')}`);
  doc.moveDown();
  doc.fontSize(13).text('Hallazgos');
  doc.fontSize(11).text(input.findings);
  doc.moveDown();
  doc.fontSize(13).text('Conclusión');
  doc.fontSize(11).text(input.conclusion);
  doc.moveDown();
  if (input.measurements.length) {
    doc.fontSize(13).text('Mediciones');
    input.measurements.forEach((m) => doc.fontSize(11).text(`• ${m.label}: ${m.value} ${m.unit}`));
  }
  doc.moveDown();
  doc.fontSize(10).text('Asistencia IA: este informe puede contener sugerencias editoriales automáticas.');
  doc.text('No reemplaza el criterio médico ni constituye diagnóstico automatizado.');
  doc.end();

  return output;
}
