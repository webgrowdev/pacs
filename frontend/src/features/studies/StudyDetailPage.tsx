import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from '../../components/AppLayout';
import { api, getFilesBaseUrl } from '../../lib/api';
import { getAccessToken } from '../../lib/auth';
import { DicomViewer, ViewerMeasurement, DicomViewerHandle } from './DicomViewer';
import { useAuth } from '../../lib/auth';
import { RichTextEditor } from '../../components/RichTextEditor';
import { checkSpelling, SpellError } from '../../lib/medicalSpellCheck';

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

interface PendingAiSuggestion {
  sessionIndex: number;
  section: 'findings' | 'conclusion' | 'patientSummary';
  suggestedText: string;
}

interface StructuredScores {
  birads?: {
    category: number;
    density?: string;
    laterality?: string;
    assessment?: string;
  };
  tirads?: {
    category: number;
    points?: number;
    recommendation?: string;
  };
  pirads?: {
    category: number;
    zone?: string;
    dcePositive?: boolean;
    assessment?: string;
  };
  lirads?: {
    category: string;
    size?: number;
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

interface PeerReview {
  id: string;
  status: string;
  discrepancyLevel?: string;
  comment?: string;
  createdAt: string;
  reviewer?: { firstName: string; lastName: string };
}

interface PatientHistoryStudy {
  id: string;
  modality: string;
  studyDate: string;
  description?: string;
  status: string;
  reports: Array<{
    id: string;
    status: string;
    findings: string;
    conclusion: string;
    finalizedAt?: string;
    doctor: { firstName: string; lastName: string };
  }>;
}

interface Report {
  id:             string;
  status:         string;
  clinicalIndication?: string;
  findings:       string;
  conclusion:     string;
  patientSummary?: string;
  measurements:   Measurement[];
  keyImages?:     KeyImage[];
  finalizedAt?:   string;
  signedAt?:      string;
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
  // Critical finding
  isCritical?:    boolean;
  criticalAt?:    string;
  criticalReason?: string;
  // Structured scores
  structuredScores?: StructuredScores;
  // Peer reviews
  peerReviews?:   PeerReview[];
  // Optimistic concurrency
  updatedAt?:     string;
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
  patientId?: string;
  requestingDoctorName?: string;
  insuranceOrderNumber?: string;
  patient: {
    id?: string;
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
  const [clinicalIndication, setClinicalIndication] = useState('');
  const [findings,       setFindings]       = useState('');
  const [conclusion,     setConclusion]     = useState('');
  const [patientSummary, setPatientSummary] = useState('');
  const [measurements,   setMeasurements]   = useState<Measurement[]>([]);
  const [newMeasLabel,   setNewMeasLabel]   = useState('');
  const [newMeasValue,   setNewMeasValue]   = useState('');
  const [newMeasUnit,    setNewMeasUnit]    = useState('mm');
  const [structuredScores, setStructuredScores] = useState<StructuredScores>({});

  // AI attribution tracking
  const [aiSessions,     setAiSessions]     = useState<AiSession[]>([]);
  const [aiUsed,         setAiUsed]         = useState(false);
  const [aiModel,        setAiModel]        = useState<string | undefined>();

  // ── D2: track pending AI suggestions for modification/discard detection ───────
  // Each entry records which session index corresponds to which suggested text,
  // so we can detect at save time whether the user modified the AI output.
  const pendingAiSuggestionsRef = useRef<PendingAiSuggestion[]>([]);
  // Stores pre-AI text so it can be restored on explicit discard
  const preAiTextRef = useRef<{ findings: string; conclusion: string } | null>(null);
  const [hasPendingAiSuggestion, setHasPendingAiSuggestion] = useState(false);

  // Addendum state
  const [showAddendumModal, setShowAddendumModal] = useState(false);
  const [addendumReason,    setAddendumReason]    = useState('');
  const [creatingAddendum,  setCreatingAddendum]  = useState(false);

  // Sign confirmation modal (Sección 4)
  const [showSignModal,     setShowSignModal]     = useState(false);
  const [signPassword,      setSignPassword]      = useState('');

  // Critical finding modal (Sección 1)
  const [showCriticalModal, setShowCriticalModal] = useState(false);
  const [criticalReason,    setCriticalReason]    = useState('');
  const [markingCritical,   setMarkingCritical]   = useState(false);

  // PDF Preview modal (Sección 20)
  const [showPdfPreview,    setShowPdfPreview]    = useState(false);

  // Patient history panel (Sección 8)
  const [showHistoryPanel,  setShowHistoryPanel]  = useState(false);
  const [patientHistory,    setPatientHistory]    = useState<PatientHistoryStudy[]>([]);
  const [historyLoading,    setHistoryLoading]    = useState(false);

  // Peer review (Sección 12)
  const [showPeerReviewModal,  setShowPeerReviewModal]  = useState(false);
  const [peerReviewStatus,     setPeerReviewStatus]     = useState<'REVIEWED' | 'DISCREPANT'>('REVIEWED');
  const [peerReviewLevel,      setPeerReviewLevel]      = useState<'MINOR' | 'MAJOR' | 'CRITICAL'>('MINOR');
  const [peerReviewComment,    setPeerReviewComment]    = useState('');
  const [submittingPeerReview, setSubmittingPeerReview] = useState(false);

  // Integrity verification (Sección 5)
  const [integrityResult,   setIntegrityResult]   = useState<{ intact: boolean; message: string; verifiedAt?: string } | null>(null);
  const [verifyingIntegrity, setVerifyingIntegrity] = useState(false);

  // Structured scores panel (Sección 7)
  const [showScoresPanel,   setShowScoresPanel]   = useState(false);

  // Key images
  const [keyImages,     setKeyImages]     = useState<KeyImage[]>([]);
  const [showKeyImages, setShowKeyImages] = useState(false);

  // ── Sección 19: Medical spell check ──────────────────────────────────────
  const [findingsSpellErrors,   setFindingsSpellErrors]   = useState<SpellError[]>([]);
  const [conclusionSpellErrors, setConclusionSpellErrors] = useState<SpellError[]>([]);
  const spellCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sección 18: Voice dictation (Web Speech API) ──────────────────────
  const [isDictating,    setIsDictating]    = useState(false);
  const recognitionRef = useRef<any>(null);

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
        setClinicalIndication(r.clinicalIndication || '');
        setFindings(r.findings || '');
        setConclusion(r.conclusion || '');
        setPatientSummary(r.patientSummary || '');
        setMeasurements(r.measurements || []);
        setKeyImages(r.keyImages || []);
        setAiUsed(r.aiUsed ?? false);
        setAiModel(r.aiModel ?? undefined);
        setAiSessions((r.aiSessions as AiSession[]) ?? []);
        setStructuredScores((r.structuredScores as StructuredScores) ?? {});
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

  // ── Sección 19: Run spell check 600ms after typing stops ─────────────────
  useEffect(() => {
    if (isFinalized) return;
    if (spellCheckRef.current) clearTimeout(spellCheckRef.current);
    spellCheckRef.current = setTimeout(() => {
      // Strip HTML tags before spell checking
      const plainFindings   = findings.replace(/<[^>]*>/g, ' ');
      const plainConclusion = conclusion.replace(/<[^>]*>/g, ' ');
      setFindingsSpellErrors(checkSpelling(plainFindings));
      setConclusionSpellErrors(checkSpelling(plainConclusion));
    }, 600);
    return () => { if (spellCheckRef.current) clearTimeout(spellCheckRef.current); };
  }, [findings, conclusion, isFinalized]);

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
      const resolvedSessions = resolveAiSessions(findings, conclusion, patientSummary);
      const payload = {
        studyId: study.id,
        clinicalIndication: clinicalIndication || undefined,
        findings,
        conclusion,
        patientSummary: patientSummary || undefined,
        measurements,
        structuredScores: Object.keys(structuredScores).length > 0 ? structuredScores : undefined,
        aiUsed,
        aiModel,
        aiSessions: resolvedSessions
      };
      if (report) {
        const { data } = await api.put(`/reports/${report.id}`, { ...payload, updatedAt: report.updatedAt });
        setReport(data);
      } else {
        const { data } = await api.post('/reports', payload);
        setReport(data);
      }
      // Sync in-memory AI state to match what was persisted so that a second
      // save in the same session resolves correctly against the new baseline.
      setAiSessions(resolvedSessions);
      pendingAiSuggestionsRef.current = [];
      preAiTextRef.current = null;
      setHasPendingAiSuggestion(false);
      showMessage('success', 'Borrador guardado');
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

  // ── Sign with password confirmation (Sección 4) ──────────────────────────────
  const signReport = async () => {
    if (!report) return;
    if (!signPassword.trim()) {
      showMessage('error', 'Ingrese su contraseña para confirmar la firma');
      return;
    }
    setSigning(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/sign`, { password: signPassword });
      setReport(data);
      setShowSignModal(false);
      setSignPassword('');
      showMessage('success', '✓ Informe firmado correctamente.');
      loadStudy();
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al firmar informe');
    } finally {
      setSigning(false);
    }
  };

  // ── Mark critical finding (Sección 1) ─────────────────────────────────────────
  const markCritical = async () => {
    if (!report || !criticalReason.trim()) return;
    setMarkingCritical(true);
    try {
      const { data } = await api.post(`/reports/${report.id}/mark-critical`, { reason: criticalReason });
      setReport((prev) => prev ? { ...prev, isCritical: true, criticalReason: data.criticalReason } : prev);
      setShowCriticalModal(false);
      setCriticalReason('');
      showMessage('success', '🚨 Hallazgo marcado como crítico. Notificación enviada al médico solicitante.');
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al marcar hallazgo crítico');
    } finally {
      setMarkingCritical(false);
    }
  };

  // ── Verify integrity (Sección 5) ─────────────────────────────────────────────
  const verifyIntegrity = async () => {
    if (!report) return;
    setVerifyingIntegrity(true);
    try {
      const { data } = await api.get(`/reports/${report.id}/verify-integrity`);
      setIntegrityResult({ intact: data.intact, message: data.message, verifiedAt: data.verifiedAt });
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al verificar integridad');
    } finally {
      setVerifyingIntegrity(false);
    }
  };

  // ── Voice dictation (Sección 18) ─────────────────────────────────────────────
  const startDictation = () => {
    const SpeechRecognition: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showMessage('error', 'Su navegador no soporta dictado por voz (use Chrome)');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-AR';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as any[])
        .slice(event.resultIndex)
        .filter((r: any) => r.isFinal)
        .map((r: any) => r[0].transcript)
        .join(' ');
      if (transcript.trim()) {
        setFindings((prev) => prev ? `${prev} ${transcript.trim()}` : transcript.trim());
      }
    };
    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech') {
        showMessage('error', `Error de dictado: ${event.error}`);
      }
      setIsDictating(false);
    };
    recognition.onend = () => setIsDictating(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsDictating(true);
  };

  const stopDictation = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsDictating(false);
  };

  // ── Load patient history (Sección 8) ─────────────────────────────────────────
  const loadPatientHistory = async () => {
    if (!study) return;
    setHistoryLoading(true);
    try {
      // Use the patient's ID if available, otherwise fall back to internalCode
      const patientIdentifier = study.patient.id ?? study.patient.internalCode;
      const resp = await api.get(`/patients/${patientIdentifier}/history`)
        .catch(async () => {
          // Fallback: use study patientId if present
          if (study.patientId) {
            return api.get(`/patients/${study.patientId}/history`);
          }
          return { data: { studies: [] } };
        });
      setPatientHistory(resp.data.studies || []);
    } catch {
      setPatientHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // ── Submit peer review (Sección 12) ──────────────────────────────────────────
  const submitPeerReview = async () => {
    if (!report) return;
    setSubmittingPeerReview(true);
    try {
      await api.post(`/reports/${report.id}/peer-review`, {
        status: peerReviewStatus,
        discrepancyLevel: peerReviewStatus === 'DISCREPANT' ? peerReviewLevel : undefined,
        comment: peerReviewComment || undefined
      });
      setShowPeerReviewModal(false);
      setPeerReviewComment('');
      showMessage('success', '✓ Revisión por pares registrada correctamente.');
      loadStudy();
    } catch (err: any) {
      showMessage('error', err?.response?.data?.message ?? 'Error al registrar revisión por pares');
    } finally {
      setSubmittingPeerReview(false);
    }
  };

  // ── Addendum ──────────────────────────────────────────────────────────────────
  const createAddendum = async () => {
    if (!report || !addendumReason.trim()) return;
    setCreatingAddendum(true);
    try {
      const resolvedSessions = resolveAiSessions(findings, conclusion, patientSummary);
      const { data } = await api.post(`/reports/${report.id}/addendum`, {
        findings:      findings || report.findings,
        conclusion:    conclusion || report.conclusion,
        patientSummary: patientSummary || undefined,
        addendumReason,
        measurements,
        aiUsed,
        aiModel,
        aiSessions: resolvedSessions
      });
      setReport(data);
      setFindings(data.findings);
      setConclusion(data.conclusion);
      setMeasurements(data.measurements || []);
      // Sync AI state so a follow-up save in the same session resolves correctly
      setAiSessions(resolvedSessions);
      pendingAiSuggestionsRef.current = [];
      preAiTextRef.current = null;
      setHasPendingAiSuggestion(false);
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

  // Resolve pending AI sessions: compare current text against what was
  // originally suggested.  Called just before any persist operation so
  // that the final action stored is accurate (accepted / modified / discarded).
  const resolveAiSessions = useCallback((
    currentFindings: string,
    currentConclusion: string,
    currentPatientSummary: string
  ): AiSession[] => {
    const pending = pendingAiSuggestionsRef.current;
    if (!pending.length) return aiSessions;
    return aiSessions.map((s, i) => {
      if (s.action !== 'accepted') return s;
      const match = pending.find((p) => p.sessionIndex === i);
      if (!match) return s;
      const currentText =
        match.section === 'findings'      ? currentFindings :
        match.section === 'conclusion'    ? currentConclusion :
                                            currentPatientSummary;
      return currentText !== match.suggestedText
        ? { ...s, action: 'modified' as const }
        : s;
    });
  }, [aiSessions]);

  // Explicitly discard the last AI suggestion: restore pre-AI text and mark
  // the corresponding sessions as 'discarded'.
  const discardAiSuggestion = useCallback(() => {
    const pre = preAiTextRef.current;
    if (!pre) return;
    setFindings(pre.findings);
    setConclusion(pre.conclusion);
    const discardIndices = new Set(
      pendingAiSuggestionsRef.current
        .filter((p) => p.section === 'findings' || p.section === 'conclusion')
        .map((p) => p.sessionIndex)
    );
    setAiSessions((prev) =>
      prev.map((s, i) =>
        discardIndices.has(i) && s.action === 'accepted'
          ? { ...s, action: 'discarded' as const }
          : s
      )
    );
    pendingAiSuggestionsRef.current = pendingAiSuggestionsRef.current.filter(
      (p) => p.section !== 'findings' && p.section !== 'conclusion'
    );
    preAiTextRef.current = null;
    setHasPendingAiSuggestion(false);
    showMessage('success', 'Sugerencia de IA descartada');
  }, []);

  const suggestAI = async () => {
    setAiLoading(true);
    setWarnings([]);
    try {
      const { data } = await api.post('/ai/suggest-report', { notes: findings || 'estudio de rutina' });
      const model = data.model ?? 'unknown';

      // Capture pre-AI text for discard restoration
      preAiTextRef.current = { findings, conclusion };

      // Record two sessions (findings + conclusion) and note their indices
      // so resolveAiSessions can compare actual text at save time.
      const baseIdx = aiSessions.length;
      recordAiSession('findings',    'accepted', model);
      recordAiSession('conclusion',  'accepted', model);

      pendingAiSuggestionsRef.current.push(
        { sessionIndex: baseIdx,     section: 'findings',   suggestedText: data.findings  },
        { sessionIndex: baseIdx + 1, section: 'conclusion', suggestedText: data.conclusion }
      );
      setHasPendingAiSuggestion(true);

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
      const model = data.model ?? 'unknown';

      const baseIdx = aiSessions.length;
      recordAiSession('patientSummary', 'accepted', model);

      pendingAiSuggestionsRef.current.push(
        { sessionIndex: baseIdx, section: 'patientSummary', suggestedText: data.patientSummary }
      );
      setHasPendingAiSuggestion(true);

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
      // Consistency check doesn't write text — record the model but no text to track
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

  // dicomFiles filtered the same way as the viewer's imageIds — DICOMDIR is
  // never loaded as an image, so both sopIndexMap and dicomUrls must exclude it
  // so that their indices stay aligned (C5 fix).
  const viewableDicomFiles = useMemo(
    () => study?.dicomFiles.filter((f) => f.fileName.toUpperCase() !== 'DICOMDIR') ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [study?.id, study?.dicomFiles?.length]
  );

  const sopIndexMap = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {};
    viewableDicomFiles.forEach((f, i) => {
      if (f.sopInstanceUid) map[f.sopInstanceUid] = i;
    });
    return map;
  }, [viewableDicomFiles]);

  const dicomUrls = useMemo(
    () => viewableDicomFiles.map((f) => `${filesBase}/dicom/${study!.id}/${f.fileName}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewableDicomFiles]
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-primary"
                      onClick={openPdf}
                      disabled={pdfLoading}
                      style={{ flex: 1, justifyContent: 'center', gap: 8, padding: '12px 16px', fontSize: 14 }}
                    >
                      {pdfLoading ? <>⏳ Descargando PDF...</> : <>📄 Ver / Descargar PDF del informe</>}
                    </button>
                    {/* Sección 20: Preview del PDF */}
                    <button
                      className="btn btn-secondary"
                      onClick={() => setShowPdfPreview(true)}
                      style={{ padding: '12px 14px', fontSize: 13 }}
                      title="Vista previa del PDF en modal"
                    >
                      👁 Preview
                    </button>
                  </div>
                )}
                {!report?.pdfPath && (
                  <div className="alert alert-error">
                    <span>⚠</span><span>El PDF no está disponible. Contacte al administrador.</span>
                  </div>
                )}

                {/* Sección 5: Verificar integridad */}
                {report?.status === 'SIGNED' && (
                  <div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={verifyIntegrity}
                      disabled={verifyingIntegrity}
                      style={{ width: '100%', justifyContent: 'center', gap: 8, fontSize: 12 }}
                    >
                      {verifyingIntegrity ? '⏳ Verificando...' : '🔒 Verificar integridad del informe'}
                    </button>
                    {integrityResult && (
                      <div style={{
                        marginTop: 8,
                        padding: '8px 12px',
                        borderRadius: 6,
                        background: integrityResult.intact ? '#f0fdf4' : '#fef2f2',
                        border: `1px solid ${integrityResult.intact ? '#86efac' : '#fca5a5'}`,
                        fontSize: 12,
                        color: integrityResult.intact ? '#166534' : '#991b1b'
                      }}>
                        {integrityResult.intact ? '✓' : '⚠'} {integrityResult.message}
                        {integrityResult.verifiedAt && (
                          <div style={{ marginTop: 2, fontSize: 10, opacity: 0.8 }}>
                            Verificado: {new Date(integrityResult.verifiedAt).toLocaleString('es-AR')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Sign button — only for FINAL (not yet SIGNED) reports */}
                {report?.status === 'FINAL' && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowSignModal(true)}
                    disabled={signing}
                    style={{ width: '100%', justifyContent: 'center', gap: 8 }}
                    title="Firmar el informe (requiere contraseña)"
                  >
                    {signing ? '⏳ Firmando...' : '✍ Firmar informe'}
                  </button>
                )}

                {/* Sección 12: Peer Review — para el informe finalizado/firmado */}
                {(report?.status === 'FINAL' || report?.status === 'SIGNED') && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowPeerReviewModal(true)}
                    style={{ width: '100%', justifyContent: 'center', gap: 8, fontSize: 12, borderColor: '#6366f1', color: '#4338ca' }}
                  >
                    👥 Realizar revisión por pares
                  </button>
                )}

                {/* Peer reviews list */}
                {(report?.peerReviews?.length ?? 0) > 0 && (
                  <ReportSection title="REVISIONES POR PARES">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {report!.peerReviews!.map((pr) => (
                        <div key={pr.id} style={{
                          padding: '6px 10px',
                          background: pr.status === 'DISCREPANT' ? '#fef2f2' : '#f0fdf4',
                          borderRadius: 6,
                          fontSize: 12,
                          border: `1px solid ${pr.status === 'DISCREPANT' ? '#fca5a5' : '#86efac'}`
                        }}>
                          <div style={{ fontWeight: 600, color: pr.status === 'DISCREPANT' ? '#991b1b' : '#166534' }}>
                            {pr.status === 'DISCREPANT' ? `⚠ Discrepante — ${pr.discrepancyLevel}` : '✓ Revisado (concordante)'}
                          </div>
                          {pr.comment && <div style={{ color: 'var(--gray-600)', marginTop: 3 }}>{pr.comment}</div>}
                          <div style={{ color: 'var(--gray-400)', fontSize: 10, marginTop: 2 }}>
                            {new Date(pr.createdAt).toLocaleString('es-AR')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ReportSection>
                )}

                {/* Sección 1: Alerta crítica (si el informe está marcado como crítico) */}
                {report?.isCritical && (
                  <div style={{
                    background: '#fef2f2',
                    border: '1px solid #fca5a5',
                    borderLeft: '4px solid #dc2626',
                    borderRadius: 8,
                    padding: '12px 14px'
                  }}>
                    <div style={{ color: '#dc2626', fontWeight: 700, fontSize: 13 }}>🚨 HALLAZGO CRÍTICO / STAT</div>
                    {report.criticalReason && (
                      <div style={{ color: '#7f1d1d', fontSize: 12, marginTop: 4 }}>{report.criticalReason}</div>
                    )}
                    {report.criticalAt && (
                      <div style={{ color: '#991b1b', fontSize: 10, marginTop: 4 }}>
                        Marcado: {new Date(report.criticalAt).toLocaleString('es-AR')}
                      </div>
                    )}
                  </div>
                )}

                {/* Sección 15 & 16: FHIR R4 + DICOM SR export — available for all finalized reports */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href={`/api/reports/${report?.id}/fhir`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                    style={{ flex: 1, justifyContent: 'center', gap: 6, fontSize: 11, borderColor: '#6366f1', color: '#4338ca', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                    title="Descargar informe en formato FHIR R4 DiagnosticReport (JSON)"
                  >
                    🔗 FHIR R4
                  </a>
                  <a
                    href={`/api/reports/${report?.id}/dicom-sr`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                    style={{ flex: 1, justifyContent: 'center', gap: 6, fontSize: 11, borderColor: '#0ea5e9', color: '#0369a1', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                    title="Descargar informe en formato DICOM Structured Report (JSON)"
                  >
                    📋 DICOM SR
                  </a>
                </div>

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

                {/* Indicación clínica */}
                {report?.clinicalIndication && (
                  <ReportSection title="INDICACIÓN CLÍNICA">
                    <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--gray-700)', margin: 0, fontStyle: 'italic' }}>
                      {report.clinicalIndication}
                    </p>
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

                {/* Sección 7: Puntuaciones estructuradas (read-only in finalized view) */}
                {report?.structuredScores && Object.keys(report.structuredScores).length > 0 && (
                  <ReportSection title="PUNTUACIONES ESTRUCTURADAS">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                      {report.structuredScores.birads && (
                        <div><span style={{ fontWeight: 700, color: '#1e3a5f' }}>BI-RADS: </span>
                          Categoría {report.structuredScores.birads.category}
                          {report.structuredScores.birads.density && ` · Densidad ${report.structuredScores.birads.density}`}
                          {report.structuredScores.birads.laterality && ` · ${report.structuredScores.birads.laterality}`}
                        </div>
                      )}
                      {report.structuredScores.tirads && (
                        <div><span style={{ fontWeight: 700, color: '#1e3a5f' }}>TI-RADS: </span>
                          Categoría {report.structuredScores.tirads.category}
                          {report.structuredScores.tirads.points != null && ` (${report.structuredScores.tirads.points} pts)`}
                        </div>
                      )}
                      {report.structuredScores.pirads && (
                        <div><span style={{ fontWeight: 700, color: '#1e3a5f' }}>PI-RADS: </span>
                          Categoría {report.structuredScores.pirads.category}
                          {report.structuredScores.pirads.zone && ` · Zona ${report.structuredScores.pirads.zone}`}
                        </div>
                      )}
                      {report.structuredScores.lirads && (
                        <div><span style={{ fontWeight: 700, color: '#1e3a5f' }}>LI-RADS: </span>
                          {report.structuredScores.lirads.category}
                          {report.structuredScores.lirads.size && ` · ${report.structuredScores.lirads.size} mm`}
                        </div>
                      )}
                      {report.structuredScores.chest && (
                        <div>
                          <span style={{ fontWeight: 700, color: '#1e3a5f' }}>Rx Tórax: </span>
                          {[
                            report.structuredScores.chest.opacity && 'Opacidad',
                            report.structuredScores.chest.pleuralEffusion && 'Derrame pleural',
                            report.structuredScores.chest.pneumothorax && 'Neumotórax',
                            report.structuredScores.chest.cardiomegaly && 'Cardiomegalia',
                            report.structuredScores.chest.infiltrate && 'Infiltrado',
                            report.structuredScores.chest.consolidation && 'Consolidación',
                            report.structuredScores.chest.atelectasis && 'Atelectasia'
                          ].filter(Boolean).join(', ') || 'Sin hallazgos patológicos'}
                        </div>
                      )}
                    </div>
                  </ReportSection>
                )}

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

                {/* Sección 1: Botón de hallazgo crítico */}
                {report && !report.isCritical && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowCriticalModal(true)}
                      style={{ color: '#dc2626', borderColor: '#fca5a5', fontSize: 12 }}
                    >
                      🚨 Marcar hallazgo crítico / STAT
                    </button>
                  </div>
                )}
                {report?.isCritical && (
                  <div style={{
                    background: '#fef2f2', border: '1px solid #fca5a5',
                    borderLeft: '4px solid #dc2626', borderRadius: 8, padding: '10px 14px'
                  }}>
                    <div style={{ color: '#dc2626', fontWeight: 700, fontSize: 13 }}>🚨 HALLAZGO CRÍTICO / STAT</div>
                    {report.criticalReason && <div style={{ color: '#7f1d1d', fontSize: 12, marginTop: 4 }}>{report.criticalReason}</div>}
                  </div>
                )}

                {/* Sección 2: Indicación clínica (obligatoria) */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Indicación clínica / motivo de consulta *
                  </label>
                  <textarea
                    value={clinicalIndication}
                    onChange={(e) => setClinicalIndication(e.target.value)}
                    placeholder="Ej: Dolor torácico atípico de 48hs, disnea progresiva. Control post-tratamiento..."
                    rows={2}
                    style={{
                      width: '100%', resize: 'vertical', minHeight: 55, fontSize: 13,
                      lineHeight: 1.5, padding: '8px 12px',
                      border: `1.5px solid ${!clinicalIndication.trim() ? '#fca5a5' : 'var(--gray-300)'}`,
                      borderRadius: 8, background: '#fff', color: 'var(--gray-800)',
                      outline: 'none', fontFamily: 'inherit'
                    }}
                    disabled={isFinalized}
                  />
                  {!clinicalIndication.trim() && (
                    <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>
                      Campo obligatorio en el informe radiológico
                    </div>
                  )}
                </div>

                {/* Hallazgos */}
                <div className="form-group" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                      Hallazgos *
                    </label>
                    {/* Sección 18: Voice dictation button */}
                    <button
                      type="button"
                      onClick={isDictating ? stopDictation : startDictation}
                      disabled={isFinalized}
                      title={isDictating ? 'Detener dictado' : 'Iniciar dictado por voz (español)'}
                      style={{
                        fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                        border: `1px solid ${isDictating ? '#dc2626' : 'var(--gray-300)'}`,
                        background: isDictating ? '#fef2f2' : 'transparent',
                        color: isDictating ? '#dc2626' : 'var(--gray-500)',
                        display: 'flex', alignItems: 'center', gap: 4,
                        animation: isDictating ? 'pulse 1.5s infinite' : 'none'
                      }}
                    >
                      🎤 {isDictating ? 'Detener' : 'Dictado'}
                    </button>
                  </div>
                  <RichTextEditor
                    value={findings}
                    onChange={setFindings}
                    placeholder="Describa los hallazgos imagenológicos observados..."
                    minHeight={120}
                    disabled={isFinalized}
                  />
                  {/* Sección 19: Spell check feedback */}
                  {!isFinalized && findingsSpellErrors.length > 0 && (
                    <SpellCheckBadge errors={findingsSpellErrors} />
                  )}
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
                  {/* Sección 19: Spell check feedback */}
                  {!isFinalized && conclusionSpellErrors.length > 0 && (
                    <SpellCheckBadge errors={conclusionSpellErrors} />
                  )}
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

                {/* Sección 7: Puntuaciones estructuradas por modalidad */}
                <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    style={{
                      width: '100%', display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', padding: '10px 14px',
                      background: 'var(--gray-50)', border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, color: 'var(--gray-600)',
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}
                    onClick={() => setShowScoresPanel((v) => !v)}
                  >
                    <span>📊 Puntuaciones estructuradas</span>
                    <span style={{ fontSize: 10 }}>{showScoresPanel ? '▲' : '▼'}</span>
                  </button>
                  <AnimatePresence>
                    {showScoresPanel && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {/* BI-RADS */}
                          {(study?.modality === 'MG' || study?.modality === 'US') && (
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)' }}>BI-RADS (Mama)</label>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                {[0, 1, 2, 3, 4, 5, 6].map((cat) => (
                                  <button key={cat}
                                    className={`btn btn-sm ${structuredScores.birads?.category === cat ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setStructuredScores((s) => ({ ...s, birads: { ...s.birads, category: cat } }))}
                                    style={{ padding: '3px 8px', fontSize: 11 }}
                                  >{cat}</button>
                                ))}
                              </div>
                              {structuredScores.birads && (
                                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                                  {['izquierda', 'derecha', 'bilateral'].map((lat) => (
                                    <button key={lat}
                                      className={`btn btn-sm ${structuredScores.birads?.laterality === lat ? 'btn-primary' : 'btn-ghost'}`}
                                      onClick={() => setStructuredScores((s) => ({ ...s, birads: { ...s.birads!, laterality: lat } }))}
                                      style={{ padding: '3px 8px', fontSize: 11 }}
                                    >{lat}</button>
                                  ))}
                                  <select value={structuredScores.birads?.density ?? ''} style={{ fontSize: 11, padding: '2px 6px' }}
                                    onChange={(e) => setStructuredScores((s) => ({ ...s, birads: { ...s.birads!, density: e.target.value } }))}>
                                    <option value="">Densidad...</option>
                                    <option value="A">A - Casi todo graso</option>
                                    <option value="B">B - Densidad dispersa</option>
                                    <option value="C">C - Heterogéneo denso</option>
                                    <option value="D">D - Extremadamente denso</option>
                                  </select>
                                </div>
                              )}
                            </div>
                          )}

                          {/* TI-RADS */}
                          {study?.modality === 'US' && (
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)' }}>TI-RADS (Tiroides)</label>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                {[1, 2, 3, 4, 5].map((cat) => (
                                  <button key={cat}
                                    className={`btn btn-sm ${structuredScores.tirads?.category === cat ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setStructuredScores((s) => ({ ...s, tirads: { ...s.tirads, category: cat } }))}
                                    style={{ padding: '3px 8px', fontSize: 11 }}
                                  >{cat}</button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* PI-RADS */}
                          {study?.modality === 'MR' && (
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)' }}>PI-RADS (Próstata)</label>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                {[1, 2, 3, 4, 5].map((cat) => (
                                  <button key={cat}
                                    className={`btn btn-sm ${structuredScores.pirads?.category === cat ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setStructuredScores((s) => ({ ...s, pirads: { ...s.pirads, category: cat } }))}
                                    style={{ padding: '3px 8px', fontSize: 11 }}
                                  >{cat}</button>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                {['PZ', 'TZ', 'AS', 'SV'].map((zone) => (
                                  <button key={zone}
                                    className={`btn btn-sm ${structuredScores.pirads?.zone === zone ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setStructuredScores((s) => ({ ...s, pirads: { ...s.pirads!, zone } }))}
                                    style={{ padding: '3px 8px', fontSize: 11 }}
                                  >{zone}</button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* LI-RADS */}
                          {(study?.modality === 'CT' || study?.modality === 'MR') && (
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)' }}>LI-RADS (Hígado)</label>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                {['LR-1', 'LR-2', 'LR-3', 'LR-4', 'LR-5', 'LR-M', 'LR-TIV'].map((cat) => (
                                  <button key={cat}
                                    className={`btn btn-sm ${structuredScores.lirads?.category === cat ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setStructuredScores((s) => ({ ...s, lirads: { ...s.lirads, category: cat } }))}
                                    style={{ padding: '3px 8px', fontSize: 11 }}
                                  >{cat}</button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Chest X-Ray structured findings */}
                          {study?.modality === 'CR' || study?.modality === 'DX' ? (
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-600)' }}>Rx Tórax — Hallazgos</label>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                {[
                                  { key: 'opacity',          label: 'Opacidad' },
                                  { key: 'pleuralEffusion',  label: 'Derrame pleural' },
                                  { key: 'pneumothorax',     label: 'Neumotórax' },
                                  { key: 'cardiomegaly',     label: 'Cardiomegalia' },
                                  { key: 'infiltrate',       label: 'Infiltrado' },
                                  { key: 'consolidation',    label: 'Consolidación' },
                                  { key: 'atelectasis',      label: 'Atelectasia' },
                                ].map(({ key, label }) => (
                                  <button key={key}
                                    className={`btn btn-sm ${(structuredScores.chest as any)?.[key] ? 'btn-primary' : 'btn-ghost'}`}
                                    onClick={() => setStructuredScores((s) => ({
                                      ...s, chest: { ...s.chest, [key]: !(s.chest as any)?.[key] }
                                    }))}
                                    style={{ padding: '3px 8px', fontSize: 11 }}
                                  >{label}</button>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {Object.keys(structuredScores).length === 0 && (
                            <p style={{ fontSize: 11, color: 'var(--gray-400)', margin: 0 }}>
                              Las puntuaciones se muestran según la modalidad del estudio (BI-RADS para MG/US, TI-RADS para US, PI-RADS para MR, etc.)
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
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

                          {/* Discard button — visible while a suggestion is pending */}
                          {hasPendingAiSuggestion && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={discardAiSuggestion}
                              style={{ justifyContent: 'flex-start', gap: 6, color: '#b45309', borderColor: '#f59e0b' }}
                              title="Revertir al texto anterior y marcar sugerencia como descartada"
                            >
                              ✕ Descartar sugerencia IA
                            </button>
                          )}

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

      {/* ── Sección 4: Modal de confirmación de firma ───────────────────────── */}
      {showSignModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', color: 'var(--gray-800)', fontSize: 16 }}>✍ Confirmar firma del informe</h3>
            <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '0 0 16px', lineHeight: 1.5 }}>
              La firma de un informe médico es un <strong>acto clínico-legal</strong>. Ingrese su contraseña
              para confirmar su identidad antes de firmar.
            </p>
            <div className="form-group">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Contraseña *</label>
              <input
                type="password"
                value={signPassword}
                onChange={(e) => setSignPassword(e.target.value)}
                placeholder="Ingrese su contraseña"
                style={{ width: '100%', fontSize: 13, padding: '8px 10px', border: '1.5px solid var(--gray-300)', borderRadius: 8 }}
                onKeyDown={(e) => { if (e.key === 'Enter') signReport(); }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setShowSignModal(false); setSignPassword(''); }} disabled={signing}>Cancelar</button>
              <button className="btn btn-primary" onClick={signReport} disabled={!signPassword.trim() || signing}>
                {signing ? 'Firmando...' : '✍ Firmar informe'}
              </button>
            </div>
            <div style={{ marginTop: 12, fontSize: 10, color: 'var(--gray-400)', lineHeight: 1.4, borderTop: '1px solid var(--gray-200)', paddingTop: 10 }}>
              FIRMA ELECTRÓNICA SIMPLE (Ley 25.506) — No constituye firma digital con plena validez legal (ANMAT Disp. 7304/2012).
            </div>
          </div>
        </div>
      )}

      {/* ── Sección 1: Modal de hallazgo crítico ────────────────────────────── */}
      {showCriticalModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 460, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', color: '#dc2626', fontSize: 16 }}>🚨 Marcar hallazgo crítico / STAT</h3>
            <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Se enviará una <strong>notificación inmediata</strong> (email + push) al médico solicitante.
              Se registrará la hora y el destinatario según el estándar <strong>ACR Practice Parameter</strong>.
            </p>
            <div className="form-group">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Descripción del hallazgo crítico *</label>
              <textarea
                value={criticalReason}
                onChange={(e) => setCriticalReason(e.target.value)}
                placeholder="Ej: Neumotórax a tensión. Embolia pulmonar masiva. Masa de 4cm en lóbulo superior derecho..."
                rows={3}
                style={{ width: '100%', fontSize: 13, padding: '8px 10px', border: '1.5px solid #fca5a5', borderRadius: 8 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setShowCriticalModal(false); setCriticalReason(''); }} disabled={markingCritical}>Cancelar</button>
              <button
                onClick={markCritical}
                disabled={!criticalReason.trim() || markingCritical}
                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
              >
                {markingCritical ? 'Marcando...' : '🚨 Marcar como CRÍTICO y notificar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sección 20: Modal de vista previa del PDF ────────────────────────── */}
      {showPdfPreview && report?.pdfPath && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, width: '90vw', height: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--gray-200)' }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>👁 Vista previa del PDF</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPdfPreview(false)}>✕ Cerrar</button>
            </div>
            <iframe
              src={`${getFilesBaseUrl()}/${report.pdfPath}?token=${getAccessToken()}`}
              style={{ flex: 1, border: 'none', borderRadius: '0 0 12px 12px' }}
              title="Vista previa del informe"
            />
          </div>
        </div>
      )}

      {/* ── Sección 12: Modal de revisión por pares ─────────────────────────── */}
      {showPeerReviewModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 460, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', color: '#4338ca', fontSize: 16 }}>👥 Revisión por pares</h3>
            <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Registre su revisión del informe. El médico informante recibirá una notificación.
            </p>
            <div className="form-group">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Estado de revisión</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {(['REVIEWED', 'DISCREPANT'] as const).map((s) => (
                  <button key={s}
                    className={`btn btn-sm ${peerReviewStatus === s ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setPeerReviewStatus(s)}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    {s === 'REVIEWED' ? '✓ Concordante' : '⚠ Discrepante'}
                  </button>
                ))}
              </div>
            </div>
            {peerReviewStatus === 'DISCREPANT' && (
              <div className="form-group">
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Nivel de discrepancia</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {(['MINOR', 'MAJOR', 'CRITICAL'] as const).map((l) => (
                    <button key={l}
                      className={`btn btn-sm ${peerReviewLevel === l ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setPeerReviewLevel(l)}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                    >
                      {l === 'MINOR' ? 'Menor' : l === 'MAJOR' ? 'Mayor' : 'Crítica'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="form-group">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Comentario (opcional)</label>
              <textarea
                value={peerReviewComment}
                onChange={(e) => setPeerReviewComment(e.target.value)}
                placeholder="Describa la discrepancia o comentarios relevantes..."
                rows={3}
                style={{ width: '100%', fontSize: 13, padding: '8px 10px', border: '1.5px solid var(--gray-300)', borderRadius: 8 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowPeerReviewModal(false)} disabled={submittingPeerReview}>Cancelar</button>
              <button className="btn btn-primary" onClick={submitPeerReview} disabled={submittingPeerReview}>
                {submittingPeerReview ? 'Registrando...' : 'Registrar revisión'}
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

// ── Sección 19: SpellCheckBadge — shows misspelling count with expandable list ─

function SpellCheckBadge({ errors }: { errors: SpellError[] }) {
  const [expanded, setExpanded] = useState(false);
  if (errors.length === 0) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        style={{
          fontSize: 11, color: '#92400e', background: '#fef3c7',
          border: '1px solid #fcd34d', borderRadius: 4,
          padding: '2px 8px', cursor: 'pointer',
        }}
      >
        ⚠ {errors.length} posible{errors.length > 1 ? 's' : ''} error{errors.length > 1 ? 'es' : ''} ortográfico{errors.length > 1 ? 's' : ''} {expanded ? '▲' : '▼'}
      </button>
      {expanded && (
        <div style={{
          marginTop: 4, padding: '6px 10px', background: '#fffbeb',
          border: '1px solid #fcd34d', borderRadius: 4, fontSize: 12,
        }}>
          {errors.map((err, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: '#92400e', fontWeight: 600 }}>"{err.word}"</span>
              {err.suggestions.length > 0 && (
                <span style={{ color: '#374151' }}>
                  {' '}→ sugerir: <em>{err.suggestions.join(', ')}</em>
                </span>
              )}
            </div>
          ))}
          <div style={{ marginTop: 6, color: '#78350f', fontSize: 11 }}>
            💡 El corrector del navegador (lang="es") también está activo.
            Para ver sugerencias: haga clic derecho sobre la palabra subrayada,
            o use el menú contextual del teclado (Shift+F10 / tecla Aplicación).
            Para agregar un término médico al diccionario: clic derecho → "Agregar al diccionario".
          </div>
        </div>
      )}
    </div>
  );
}
