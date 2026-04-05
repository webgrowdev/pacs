import { useEffect, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

interface Patient {
  id: string;
  internalCode: string;
  firstName: string;
  lastName: string;
  documentId: string;
  cuil?: string;
  dateOfBirth: string;
  sex: string;
  email?: string;
  phone?: string;
  healthInsurance?: string;
  healthInsurancePlan?: string;
  healthInsuranceMemberId?: string;
  _count?: { studies: number };
}

const EMPTY_FORM = {
  internalCode: '', firstName: '', lastName: '', documentId: '', cuil: '',
  dateOfBirth: '', sex: 'M', email: '', phone: '',
  healthInsurance: '', healthInsurancePlan: '', healthInsuranceMemberId: ''
};

export function PatientsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing,  setEditing]  = useState<Patient | null>(null);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const LIMIT = 50;

  const load = async (p = page) => {
    setLoading(true);
    try {
      const params: any = { page: p, limit: LIMIT };
      if (search) params.search = search;
      const { data } = await api.get('/patients', { params });
      // API now returns { data, total, page, limit }
      setPatients(Array.isArray(data) ? data : data.data ?? []);
      setTotal(data.total ?? (Array.isArray(data) ? data.length : 0));
    } catch (err: any) {
      console.error('[PATIENTS]', err);
    }
    setLoading(false);
  };

  useEffect(() => { setPage(1); load(1); }, [search]);
  useEffect(() => { if (page > 1) load(page); }, [page]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowModal(true);
  };

  const openEdit = (p: Patient) => {
    setEditing(p);
    setForm({
      internalCode: p.internalCode,
      firstName: p.firstName,
      lastName: p.lastName,
      documentId: p.documentId,
      cuil: p.cuil ?? '',
      dateOfBirth: p.dateOfBirth ? p.dateOfBirth.split('T')[0] : '',
      sex: p.sex,
      email: p.email ?? '',
      phone: p.phone ?? '',
      healthInsurance: p.healthInsurance ?? '',
      healthInsurancePlan: p.healthInsurancePlan ?? '',
      healthInsuranceMemberId: p.healthInsuranceMemberId ?? ''
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, dateOfBirth: new Date(form.dateOfBirth).toISOString() };
      if (editing) {
        await api.put(`/patients/${editing.id}`, payload);
      } else {
        await api.post('/patients', payload);
      }
      setShowModal(false);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Error al guardar paciente');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <AppLayout
      title="Pacientes"
      actions={
        isAdmin ? (
          <button className="btn btn-primary" onClick={openCreate}>
            + Nuevo paciente
          </button>
        ) : undefined
      }
    >
      {/* Search */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <div className="search-bar" style={{ maxWidth: 360, flex: 1 }}>
          <span className="search-icon">⌕</span>
          <input
            type="text"
            placeholder="Buscar por nombre, código o documento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-muted">
          {loading ? 'Cargando...' : `${total} paciente${total !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Apellido, Nombre</th>
              <th>Documento</th>
              <th>Fecha nac.</th>
              <th>Sexo</th>
              <th>Estudios</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}><div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div></td></tr>
            ) : patients.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <div className="empty-icon">♥</div>
                    <div className="empty-title">Sin pacientes</div>
                    <div className="empty-desc">{search ? 'No se encontraron resultados' : 'Cree el primer paciente'}</div>
                  </div>
                </td>
              </tr>
            ) : (
              patients.map((p) => (
                <tr key={p.id}>
                  <td><span className="badge badge-gray">{p.internalCode}</span></td>
                  <td className="font-medium">{p.lastName}, {p.firstName}</td>
                  <td className="text-sm text-muted">{p.documentId}</td>
                  <td className="text-sm text-muted">{formatDate(p.dateOfBirth)}</td>
                  <td>{p.sex === 'M' ? 'Masc.' : p.sex === 'F' ? 'Fem.' : 'N/E'}</td>
                  <td>
                    <span className="badge badge-blue">{p._count?.studies ?? 0}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Link
                        to={`/patients/${p.id}`}
                        className="btn btn-ghost btn-sm"
                        title="Ver detalle"
                      >
                        Detalle
                      </Link>
                      <Link
                        to={`/studies?patientId=${p.id}`}
                        className="btn btn-ghost btn-sm"
                        title="Ver estudios"
                      >
                        Estudios
                      </Link>
                      {isAdmin && (
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>
                          Editar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>← Anterior</button>
          <span className="text-sm text-muted">Página {page} de {totalPages}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Siguiente →</button>
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
          >
            <motion.div
              className="modal"
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <h2 className="modal-title">{editing ? 'Editar paciente' : 'Nuevo paciente'}</h2>
                <button className="btn btn-ghost btn-icon" onClick={() => setShowModal(false)}>✕</button>
              </div>
              <form onSubmit={handleSave}>
                <div className="modal-body form-grid">
                  <div className="form-row">
                    <div className="form-group">
                      <label>Código interno *</label>
                      <input value={form.internalCode} onChange={(e) => setForm(f => ({ ...f, internalCode: e.target.value }))} required placeholder="PAC-0001" />
                    </div>
                    <div className="form-group">
                      <label>Documento *</label>
                      <input value={form.documentId} onChange={(e) => setForm(f => ({ ...f, documentId: e.target.value }))} required placeholder="DNI12345678" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Nombre *</label>
                      <input value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label>Apellido *</label>
                      <input value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))} required />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Fecha de nacimiento *</label>
                      <input type="date" value={form.dateOfBirth} onChange={(e) => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label>Sexo biológico *</label>
                      <select value={form.sex} onChange={(e) => setForm(f => ({ ...f, sex: e.target.value }))}>
                        <option value="M">Masculino</option>
                        <option value="F">Femenino</option>
                        <option value="X">No especificado</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Email</label>
                      <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="opcional" />
                    </div>
                    <div className="form-group">
                      <label>Teléfono</label>
                      <input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="opcional" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>CUIL</label>
                      <input
                        value={form.cuil}
                        onChange={(e) => setForm(f => ({ ...f, cuil: e.target.value }))}
                        placeholder="ej. 20-12345678-9"
                        pattern="^\d{2}-\d{7,8}-\d$"
                        title="Formato: XX-XXXXXXXX-X"
                      />
                    </div>
                    <div className="form-group" />
                  </div>
                  <div style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 12, marginTop: 4 }}>
                    <div className="text-xs text-muted" style={{ fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cobertura médica</div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Obra social / prepaga</label>
                        <input
                          value={form.healthInsurance}
                          onChange={(e) => setForm(f => ({ ...f, healthInsurance: e.target.value }))}
                          placeholder="ej. OSDE, PAMI, Swiss Medical..."
                        />
                      </div>
                      <div className="form-group">
                        <label>Plan</label>
                        <input
                          value={form.healthInsurancePlan}
                          onChange={(e) => setForm(f => ({ ...f, healthInsurancePlan: e.target.value }))}
                          placeholder="ej. 210, Gold, Básico..."
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Número de afiliado</label>
                        <input
                          value={form.healthInsuranceMemberId}
                          onChange={(e) => setForm(f => ({ ...f, healthInsuranceMemberId: e.target.value }))}
                          placeholder="opcional"
                        />
                      </div>
                      <div className="form-group" />
                    </div>
                  </div>
                  {error && <div className="alert alert-error"><span>✕</span><span>{error}</span></div>}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear paciente'}
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

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}
