import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from '../../components/AppLayout';
import { api, getFilesBaseUrl } from '../../lib/api';
import { DicomViewer } from './DicomViewer';
import { useAuth } from '../../lib/auth';

interface Measurement {
  id?: string;
  type: string;
  label: string;
  value: number;
  unit: string;
}

interface Report {
  id: string;
  status: string;
  findings: string;
  conclusion: string;
  patientSummary?: string;
  measurements: Measurement[];
  finalizedAt?: string;
  pdfPath?: string;
  doctor: { firstName: string; lastName: string };
}

interface Study {
  id: string;
  modality: string;
  studyDate: string;
  description?: string;
  status: string;
  patient: { firstName: string; lastName: string; internalCode: string; documentId: string; dateOfBirth: string; sex: string };
  dicomFiles: Array<{ id: string; fileName: string; filePath: string }>;
  reports: Report[];
  assignedDoctor?: { firstName: string; lastName: string } | null;
}

export function StudyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [study, setStudy] = useState<Study | null>(null);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<Report | null>(null);

  // Form state
  const [findings, setFindings] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [patientSummary, setPatientSummary] = useState('');
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [newMeasLabel, setNewMeasLabel] = useState('');
  const [newMeasValue, setNewMeasValue] = useState('');
  const [newMeasUnit, setNewMeasUnit] = useState('mm');

  // UI state
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [consistencyLoading, setConsistencyLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [aiDisclaimer, setAiDisclaimer] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showAiPanel, setShowAiPanel] = useState(false);

  const loadStudy = useCallback(async () => {
    try {
      const { data } = await api.get(`/studies/${id}`);
      setStudy(data);
      const r: Report | undefined = data.reports?.[0];
      if (r) {
        setReport(r);
        setFindings(r.findings || '');
        setConclusion(r.conclusion || '');
        setPatientSummary(r.patientSummary || '');
        setMeasurements(r.measurements || []);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Error al cargar el estudio' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadStudy(); }, [loadStudy]);

  const isFinalized = report?.status === 'FINAL' || report?.status === 'SIGNED';

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const saveDraft = async () => {
    if (!study) return;
    setSaving(true);
    try {
      const payload = { studyId: study.id, findings, conclusion, patientSummary: patientSummary || undefined, measurements };
      if (report) {
        await api.put(`/reports/${report.id}`, payload);
        showMessage('success', 'Borrador guardado correctamente');
      } else {
        const { data } = await api.post('/reports', payload);
        setReport(data);
        showMessage('success', 'Borrador creado correctamente');
      }
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al guardar borrador');
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!report) return showMessage('error', 'Primero guarde el borrador');
    if (!window.confirm('¿Confirma que desea finalizar y generar el PDF? Esta acción no puede revertirse.')) return;
    setFinalizing(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/finalize`);
      setReport(data);
      showMessage('success', 'Informe finalizado. PDF generado correctamente.');
      loadStudy();
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al finalizar informe');
    } finally {
      setFinalizing(false);
    }
  };

  const suggestAI = async () => {
    setAiLoading(true);
    setWarnings([]);
    try {
      const { data } = await api.post('/ai/suggest-report', { notes: findings || 'estudio de rutina' });
      setFindings(data.findings);
      setConclusion(data.conclusion);
      setAiDisclaimer(data.disclaimer);
      setShowAiPanel(true);
    } catch {
      showMessage('error', 'Error al obtener sugerencia de IA');
    } finally {
      setAiLoading(false);
    }
  };

  const generatePatientSummary = async () => {
    if (!conclusion) return showMessage('error', 'Escriba primero la conclusión');
    setSummaryLoading(true);
    try {
      const { data } = await api.post('/ai/patient-summary', { conclusion });
      setPatientSummary(data.patientSummary);
    } catch {
      showMessage('error', 'Error al generar resumen para paciente');
    } finally {
      setSummaryLoading(false);
    }
  };

  const checkConsistency = async () => {
    if (!findings || !conclusion) return showMessage('error', 'Complete hallazgos y conclusión primero');
    setConsistencyLoading(true);
    try {
      const { data } = await api.post('/ai/check-consistency', { findings, conclusion, modality: study?.modality });
      setWarnings(data.warnings);
      setShowAiPanel(true);
    } catch {
      showMessage('error', 'Error al revisar consistencia');
    } finally {
      setConsistencyLoading(false);
    }
  };

  const addMeasurement = () => {
    if (!newMeasLabel || !newMeasValue) return;
    setMeasurements((prev) => [...prev, { type: 'LINEAR', label: newMeasLabel, value: Number(newMeasValue), unit: newMeasUnit }]);
    setNewMeasLabel('');
    setNewMeasValue('');
  };

  const removeMeasurement = (i: number) => setMeasurements((prev) => prev.filter((_, idx) => idx !== i));

  const filesBase = getFilesBaseUrl();
  const dicomUrls = study?.dicomFiles.map((f) => `${filesBase}/dicom/${study.id}/${f.fileName}`) ?? [];

  if (loading) {
    return (
      <AppLayout title="Cargando estudio...">
        <div className="loading-screen" style={{ position: 'relative', height: 400 }}>
          <div className="spinner" />
        </div>
      </AppLayout>
    );
  }

  if (!study) {
    return (
      <AppLayout title="Estudio no encontrado">
        <div className="empty-state">
          <div className="empty-desc">El estudio no existe o no tiene permisos para verlo.</div>
          <Link to="/studies" className="btn btn-secondary mt-4">Volver a estudios</Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title={`${study.modality} — ${study.patient.lastName}, ${study.patient.firstName}`}
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StudyStatusBadge status={study.status} />
          <Link to="/worklist" className="btn btn-ghost btn-sm">← Worklist</Link>
        </div>
      }
    >
      <div className="viewer-shell">
        {/* LEFT: DICOM Viewer */}
        <DicomViewer imageUrls={dicomUrls} />

        {/* RIGHT: Report editor */}
        <div className="viewer-side">
          {/* Study info */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div className="card-title" style={{ marginBottom: 10 }}>Información del estudio</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 13 }}>
              <div className="text-muted">Paciente</div>
              <div className="font-medium">{study.patient.lastName}, {study.patient.firstName}</div>
              <div className="text-muted">Código</div>
              <div>{study.patient.internalCode}</div>
              <div className="text-muted">Documento</div>
              <div>{study.patient.documentId}</div>
              <div className="text-muted">Modalidad</div>
              <div><span className="badge badge-blue">{study.modality}</span></div>
              <div className="text-muted">Fecha</div>
              <div>{formatDate(study.studyDate)}</div>
              {study.description && (
                <>
                  <div className="text-muted">Descripción</div>
                  <div>{study.description}</div>
                </>
              )}
              <div className="text-muted">Archivos</div>
              <div>{study.dicomFiles.length} archivo{study.dicomFiles.length !== 1 ? 's' : ''}</div>
            </div>
          </div>

          {/* Report editor */}
          <div className="report-block">
            <div className="report-block-header">
              {isFinalized ? '✓ Informe finalizado' : '✎ Redacción del informe'}
            </div>
            <div className="report-block-body form-grid">
              {isFinalized ? (
                <div className="report-status-final">
                  Informe cerrado el {formatDate(report?.finalizedAt ?? '')} por Dr/a. {report?.doctor.firstName} {report?.doctor.lastName}
                </div>
              ) : null}

              <div className="form-group">
                <label>Hallazgos *</label>
                <textarea
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  placeholder="Describa los hallazgos imagenológicos..."
                  rows={5}
                  disabled={isFinalized}
                  style={{ minHeight: 100 }}
                />
              </div>

              <div className="form-group">
                <label>Conclusión *</label>
                <textarea
                  value={conclusion}
                  onChange={(e) => setConclusion(e.target.value)}
                  placeholder="Conclusión diagnóstica..."
                  rows={3}
                  disabled={isFinalized}
                  style={{ minHeight: 70 }}
                />
              </div>

              <div className="form-group">
                <label>
                  Resumen para el paciente{' '}
                  <span className="text-xs text-muted">(lenguaje simple)</span>
                </label>
                <textarea
                  value={patientSummary}
                  onChange={(e) => setPatientSummary(e.target.value)}
                  placeholder="Explicación en lenguaje no técnico para el paciente..."
                  rows={2}
                  disabled={isFinalized}
                  style={{ minHeight: 60 }}
                />
              </div>

              {/* Mediciones */}
              {!isFinalized && (
                <div>
                  <label style={{ fontSize: 13, color: 'var(--gray-400)', marginBottom: 6, display: 'block' }}>Mediciones</label>
                  {measurements.map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{m.label}: <strong>{m.value} {m.unit}</strong></span>
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => removeMeasurement(i)}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input
                      value={newMeasLabel}
                      onChange={(e) => setNewMeasLabel(e.target.value)}
                      placeholder="Etiqueta"
                      style={{ flex: 2 }}
                    />
                    <input
                      type="number"
                      value={newMeasValue}
                      onChange={(e) => setNewMeasValue(e.target.value)}
                      placeholder="Valor"
                      style={{ flex: 1, width: 70 }}
                    />
                    <select value={newMeasUnit} onChange={(e) => setNewMeasUnit(e.target.value)} style={{ width: 60 }}>
                      <option>mm</option>
                      <option>cm</option>
                      <option>HU</option>
                      <option>%</option>
                    </select>
                    <button className="btn btn-secondary btn-sm" onClick={addMeasurement}>+</button>
                  </div>
                </div>
              )}

              {measurements.length > 0 && isFinalized && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 6 }}>MEDICIONES</div>
                  {measurements.map((m, i) => (
                    <div key={i} style={{ fontSize: 13, marginBottom: 3 }}>• {m.label}: <strong>{m.value} {m.unit}</strong></div>
                  ))}
                </div>
              )}

              {/* Mensaje */}
              <AnimatePresence>
                {message && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`}
                  >
                    <span>{message.type === 'success' ? '✓' : '✕'}</span>
                    <span>{message.text}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Buttons */}
              {!isFinalized && (
                <>
                  <button className="btn btn-secondary" onClick={saveDraft} disabled={saving}>
                    {saving ? 'Guardando...' : report ? '💾 Actualizar borrador' : '💾 Guardar borrador'}
                  </button>
                  <button
                    className="btn btn-success"
                    onClick={finalize}
                    disabled={!report || finalizing}
                  >
                    {finalizing ? 'Finalizando...' : '✓ Finalizar y generar PDF'}
                  </button>
                </>
              )}

              {/* PDF link */}
              {isFinalized && report?.pdfPath && (
                <a
                  href={`${getFilesBaseUrl()}/${report.pdfPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                >
                  📄 Descargar PDF del informe
                </a>
              )}
            </div>
          </div>

          {/* AI Panel */}
          <div className="report-block">
            <div className="report-block-header">✦ Asistencia IA</div>
            <div className="report-block-body form-grid">
              <p style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.5 }}>
                Las herramientas de IA son de apoyo editorial. No generan diagnósticos automáticos.
                Siempre verifique y adapte el contenido sugerido.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  onClick={suggestAI}
                  disabled={aiLoading || isFinalized}
                  style={{ justifyContent: 'flex-start', gap: 8 }}
                >
                  {aiLoading ? '...' : '✦'} Sugerir redacción desde notas
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={generatePatientSummary}
                  disabled={summaryLoading || isFinalized}
                  style={{ justifyContent: 'flex-start', gap: 8 }}
                >
                  {summaryLoading ? '...' : '♥'} Generar resumen para paciente
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={checkConsistency}
                  disabled={consistencyLoading || isFinalized}
                  style={{ justifyContent: 'flex-start', gap: 8 }}
                >
                  {consistencyLoading ? '...' : '⚑'} Revisar consistencia del informe
                </button>
              </div>

              <AnimatePresence>
                {showAiPanel && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="alert-ai"
                  >
                    {aiDisclaimer && <p style={{ marginBottom: 6, fontWeight: 500 }}>{aiDisclaimer}</p>}
                    {warnings.length > 0 && (
                      <>
                        <p style={{ fontWeight: 500, marginBottom: 4 }}>Advertencias detectadas:</p>
                        <ul style={{ paddingLeft: 16, fontSize: 12, lineHeight: 1.8 }}>
                          {warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </>
                    )}
                    {warnings.length === 0 && !aiDisclaimer && (
                      <p style={{ color: '#86efac' }}>✓ Sin advertencias detectadas</p>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setShowAiPanel(false); setAiDisclaimer(''); setWarnings([]); }}
                      style={{ marginTop: 8, fontSize: 11 }}
                    >
                      Cerrar
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function StudyStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    UPLOADED:  { label: 'Cargado', cls: 'badge-gray' },
    IN_REVIEW: { label: 'En revisión', cls: 'badge-yellow' },
    REPORTED:  { label: 'Informado', cls: 'badge-green' },
    PUBLISHED: { label: 'Publicado', cls: 'badge-purple' }
  };
  const m = map[status] ?? { label: status, cls: 'badge-gray' };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
