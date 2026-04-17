/**
 * AI-assisted report tools
 *
 * ⚠️  HIPAA / ANMAT COMPLIANCE WARNING:
 *     Sending PHI to external AI APIs (OpenAI, etc.) requires a signed
 *     Business Associate Agreement (BAA) with the provider.
 *     See: https://openai.com/enterprise-privacy
 *
 *     This module applies best-effort PHI scrubbing (scrubPhiFromText) before
 *     all external API calls. However, scrubbing is NOT a substitute for a BAA.
 *
 *     If OPENAI_API_KEY is not configured, the system falls back to local
 *     rule-based templates that never transmit data externally.
 */

import { Router } from 'express';
import { z } from 'zod';
import OpenAI from 'openai';
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth.js';
import { logAudit } from '../../middleware/audit.js';
import { env } from '../../config/env.js';
import { scrubPhiFromText } from '../../utils/security.js';

export const aiRouter = Router();
aiRouter.use(requireAuth as any, requireRole('DOCTOR', 'ADMIN') as any);

function getOpenAI(): OpenAI | null {
  if (!env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

const suggestSchema = z.object({ notes: z.string().min(3).max(2000) });
const summarySchema = z.object({ conclusion: z.string().min(10).max(2000) });
const consistencySchema = z.object({
  findings: z.string().min(5).max(5000),
  conclusion: z.string().min(5).max(2000),
  modality: z.string().optional()
});

aiRouter.post('/suggest-report', async (req: any, res: any) => {
  const parsed = suggestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Notas inválidas' });
  const { notes } = parsed.data;

  // Audit: AI suggestion requested
  await logAudit(req, 'AI_SUGGESTION_REQUESTED', 'AI', undefined, {
    section: 'suggest-report',
    model: env.OPENAI_API_KEY ? env.OPENAI_MODEL : 'local-template'
  });

  const openai = getOpenAI();
  if (openai) {
    try {
      // HIPAA: scrub PHI before sending to external API
      const safeNotes = scrubPhiFromText(notes);
      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'Eres un radiólogo médico experimentado. Redacta informes clínicos en español formal. Responde SOLO con JSON válido con claves "findings" y "conclusion".' },
          { role: 'user', content: `Notas clínicas: "${safeNotes}"\n\nGenera hallazgos radiológicos detallados y una conclusión clínica. Responde solo con JSON: {"findings":"...","conclusion":"..."}` }
        ],
        temperature: 0.3,
        max_tokens: 800
      });
      const content = completion.choices[0]?.message?.content ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return res.json({
          findings: result.findings ?? '',
          conclusion: result.conclusion ?? '',
          disclaimer: 'Generado por IA (GPT). El médico debe validar, corregir y firmar el informe.',
          confidence: 'medium',
          model: env.OPENAI_MODEL
        });
      }
    } catch (err) {
      console.error('[AI/suggest-report] OpenAI error, usando fallback:', err);
    }
  }

  // Fallback template
  const lower = notes.toLowerCase();
  return res.json({
    findings: buildFindings(lower, notes),
    conclusion: buildConclusion(lower),
    disclaimer: 'Sugerencia editorial automática. El médico debe validar, corregir y firmar el informe.',
    confidence: 'low',
    model: 'local-template'
  });
});

aiRouter.post('/patient-summary', async (req: any, res: any) => {
  const parsed = summarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Conclusión inválida' });
  const { conclusion } = parsed.data;

  await logAudit(req, 'AI_SUGGESTION_REQUESTED', 'AI', undefined, {
    section: 'patient-summary',
    model: env.OPENAI_API_KEY ? env.OPENAI_MODEL : 'local-template'
  });

  const openai = getOpenAI();
  if (openai) {
    try {
      // HIPAA: scrub PHI before sending to external API
      const safeConclusion = scrubPhiFromText(conclusion);
      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'Eres un asistente médico que traduce conclusiones técnicas a lenguaje sencillo para pacientes. Responde en español, máximo 3 oraciones, sin tecnicismos.' },
          { role: 'user', content: `Conclusión médica técnica: "${safeConclusion}"\n\nReescribe esto en lenguaje simple para el paciente.` }
        ],
        temperature: 0.4,
        max_tokens: 200
      });
      const patientSummary = completion.choices[0]?.message?.content?.trim() ?? '';
      if (patientSummary) {
        return res.json({
          patientSummary,
          disclaimer: 'Resumen generado por IA. Consulte con su médico para interpretación completa.',
          model: env.OPENAI_MODEL
        });
      }
    } catch (err) {
      console.error('[AI/patient-summary] OpenAI error, usando fallback:', err);
    }
  }

  return res.json({
    patientSummary: buildPatientSummary(conclusion),
    disclaimer: 'Resumen orientativo para el paciente. Consulte con su médico.',
    model: 'local-template'
  });
});

aiRouter.post('/check-consistency', async (req: any, res: any) => {
  const parsed = consistencySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' });
  const { findings, conclusion, modality } = parsed.data;

  await logAudit(req, 'AI_CONSISTENCY_CHECK', 'AI', undefined, {
    modality,
    model: env.OPENAI_API_KEY ? env.OPENAI_MODEL : 'local-rules'
  });

  const openai = getOpenAI();
  if (openai) {
    try {
      // HIPAA: scrub PHI before sending to external API
      const safeFindings   = scrubPhiFromText(findings);
      const safeConclusion = scrubPhiFromText(conclusion);
      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'Eres un revisor de calidad de informes radiológicos. Responde SOLO con JSON: {"warnings":["..."],"ok":true/false}' },
          { role: 'user', content: `Modalidad: ${modality ?? 'desconocida'}\nHallazgos: "${safeFindings}"\nConclusión: "${safeConclusion}"\n\nIdentifica inconsistencias, omisiones importantes o problemas de calidad. Si todo está bien, devuelve warnings:[].` }
        ],
        temperature: 0.2,
        max_tokens: 300
      });
      const content = completion.choices[0]?.message?.content ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return res.json({
          warnings: result.warnings ?? [],
          ok: result.ok ?? result.warnings?.length === 0,
          disclaimer: 'Revisión asistida por IA. No garantiza calidad diagnóstica completa.',
          model: env.OPENAI_MODEL
        });
      }
    } catch (err) {
      console.error('[AI/check-consistency] OpenAI error, usando fallback:', err);
    }
  }

  // Fallback rule-based
  const warnings: string[] = [];
  if (conclusion.length < 30) warnings.push('La conclusión parece muy breve para un informe completo.');
  if (findings.length < 50) warnings.push('Los hallazgos parecen incompletos. Considere ampliar la descripción.');
  if (!conclusion.toLowerCase().includes('correlaci') && !conclusion.toLowerCase().includes('clínica')) {
    warnings.push('Se recomienda incluir indicación de correlación clínica en la conclusión.');
  }
  if (modality === 'RM' && !findings.toLowerCase().includes('señal') && !findings.toLowerCase().includes('intensidad')) {
    warnings.push('En RM es habitual describir señal e intensidad en los hallazgos.');
  }
  return res.json({ warnings, ok: warnings.length === 0, disclaimer: 'Revisión automática básica.', model: 'local-rules' });
});

// ─── Helpers template ────────────────────────────────────────────────────────
function buildFindings(lower: string, original: string): string {
  if (lower.includes('normal') || lower.includes('sin lesión') || lower.includes('sin hallazgo')) {
    return 'El estudio no evidencia alteraciones estructurales significativas en los planos evaluados. No se identifican lesiones focales, masas ni colecciones patológicas.';
  }
  const parts = [`Se describe el siguiente hallazgo clínico referenciado: "${original.slice(0, 120)}${original.length > 120 ? '...' : ''}".`];
  if (lower.includes('fractura')) parts.push('Se evalúa la continuidad cortical en busca de soluciones de continuidad ósea.');
  if (lower.includes('tumor') || lower.includes('masa') || lower.includes('nódulo')) {
    parts.push('Se identifica imagen compatible con lesión focal. Se describe localización, dimensiones y características.');
  }
  if (parts.length < 2) parts.push('Los hallazgos observados se describen en detalle. El médico debe completar la descripción semiológica específica.');
  return parts.join(' ');
}

function buildConclusion(lower: string): string {
  if (lower.includes('normal') || lower.includes('sin lesión')) return 'Estudio dentro de parámetros normales. No se identifican hallazgos patológicos. Correlacionar con la clínica.';
  if (lower.includes('fractura')) return 'Imágenes compatibles con compromiso de la integridad estructural ósea. Se recomienda evaluación ortopédica y correlación clínica.';
  if (lower.includes('tumor') || lower.includes('masa') || lower.includes('nódulo')) return 'Se identifica imagen focal que requiere caracterización adicional. Se sugiere seguimiento y evaluación multidisciplinaria.';
  return 'Los hallazgos requieren correlación con la presentación clínica. Se recomienda seguimiento según criterio médico.';
}

function buildPatientSummary(conclusion: string): string {
  const lower = conclusion.toLowerCase();
  if (lower.includes('normal') || lower.includes('parámetros normales')) return 'Sus imágenes fueron evaluadas y no se encontraron alteraciones relevantes. Consulte con su médico para una explicación personalizada.';
  if (lower.includes('seguimiento') || lower.includes('control')) return 'El médico encontró algo que requiere seguimiento. Consulte con su médico para entender los pasos a seguir.';
  return `El médico evaluó sus imágenes. En términos generales: ${conclusion.slice(0, 200)}. Consulte con su médico para la interpretación completa.`;
}
