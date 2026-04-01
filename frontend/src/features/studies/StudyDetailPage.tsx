import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { api } from '../../lib/api';
import { DicomViewer } from './DicomViewer';

export function StudyDetailPage() {
  const { id } = useParams();
  const [study, setStudy] = useState<any>();
  const [reportId, setReportId] = useState<string | null>(null);
  const [findings, setFindings] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [lesionSize, setLesionSize] = useState<number>(0);

  useEffect(() => {
    api.get(`/studies/${id}`).then((r) => {
      setStudy(r.data);
      if (r.data.reports?.[0]) {
        setReportId(r.data.reports[0].id);
        setFindings(r.data.reports[0].findings || '');
        setConclusion(r.data.reports[0].conclusion || '');
      }
    });
  }, [id]);

  const suggest = async () => {
    const { data } = await api.post('/ai/suggest-report', { notes: findings });
    setFindings(data.findings);
    setConclusion(data.conclusion);
  };

  const saveDraft = async () => {
    const payload = {
      studyId: id,
      findings,
      conclusion,
      measurements: lesionSize > 0 ? [{ type: 'LINEAR', label: 'Lesión principal', value: lesionSize, unit: 'mm' }] : []
    };

    if (reportId) {
      await api.put(`/reports/${reportId}`, payload);
    } else {
      const { data } = await api.post('/reports', payload);
      setReportId(data.id);
    }
    alert('Informe guardado');
  };

  const finalize = async () => {
    if (!reportId) return alert('Primero guarde el borrador');
    await api.post(`/reports/${reportId}/finalize`);
    alert('Informe finalizado y PDF generado');
  };

  if (!study) return <Layout title="Estudio">Cargando...</Layout>;
  const urls = study.dicomFiles.map((f: any) => `http://localhost:4000/files/dicom/${study.id}/${f.fileName}`);

  return (
    <Layout title={`Estudio ${study.modality} - ${study.patient.lastName}`}>
      <div className="split">
        <DicomViewer imageUrls={urls} />
        <div className="grid">
          <textarea placeholder="Hallazgos" value={findings} onChange={(e) => setFindings(e.target.value)} />
          <textarea placeholder="Conclusión" value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
          <input type="number" placeholder="Medición lineal (mm)" value={lesionSize} onChange={(e) => setLesionSize(Number(e.target.value))} />
          <button onClick={suggest}>Sugerir redacción IA</button>
          <button onClick={saveDraft}>Guardar borrador</button>
          <button onClick={finalize}>Finalizar y generar PDF</button>
        </div>
      </div>
    </Layout>
  );
}
