import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const aiRouter = Router();
aiRouter.use(requireAuth as any, requireRole('DOCTOR', 'ADMIN') as any);

const suggestSchema = z.object({
  notes: z.string().min(3).max(2000)
});

const summarySchema = z.object({
  conclusion: z.string().min(10).max(2000)
});

const consistencySchema = z.object({
  findings: z.string().min(5).max(5000),
  conclusion: z.string().min(5).max(2000),
  modality: z.string().optional()
});

/**
 * Sugerencia de redacción a partir de notas clínicas.
 * En esta versión usa plantillas inteligentes basadas en palabras clave.
 * Sustituible por un LLM real sin cambiar la interfaz.
 */
aiRouter.post('/suggest-report', (req, res) => {
  const parsed = suggestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Notas inválidas' });

  const { notes } = parsed.data;
  const lower = notes.toLowerCase();

  const findings = buildFindings(lower, notes);
  const conclusion = buildConclusion(lower);

  return res.json({
    findings,
    conclusion,
    disclaimer: 'Sugerencia editorial automática. El médico debe validar, corregir y firmar el informe. No constituye diagnóstico automatizado.',
    confidence: 'low'
  });
});

/**
 * Resumen en lenguaje sencillo para el paciente.
 */
aiRouter.post('/patient-summary', (req, res) => {
  const parsed = summarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Conclusión inválida' });

  const { conclusion } = parsed.data;

  const patientSummary = buildPatientSummary(conclusion);

  return res.json({
    patientSummary,
    disclaimer: 'Resumen orientativo para el paciente. Consulte con su médico para la interpretación completa.'
  });
});

/**
 * Revisión básica de consistencia entre hallazgos y conclusión.
 */
aiRouter.post('/check-consistency', (req, res) => {
  const parsed = consistencySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' });

  const { findings, conclusion, modality } = parsed.data;
  const warnings: string[] = [];

  if (conclusion.length < 30) {
    warnings.push('La conclusión parece muy breve para un informe completo.');
  }
  if (findings.length < 50) {
    warnings.push('Los hallazgos parecen incompletos. Considere ampliar la descripción.');
  }
  if (!conclusion.toLowerCase().includes('correlaci') && !conclusion.toLowerCase().includes('clínica')) {
    warnings.push('Se recomienda incluir indicación de correlación clínica en la conclusión.');
  }
  if (modality === 'RM' && !findings.toLowerCase().includes('señal') && !findings.toLowerCase().includes('intensidad')) {
    warnings.push('En RM es habitual describir señal e intensidad en los hallazgos.');
  }
  if (modality === 'RX' && !findings.toLowerCase().includes('densidad') && !findings.toLowerCase().includes('radio')) {
    warnings.push('En radiología convencional es útil describir la densidad radiológica.');
  }

  return res.json({
    warnings,
    ok: warnings.length === 0,
    disclaimer: 'Revisión automática básica. No garantiza calidad diagnóstica completa.'
  });
});

// ─── Helpers de generación de texto ──────────────────────────────────────────

function buildFindings(lower: string, original: string): string {
  const parts: string[] = [];

  if (lower.includes('normal') || lower.includes('sin lesión') || lower.includes('sin hallazgo')) {
    parts.push('El estudio no evidencia alteraciones estructurales significativas en los planos evaluados.');
    parts.push('No se identifican lesiones focales, masas ni colecciones patológicas.');
    return parts.join(' ');
  }

  parts.push(`Se describe el siguiente hallazgo clínico referenciado: "${original.slice(0, 120)}${original.length > 120 ? '...' : ''}".`);

  if (lower.includes('dolor')) parts.push('El área de interés clínico referida por el paciente es evaluada en el contexto imagenológico.');
  if (lower.includes('fractura')) parts.push('Se evalúa la continuidad cortical en busca de soluciones de continuidad ósea.');
  if (lower.includes('tumor') || lower.includes('masa') || lower.includes('nódulo')) {
    parts.push('Se identifica imagen compatible con lesión focal. Se describe su localización, dimensiones aproximadas y características de señal/densidad.');
  }
  if (lower.includes('derrame') || lower.includes('líquido')) parts.push('Se evidencia presencia de señal compatible con colección líquida en el espacio evaluado.');

  if (parts.length < 2) {
    parts.push('Los hallazgos observados se describen en detalle a continuación. El médico debe completar la descripción semiológica específica según su análisis.');
  }

  return parts.join(' ');
}

function buildConclusion(lower: string): string {
  if (lower.includes('normal') || lower.includes('sin lesión') || lower.includes('sin hallazgo')) {
    return 'Estudio dentro de parámetros normales para la edad y técnica empleada. No se identifican hallazgos patológicos de relevancia. Correlacionar con la clínica.';
  }
  if (lower.includes('fractura')) {
    return 'Imágenes compatibles con compromiso de la integridad estructural ósea. Se recomienda evaluación ortopédica especializada y correlación con el cuadro clínico.';
  }
  if (lower.includes('tumor') || lower.includes('masa') || lower.includes('nódulo')) {
    return 'Se identifica imagen focal que requiere caracterización adicional. Se sugiere seguimiento con estudios complementarios y evaluación multidisciplinaria. Correlacionar con clínica.';
  }
  return 'Los hallazgos observados requieren correlación con la presentación clínica del paciente. Se recomienda seguimiento según criterio del médico tratante.';
}

function buildPatientSummary(conclusion: string): string {
  const lower = conclusion.toLowerCase();

  if (lower.includes('normal') || lower.includes('parámetros normales') || lower.includes('sin hallazgos')) {
    return 'Sus imágenes fueron evaluadas por el médico y no se encontraron alteraciones relevantes. El resultado es normal. Recuerde consultar con su médico para una explicación personalizada.';
  }
  if (lower.includes('seguimiento') || lower.includes('control')) {
    return 'El médico encontró algo que requiere seguimiento o un estudio adicional. Esto no significa necesariamente algo grave. Consulte con su médico para entender los pasos a seguir.';
  }
  return `El médico evaluó sus imágenes. En términos generales: ${conclusion.slice(0, 200)}. Recuerde que este resumen es orientativo. Consulte con su médico para la interpretación completa de su estudio.`;
}
