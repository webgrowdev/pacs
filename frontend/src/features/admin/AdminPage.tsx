import { useState, FormEvent } from 'react';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';

export function AdminPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleExport = async (e: FormEvent) => {
    e.preventDefault();
    setExporting(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.get('/audit/export', {
        params: { from, to, format },
        responseType: format === 'csv' ? 'blob' : 'json'
      });

      if (format === 'csv') {
        const blob = new Blob([response.data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-${from}-to-${to}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setSuccess('Exportación completada. Archivo descargado.');
      } else {
        const json = JSON.stringify(response.data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-${from}-to-${to}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setSuccess(`Exportación completada. ${response.data.length} registros.`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Error al exportar');
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppLayout title="Administración">
      <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Audit Export */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Exportar Log de Auditoría</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>
            Descarga el registro de todas las acciones del sistema en el rango de fechas seleccionado.
          </p>
          <form onSubmit={handleExport} className="form-grid">
            <div className="form-row">
              <div className="form-group">
                <label>Fecha desde</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Fecha hasta</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
              </div>
            </div>
            <div className="form-group">
              <label>Formato</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}>
                <option value="csv">CSV (Excel)</option>
                <option value="json">JSON</option>
              </select>
            </div>
            {error && <div className="alert alert-error"><span>✕</span><span>{error}</span></div>}
            {success && <div className="alert alert-success"><span>✓</span><span>{success}</span></div>}
            <div>
              <button type="submit" className="btn btn-primary" disabled={exporting}>
                {exporting ? 'Exportando...' : '⬇ Descargar auditoría'}
              </button>
            </div>
          </form>
        </div>

        {/* SFTP Info */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Carga masiva SFTP</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 12 }}>
            Coloca archivos <code>.dcm</code> en la carpeta de drop configurada en el servidor (<code>SFTP_DROP_FOLDER</code>).
            El sistema los detecta automáticamente, extrae los metadatos DICOM y los procesa al instante.
          </p>
          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '12px 16px', fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ color: 'var(--success)' }}>✓</span>
              <span>Archivos procesados → movidos a <code>processed/</code></span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--danger)' }}>✕</span>
              <span>Archivos con error → movidos a <code>failed/</code></span>
            </div>
          </div>
        </div>

        {/* DICOM Info */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Configuración DICOM</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray-600)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>SCP Clásico (equipos viejos):</span>
              <span style={{ marginLeft: 8 }}>Puerto TCP configurado por <code>DICOM_SCP_PORT</code> (default: 11112)</span>
            </div>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>DICOMweb STOW-RS (equipos nuevos):</span>
              <span style={{ marginLeft: 8 }}><code>POST /wado/studies</code> con <code>Content-Type: multipart/related</code></span>
            </div>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>AE Title:</span>
              <span style={{ marginLeft: 8 }}>Configurado por <code>DICOM_AE_TITLE</code> (default: PACS_SERVER)</span>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
