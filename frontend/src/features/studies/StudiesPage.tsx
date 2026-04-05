import { useEffect, useState, FormEvent, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

type UploadMode = 'files' | 'folder';

interface Study {
  id: string;
  modality: string;
  studyDate: string;
  status: string;
  description?: string;
  patient: { id: string; firstName: string; lastName: string; internalCode: string };
  reports: Array<{ id: string; status: string }>;
}

interface Patient { id: string; firstName: string; lastName: string; internalCode: string; }

const MODALITIES = ['RX', 'TC', 'RM', 'ECO', 'PET', 'MAMM', 'NM', 'ANGIO', 'OTRO'];

export function StudiesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams] = useSearchParams();
  const patientIdFilter = searchParams.get('patientId') ?? '';

  const [studies, setStudies] = useState<Study[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({
    patientId: patientIdFilter,
    modality: 'RX',
    studyDate: new Date().toISOString().split('T')[0],
    description: ''
  });
  const [uploadMode, setUploadMode] = useState<UploadMode>('files');
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (patientIdFilter) params.patientId = patientIdFilter;
      params.limit = 200;
      const [studiesRes, patientsRes] = await Promise.all([
        api.get('/studies', { params }),
        api.get('/patients', { params: { limit: 200 } })
      ]);
      // APIs return paginated { data, total } or plain arrays
      setStudies(Array.isArray(studiesRes.data) ? studiesRes.data : studiesRes.data.data ?? []);
      setPatients(Array.isArray(patientsRes.data) ? patientsRes.data : patientsRes.data.data ?? []);
    } catch (err: any) {
      console.error('[STUDIES]', err);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [patientIdFilter]);

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!files || files.length === 0) return setUploadError('Seleccione al menos un archivo DICOM o ZIP');
    setUploadError('');
    setUploadSuccess('');
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append('patientId', form.patientId);
      fd.append('modality', form.modality);
      fd.append('studyDate', new Date(form.studyDate + 'T12:00:00Z').toISOString());
      fd.append('description', form.description);
      for (let i = 0; i < files.length; i++) fd.append('files', files[i]);

      const { data } = await api.post('/studies/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setUploadSuccess(`Estudio creado. ${data.files} archivo(s) procesado(s).`);
      setForm({ patientId: patientIdFilter, modality: 'RX', studyDate: new Date().toISOString().split('T')[0], description: '' });
      setFiles(null);
      if (fileRef.current) fileRef.current.value = '';
      if (folderRef.current) folderRef.current.value = '';
      load();
    } catch (err: any) {
      setUploadError(err?.response?.data?.message ?? 'Error al cargar el estudio');
    } finally {
      setUploading(false);
    }
  };

  const handleModeChange = (mode: UploadMode) => {
    setUploadMode(mode);
    setFiles(null);
    if (fileRef.current) fileRef.current.value = '';
    if (folderRef.current) folderRef.current.value = '';
  };

  return (
    <AppLayout
      title="Estudios DICOM"
      actions={
        <button className="btn btn-primary" onClick={() => { setShowUpload(true); setUploadError(''); setUploadSuccess(''); }}>
          + Cargar estudio
        </button>
      }
    >
      {/* List */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Paciente</th>
              <th>Modalidad</th>
              <th>Fecha estudio</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th>Informe</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}><div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div></td></tr>
            ) : studies.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <div className="empty-icon">⊞</div>
                    <div className="empty-title">Sin estudios</div>
                    <div className="empty-desc">Cargue el primer estudio DICOM</div>
                  </div>
                </td>
              </tr>
            ) : (
              studies.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="font-medium">{s.patient.lastName}, {s.patient.firstName}</span>
                    <div className="text-xs text-muted">{s.patient.internalCode}</div>
                  </td>
                  <td><span className="badge badge-blue">{s.modality}</span></td>
                  <td className="text-sm">{formatDate(s.studyDate)}</td>
                  <td className="text-sm text-muted truncate" style={{ maxWidth: 180 }}>{s.description || '—'}</td>
                  <td><StudyStatusBadge status={s.status} /></td>
                  <td>
                    {s.reports[0] ? (
                      <ReportStatusBadge status={s.reports[0].status} />
                    ) : (
                      <span className="text-xs text-muted">Sin informe</span>
                    )}
                  </td>
                  <td>
                    {s.reports[0]?.status === 'FINAL' || s.reports[0]?.status === 'SIGNED' ? (
                      <Link to={`/studies/${s.id}`} className="btn btn-ghost btn-sm">Ver informe</Link>
                    ) : (
                      <Link to={`/studies/${s.id}`} className="btn btn-primary btn-sm">Informar</Link>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Upload modal */}
      <AnimatePresence>
        {showUpload && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) { setShowUpload(false); setUploadMode('files'); } }}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <h2 className="modal-title">Cargar nuevo estudio DICOM</h2>
                <button className="btn btn-ghost btn-icon" onClick={() => { setShowUpload(false); setUploadMode('files'); }}>✕</button>
              </div>
              <form onSubmit={handleUpload}>
                <div className="modal-body form-grid">
                  <div className="form-group">
                    <label>Paciente *</label>
                    <select value={form.patientId} onChange={(e) => setForm(f => ({ ...f, patientId: e.target.value }))} required>
                      <option value="">Seleccionar paciente...</option>
                      {patients.map((p) => (
                        <option key={p.id} value={p.id}>{p.lastName}, {p.firstName} ({p.internalCode})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Modalidad *</label>
                      <select value={form.modality} onChange={(e) => setForm(f => ({ ...f, modality: e.target.value }))} required>
                        {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Fecha del estudio *</label>
                      <input type="date" value={form.studyDate} onChange={(e) => setForm(f => ({ ...f, studyDate: e.target.value }))} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Descripción</label>
                    <input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ej: RM de rodilla derecha, RX de tórax AP..." />
                  </div>
                  <div className="form-group">
                    <label>Tipo de carga</label>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${uploadMode === 'files' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => handleModeChange('files')}
                      >
                        📄 Archivos
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${uploadMode === 'folder' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => handleModeChange('folder')}
                      >
                        📁 Carpeta
                      </button>
                    </div>

                    {uploadMode === 'files' ? (
                      <>
                        <input
                          ref={fileRef}
                          type="file"
                          multiple
                          accept=".dcm,.dicom,.zip,.tar,.tar.gz,.tgz,.tar.bz2,.tbz,.tbz2,application/dicom,application/x-bzip2,application/x-tar,application/gzip"
                          onChange={(e) => setFiles(e.target.files)}
                          required
                        />
                        <span className="text-xs text-muted">
                          Se aceptan: archivos <strong>.dcm</strong> individuales · <strong>.zip</strong> · <strong>.tar.bz2</strong> · <strong>.tar.gz</strong> · <strong>.tgz</strong> con varios archivos DICOM.
                          También puede subir archivos <strong>.tar.bz2</strong> descomprimiéndolos primero o seleccionando el archivo comprimido directamente.
                        </span>
                      </>
                    ) : (
                      <>
                        <input
                          ref={folderRef}
                          type="file"
                          {...({ webkitdirectory: '', mozdirectory: '' } as any)}
                          onChange={(e) => setFiles(e.target.files)}
                          required
                        />
                        {files && files.length > 0 && (
                          <span className="text-xs" style={{ color: 'var(--brand-600)', display: 'block', marginTop: 4 }}>
                            📁 {files.length} archivo(s) detectado(s) en la carpeta seleccionada
                          </span>
                        )}
                        <span className="text-xs text-muted">
                          Seleccione la carpeta raíz del estudio. Se procesarán todos los archivos DICOM encontrados, incluyendo subcarpetas y DICOMDIR.
                        </span>
                      </>
                    )}
                  </div>
                  {uploadError && <div className="alert alert-error"><span>✕</span><span>{uploadError}</span></div>}
                  {uploadSuccess && <div className="alert alert-success"><span>✓</span><span>{uploadSuccess}</span></div>}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => { setShowUpload(false); setUploadMode('files'); }}>Cancelar</button>
                  <button type="submit" className="btn btn-primary" disabled={uploading}>
                    {uploading ? 'Cargando...' : 'Subir estudio'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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

function ReportStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: 'Borrador', cls: 'badge-yellow' },
    FINAL: { label: 'Finalizado', cls: 'badge-green' },
    SIGNED: { label: 'Firmado', cls: 'badge-purple' }
  };
  const m = map[status] ?? { label: status, cls: 'badge-gray' };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}
