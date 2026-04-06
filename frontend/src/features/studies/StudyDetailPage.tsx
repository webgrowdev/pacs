import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from '../../components/AppLayout';
import { api, getFilesBaseUrl } from '../../lib/api';
import { getAccessToken } from '../../lib/auth';
import { DicomViewer, ViewerMeasurement, DicomViewerHandle } from './DicomViewer';
import { useAuth } from '../../lib/auth';
import { RichTextEditor } from '../../components/RichTextEditor';

interface Measurement {
  id?: string;
  type:    string;
  label:   string;
  value:   number;
  unit:    string;
  toolName?: string;
  // Primary evidence references
  sopInstanceUid?:      string;
  seriesInstanceUid?:   string;
  studyInstanceUid?:    string;
  frameOfReferenceUid?: string;
  instanceNumber?:      number;
  frameIndex?:          number;
  // Geometry
  coordinatesJson?:  Array<{ x: number; y: number }>;
  imageWidth?:       number;
  imageHeight?:      number;
  extraStatsJson?:   Record<string, number>;
}

interface KeyImage {
  id:             string;
  sopInstanceUid: string;
  instanceNumber?: number;
  frameIndex?:    number;
  description?:   string;
}

interface AiSession {
  requestedAt:  string;
  model:        string;
  section:      string;
  action:       'accepted' | 'modified' | 'discarded';
  editedByUser?: boolean;
}

interface Report {
  id:             string;
  status:         string;
  findings:       string;
  conclusion:     string;
  patientSummary?: string;
  measurements:   Measurement[];
  keyImages?:     KeyImage[];
  finalizedAt?:   string;
  pdfPath?:       string;
  doctor:         { firstName: string; lastName: string };
  // Versioning
  versionNumber?: number;
  isAddendum?:    boolean;
  addendumReason?: string;
  parentReportId?: string;
  childReports?:  Array<{ id: string; versionNumber: number; isAddendum: boolean; status: string }>;
  // AI attribution
  aiUsed?:        boolean;
  aiModel?:       string;
  aiSessions?:    AiSession[];
}

interface ReportTemplate {
  id: string;
  name: string;
  modality?: string | null;
  findingsTemplate: string;
  conclusionTemplate: string;
}

interface Study {
  id: string;
  modality: string;
  studyDate: string;
  description?: string;
  status: string;
  requestingDoctorName?: string;
  insuranceOrderNumber?: string;
  patient: {
    firstName: string; lastName: string; internalCode: string;
    documentId: string; cuil?: string; dateOfBirth: string; sex: string;
    healthInsurance?: string; healthInsurancePlan?: string; healthInsuranceMemberId?: string;
  };
  dicomFiles: Array<{ id: string; fileName: string; filePath: string; sopInstanceUid?: string; instanceNumber?: number }>;
  reports: Report[];
  assignedDoctor?: { firstName: string; lastName: string } | null;
  series?: Array<{ id: string; seriesInstanceUid: string }>;
}

export function StudyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [study,   setStudy]   = useState<Study | null>(null);
  const [loading, setLoading] = useState(true);
  const [report,  setReport]  = useState<Report | null>(null);
  const viewerRef = useRef<DicomViewerHandle>(null);

  // Form state
  const [findings,       setFindings]       = useState('');
  const [conclusion,     setConclusion]     = useState('');
  const [patientSummary, setPatientSummary] = useState('');
  const [measurements,   setMeasurements]   = useState<Measurement[]>([]);
  const [newMeasLabel,   setNewMeasLabel]   = useState('');
  const [newMeasValue,   setNewMeasValue]   = useState('');
  const [newMeasUnit,    setNewMeasUnit]    = useState('mm');

  // AI attribution tracking
  const [aiSessions,     setAiSessions]     = useState<AiSession[]>([]);
  const [aiUsed,         setAiUsed]         = useState(false);
  const [aiModel,        setAiModel]        = useState<string | undefined>();

  // Addendum state
  const [showAddendumModal, setShowAddendumModal] = useState(false);
  const [addendumReason,    setAddendumReason]    = useState('');
  const [creatingAddendum,  setCreatingAddendum]  = useState(false);

  // Key images
  const [keyImages,     setKeyImages]     = useState<KeyImage[]>([]);
  const [showKeyImages, setShowKeyImages] = useState(false);

  // UI state
  const [saving,              setSaving]              = useState(false);
  const [finalizing,          setFinalizing]          = useState(false);
  const [signing,             setSigning]             = useState(false);
  const [aiLoading,           setAiLoading]           = useState(false);
  const [summaryLoading,      setSummaryLoading]      = useState(false);
  const [consistencyLoading,  setConsistencyLoading]  = useState(false);
  const [pdfLoading,          setPdfLoading]          = useState(false);
  const [message,             setMessage]             = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [aiDisclaimer,        setAiDisclaimer]        = useState('');
  const [warnings,            setWarnings]            = useState<string[]>([]);
  const [showAiPanel,         setShowAiPanel]         = useState(false);
  const [showStudyInfo,       setShowStudyInfo]       = useState(false);

  // Template state
  const [templates,        setTemplates]        = useState<ReportTemplate[]>([]);
  const [showTemplates,    setShowTemplates]    = useState(false);

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
        setKeyImages(r.keyImages || []);
        setAiUsed(r.aiUsed ?? false);
        setAiModel(r.aiModel ?? undefined);
        setAiSessions((r.aiSessions as AiSession[]) ?? []);
      }
    } catch {
      setMessage({ type: 'error', text: 'Error al cargar el estudio' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadStudy(); }, [loadStudy]);

  // Load key images for the study
  useEffect(() => {
    if (!study) return;
    api.get(`/viewer/${study.id}/key-images`)
      .then((r) => setKeyImages(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, [study]);

  // Load report templates filtered by current modality
  useEffect(() => {
    if (!study) return;
    api.get('/report-templates', { params: { modality: study.modality } })
      .then((r) => setTemplates(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, [study]);

  const applyTemplate = (tpl: ReportTemplate) => {
    if (isFinalized) return;
    if ((findings || conclusion) && !window.confirm('¿Reemplazar el contenido actual con la plantilla?')) return;
    setFindings(tpl.findingsTemplate);
    setConclusion(tpl.conclusionTemplate);
    setShowTemplates(false);
    showMessage('success', `Plantilla "${tpl.name}" aplicada`);
  };

  const isFinalized = report?.status === 'FINAL' || report?.status === 'SIGNED';

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4500);
  };

  // ── PDF download ──────────────────────────────────────────────────────────────
  const openPdf = async () => {
    if (!report?.pdfPath) return;
    setPdfLoading(true);
    try {
      const token = getAccessToken();
      const response = await fetch(`${getFilesBaseUrl()}/${report.pdfPath}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `informe-${report.id.slice(0, 8)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      showMessage('error', 'No se pudo descargar el PDF. Verifique que el servidor esté activo.');
    } finally {
      setPdfLoading(false);
    }
  };

  // ── Save draft ────────────────────────────────────────────────────────────────
  const saveDraft = async () => {
    if (!study) return;
    setSaving(true);
    try {
      const payload = {
        studyId: study.id,
        findings,
        conclusion,
        patientSummary: patientSummary || undefined,
        measurements,
        aiUsed,
        aiModel,
        aiSessions
      };
      if (report) {
        const { data } = await api.put(`/reports/${report.id}`, payload);
        setReport(data);
        showMessage('success', 'Borrador guardado');
      } else {
        const { data } = await api.post('/reports', payload);
        setReport(data);
        showMessage('success', 'Borrador creado');
      }
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al guardar borrador');
    } finally {
      setSaving(false);
    }
  };

  // ── Finalize ──────────────────────────────────────────────────────────────────
  const finalize = async () => {
    if (!report) return showMessage('error', 'Primero guarde el borrador');
    if (!findings.trim() || !conclusion.trim()) return showMessage('error', 'Complete hallazgos y conclusión antes de finalizar');
    if (!window.confirm('¿Confirma que desea finalizar y generar el PDF? Esta acción no puede revertirse.')) return;
    setFinalizing(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/finalize`);
      setReport(data);
      showMessage('success', '✓ Informe finalizado. PDF generado correctamente.');
      loadStudy();
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al finalizar informe');
    } finally {
      setFinalizing(false);
    }
  };

  // ── Sign ──────────────────────────────────────────────────────────────────────
  const signReport = async () => {
    if (!report) return;
    if (!window.confirm('¿Confirma que desea firmar este informe? Esta acción es irreversible.')) return;
    setSigning(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/sign`);
      setReport(data);
      showMessage('success', '✓ Informe firmado.');
      loadStudy();
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al firmar informe');
    } finally {
      setSigning(false);
    }
  };

  // ── Addendum ──────────────────────────────────────────────────────────────────
  const createAddendum = async () => {
    if (!report || !addendumReason.trim()) return;
    setCreatingAddendum(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/addendum`, {
        findings:      findings || report.findings,
        conclusion:    conclusion || report.conclusion,
        patientSummary: patientSummary || undefined,
        addendumReason,
        measurements,
        aiUsed,
        aiModel,
        aiSessions
      });
      setReport(data);
      setFindings(data.findings);
      setConclusion(data.conclusion);
      setMeasurements(data.measurements || []);
      setShowAddendumModal(false);
      setAddendumReason('');
      showMessage('success', `✓ Addendum v${data.versionNumber} creado.`);
      loadStudy();
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al crear addendum');
    } finally {
      setCreatingAddendum(false);
    }
  };

  // ── AI tools ──────────────────────────────────────────────────────────────────
  const recordAiSession = (section: AiSession['section'], action: AiSession['action'], model: string) => {
    const session: AiSession = { requestedAt: new Date().toISOString(), model, section, action };
    setAiSessions((prev) => [...prev, session]);
    setAiUsed(true);
    setAiModel(model);
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
      recordAiSession('findings', 'accepted', data.model ?? 'unknown');
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
      recordAiSession('patientSummary', 'accepted', data.model ?? 'unknown');
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
      recordAiSession('consistency', 'accepted', data.model ?? 'unknown');
    } catch {
      showMessage('error', 'Error al revisar consistencia');
    } finally {
      setConsistencyLoading(false);
    }
  };

  // ── Measurements ──────────────────────────────────────────────────────────────
  const addMeasurement = () => {
    if (!newMeasLabel || !newMeasValue) return;
    setMeasurements((prev) => [...prev, { type: 'LINEAR', label: newMeasLabel, value: Number(newMeasValue), unit: newMeasUnit }]);
    setNewMeasLabel(''); setNewMeasValue('');
  };

  const removeMeasurement = (i: number) => setMeasurements((prev) => prev.filter((_, idx) => idx !== i));

  // Import measurements from CornerstoneJS annotations — includes full traceability
  const handleImportViewerMeasurements = useCallback((imported: ViewerMeasurement[]) => {
    if (!imported.length) {
      showMessage('error', 'No se encontraron mediciones en el visor. Use las herramientas de medición primero.');
      return;
    }
    setMeasurements((prev) => {
      const existing = new Set(prev.map((m) => `${m.label}:${m.value}:${m.unit}`));
      const newOnes = imported.filter((m) => !existing.has(`${m.label}:${m.value}:${m.unit}`));
      return [...prev, ...newOnes];
    });
    const n = imported.length;
    showMessage('success', `${n} medición${n !== 1 ? 'es' : ''} importada${n !== 1 ? 's' : ''} del visor`);
  }, []);

  // Navigate from a measurement back to the image in the viewer
  const navigateToMeasurement = useCallback((m: Measurement) => {
    if (!viewerRef.current) return;
    if (m.sopInstanceUid) {
      viewerRef.current.navigateToSopInstance(
        m.sopInstanceUid,
        m.frameIndex ?? (m.instanceNumber != null ? m.instanceNumber - 1 : 0)
      );
    } else if (m.frameIndex != null) {
      viewerRef.current.navigateToFrame(m.frameIndex);
    } else if (m.instanceNumber != null) {
      viewerRef.current.navigateToFrame(m.instanceNumber - 1);
    }
  }, []);

  // Navigate to a key image in the viewer
  const navigateToKeyImage = useCallback((ki: KeyImage) => {
    if (!viewerRef.current) return;
    viewerRef.current.navigateToSopInstance(ki.sopInstanceUid, ki.frameIndex ?? (ki.instanceNumber != null ? ki.instanceNumber - 1 : 0));
  }, []);

  const filesBase = getFilesBaseUrl();

  const sopIndexMap = useMemo((): Record<string, number> => {
    if (!study?.dicomFiles) return {};
    const map: Record<string, number> = {};
    study.dicomFiles.forEach((f, i) => {
      if (f.sopInstanceUid) map[f.sopInstanceUid] = i;
    });
    return map;
  }, [study?.dicomFiles]);

  const dicomUrls = useMemo(
    () =>
      study?.dicomFiles
        .filter((f) => f.fileName.toUpperCase() !== 'DICOMDIR')
        .map((f) => `${filesBase}/dicom/${study.id}/${f.fileName}`) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [study?.id, study?.dicomFiles?.length]
  );

  // ────────────────────────────────────────────────────────────────────────────
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
      title={`${study.modality} · ${study.patient.lastName}, ${study.patient.firstName}`}
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StudyStatusBadge status={study.status} />
          <Link to="/worklist" className="btn btn-ghost btn-sm">← Worklist</Link>
        </div>
      }
    >
      {/* ── Full-height two-column shell ────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 440px',
        gap: 0,
        height: 'calc(100vh - 112px)',
        marginTop: -8,
        marginLeft: -24,
        marginRight: -24,
        marginBottom: -24
      }}>

        {/* LEFT — DICOM viewer */}
        <div style={{
          overflow: 'hidden',
          borderRight: '1px solid var(--gray-200)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <DicomViewer
            ref={viewerRef}
            imageUrls={dicomUrls}
            studyId={study.id}
            sopIndexMap={sopIndexMap}
            onImportMeasurements={!isFinalized ? handleImportViewerMeasurements : undefined}
          />
        </div>

        {/* RIGHT — Report panel */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' }}>

          {/* ── Panel header: patient summary + toggle study info ─── */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--gray-200)',
            background: 'var(--gray-50)',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--gray-800)' }}>
                  {study.patient.lastName}, {study.patient.firstName}
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>
                  <span className="badge badge-blue" style={{ fontSize: 11, marginRight: 6 }}>{study.modality}</span>
                  {formatDate(study.studyDate)}
                  {study.description && <span style={{ marginLeft: 6 }}>· {study.description}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                  DNI {study.patient.documentId} · Cód. {study.patient.internalCode}
                  · {study.dicomFiles.length} imagen{study.dicomFiles.length !== 1 ? 'es' : ''}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowStudyInfo((v) => !v)}
                style={{ fontSize: 11, flexShrink: 0 }}
              >
                {showStudyInfo ? '▲ Ocultar' : '▼ Datos'}
              </button>
            </div>

            {/* Expandable study details */}
            <AnimatePresence>
              {showStudyInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{
                    marginTop: 10,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '4px 16px',
                    fontSize: 12,
                    paddingTop: 10,
                    borderTop: '1px solid var(--gray-200)'
                  }}>
                    {[
                      { label: 'Fecha nac.', value: formatDate(study.patient.dateOfBirth) },
                      { label: 'Sexo', value: study.patient.sex === 'M' ? 'Masculino' : study.patient.sex === 'F' ? 'Femenino' : 'N/E' },
                      ...(study.patient.cuil ? [{ label: 'CUIL', value: study.patient.cuil }] : []),
                      ...(study.patient.healthInsurance ? [{ label: 'Cobertura', value: study.patient.healthInsurance + (study.patient.healthInsurancePlan ? ` — ${study.patient.healthInsurancePlan}` : '') }] : []),
                      ...(study.patient.healthInsuranceMemberId ? [{ label: 'Nº afiliado', value: study.patient.healthInsuranceMemberId }] : []),
                      ...(study.requestingDoctorName ? [{ label: 'Médico solic.', value: study.requestingDoctorName }] : []),
                      ...(study.insuranceOrderNumber ? [{ label: 'Nº de orden', value: study.insuranceOrderNumber }] : []),
                      { label: 'Médico asig.', value: study.assignedDoctor ? `Dr/a. ${study.assignedDoctor.lastName}` : 'Sin asignar' },
                      { label: 'Archivos', value: `${study.dicomFiles.length} archivo(s) DICOM` }
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <span style={{ color: 'var(--gray-400)' }}>{label}: </span>
                        <span style={{ color: 'var(--gray-700)', fontWeight: 500 }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Scrollable content area ──────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

            {/* Global message banner */}
            <AnimatePresence>
              {message && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`}
                  style={{ marginBottom: 14 }}
                >
                  <span>{message.type === 'success' ? '✓' : '✕'}</span>
                  <span>{message.text}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ═══════════════════════════════════════════════════════
                FINALIZED MODE — read-only report view + PDF
            ════════════════════════════════════════════════════════ */}
            {isFinalized ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Finalization banner */}
                <div style={{
                  background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
                  border: '1px solid #86efac',
                  borderRadius: 10,
                  padding: '14px 16px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 18 }}>✓</span>
                    <span style={{ fontWeight: 600, color: '#15803d', fontSize: 14 }}>Informe finalizado</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#166534' }}>
                    Cerrado el {formatDate(report?.finalizedAt ?? '')} por Dr/a. {report?.doctor.firstName} {report?.doctor.lastName}
                  </div>
                </div>

                {/* PDF download — prominent */}
                {report?.pdfPath && (
                  <button
                    className="btn btn-primary"
                    onClick={openPdf}
                    disabled={pdfLoading}
                    style={{ width: '100%', justifyContent: 'center', gap: 8, padding: '12px 16px', fontSize: 14 }}
                  >
                    {pdfLoading ? (
                      <>⏳ Descargando PDF...</>
                    ) : (
                      <>📄 Ver / Descargar PDF del informe</>
                    )}
                  </button>
                )}
                {!report?.pdfPath && (
                  <div className="alert alert-error">
                    <span>⚠</span><span>El PDF no está disponible. Contacte al administrador.</span>
                  </div>
                )}

                {/* Sign button — only for FINAL (not yet SIGNED) reports */}
                {report?.status === 'FINAL' && (
                  <button
                    className="btn btn-secondary"
                    onClick={signReport}
                    disabled={signing}
                    style={{ width: '100%', justifyContent: 'center', gap: 8 }}
                    title="Firmar el informe"
                  >
                    {signing ? '⏳ Firmando...' : '✍ Firmar informe'}
                  </button>
                )}

                {/* Addendum button — only for SIGNED reports */}
                {report?.status === 'SIGNED' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowAddendumModal(true)}
                    style={{ width: '100%', justifyContent: 'center', gap: 8, borderColor: '#f59e0b', color: '#92400e' }}
                    title="Crear addendum sobre informe firmado"
                  >
                    ✏ Crear addendum (corrección)
                  </button>
                )}

                {/* Version history */}
                {report?.versionNumber != null && report.versionNumber > 1 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                    <strong>Versión {report.versionNumber}</strong>
                    {report.isAddendum && report.addendumReason && (
                      <div style={{ color: '#92400e', marginTop: 4 }}>Motivo: {report.addendumReason}</div>
                    )}
                  </div>
                )}

                {/* Key images section */}
                {keyImages.length > 0 && (
                  <ReportSection title="IMÁGENES CLAVE">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {keyImages.map((ki) => (
                        <div key={ki.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => navigateToKeyImage(ki)}
                            style={{ padding: '2px 6px', fontSize: 11 }}
                            title="Navegar a imagen clave"
                          >🖼 {ki.instanceNumber != null ? `Im. ${ki.instanceNumber}` : ki.sopInstanceUid.slice(0, 12)}</button>
                          {ki.description && <span style={{ color: 'var(--gray-500)' }}>{ki.description}</span>}
                        </div>
                      ))}
                    </div>
                  </ReportSection>
                )}

                {/* Report content — read only */}
                <ReportSection title="HALLAZGOS">
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--gray-700)', margin: 0, whiteSpace: 'pre-wrap' }}>
                    {report?.findings}
                  </p>
                </ReportSection>

                <ReportSection title="CONCLUSIÓN">
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--gray-700)', margin: 0, fontWeight: 500, whiteSpace: 'pre-wrap' }}>
                    {report?.conclusion}
                  </p>
                </ReportSection>

                {report?.patientSummary && (
                  <ReportSection title="RESUMEN PARA EL PACIENTE">
                    <p style={{ fontSize: 13, lineHeight: 1.7, color: '#166534', margin: 0, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                      {report.patientSummary}
                    </p>
                  </ReportSection>
                )}

                {(report?.measurements?.length ?? 0) > 0 && (
                  <ReportSection title="MEDICIONES">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {report!.measurements.map((m, i) => (
                        <div key={i} style={{ fontSize: 13, color: 'var(--gray-700)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            • <strong>{m.label}:</strong> {m.value} {m.unit}
                            {(m.sopInstanceUid || m.frameIndex != null || m.instanceNumber != null) && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => navigateToMeasurement(m)}
                                title="Navegar a imagen de origen"
                                style={{ fontSize: 11, padding: '1px 6px', marginLeft: 4 }}
                              >
                                🔗 Ver
                              </button>
                            )}
                          </div>
                          {m.sopInstanceUid && (
                            <div style={{ fontSize: 10, color: 'var(--gray-400)', paddingLeft: 12 }}>
                              SOP: {m.sopInstanceUid.slice(0, 24)}…
                              {m.instanceNumber != null && ` · Im. ${m.instanceNumber}`}
                              {m.frameIndex != null && ` / frame ${m.frameIndex}`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ReportSection>
                )}
              </div>

            ) : (
              /* ══════════════════════════════════════════════════════
                 EDITING MODE — report form
              ═════════════════════════════════════════════════════ */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Template selector */}
                {templates.length > 0 && (
                  <div style={{ position: 'relative' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowTemplates((v) => !v)}
                      style={{ width: '100%', justifyContent: 'space-between' }}
                    >
                      <span>📋 Usar plantilla de informe</span>
                      <span>{showTemplates ? '▲' : '▼'}</span>
                    </button>
                    {showTemplates && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                        background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 6,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto'
                      }}>
                        {templates.map((tpl) => (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => applyTemplate(tpl)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              width: '100%', padding: '10px 14px', background: 'none',
                              border: 'none', borderBottom: '1px solid var(--gray-100)',
                              cursor: 'pointer', textAlign: 'left', fontSize: 13
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gray-50)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                          >
                            {tpl.modality && (
                              <span className="badge badge-blue" style={{ fontSize: 10 }}>{tpl.modality}</span>
                            )}
                            <span className="font-medium">{tpl.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Hallazgos */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Hallazgos *
                  </label>
                  <RichTextEditor
                    value={findings}
                    onChange={setFindings}
                    placeholder="Describa los hallazgos imagenológicos observados..."
                    minHeight={120}
                    disabled={isFinalized}
                  />
                </div>

                {/* Conclusión */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Conclusión *
                  </label>
                  <RichTextEditor
                    value={conclusion}
                    onChange={setConclusion}
                    placeholder="Conclusión diagnóstica..."
                    minHeight={90}
                    disabled={isFinalized}
                  />
                </div>

                {/* Resumen paciente */}
                <div className="form-group" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                      Resumen para el paciente
                    </label>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={generatePatientSummary}
                      disabled={summaryLoading}
                      style={{ fontSize: 11 }}
                    >
                      {summaryLoading ? '...' : '✦ Generar con IA'}
                    </button>
                  </div>
                  <textarea
                    value={patientSummary}
                    onChange={(e) => setPatientSummary(e.target.value)}
                    placeholder="Explicación en lenguaje simple para el paciente (opcional)..."
                    rows={3}
                    style={{
                      width: '100%',
                      resize: 'vertical',
                      minHeight: 65,
                      fontSize: 13,
                      lineHeight: 1.6,
                      padding: '10px 12px',
                      border: '1.5px solid var(--gray-300)',
                      borderRadius: 8,
                      background: '#fff',
                      color: 'var(--gray-800)',
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'var(--brand-400)'; }}
                    onBlur={(e)  => { e.target.style.borderColor = 'var(--gray-300)'; }}
                  />
                </div>

                {/* Mediciones */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Mediciones
                  </div>
                  {measurements.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      {measurements.map((m, i) => (
                        <div key={i} style={{
                          display: 'flex', flexDirection: 'column',
                          background: 'var(--gray-50)', borderRadius: 6,
                          padding: '6px 10px', fontSize: 12, gap: 2
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ flex: 1, color: 'var(--gray-700)' }}>
                              {m.label}: <strong>{m.value} {m.unit}</strong>
                              {m.toolName && <span style={{ marginLeft: 6, color: 'var(--gray-400)', fontSize: 10 }}>[{m.toolName}]</span>}
                            </span>
                            {(m.sopInstanceUid || m.frameIndex != null || m.instanceNumber != null) && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => navigateToMeasurement(m)}
                                title="Navegar a imagen de origen"
                                style={{ padding: '1px 6px', fontSize: 10 }}
                              >🔗</button>
                            )}
                            <button
                              className="btn btn-ghost btn-sm btn-icon"
                              onClick={() => removeMeasurement(i)}
                              style={{ padding: '2px 6px', fontSize: 11 }}
                            >✕</button>
                          </div>
                          {m.sopInstanceUid && (
                            <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>
                              SOP: {m.sopInstanceUid.slice(0, 20)}…
                              {m.instanceNumber != null && ` · Im. ${m.instanceNumber}`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={newMeasLabel}
                      onChange={(e) => setNewMeasLabel(e.target.value)}
                      placeholder="Etiqueta"
                      style={{ flex: 2, fontSize: 12, padding: '6px 8px' }}
                      onKeyDown={(e) => { if (e.key === 'Enter') addMeasurement(); }}
                    />
                    <input
                      type="number"
                      value={newMeasValue}
                      onChange={(e) => setNewMeasValue(e.target.value)}
                      placeholder="Valor"
                      style={{ flex: 1, fontSize: 12, padding: '6px 8px', minWidth: 60 }}
                      onKeyDown={(e) => { if (e.key === 'Enter') addMeasurement(); }}
                    />
                    <select
                      value={newMeasUnit}
                      onChange={(e) => setNewMeasUnit(e.target.value)}
                      style={{ fontSize: 12, padding: '6px 8px', width: 55 }}
                    >
                      <option>mm</option><option>cm</option>
                      <option>HU</option><option>%</option>
                      <option>mL</option><option>°</option>
                    </select>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={addMeasurement}
                      style={{ fontSize: 12, padding: '6px 10px' }}
                    >+</button>
                  </div>
                </div>

                {/* IA Tools — collapsible */}
                <div style={{
                  border: '1px solid var(--gray-200)',
                  borderRadius: 8,
                  overflow: 'hidden'
                }}>
                  <button
                    style={{
                      width: '100%', display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', padding: '10px 14px',
                      background: 'var(--gray-50)', border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, color: 'var(--gray-600)',
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}
                    onClick={() => setShowAiPanel((v) => !v)}
                  >
                    <span>✦ Asistencia IA</span>
                    <span style={{ fontSize: 10 }}>{showAiPanel ? '▲' : '▼'}</span>
                  </button>

                  <AnimatePresence>
                    {showAiPanel && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <p style={{ fontSize: 11, color: 'var(--gray-500)', margin: 0, lineHeight: 1.5 }}>
                            Las herramientas de IA son de apoyo editorial y no generan diagnósticos automáticos.
                          </p>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={suggestAI}
                            disabled={aiLoading}
                            style={{ justifyContent: 'flex-start', gap: 6 }}
                          >
                            {aiLoading ? '...' : '✦'} Sugerir redacción desde notas
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={checkConsistency}
                            disabled={consistencyLoading}
                            style={{ justifyContent: 'flex-start', gap: 6 }}
                          >
                            {consistencyLoading ? '...' : '⚑'} Revisar consistencia
                          </button>

                          {/* AI warnings / disclaimer */}
                          {(warnings.length > 0 || aiDisclaimer) && (
                            <div style={{
                              background: '#0f172a', borderRadius: 6, padding: '10px 12px', marginTop: 4
                            }}>
                              {aiDisclaimer && (
                                <p style={{ fontSize: 11, fontWeight: 500, color: '#e2e8f0', margin: '0 0 6px' }}>{aiDisclaimer}</p>
                              )}
                              {warnings.length === 0 && (
                                <p style={{ fontSize: 11, color: '#86efac', margin: 0 }}>✓ Sin advertencias</p>
                              )}
                              {warnings.length > 0 && (
                                <ul style={{ paddingLeft: 14, fontSize: 11, lineHeight: 1.8, color: '#fde68a', margin: 0 }}>
                                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </div>
            )}
          </div>

          {/* ── Sticky action bar — only when editing ─────────────── */}
          {!isFinalized && (
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--gray-200)',
              background: 'white',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              {/* Character counts */}
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--gray-400)', flexWrap: 'wrap' }}>
                <span>Hallazgos: {findings.length} car.</span>
                <span>Conclusión: {conclusion.length} car.</span>
                {report && <span style={{ color: '#f59e0b' }}>Estado: {report.isAddendum ? `Addendum v${report.versionNumber}` : 'Borrador'}</span>}
                {aiUsed && <span style={{ color: '#7c3aed', fontSize: 10 }}>✦ IA usada ({aiSessions.length} sesión{aiSessions.length !== 1 ? 'es' : ''})</span>}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  onClick={saveDraft}
                  disabled={saving || !findings.trim() || !conclusion.trim()}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  {saving ? 'Guardando...' : report ? '💾 Actualizar' : '💾 Guardar borrador'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={finalize}
                  disabled={!report || finalizing}
                  style={{ flex: 1, justifyContent: 'center' }}
                  title={!report ? 'Primero guarde el borrador' : ''}
                >
                  {finalizing ? 'Finalizando...' : '✓ Finalizar y generar PDF'}
                </button>
              </div>

              {!report && (
                <div style={{ fontSize: 11, color: 'var(--gray-400)', textAlign: 'center' }}>
                  Guarde el borrador para poder finalizar el informe
                </div>
              )}
            </div>
          )}

        </div>{/* end right panel */}
      </div>

      {/* ── Addendum modal ─────────────────────────────────────────────────── */}
      {showAddendumModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '90vw',
            boxShadow: '0 16px 48px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ margin: '0 0 12px', color: 'var(--gray-800)', fontSize: 16 }}>✏ Crear Addendum</h3>
            <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '0 0 16px', lineHeight: 1.5 }}>
              El informe original firmado se conservará intacto. Se creará un nuevo borrador de addendum
              (versión {(report?.versionNumber ?? 1) + 1}) que podrá editar, finalizar y firmar por separado.
            </p>
            <div className="form-group">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>
                Motivo del addendum *
              </label>
              <textarea
                value={addendumReason}
                onChange={(e) => setAddendumReason(e.target.value)}
                placeholder="Ej: Error tipográfico en conclusión, medición adicional, corrección de lateralidad..."
                rows={3}
                style={{ width: '100%', fontSize: 13, padding: '8px 10px', border: '1.5px solid var(--gray-300)', borderRadius: 8 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost"
                onClick={() => { setShowAddendumModal(false); setAddendumReason(''); }}
                disabled={creatingAddendum}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={createAddendum}
                disabled={!addendumReason.trim() || creatingAddendum}
              >
                {creatingAddendum ? 'Creando...' : 'Crear addendum'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

// ── Small helper components ────────────────────────────────────────────────────

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        background: 'var(--gray-50)',
        padding: '8px 12px',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-500)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        borderBottom: '1px solid var(--gray-200)'
      }}>
        {title}
      </div>
      <div style={{ padding: '12px 14px' }}>{children}</div>
    </div>
  );
}

function StudyStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    UPLOADED:  { label: 'Cargado',     cls: 'badge-gray'   },
    IN_REVIEW: { label: 'En revisión', cls: 'badge-yellow' },
    REPORTED:  { label: 'Informado',   cls: 'badge-green'  },
    PUBLISHED: { label: 'Publicado',   cls: 'badge-purple' }
  };
  const m = map[status] ?? { label: status, cls: 'badge-gray' };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
