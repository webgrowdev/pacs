import { useEffect, useState, FormEvent, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

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
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (patientIdFilter) params.patientId = patientIdFilter;
      const [studiesRes, patientsRes] = await Promise.all([
        api.get('/studies', { params }),
        api.get('/patients')
      ]);
      setStudies(studiesRes.data);
      setPatients(patientsRes.data);
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
      load();
    } catch (err: any) {
      setUploadError(err?.response?.data?.message ?? 'Error al cargar el estudio');
    } finally {
      setUploading(false);
    }
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
                    <Link to={`/studies/${s.id}`} className="btn btn-ghost btn-sm">Abrir visor</Link>
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
            onClick={(e) => { if (e.target === e.currentTarget) setShowUpload(false); }}
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
                <button className="btn btn-ghost btn-icon" onClick={() => setShowUpload(false)}>✕</button>
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
                    <label>Archivos DICOM o ZIP *</label>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      accept=".dcm,.dicom,.zip,application/dicom"
                      onChange={(e) => setFiles(e.target.files)}
                      required
                    />
                    <span className="text-xs text-muted">Se aceptan archivos .dcm individuales o .zip con varios archivos DICOM</span>
                  </div>
                  {uploadError && <div className="alert alert-error"><span>✕</span><span>{uploadError}</span></div>}
                  {uploadSuccess && <div className="alert alert-success"><span>✓</span><span>{uploadSuccess}</span></div>}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowUpload(false)}>Cancelar</button>
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
