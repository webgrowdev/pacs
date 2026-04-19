/**
 * DICOM C-FIND SCU via DICOMweb (QIDO-RS) — consults remote PACS (Orthanc).
 * Uses Orthanc REST API if ORTHANC_URL is configured.
 */

import { env } from '../config/env.js';

export interface RemoteStudy {
  studyInstanceUid: string;
  studyDate:        string;
  studyDescription: string;
  modality:         string;
  seriesCount:      number;
  imagesCount:      number;
  accessionNumber:  string;
}

export interface DicomMetadata {
  studyInstanceUid: string;
  series: Array<{
    seriesInstanceUid: string;
    modality:         string;
    seriesDescription: string;
    imagesCount:      number;
  }>;
}

export async function queryRemoteStudies(patientId: string): Promise<RemoteStudy[]> {
  if (!env.ORTHANC_URL) return [];
  const url = `${env.ORTHANC_URL}/dicom-web/studies?PatientID=${encodeURIComponent(patientId)}&includefield=00080060,00201206,00201208,00080050`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new Error(`[SCU] Orthanc QIDO-RS error: ${resp.status}`);
  const data = await resp.json() as any[];
  return data.map((item: any) => ({
    studyInstanceUid: item['0020000D']?.Value?.[0] ?? '',
    studyDate:        item['00080020']?.Value?.[0] ?? '',
    studyDescription: item['00081030']?.Value?.[0] ?? '',
    modality:         item['00080060']?.Value?.[0] ?? '',
    seriesCount:      item['00201206']?.Value?.[0] ?? 0,
    imagesCount:      item['00201208']?.Value?.[0] ?? 0,
    accessionNumber:  item['00080050']?.Value?.[0] ?? ''
  }));
}

export async function fetchRemoteStudyMetadata(studyInstanceUid: string): Promise<DicomMetadata> {
  if (!env.ORTHANC_URL) throw new Error('ORTHANC_URL not configured');
  const url = `${env.ORTHANC_URL}/dicom-web/studies/${encodeURIComponent(studyInstanceUid)}/series`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new Error(`[SCU] Orthanc metadata error: ${resp.status}`);
  const data = await resp.json() as any[];
  return {
    studyInstanceUid,
    series: data.map((s: any) => ({
      seriesInstanceUid: s['0020000E']?.Value?.[0] ?? '',
      modality:          s['00080060']?.Value?.[0] ?? '',
      seriesDescription: s['0008103E']?.Value?.[0] ?? '',
      imagesCount:       s['00201209']?.Value?.[0] ?? 0
    }))
  };
}
