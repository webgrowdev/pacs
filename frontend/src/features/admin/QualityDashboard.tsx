import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface QualityIndicators {
  period: string;
  totalStudies: number;
  totalReports: number;
  reportingRate: number;
  avgTatMinutes: number | null;
  slaBreachRate: number;
  criticalFindingsCount: number;
  criticalAckRate: number;
  peerReviewDiscrepancyRate: number;
  aiUsageRate: number;
  addendumRate: number;
  byModality: Array<{ modality: string; count: number; avgTat: number | null }>;
}

export function QualityDashboard() {
  const [data, setData]             = useState<QualityIndicators | null>(null);
  const [period, setPeriod]         = useState('30d');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [tatBreakdown, setTatBreakdown] = useState<any[]>([]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const days = period === '90d' ? 90 : period === '365d' ? 365 : 30;
    const fromDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    const toDate   = new Date().toISOString().split('T')[0];
    Promise.all([
      api.get(`/analytics/quality-indicators?period=${period}`),
      api.get(`/analytics/tat?from=${fromDate}&to=${toDate}`)
    ])
      .then(([qi, tat]) => { setData(qi.data); setTatBreakdown(tat.data?.breakdown ?? []); })
      .catch(() => setError('Error al cargar indicadores'))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) return <div style={{ padding: 24, textAlign: 'center' }}>Cargando...</div>;
  if (error)   return <div style={{ padding: 24, color: '#dc2626' }}>{error}</div>;
  if (!data)   return null;

  const Metric = ({ label, value, unit, warn }: { label: string; value: string | number | null; unit?: string; warn?: boolean }) => (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
      padding: '16px 20px', minWidth: 160, flex: '1 1 160px'
    }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: warn ? '#dc2626' : '#0f172a' }}>
        {value ?? '—'}{unit && value != null ? <span style={{ fontSize: 13, color: '#64748b', marginLeft: 3 }}>{unit}</span> : null}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📊 Indicadores de Calidad</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['30d', '90d', '365d'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '4px 12px', borderRadius: 6, border: '1px solid #e2e8f0',
                background: period === p ? '#0f172a' : '#fff',
                color: period === p ? '#fff' : '#374151',
                cursor: 'pointer', fontSize: 12
              }}
            >{p}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <Metric label="Estudios totales" value={data.totalStudies} />
        <Metric label="Informes finalizados" value={data.totalReports} />
        <Metric label="Tasa de informes" value={data.reportingRate} unit="%" warn={data.reportingRate < 90} />
        <Metric label="TAT promedio" value={data.avgTatMinutes} unit="min" warn={(data.avgTatMinutes ?? 0) > 120} />
        <Metric label="Incumplimiento SLA" value={data.slaBreachRate} unit="%" warn={data.slaBreachRate > 5} />
        <Metric label="Hallazgos críticos" value={data.criticalFindingsCount} />
        <Metric label="Confirmación críticos" value={data.criticalAckRate} unit="%" warn={data.criticalAckRate < 100} />
        <Metric label="Discrepancias peer review" value={data.peerReviewDiscrepancyRate} unit="%" warn={data.peerReviewDiscrepancyRate > 3} />
        <Metric label="Uso de IA" value={data.aiUsageRate} unit="%" />
        <Metric label="Tasa de addendum" value={data.addendumRate} unit="%" />
      </div>

      {data.byModality.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Por modalidad</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>Modalidad</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>Informes</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>TAT promedio</th>
              </tr>
            </thead>
            <tbody>
              {data.byModality.map(m => (
                <tr key={m.modality} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{m.modality}</td>
                  <td style={{ padding: '8px 12px' }}>{m.count}</td>
                  <td style={{ padding: '8px 12px' }}>{m.avgTat != null ? `${m.avgTat} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tatBreakdown.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>TAT por médico (informes finalizados)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>Médico</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>Informes</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>TAT promedio</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>Estado SLA</th>
              </tr>
            </thead>
            <tbody>
              {tatBreakdown.map((d: any) => (
                <tr key={d.doctorId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 12px' }}>{d.doctorName}</td>
                  <td style={{ padding: '8px 12px' }}>{d.count}</td>
                  <td style={{ padding: '8px 12px' }}>{d.avg != null ? `${d.avg} min` : '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {d.avg > 120 ? <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠ Sobre SLA</span>
                                 : <span style={{ color: '#16a34a' }}>✓ OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
