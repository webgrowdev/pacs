import { useEffect, useState } from 'react';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';

interface Module {
  id: string;
  code: string;
  name: string;
  description: string;
  version: string;
  isActive: boolean;
  createdAt: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

function versionStatus(version: string): { label: string; color: string; bg: string } {
  const [major] = version.split('.').map(Number);
  if (major >= 1) return { label: '🟢 Activo',       color: '#16a34a', bg: '#f0fdf4' };
  if (version === '0.0.0') return { label: '🔴 Pendiente', color: '#dc2626', bg: '#fef2f2' };
  return { label: '🟡 Parcial',   color: '#d97706', bg: '#fffbeb' };
}

export function ModulesAdminPage() {
  const [modules,  setModules]  = useState<Module[]>([]);
  const [tenants,  setTenants]  = useState<Tenant[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error,    setError]    = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [modsRes, tenantsRes] = await Promise.all([
        api.get<Module[]>('/system/modules'),
        api.get<Tenant[]>('/system/tenants'),
      ]);
      setModules(modsRes.data);
      setTenants(tenantsRes.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Error al cargar módulos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (tenantId: string, moduleCode: string) => {
    const key = `${tenantId}-${moduleCode}`;
    setToggling(key);
    try {
      await api.put(`/system/tenants/${tenantId}/modules/${moduleCode}/toggle`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Error al cambiar estado');
    } finally {
      setToggling(null);
    }
  };

  const firstTenant = tenants[0];

  return (
    <AppLayout title="Módulos del sistema">
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: 0 }}>
          Gestione los módulos disponibles en el sistema y su activación por tenant.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          <span>✕</span><span>{error}</span>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">📦 Módulos del sistema</span>
          {firstTenant && (
            <span style={{ fontSize: 12, color: 'var(--gray-500)', marginLeft: 'auto' }}>
              Tenant activo: <strong>{firstTenant.name}</strong>
            </span>
          )}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Módulo</th>
                <th>Código</th>
                <th>Versión</th>
                <th>Estado</th>
                <th>Descripción</th>
                {firstTenant && <th>Tenant activo</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={firstTenant ? 6 : 5}>
                    <div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div>
                  </td>
                </tr>
              ) : modules.length === 0 ? (
                <tr>
                  <td colSpan={firstTenant ? 6 : 5}>
                    <div className="empty-state">
                      <div className="empty-icon">📦</div>
                      <div className="empty-title">Sin módulos</div>
                      <div className="empty-desc">Ejecute el seed de base de datos</div>
                    </div>
                  </td>
                </tr>
              ) : (
                modules.map((mod) => {
                  const vs = versionStatus(mod.version);
                  return (
                    <tr key={mod.id}>
                      <td>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{mod.name}</span>
                      </td>
                      <td>
                        <code style={{
                          background: 'var(--gray-100)', borderRadius: 4,
                          padding: '2px 6px', fontSize: 11, fontFamily: 'monospace'
                        }}>
                          {mod.code}
                        </code>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: 'var(--gray-600)' }}>{mod.version}</span>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          background: vs.bg,
                          color: vs.color,
                          border: `1px solid ${vs.color}40`,
                          borderRadius: 12,
                          padding: '2px 10px',
                          fontSize: 11,
                          fontWeight: 500,
                          whiteSpace: 'nowrap'
                        }}>
                          {vs.label}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--gray-600)', maxWidth: 280 }}>
                        {mod.description}
                      </td>
                      {firstTenant && (
                        <td>
                          <button
                            className="btn btn-sm btn-ghost"
                            disabled={toggling === `${firstTenant.id}-${mod.code}`}
                            onClick={() => handleToggle(firstTenant.id, mod.code)}
                            title={`Cambiar estado de ${mod.code} para ${firstTenant.name}`}
                          >
                            {toggling === `${firstTenant.id}-${mod.code}` ? '...' : '⇄ Toggle'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
