import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const aiRouter = Router();
aiRouter.use(requireAuth, requireRole('DOCTOR', 'ADMIN'));

aiRouter.post('/suggest-report', (req, res) => {
  const { notes } = req.body as { notes: string };
  const findings = `Se describen hallazgos compatibles con: ${notes || 'sin hallazgos relevantes reportados'}.`;
  const conclusion = 'Correlacionar con clínica. No se identifican signos de urgencia en este borrador asistido.';
  res.json({ findings, conclusion, disclaimer: 'Asistencia editorial: no genera diagnóstico automático.' });
});

aiRouter.post('/patient-summary', (req, res) => {
  const { conclusion } = req.body as { conclusion: string };
  res.json({
    patientSummary: `Resumen en lenguaje simple: ${conclusion}. Consulte a su médico para interpretar el resultado en contexto.`
  });
});
