import { useState, FormEvent, useEffect, useCallback } from 'react';
import { AppLayout } from '../../components/AppLayout';
import { api } from '../../lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Device {
  aeTitle: string;
  ipAddress: string;
  lastSeen: string;
  firstSeen: string;
  studiesCount: number;
  imagesCount: number;
  errorCount: number;
  status: 'online' | 'recent' | 'idle';
}

interface ServerConfig {
  aeTitle: string;
  scpPort: number;
  appBaseUrl: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span className="card-title">{title}</span>
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{
        background: '#0f172a',
        color: '#e2e8f0',
        borderRadius: 8,
        padding: '12px 16px',
        fontSize: 12,
        fontFamily: 'monospace',
        overflowX: 'auto',
        lineHeight: 1.7,
        margin: 0
      }}>
        {children}
      </pre>
      <button
        onClick={() => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        style={{
          position: 'absolute', top: 8, right: 8,
          background: copied ? '#16a34a' : 'rgba(255,255,255,0.1)',
          border: 'none', borderRadius: 4, color: '#e2e8f0',
          padding: '3px 8px', fontSize: 10, cursor: 'pointer'
        }}
      >
        {copied ? '✓ Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'var(--brand-500)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 1
      }}>{n}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--gray-800)', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.65 }}>{children}</div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: Device['status'] }) {
  const map = {
    online: { color: '#16a34a', label: 'En línea', bg: '#f0fdf4' },
    recent: { color: '#d97706', label: 'Reciente', bg: '#fffbeb' },
    idle:   { color: '#6b7280', label: 'Inactivo', bg: '#f9fafb' }
  };
  const s = map[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: s.bg, border: `1px solid ${s.color}40`,
      borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 500
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: s.color,
        ...(status === 'online' ? { animation: 'pulse 1.5s infinite' } : {})
      }} />
      <span style={{ color: s.color }}>{s.label}</span>
    </span>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1)  return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'monitor' | 'tutorial' | 'audit' | 'config';

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'monitor',  label: 'Equipos conectados', icon: '📡' },
  { id: 'tutorial', label: 'Tutorial de conexión', icon: '📋' },
  { id: 'audit',    label: 'Auditoría',           icon: '📊' },
  { id: 'config',   label: 'Configuración',        icon: '⚙' },
];

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('monitor');

  return (
    <AppLayout title="Administración">
      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, borderBottom: '2px solid var(--gray-200)',
        marginBottom: 24, marginLeft: -4
      }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 18px',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === t.id ? 600 : 400,
              color: activeTab === t.id ? 'var(--brand-600)' : 'var(--gray-500)',
              borderBottom: activeTab === t.id ? '2px solid var(--brand-500)' : '2px solid transparent',
              marginBottom: -2, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {activeTab === 'monitor'  && <MonitorTab />}
      {activeTab === 'tutorial' && <TutorialTab />}
      {activeTab === 'audit'    && <AuditTab />}
      {activeTab === 'config'   && <ConfigTab />}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Equipment Monitor
// ─────────────────────────────────────────────────────────────────────────────

function MonitorTab() {
  const [devices,      setDevices]      = useState<Device[]>([]);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/audit/devices');
      setDevices(data.devices ?? []);
      setServerConfig(data.serverConfig ?? null);
      setLastRefresh(new Date());
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Error al cargar dispositivos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const online = devices.filter((d) => d.status === 'online').length;
  const recent = devices.filter((d) => d.status === 'recent').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: 'Equipos activos',    value: online,          color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
          { label: 'Activos última hora',value: online + recent, color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
          { label: 'Total equipos',      value: devices.length,  color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
          { label: 'Total imágenes (72h)',value: devices.reduce((a, d) => a + d.imagesCount, 0), color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
        ].map((s) => (
          <div key={s.label} style={{
            background: s.bg, border: `1px solid ${s.border}`,
            borderRadius: 12, padding: '14px 18px'
          }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Device table */}
      <SectionCard title="Equipos DICOM — últimas 72 horas" icon="📡">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
            {lastRefresh ? `Actualizado: ${lastRefresh.toLocaleTimeString('es-AR')} · Auto-refresca cada 30 s` : ''}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => load()}>⟳ Actualizar</button>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>
            <span>✕</span><span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="empty-state"><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : devices.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 0' }}>
            <div className="empty-icon">📡</div>
            <div className="empty-title">Sin equipos registrados</div>
            <div className="empty-desc">Ningún equipo ha enviado imágenes en las últimas 72 horas</div>
          </div>
        ) : (
          <div className="table-wrap" style={{ margin: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>AE Title</th>
                  <th>IP</th>
                  <th>Último envío</th>
                  <th>Estudios (72h)</th>
                  <th>Imágenes (72h)</th>
                  <th>Errores</th>
                </tr>
              </thead>
              <tbody>
                {devices.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()).map((d) => (
                  <tr key={d.aeTitle}>
                    <td><StatusDot status={d.status} /></td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--gray-800)', fontSize: 13 }}>
                        {d.aeTitle}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--gray-500)' }}>
                        {d.ipAddress}
                      </span>
                    </td>
                    <td className="text-sm" title={new Date(d.lastSeen).toLocaleString('es-AR')}>
                      {timeAgo(d.lastSeen)}
                    </td>
                    <td>
                      <span className="badge badge-blue">{d.studiesCount}</span>
                    </td>
                    <td>
                      <span className="badge badge-gray">{d.imagesCount}</span>
                    </td>
                    <td>
                      {d.errorCount > 0
                        ? <span className="badge" style={{ background: '#fee2e2', color: '#dc2626' }}>{d.errorCount}</span>
                        : <span style={{ color: 'var(--gray-300)', fontSize: 12 }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {serverConfig && (
          <div style={{
            marginTop: 16, padding: '12px 14px',
            background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
            borderRadius: 8, fontSize: 12, color: 'var(--gray-600)',
            display: 'flex', gap: 24, flexWrap: 'wrap'
          }}>
            <span>
              <strong style={{ color: 'var(--gray-700)' }}>AE Title propio:</strong>{' '}
              <code style={{ fontWeight: 700, color: 'var(--brand-700)' }}>{serverConfig.aeTitle}</code>
            </span>
            <span>
              <strong style={{ color: 'var(--gray-700)' }}>Puerto SCP:</strong>{' '}
              <code style={{ fontWeight: 700 }}>{serverConfig.scpPort}</code>
            </span>
            <span>
              <strong style={{ color: 'var(--gray-700)' }}>URL servidor:</strong>{' '}
              <code>{serverConfig.appBaseUrl}</code>
            </span>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Tutorial
// ─────────────────────────────────────────────────────────────────────────────

function TutorialTab() {
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [modalityTab, setModalityTab]   = useState<'ct' | 'rx' | 'us' | 'rm' | 'modern'>('ct');

  useEffect(() => {
    api.get('/audit/devices').then(({ data }) => setServerConfig(data.serverConfig)).catch(() => {});
  }, []);

  const ae     = serverConfig?.aeTitle ?? 'PACS_SERVER';
  const port   = serverConfig?.scpPort ?? 11112;
  const url    = serverConfig?.appBaseUrl ?? 'http://tu-servidor:4000';

  const MODALITY_TABS = [
    { id: 'ct'     as const, label: 'TC / CT',      icon: '🔬' },
    { id: 'rx'     as const, label: 'RX / CR / DR', icon: '🦴' },
    { id: 'us'     as const, label: 'Ecografía',    icon: '🔊' },
    { id: 'rm'     as const, label: 'RM / MRI',     icon: '🧲' },
    { id: 'modern' as const, label: 'DICOMweb',     icon: '🌐' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 860 }}>

      {/* Overview */}
      <SectionCard title="Cómo conectar equipos al PACS" icon="📋">
        <p style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.7, marginBottom: 16 }}>
          El sistema soporta dos protocolos de comunicación DICOM. Seleccione la guía
          según el tipo de equipo que desea conectar:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{
            background: '#eff6ff', border: '1px solid #bfdbfe',
            borderRadius: 10, padding: '14px 16px'
          }}>
            <div style={{ fontWeight: 600, color: '#1d4ed8', fontSize: 14, marginBottom: 6 }}>
              📡 DICOM C-STORE (clásico)
            </div>
            <div style={{ fontSize: 12, color: '#1e40af', lineHeight: 1.6 }}>
              Para equipos convencionales: TC, RM, RX, ecógrafos, mamógrafos.
              Usa el protocolo DICOM estándar por TCP.
            </div>
          </div>
          <div style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 10, padding: '14px 16px'
          }}>
            <div style={{ fontWeight: 600, color: '#15803d', fontSize: 14, marginBottom: 6 }}>
              🌐 DICOMweb STOW-RS (moderno)
            </div>
            <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.6 }}>
              Para equipos modernos con soporte HTTP/REST.
              Envío seguro con autenticación Bearer token.
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Server config pill */}
      {serverConfig && (
        <div style={{
          background: '#0f172a', borderRadius: 10, padding: '14px 20px',
          display: 'flex', gap: 32, flexWrap: 'wrap'
        }}>
          {[
            { label: 'IP / Hostname del servidor', value: new URL(url).hostname },
            { label: 'Puerto DICOM SCP', value: String(port) },
            { label: 'AE Title destino', value: ae },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                {item.label}
              </div>
              <div style={{
                fontFamily: 'monospace', fontSize: 15, fontWeight: 700,
                color: '#38bdf8', background: 'rgba(56,189,248,0.08)',
                padding: '2px 8px', borderRadius: 4
              }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Protocol tabs */}
      <div>
        <div style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid var(--gray-200)', marginBottom: 20 }}>
          {MODALITY_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setModalityTab(t.id)}
              style={{
                padding: '7px 14px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: modalityTab === t.id ? 600 : 400,
                color: modalityTab === t.id ? 'var(--brand-600)' : 'var(--gray-500)',
                borderBottom: modalityTab === t.id ? '2px solid var(--brand-500)' : '2px solid transparent',
                marginBottom: -2
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {(modalityTab === 'ct' || modalityTab === 'rx' || modalityTab === 'us' || modalityTab === 'rm') && (
          <EquipmentGuide aeTitle={ae} port={port} modality={modalityTab} />
        )}
        {modalityTab === 'modern' && (
          <DicomWebGuide aeTitle={ae} baseUrl={url} />
        )}
      </div>

      {/* Common troubleshooting */}
      <SectionCard title="Solución de problemas comunes" icon="🔧">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
          {[
            {
              problem: 'El equipo rechaza la conexión / "Association Rejected"',
              solution: `Verifique que el AE Title destino configurado en el equipo sea exactamente "${ae}" (sensible a mayúsculas). Confirme que el puerto ${port} esté abierto en el firewall del servidor.`
            },
            {
              problem: 'Las imágenes no aparecen en el PACS',
              solution: 'Revise el log de auditoría: busque entradas "DICOM_SCP_ERROR". Asegúrese de que el equipo esté enviando al puerto y AE Title correctos. Verifique el espacio en disco del servidor.'
            },
            {
              problem: `Puerto ${port} no disponible`,
              solution: `En Linux, los puertos < 1024 requieren privilegios root. Si usa el puerto 104 (estándar), ejecute el backend como root o use iptables para redirigir el puerto 104 → ${port}.`
            },
            {
              problem: 'Error de transfer syntax / compresión no soportada',
              solution: 'Configure el equipo para usar "Explicit VR Little Endian" como transfer syntax preferida. El PACS acepta también Implicit VR Little Endian.'
            },
            {
              problem: 'El equipo envía pero el estudio no se asocia al paciente correcto',
              solution: 'El PACS usa Patient ID del campo DICOM (0010,0020) para identificar pacientes. Si el equipo envía un ID diferente al registrado, se creará un paciente nuevo. Unifique los ID de paciente en ambos sistemas.'
            }
          ].map((item, i) => (
            <div key={i} style={{ padding: 14, background: 'var(--gray-50)', borderRadius: 8, borderLeft: '3px solid var(--brand-400)' }}>
              <div style={{ fontWeight: 600, color: 'var(--gray-800)', marginBottom: 4 }}>⚠ {item.problem}</div>
              <div style={{ color: 'var(--gray-600)', lineHeight: 1.6 }}>✓ {item.solution}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function EquipmentGuide({ aeTitle, port, modality }: { aeTitle: string; port: number; modality: string }) {
  const labels: Record<string, string> = { ct: 'Tomógrafo (CT/TC)', rx: 'Radiografía (RX/CR/DR)', us: 'Ecógrafo (US)', rm: 'Resonancia (MRI/RM)' };
  const brands: Record<string, string[]> = {
    ct: ['GE Revolution / Optima', 'Siemens SOMATOM', 'Philips Ingenuity / IQon', 'Toshiba / Canon Aquilion'],
    rx: ['Fujifilm FDR Go / D-EVO', 'Carestream DRX', 'Agfa DR 400 / 600', 'Konica Minolta AeroDR', 'Siemens Ysio'],
    us: ['GE Voluson / Logiq', 'Philips EPIQ / Affiniti', 'Siemens Acuson', 'Canon Aplio', 'Samsung RS85'],
    rm: ['Siemens MAGNETOM', 'GE SIGNA', 'Philips Ingenia / Elition', 'Toshiba / Canon Vantage']
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionCard title={`Guía de conexión: ${labels[modality]}`} icon="📡">
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>
          Modelos compatibles: {brands[modality].join(', ')} y otros con soporte DICOM estándar.
        </p>

        <Step n={1} title="Ingresar al menú de configuración DICOM del equipo">
          En la consola del equipo, busque:{' '}
          <strong>Configuración → DICOM → Destinos de almacenamiento</strong>{' '}
          (puede variar: "DICOM Nodes", "Storage SCU", "Remote Nodes", "AE Configuration").
        </Step>

        <Step n={2} title="Agregar nuevo destino (Remote AE / Storage SCP)">
          Cree un nuevo destino con los siguientes datos:
          <div style={{ marginTop: 12 }}>
            <CodeBlock>{`AE Title destino:  ${aeTitle}
IP / Hostname:     <IP del servidor PACSMed>
Puerto (Port):     ${port}
Modalidad:         (dejar en blanco o "STORAGE")`}</CodeBlock>
          </div>
        </Step>

        <Step n={3} title='Configurar AE Title propio del equipo (opcional pero recomendado)'>
          Asigne un AE Title único al equipo (ej. <code>CT_PISO2</code>, <code>RX_SALA1</code>).
          Esto permite identificar el equipo en el panel de monitoreo del PACS.
          Anótelo: lo verá reflejado en la columna "AE Title" del monitor.
        </Step>

        <Step n={4} title="Realizar un envío de prueba (Echo / Verify)">
          La mayoría de los equipos tienen un botón <strong>"DICOM Echo"</strong> o <strong>"Verify"</strong>{' '}
          que envía un C-ECHO al PACS para verificar la conectividad. Si responde OK, la configuración es correcta.
          <div style={{ marginTop: 10, padding: '10px 14px', background: '#f0fdf4', borderRadius: 6, color: '#166534', fontSize: 12 }}>
            ✓ Si el Echo falla pero el puerto está abierto, verifique que el AE Title esté escrito exactamente igual.
          </div>
        </Step>

        <Step n={5} title="Enviar un estudio de prueba">
          Seleccione un estudio existente en el equipo y envíelo al PACS (<strong>Send / Store / Transfer</strong>).
          En el panel de monitoreo (pestaña "Equipos conectados"), debería aparecer el equipo en estado <strong>En línea</strong>{' '}
          y el estudio en la worklist.
        </Step>

        <Step n={6} title="Configurar envío automático (opcional)">
          En equipos modernos puede configurar el envío automático al finalizar cada estudio:
          <strong> Auto-routing / Auto-forward / Auto-Store</strong> → seleccionar el destino PACSMed.
          Así cada estudio se envía automáticamente sin intervención del técnico.
        </Step>
      </SectionCard>

      {/* Firewall note */}
      <div style={{
        padding: '14px 16px', background: '#fffbeb',
        border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, color: '#92400e'
      }}>
        <strong>⚠ Importante — Firewall:</strong> El puerto{' '}
        <code style={{ fontWeight: 700 }}>{port}</code> debe estar abierto en el servidor para conexiones TCP entrantes desde la IP del equipo.<br />
        <span style={{ color: '#78350f', fontSize: 12 }}>
          En Ubuntu/Debian: <code>sudo ufw allow {port}/tcp</code> &nbsp;|&nbsp; En CentOS/RHEL: <code>sudo firewall-cmd --add-port={port}/tcp --permanent && sudo firewall-cmd --reload</code>
        </span>
      </div>
    </div>
  );
}

function DicomWebGuide({ aeTitle, baseUrl }: { aeTitle: string; baseUrl: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionCard title="Conexión via DICOMweb STOW-RS (equipos modernos)" icon="🌐">
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>
          Para equipos con soporte DICOMweb (RIS/PACS Bridge, escáneres modernos, aplicaciones de terceros).
          Comunicación via HTTPS con autenticación Bearer token.
        </p>

        <Step n={1} title="Obtener el token de sistema">
          Contacte al administrador del servidor para obtener el valor de <code>DICOM_SYSTEM_TOKEN</code>{' '}
          configurado en el <code>.env</code> del backend. Este token se usa como contraseña para que
          los equipos envíen imágenes.
        </Step>

        <Step n={2} title="Configurar el endpoint STOW-RS">
          En el software del equipo o RIS, configure:
          <div style={{ marginTop: 12 }}>
            <CodeBlock>{`URL STOW-RS:    ${baseUrl}/wado/studies
Método HTTP:   POST
Content-Type:  multipart/related; type="application/dicom"
Authorization: Bearer <DICOM_SYSTEM_TOKEN>`}</CodeBlock>
          </div>
        </Step>

        <Step n={3} title="Prueba con curl (para técnicos de sistemas)">
          <CodeBlock>{`curl -X POST "${baseUrl}/wado/studies" \\
  -H "Authorization: Bearer <DICOM_SYSTEM_TOKEN>" \\
  -H "Content-Type: multipart/related; type=\\"application/dicom\\"; boundary=BOUNDARY" \\
  --data-binary @archivo.dcm`}</CodeBlock>
        </Step>

        <Step n={4} title="Alternativa: IP allowlist (red interna)">
          Si los equipos están en la misma red interna, configure <code>DICOM_ALLOWED_IPS</code>{' '}
          en el <code>.env</code> del backend con las IPs de los equipos (separadas por coma).
          Estos equipos podrán enviar sin token Bearer:
          <CodeBlock>{`DICOM_ALLOWED_IPS=192.168.1.50,192.168.1.51,192.168.1.52`}</CodeBlock>
        </Step>
      </SectionCard>

      <div style={{
        padding: '14px 16px', background: '#eff6ff',
        border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 13, color: '#1e40af'
      }}>
        <strong>ℹ Nota:</strong> El AE Title del PACS es <code style={{ fontWeight: 700 }}>{aeTitle}</code>.
        En algunos sistemas DICOMweb se requiere indicarlo como parámetro de la URL:{' '}
        <code>{baseUrl}/wado/studies?AETitle={aeTitle}</code>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Audit Export
// ─────────────────────────────────────────────────────────────────────────────

function AuditTab() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [to,        setTo]        = useState(() => new Date().toISOString().split('T')[0]);
  const [format,    setFormat]    = useState<'csv' | 'json'>('csv');
  const [exporting, setExporting] = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  const handleExport = async (e: FormEvent) => {
    e.preventDefault();
    setExporting(true); setError(''); setSuccess('');
    try {
      const response = await api.get('/audit/export', {
        params: { from, to, format },
        responseType: format === 'csv' ? 'blob' : 'json'
      });
      if (format === 'csv') {
        const blob = new Blob([response.data], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `audit-${from}-to-${to}.csv`; a.click();
        URL.revokeObjectURL(url);
        setSuccess('Exportación completada. Archivo descargado.');
      } else {
        const json = JSON.stringify(response.data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `audit-${from}-to-${to}.json`; a.click();
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
    <div style={{ maxWidth: 640 }}>
      <SectionCard title="Exportar Log de Auditoría" icon="📊">
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 20 }}>
          Descarga el registro completo de acciones del sistema (cumplimiento HIPAA §164.312 / ANMAT Disp. 2318/02).
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
              <option value="csv">CSV (Excel / LibreOffice)</option>
              <option value="json">JSON (análisis programático)</option>
            </select>
          </div>
          {error   && <div className="alert alert-error"><span>✕</span><span>{error}</span></div>}
          {success && <div className="alert alert-success"><span>✓</span><span>{success}</span></div>}
          <div>
            <button type="submit" className="btn btn-primary" disabled={exporting}>
              {exporting ? 'Exportando...' : '⬇ Descargar auditoría'}
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: Configuration reference
// ─────────────────────────────────────────────────────────────────────────────

function ConfigTab() {
  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>

      <SectionCard title="Variables de entorno del servidor" icon="⚙">
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 16 }}>
          Edite el archivo <code>.env</code> en la raíz del backend. Reinicie el proceso después de cada cambio.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { key: 'DICOM_AE_TITLE',     desc: 'AE Title del PACS (lo que configuras en los equipos)',   default: 'PACS_SERVER' },
            { key: 'DICOM_SCP_PORT',     desc: 'Puerto TCP para recibir imágenes DICOM (C-STORE SCP)',   default: '11112' },
            { key: 'DICOM_SYSTEM_TOKEN', desc: 'Token Bearer para equipos DICOMweb',                     default: '(generar aleatoriamente)' },
            { key: 'DICOM_ALLOWED_IPS',  desc: 'IPs de equipos autorizados sin token (lista CSV)',        default: '' },
            { key: 'STORAGE_ROOT',       desc: 'Directorio donde se guardan los archivos DICOM en disco', default: '../storage' },
            { key: 'SFTP_DROP_FOLDER',   desc: 'Carpeta SFTP para carga masiva automática',              default: '../sftp-drop' },
            { key: 'PORT',               desc: 'Puerto HTTP de la API REST',                              default: '4000' },
            { key: 'CORS_ORIGIN',        desc: 'URL del frontend (separadas por coma si hay más de una)', default: 'http://localhost:5173' },
          ].map((v) => (
            <div key={v.key} style={{
              padding: '10px 14px', background: 'var(--gray-50)',
              border: '1px solid var(--gray-200)', borderRadius: 8
            }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <code style={{ color: 'var(--brand-700)', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
                  {v.key}
                </code>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{v.desc}</div>
                  {v.default && (
                    <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                      Default: <code>{v.default}</code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Carga masiva vía SFTP" icon="📁">
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 12 }}>
          Coloca archivos <code>.dcm</code> en la carpeta configurada en <code>SFTP_DROP_FOLDER</code>.
          El sistema los detecta y procesa automáticamente.
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
      </SectionCard>
    </div>
  );
}
