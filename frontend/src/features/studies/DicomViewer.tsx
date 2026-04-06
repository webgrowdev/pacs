import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
// Static import — dynamic import() fails for this package in browser ESM
// because it mixes named + default exports.
// The 'init' named export registers 'wadouri' / 'wadors' / 'dicomfile' loaders
// with @cornerstonejs/core via registerImageLoader() internally.
import { init as dicomLoaderInit } from '@cornerstonejs/dicom-image-loader';
import { getAccessToken } from '../../lib/auth';
import { api } from '../../lib/api';

// ─── One-time initialization guards (module-level, survive hot-reload) ────────
let cornerstoneInitialized = false;
let dicomLoaderInitialized = false;

function initializeDicomLoader() {
  if (dicomLoaderInitialized) return;
  dicomLoaderInitialized = true;
  dicomLoaderInit({
    maxWebWorkers: 1,
    beforeSend: (xhr: XMLHttpRequest) => {
      const token = getAccessToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
  } as any);
}

async function initializeCornerstone() {
  if (cornerstoneInitialized) return;
  cornerstoneInitialized = true;
  await cornerstone.init();
  initializeDicomLoader();
  await csTools.init();
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A measurement extracted from a CornerstoneJS annotation with full traceability.
 * Includes primary evidence references so the measurement can be linked back to
 * the exact image, frame, and geometry in the DICOM archive.
 */
export interface ViewerMeasurement {
  // Tool metadata
  type:    string;
  label:   string;
  value:   number;
  unit:    string;
  toolName: string;

  // Primary evidence references (parsed from CornerstoneJS annotation metadata)
  sopInstanceUid?:      string;  // parsed from referencedImageId WADO URI
  seriesInstanceUid?:   string;
  studyInstanceUid?:    string;
  frameOfReferenceUid?: string;
  instanceNumber?:      number;
  frameIndex?:          number;

  // Geometry — array of {x, y} points in image pixel space
  coordinatesJson?: Array<{ x: number; y: number }>;
  imageWidth?:      number;
  imageHeight?:     number;

  // Additional statistics from ROI
  extraStatsJson?: Record<string, number>;
}

/** Imperative handle exposed via ref so StudyDetailPage can navigate to a frame */
export interface DicomViewerHandle {
  navigateToFrame: (frameIndex: number) => Promise<void>;
  navigateToSopInstance: (sopInstanceUid: string, frameIndex?: number) => Promise<void>;
}

interface DicomViewerProps {
  imageUrls:    string[];
  studyId?:     string;   // used for viewer-state persistence
  /** imageUrls indexed by sopInstanceUid — enables "navigate to image" from report */
  sopIndexMap?: Record<string, number>;
  /** Called when the user clicks "📥 Mediciones" */
  onImportMeasurements?: (measurements: ViewerMeasurement[]) => void;
}

type ToolName =
  | 'WindowLevel'
  | 'Pan'
  | 'Zoom'
  | 'Length'
  | 'Angle'
  | 'EllipticalROI'
  | 'RectangleROI'
  | 'Bidirectional'
  | 'ArrowAnnotate'
  | 'Probe'
  | 'Magnify';

const WINDOW_PRESETS = [
  { label: 'Pulmón',     ww: 1500, wl: -600 },
  { label: 'Mediastino', ww: 400,  wl: 40   },
  { label: 'Hueso',      ww: 1800, wl: 400  },
  { label: 'Cerebro',    ww: 80,   wl: 40   },
  { label: 'Hígado',     ww: 150,  wl: 60   },
  { label: 'Abdomen',    ww: 400,  wl: 50   },
];

const BASIC_TOOLS: Array<{ name: ToolName; label: string; icon: string }> = [
  { name: 'WindowLevel', label: 'Ventana', icon: '◑' },
  { name: 'Pan',         label: 'Mover',   icon: '✥' },
  { name: 'Zoom',        label: 'Zoom',    icon: '⊕' },
];

const MEASURE_TOOLS: Array<{ name: ToolName; label: string; icon: string }> = [
  { name: 'Length',       label: 'Longitud',    icon: '↔' },
  { name: 'Angle',        label: 'Ángulo',       icon: '∠' },
  { name: 'Bidirectional',label: 'Bidir.',       icon: '⊕' },
  { name: 'Probe',        label: 'Sonda',        icon: '⊙' },
];

const ANNOTATION_TOOLS: Array<{ name: ToolName; label: string; icon: string }> = [
  { name: 'EllipticalROI', label: 'ROI Elíptica', icon: '⬭' },
  { name: 'RectangleROI',  label: 'ROI Rect.',    icon: '▭' },
  { name: 'ArrowAnnotate', label: 'Flecha',        icon: '↗' },
  { name: 'Magnify',       label: 'Lupa',          icon: '🔍' },
];

const {
  PanTool,
  ZoomTool,
  WindowLevelTool,
  LengthTool,
  AngleTool,
  EllipticalROITool,
  RectangleROITool,
  BidirectionalTool,
  ArrowAnnotateTool,
  ProbeTool,
  MagnifyTool,
  ToolGroupManager,
  Enums: ToolEnums
} = csTools as any;

const TOOL_CLASS_MAP: Record<ToolName, any> = {
  WindowLevel:   WindowLevelTool,
  Pan:           PanTool,
  Zoom:          ZoomTool,
  Length:        LengthTool,
  Angle:         AngleTool,
  EllipticalROI: EllipticalROITool,
  RectangleROI:  RectangleROITool,
  Bidirectional: BidirectionalTool,
  ArrowAnnotate: ArrowAnnotateTool,
  Probe:         ProbeTool,
  Magnify:       MagnifyTool,
};

const ALL_TOOL_CLASSES = Object.values(TOOL_CLASS_MAP);

const VIEWPORT_ID = 'dicom-vp';

/** Auto-save interval for viewer state (ms) */
const VIEWER_STATE_AUTOSAVE_MS = 15_000;

// ─── Helper: parse SOPInstanceUID from a WADO URI ─────────────────────────────
// WADO URI format: wadouri:http://host/files/dicom/{studyId}/{fileName}
// The SOPInstanceUID is stored per-image in CornerstoneJS metaData provider.
function parseSopFromImageId(imageId: string): string | undefined {
  try {
    // CornerstoneJS stores metadata accessible via metaData.get
    const meta = (cornerstone as any).metaData?.get('generalImageModule', imageId);
    if (meta?.sopInstanceUID) return meta.sopInstanceUID;
    const imgMeta = (cornerstone as any).metaData?.get('imagePixelModule', imageId);
    if (imgMeta?.sopInstanceUID) return imgMeta.sopInstanceUID;
    return undefined;
  } catch {
    return undefined;
  }
}

// ─── Helper: extract coordinates from CornerstoneJS annotation handles ────────
function extractCoordinates(ann: any): Array<{ x: number; y: number }> | undefined {
  try {
    const handles = ann?.data?.handles;
    if (!handles) return undefined;
    const pts: Array<{ x: number; y: number }> = [];

    // Line / Length / Bidirectional
    if (handles.points && Array.isArray(handles.points)) {
      for (const pt of handles.points) {
        if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
          pts.push({ x: Math.round(pt.x), y: Math.round(pt.y) });
        }
      }
    }
    // Angle has start/middle/end
    if (handles.start) pts.push({ x: Math.round(handles.start.x), y: Math.round(handles.start.y) });
    if (handles.middle) pts.push({ x: Math.round(handles.middle.x), y: Math.round(handles.middle.y) });
    if (handles.end) pts.push({ x: Math.round(handles.end.x), y: Math.round(handles.end.y) });

    return pts.length ? pts : undefined;
  } catch {
    return undefined;
  }
}

// ─── Helper: extract extra stats from cachedStats ─────────────────────────────
function extractExtraStats(ann: any): Record<string, number> | undefined {
  try {
    const stats = Object.values(ann?.data?.cachedStats ?? {});
    if (!stats.length) return undefined;
    const merged: Record<string, number> = {};
    for (const s of stats) {
      for (const [k, v] of Object.entries(s as any)) {
        if (v != null && isFinite(v as number)) merged[k] = v as number;
      }
    }
    return Object.keys(merged).length ? merged : undefined;
  } catch {
    return undefined;
  }
}

export const DicomViewer = forwardRef<DicomViewerHandle, DicomViewerProps>(
  function DicomViewer({ imageUrls, studyId, sopIndexMap, onImportMeasurements }, ref) {
  const elementRef    = useRef<HTMLDivElement>(null);
  const engineRef     = useRef<cornerstone.RenderingEngine | null>(null);
  const toolGroupRef  = useRef<any>(null);
  const imageIdsRef   = useRef<string[]>([]);
  const autosaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalFrames,  setTotalFrames]  = useState(0);
  const [activeTool,   setActiveTool]   = useState<ToolName>('WindowLevel');
  const [ready,        setReady]        = useState(false);
  const [error,        setError]        = useState('');
  const [currentWW,    setCurrentWW]    = useState<number | null>(null);
  const [currentWL,    setCurrentWL]    = useState<number | null>(null);
  const [isInverted,   setIsInverted]   = useState(false);
  const [rotation,     setRotation]     = useState(0);

  // ── Activate a tool on the current group ────────────────────────────────────
  const activateTool = useCallback((toolName: ToolName) => {
    if (!toolGroupRef.current) return;
    const tg = toolGroupRef.current;
    try {
      // Set all tools passive first
      ALL_TOOL_CLASSES.forEach((tc: any) => {
        try { tg.setToolPassive(tc.toolName); } catch {}
      });
      const toolClass = TOOL_CLASS_MAP[toolName];
      if (toolClass) {
        tg.setToolActive(toolClass.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }]
        });
      }
      setActiveTool(toolName);
    } catch {}
  }, []);

  // ── View controls ────────────────────────────────────────────────────────────
  const getViewport = useCallback(() => {
    if (!engineRef.current) return null;
    try { return engineRef.current.getViewport(VIEWPORT_ID) as any; } catch { return null; }
  }, []);

  const handleFlipH = useCallback(() => {
    const vp = getViewport();
    if (!vp) return;
    try { vp.flip({ flipHorizontal: true }); vp.render(); } catch {}
  }, [getViewport]);

  const handleFlipV = useCallback(() => {
    const vp = getViewport();
    if (!vp) return;
    try { vp.flip({ flipVertical: true }); vp.render(); } catch {}
  }, [getViewport]);

  const handleRotate = useCallback(() => {
    const vp = getViewport();
    if (!vp) return;
    const newRotation = (rotation + 90) % 360;
    try { vp.setProperties({ rotation: newRotation }); vp.render(); setRotation(newRotation); } catch {}
  }, [getViewport, rotation]);

  const handleReset = useCallback(() => {
    const vp = getViewport();
    if (!vp) return;
    try {
      vp.resetCamera();
      vp.resetProperties();
      vp.render();
      setIsInverted(false);
      setRotation(0);
      setCurrentWW(null);
      setCurrentWL(null);
    } catch {}
  }, [getViewport]);

  const handleInvert = useCallback(() => {
    const vp = getViewport();
    if (!vp) return;
    const newInvert = !isInverted;
    try { vp.setProperties({ invert: newInvert }); vp.render(); setIsInverted(newInvert); } catch {}
  }, [getViewport, isInverted]);

  const handleFullscreen = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        el.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    } catch {}
  }, []);

  const handlePreset = useCallback((ww: number, wl: number) => {
    const vp = getViewport();
    if (!vp) return;
    try {
      vp.setProperties({ voiRange: { lower: wl - ww / 2, upper: wl + ww / 2 } });
      vp.render();
      setCurrentWW(ww);
      setCurrentWL(wl);
    } catch {}
  }, [getViewport]);

  // ── Save viewer state to backend ─────────────────────────────────────────────
  const saveViewerState = useCallback(async () => {
    if (!studyId || !engineRef.current) return;
    try {
      const vp = engineRef.current.getViewport(VIEWPORT_ID) as any;
      const props = vp?.getProperties?.() ?? {};
      const camera = vp?.getCamera?.() ?? {};

      const annotationState = (csTools as any).annotation?.state;
      const snapshot = typeof annotationState?.getAllAnnotations === 'function'
        ? annotationState.getAllAnnotations()
        : undefined;

      await api.put(`/viewer/${studyId}/state`, {
        windowWidth:  props.voiRange ? Math.round(props.voiRange.upper - props.voiRange.lower) : currentWW,
        windowCenter: props.voiRange ? Math.round((props.voiRange.upper + props.voiRange.lower) / 2) : currentWL,
        zoom:         camera.parallelScale ?? null,
        panX:         camera.focalPoint?.[0] ?? null,
        panY:         camera.focalPoint?.[1] ?? null,
        rotation,
        isInverted,
        frameIndex:   currentIndex,
        activeTool,
        annotationSnapshot: snapshot
      });
    } catch {
      // Non-fatal: viewer state save failure should not block the user
    }
  }, [studyId, currentIndex, activeTool, rotation, isInverted, currentWW, currentWL]);

  // ── Restore viewer state from backend ────────────────────────────────────────
  const restoreViewerState = useCallback(async () => {
    if (!studyId || !engineRef.current) return;
    try {
      const { data, status } = await api.get(`/viewer/${studyId}/state`);
      if (status === 204 || !data) return; // no saved state

      const vp = engineRef.current.getViewport(VIEWPORT_ID) as any;
      if (!vp) return;

      // Restore viewport properties
      if (data.windowWidth != null && data.windowCenter != null) {
        const ww = data.windowWidth;
        const wc = data.windowCenter;
        vp.setProperties({ voiRange: { lower: wc - ww / 2, upper: wc + ww / 2 } });
        setCurrentWW(ww);
        setCurrentWL(wc);
      }
      if (data.rotation != null && data.rotation !== 0) {
        vp.setProperties({ rotation: data.rotation });
        setRotation(data.rotation);
      }
      if (data.isInverted) {
        vp.setProperties({ invert: true });
        setIsInverted(true);
      }
      if (data.frameIndex != null && data.frameIndex > 0) {
        await vp.setImageIdIndex(data.frameIndex);
        setCurrentIndex(data.frameIndex);
      }

      // Restore annotations
      if (data.annotationSnapshot) {
        const annotationState = (csTools as any).annotation?.state;
        if (typeof annotationState?.restoreAnnotations === 'function') {
          annotationState.restoreAnnotations(data.annotationSnapshot);
        }
      }

      // Restore active tool
      if (data.activeTool && TOOL_CLASS_MAP[data.activeTool as ToolName]) {
        activateTool(data.activeTool as ToolName);
      }

      vp.render();
    } catch {
      // Non-fatal: state restoration failure should not block reading
    }
  }, [studyId, activateTool]);

  // ── Expose imperative handle for StudyDetailPage ──────────────────────────────
  useImperativeHandle(ref, () => ({
    navigateToFrame: async (frameIndex: number) => {
      if (!engineRef.current) return;
      try {
        const vp = engineRef.current.getViewport(VIEWPORT_ID) as any;
        if (frameIndex >= 0 && frameIndex < imageIdsRef.current.length) {
          await vp.setImageIdIndex(frameIndex);
          vp.render();
          setCurrentIndex(frameIndex);
        }
      } catch {}
    },
    navigateToSopInstance: async (sopInstanceUid: string, frameIndex?: number) => {
      if (!engineRef.current) return;
      // Find the index in imageIds that corresponds to this SOPInstanceUID
      if (sopIndexMap && sopIndexMap[sopInstanceUid] !== undefined) {
        const idx = sopIndexMap[sopInstanceUid];
        try {
          const vp = engineRef.current.getViewport(VIEWPORT_ID) as any;
          await vp.setImageIdIndex(idx);
          vp.render();
          setCurrentIndex(idx);
        } catch {}
      } else if (frameIndex != null) {
        try {
          const vp = engineRef.current.getViewport(VIEWPORT_ID) as any;
          await vp.setImageIdIndex(frameIndex);
          vp.render();
          setCurrentIndex(frameIndex);
        } catch {}
      }
    }
  }), [sopIndexMap]);

  // ── Export current frame as PNG ──────────────────────────────────────────────
  const handleExportPng = useCallback(() => {
    // CornerstoneJS renders onto a <canvas> inside elementRef
    const canvas = elementRef.current?.querySelector('canvas');
    if (!canvas) return;
    try {
      const url = (canvas as HTMLCanvasElement).toDataURL('image/png');
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `dicom-frame-${Date.now()}.png`;
      a.click();
    } catch {}
  }, []);

  // ── Extract annotation measurements with full traceability ───────────────────
  const handleImportMeasurements = useCallback(() => {
    if (!onImportMeasurements) return;
    try {
      const annotationState = (csTools as any).annotation?.state;
      if (!annotationState) { onImportMeasurements([]); return; }

      const allRaw: Record<string, any[]> =
        typeof annotationState.getAllAnnotations === 'function'
          ? annotationState.getAllAnnotations()
          : {};

      const imported: ViewerMeasurement[] = [];

      const buildMeasurement = (
        toolKey: string,
        ann: any,
        type: string,
        label: string,
        value: number | null,
        unit: string
      ): ViewerMeasurement | null => {
        if (value == null) return null;

        // Extract primary evidence references from CornerstoneJS annotation metadata
        const referencedImageId: string | undefined = ann?.metadata?.referencedImageId;
        const sopInstanceUid = referencedImageId
          ? parseSopFromImageId(referencedImageId)
          : undefined;
        const frameOfReferenceUid: string | undefined = ann?.metadata?.FrameOfReferenceUID;

        // Extract geometry
        const coords = extractCoordinates(ann);

        // Extract extra statistics
        const extraStats = extractExtraStats(ann);

        // Get image dimensions from viewport
        let imageWidth: number | undefined;
        let imageHeight: number | undefined;
        try {
          if (engineRef.current) {
            const vp = engineRef.current.getViewport(VIEWPORT_ID) as any;
            const img = vp?.getCornerstoneImage?.();
            if (img) { imageWidth = img.width; imageHeight = img.height; }
          }
        } catch {}

        return {
          type,
          label,
          value:     parseFloat(value.toFixed(3)),
          unit,
          toolName:  toolKey,
          sopInstanceUid,
          frameOfReferenceUid,
          frameIndex: currentIndex,
          coordinatesJson: coords,
          imageWidth,
          imageHeight,
          extraStatsJson: extraStats
        };
      };

      const extractStat = (ann: any, key: string): number | null => {
        const stats = Object.values(ann?.data?.cachedStats ?? {});
        for (const s of stats) {
          const v = (s as any)?.[key];
          if (v != null && isFinite(v)) return v;
        }
        return null;
      };

      // Length / Bidirectional → length in mm
      for (const toolKey of ['Length', 'LengthTool', 'Bidirectional', 'BidirectionalTool']) {
        for (const ann of (allRaw[toolKey] ?? [])) {
          const len = extractStat(ann, 'length');
          const m = buildMeasurement(toolKey, ann, 'LINEAR', toolKey.replace('Tool', ''), len, 'mm');
          if (m) imported.push(m);
        }
      }

      // Angle → degrees
      for (const toolKey of ['Angle', 'AngleTool']) {
        for (const ann of (allRaw[toolKey] ?? [])) {
          const deg = extractStat(ann, 'angle');
          const m = buildMeasurement(toolKey, ann, 'ANGLE', 'Ángulo', deg, '°');
          if (m) imported.push(m);
        }
      }

      // ROI → mean HU + full stats
      for (const toolKey of ['EllipticalROI', 'EllipticalROITool', 'RectangleROI', 'RectangleROITool']) {
        for (const ann of (allRaw[toolKey] ?? [])) {
          const mean = extractStat(ann, 'mean');
          const label = toolKey.replace('Tool', '').replace('Elliptical', 'ROI Elíptica').replace('Rectangle', 'ROI Rect.');
          const m = buildMeasurement(toolKey, ann, 'ROI', label, mean, 'HU');
          if (m) imported.push(m);
        }
      }

      // Probe → single pixel HU
      for (const toolKey of ['Probe', 'ProbeTool']) {
        for (const ann of (allRaw[toolKey] ?? [])) {
          const val = extractStat(ann, 'value') ?? extractStat(ann, 'huValue');
          const m = buildMeasurement(toolKey, ann, 'PROBE', 'Sonda HU', val, 'HU');
          if (m) imported.push(m);
        }
      }

      onImportMeasurements(imported);
    } catch {
      onImportMeasurements([]);
    }
  }, [onImportMeasurements, currentIndex]);

  // ── Main initialization effect ───────────────────────────────────────────────
  useEffect(() => {
    if (!elementRef.current || !imageUrls.length) return;

    const element = elementRef.current;

    const engineId    = `cs-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const toolGroupId = `cs-tg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let localEngine:    cornerstone.RenderingEngine | null = null;
    let localToolGroup: any = null;
    let cancelled = false;

    const run = async () => {
      try {
        await initializeCornerstone();
        if (cancelled) return;

        // ── Rendering engine ────────────────────────────────────────────────
        const renderingEngine = new cornerstone.RenderingEngine(engineId);
        localEngine = renderingEngine;
        engineRef.current = renderingEngine;

        renderingEngine.setViewports([{
          viewportId: VIEWPORT_ID,
          type:       cornerstone.Enums.ViewportType.STACK,
          element
        }]);

        if (cancelled) return;

        // ── Tools ────────────────────────────────────────────────────────────
        if (!csTools.addTool) return;
        ALL_TOOL_CLASSES.forEach((t: any) => {
          try { csTools.addTool(t); } catch {}
        });

        const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
        localToolGroup = toolGroup;
        toolGroupRef.current = toolGroup;

        ALL_TOOL_CLASSES.forEach((tc: any) => {
          try { toolGroup.addTool(tc.toolName); } catch {}
        });
        toolGroup.addViewport(VIEWPORT_ID, engineId);

        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }]
        });
        toolGroup.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }]
        });
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }]
        });

        if (cancelled) return;

        // ── Load images ──────────────────────────────────────────────────────
        const imageIds = imageUrls.map((u) => `wadouri:${u}`);
        imageIdsRef.current = imageIds;
        const vp = renderingEngine.getViewport(VIEWPORT_ID) as any;
        await vp.setStack(imageIds, 0);

        if (cancelled) return;

        vp.render();
        setTotalFrames(imageIds.length);
        setCurrentIndex(0);
        setIsInverted(false);
        setRotation(0);
        setCurrentWW(null);
        setCurrentWL(null);
        setReady(true);

        // ── Restore saved state after viewer is ready ────────────────────────
        if (studyId) {
          // Small delay to let the viewport settle before restoring
          setTimeout(() => { if (!cancelled) restoreViewerState(); }, 400);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[DicomViewer]', err);
        setError('No se pudo inicializar el visor DICOM. Verifique que los archivos sean DICOM válidos.');
      }
    };

    run();

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      cancelled = true;

      // Stop autosave timer
      if (autosaveTimer.current) {
        clearInterval(autosaveTimer.current);
        autosaveTimer.current = null;
      }

      try {
        if (localToolGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
          localToolGroup = null;
        }
      } catch {}

      try {
        if (localEngine) {
          localEngine.destroy();
          localEngine = null;
        }
      } catch {}

      if (engineRef.current === localEngine)   engineRef.current   = null;
      if (toolGroupRef.current === localToolGroup) toolGroupRef.current = null;

      setReady(false);
      setError('');
    };
  // restoreViewerState is memoized with studyId — stable during a study session
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrls]);

  // ── Autosave viewer state every VIEWER_STATE_AUTOSAVE_MS when ready ──────────
  useEffect(() => {
    if (!ready || !studyId) return;
    autosaveTimer.current = setInterval(saveViewerState, VIEWER_STATE_AUTOSAVE_MS);
    return () => {
      if (autosaveTimer.current) {
        clearInterval(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [ready, studyId, saveViewerState]);

  // ── Mouse wheel frame navigation ─────────────────────────────────────────────
  useEffect(() => {
    const el = elementRef.current;
    if (!el || !ready) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 : -1;
      setCurrentIndex((prev) => {
        const next = Math.max(0, Math.min(totalFrames - 1, prev + delta));
        if (next !== prev && engineRef.current) {
          try {
            const vp = engineRef.current.getViewport(VIEWPORT_ID) as any;
            vp.setImageIdIndex(next).then(() => vp.render());
          } catch {}
        }
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ready, totalFrames]);

  // ── Frame navigation ─────────────────────────────────────────────────────────
  const navigate = useCallback(async (newIndex: number) => {
    if (!engineRef.current || newIndex < 0 || newIndex >= totalFrames) return;
    try {
      const vp = engineRef.current.getViewport(VIEWPORT_ID) as any;
      await vp.setImageIdIndex(newIndex);
      vp.render();
      setCurrentIndex(newIndex);
    } catch {}
  }, [totalFrames]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!imageUrls.length) {
    return (
      <div className="viewer-panel" style={{ height: '100%', minHeight: 400 }}>
        <div className="empty-state" style={{ margin: 'auto' }}>
          <div className="empty-icon">⊞</div>
          <div className="empty-title" style={{ color: 'rgba(255,255,255,0.5)' }}>Sin imágenes DICOM</div>
          <div className="empty-desc" style={{ color: 'rgba(255,255,255,0.3)' }}>Este estudio no tiene archivos cargados</div>
        </div>
      </div>
    );
  }

  const toolbarBtnStyle = (active: boolean) => ({
    padding: '4px 8px',
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  });

  const renderToolGroup = (tools: Array<{ name: ToolName; label: string; icon: string }>) =>
    tools.map((btn) => (
      <button
        key={btn.name}
        className={`btn btn-sm ${activeTool === btn.name ? 'btn-primary' : 'btn-ghost'}`}
        onClick={() => activateTool(btn.name)}
        title={btn.label}
        disabled={!ready}
        style={toolbarBtnStyle(activeTool === btn.name)}
      >
        <span>{btn.icon}</span>
        <span style={{ fontSize: 11 }}>{btn.label}</span>
      </button>
    ));

  return (
    <div className="viewer-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar row 1 — tools */}
      <div className="viewer-toolbar" style={{ flexWrap: 'wrap', gap: 4, padding: '6px 8px' }}>
        {/* Basic tools */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {renderToolGroup(BASIC_TOOLS)}
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
        {/* Measurement tools */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {renderToolGroup(MEASURE_TOOLS)}
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
        {/* Annotation tools */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {renderToolGroup(ANNOTATION_TOOLS)}
        </div>
        <div style={{ flex: 1 }} />
        {/* View controls */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={handleFlipH} disabled={!ready} title="Voltear horizontal" style={toolbarBtnStyle(false)}>↔ FH</button>
          <button className="btn btn-ghost btn-sm" onClick={handleFlipV} disabled={!ready} title="Voltear vertical" style={toolbarBtnStyle(false)}>↕ FV</button>
          <button className="btn btn-ghost btn-sm" onClick={handleRotate} disabled={!ready} title="Rotar 90°" style={toolbarBtnStyle(false)}>↻ 90°</button>
          <button className={`btn btn-sm btn-ghost ${isInverted ? 'btn-primary' : ''}`} onClick={handleInvert} disabled={!ready} title="Invertir" style={toolbarBtnStyle(isInverted)}>⊘ Inv</button>
          <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={!ready} title="Reset vista" style={toolbarBtnStyle(false)}>⟳ Reset</button>
          <button className="btn btn-ghost btn-sm" onClick={handleFullscreen} disabled={!ready} title="Pantalla completa" style={toolbarBtnStyle(false)}>⛶</button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportPng} disabled={!ready} title="Exportar frame como PNG" style={toolbarBtnStyle(false)}>📷 PNG</button>
          {onImportMeasurements && (
            <button className="btn btn-ghost btn-sm" onClick={handleImportMeasurements} disabled={!ready} title="Importar mediciones del visor al informe" style={toolbarBtnStyle(false)}>📥 Mediciones</button>
          )}
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
        {/* Window presets */}
        <select
          disabled={!ready}
          title="Presets de ventana"
          onChange={(e) => {
            const idx = parseInt(e.target.value, 10);
            if (!isNaN(idx) && WINDOW_PRESETS[idx]) {
              const { ww, wl } = WINDOW_PRESETS[idx];
              handlePreset(ww, wl);
            }
            e.target.value = '';
          }}
          defaultValue=""
          style={{
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.85)',
            borderRadius: 4,
            padding: '3px 6px',
            fontSize: 11,
            cursor: 'pointer'
          }}
        >
          <option value="" disabled>🪟 Preset…</option>
          {WINDOW_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>{p.label} (WW:{p.ww} WL:{p.wl})</option>
          ))}
        </select>
      </div>

      {/* Canvas */}
      <div className="viewer-canvas" style={{ position: 'relative', flex: 1 }}>
        {error ? (
          <div className="empty-state" style={{ margin: 'auto', padding: 32 }}>
            <div className="empty-title" style={{ color: '#fca5a5' }}>Error al cargar imágenes</div>
            <div className="empty-desc" style={{ color: 'rgba(255,255,255,0.4)', marginTop: 8, fontSize: 12 }}>{error}</div>
          </div>
        ) : (
          <>
            <div
              ref={elementRef}
              style={{ width: '100%', height: '100%', minHeight: 400, background: '#000' }}
            />
            <div className="viewer-info">
              {ready && (
                <>
                  <div>Frame: {currentIndex + 1}/{totalFrames}</div>
                  {(currentWW !== null && currentWL !== null) && (
                    <div>WW: {currentWW} / WL: {currentWL}</div>
                  )}
                  <div style={{ marginTop: 4, fontSize: 10, opacity: 0.6 }}>
                    Activo: {activeTool} | Centro: mover | Der: zoom | Rueda: navegar frames
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Frame navigation */}
      {ready && totalFrames > 1 && (
        <div className="viewer-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(0)} disabled={currentIndex === 0}>«</button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(currentIndex - 1)} disabled={currentIndex === 0}>‹ Anterior</button>
          <span style={{ padding: '0 8px' }}>{currentIndex + 1} / {totalFrames}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(currentIndex + 1)} disabled={currentIndex >= totalFrames - 1}>Siguiente ›</button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(totalFrames - 1)} disabled={currentIndex >= totalFrames - 1}>»</button>
        </div>
      )}
    </div>
  );
});
