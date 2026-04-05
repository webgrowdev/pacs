import { useEffect, useRef, useState, useCallback } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
// Static import — dynamic import() fails for this package in browser ESM
// because it mixes named + default exports.
// The 'init' named export registers 'wadouri' / 'wadors' / 'dicomfile' loaders
// with @cornerstonejs/core via registerImageLoader() internally.
import { init as dicomLoaderInit } from '@cornerstonejs/dicom-image-loader';
import { getAccessToken } from '../../lib/auth';

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

interface DicomViewerProps {
  imageUrls: string[];
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

export function DicomViewer({ imageUrls }: DicomViewerProps) {
  const elementRef    = useRef<HTMLDivElement>(null);
  const engineRef     = useRef<cornerstone.RenderingEngine | null>(null);
  const toolGroupRef  = useRef<any>(null);

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
  }, [imageUrls]);

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
}
