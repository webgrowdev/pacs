import { useEffect, useState, FormEvent } from 'react';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';

interface ReportTemplate {
  id: string;
  name: string;
  modality?: string | null;
  findingsTemplate: string;
  conclusionTemplate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const MODALITIES = ['RX', 'TC', 'RM', 'ECO', 'PET', 'MAMM', 'NM', 'ANGIO', 'CT', 'MRI', 'US', 'MG', 'XA', 'CR', 'DR', 'OT'];

const EMPTY_FORM = {
  name: '',
  modality: '',
  findingsTemplate: '',
  conclusionTemplate: ''
};

export function ReportTemplatesPage() {
  const [templates,   setTemplates]   = useState<ReportTemplate[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [editing,     setEditing]     = useState<ReportTemplate | null>(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [preview,     setPreview]     = useState<ReportTemplate | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/report-templates/all');
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowModal(true);
  };

  const openEdit = (t: ReportTemplate) => {
    setEditing(t);
    setForm({
      name: t.name,
      modality: t.modality ?? '',
      findingsTemplate: t.findingsTemplate,
      conclusionTemplate: t.conclusionTemplate
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('El nombre es obligatorio');
    if (!form.findingsTemplate.trim()) return setError('Los hallazgos son obligatorios');
    if (!form.conclusionTemplate.trim()) return setError('La conclusión es obligatoria');
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        modality: form.modality.trim() || null,
        findingsTemplate: form.findingsTemplate,
        conclusionTemplate: form.conclusionTemplate
      };
      if (editing) {
        await api.put(`/report-templates/${editing.id}`, payload);
      } else {
        await api.post('/report-templates', payload);
      }
      setShowModal(false);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Error al guardar plantilla');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: ReportTemplate) => {
    try {
      await api.put(`/report-templates/${t.id}`, { isActive: !t.isActive });
      load();
    } catch {
      // ignore
    }
  };

  const handleDelete = async (t: ReportTemplate) => {
    if (!window.confirm(`¿Desactivar la plantilla "${t.name}"?`)) return;
    try {
      await api.delete(`/report-templates/${t.id}`);
      load();
    } catch {
      // ignore
    }
  };

  return (
    <AppLayout
      title="Plantillas de informes"
      actions={
        <button className="btn btn-primary" onClick={openCreate}>
          + Nueva plantilla
        </button>
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Modalidad</th>
              <th>Hallazgos (preview)</th>
              <th>Estado</th>
              <th>Última mod.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}><div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div></td></tr>
            ) : templates.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <div className="empty-icon">📋</div>
                    <div className="empty-title">Sin plantillas</div>
                    <div className="empty-desc">Cree plantillas de informes por modalidad para agilizar la redacción</div>
                  </div>
                </td>
              </tr>
            ) : (
              templates.map((t) => (
                <tr key={t.id} style={{ opacity: t.isActive ? 1 : 0.5 }}>
                  <td>
                    <span className="font-medium">{t.name}</span>
                  </td>
                  <td>
                    {t.modality
                      ? <span className="badge badge-blue">{t.modality}</span>
                      : <span className="text-xs text-muted">Genérica</span>}
                  </td>
                  <td className="text-sm text-muted" style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.findingsTemplate.substring(0, 80)}{t.findingsTemplate.length > 80 ? '…' : ''}
                  </td>
                  <td>
                    {t.isActive
                      ? <span className="badge badge-green">Activa</span>
                      : <span className="badge badge-gray">Inactiva</span>}
                  </td>
                  <td className="text-sm text-muted">
                    {new Date(t.updatedAt).toLocaleDateString('es-AR')}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setPreview(t)}>Ver</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(t)}>Editar</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleActive(t)}
                        title={t.isActive ? 'Desactivar' : 'Activar'}
                      >
                        {t.isActive ? '⏸' : '▶'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDelete(t)}
                        style={{ color: 'var(--error-600)' }}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal"
            style={{ maxWidth: 680, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">{editing ? 'Editar plantilla' : 'Nueva plantilla'}</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Nombre de la plantilla *</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                      required
                      placeholder="Ej: RX Tórax AP estándar"
                    />
                  </div>
                  <div className="form-group">
                    <label>Modalidad</label>
                    <select
                      value={form.modality}
                      onChange={(e) => setForm(f => ({ ...f, modality: e.target.value }))}
                    >
                      <option value="">Genérica (todas las modalidades)</option>
                      {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Plantilla de Hallazgos *</label>
                  <textarea
                    value={form.findingsTemplate}
                    onChange={(e) => setForm(f => ({ ...f, findingsTemplate: e.target.value }))}
                    required
                    rows={6}
                    placeholder="Texto pre-cargado para la sección de hallazgos. El médico podrá editar este texto al redactar el informe."
                    style={{
                      width: '100%', resize: 'vertical', fontSize: 13,
                      lineHeight: 1.6, padding: '8px 10px',
                      border: '1px solid var(--gray-300)', borderRadius: 6,
                      fontFamily: 'inherit'
                    }}
                  />
                </div>

                <div className="form-group">
                  <label>Plantilla de Conclusión *</label>
                  <textarea
                    value={form.conclusionTemplate}
                    onChange={(e) => setForm(f => ({ ...f, conclusionTemplate: e.target.value }))}
                    required
                    rows={4}
                    placeholder="Texto pre-cargado para la sección de conclusión."
                    style={{
                      width: '100%', resize: 'vertical', fontSize: 13,
                      lineHeight: 1.6, padding: '8px 10px',
                      border: '1px solid var(--gray-300)', borderRadius: 6,
                      fontFamily: 'inherit'
                    }}
                  />
                </div>

                {error && <div className="alert alert-error"><span>✕</span><span>{error}</span></div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear plantilla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div
            className="modal"
            style={{ maxWidth: 620, width: '95vw', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 className="modal-title">{preview.name}</h2>
                {preview.modality && <span className="badge badge-blue" style={{ marginTop: 4 }}>{preview.modality}</span>}
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="text-xs text-muted" style={{ fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Hallazgos</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--gray-700)', whiteSpace: 'pre-wrap' }}>{preview.findingsTemplate}</div>
              </div>
              <div>
                <div className="text-xs text-muted" style={{ fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Conclusión</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--gray-700)', whiteSpace: 'pre-wrap' }}>{preview.conclusionTemplate}</div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPreview(null)}>Cerrar</button>
              <button className="btn btn-primary" onClick={() => { openEdit(preview); setPreview(null); }}>Editar</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
