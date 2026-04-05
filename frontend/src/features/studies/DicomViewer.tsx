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

type ToolName = 'WindowLevel' | 'Pan' | 'Zoom' | 'Length';

const TOOL_BUTTONS: Array<{ name: ToolName; label: string; icon: string }> = [
  { name: 'WindowLevel', label: 'Ventana', icon: '◑' },
  { name: 'Pan',         label: 'Mover',   icon: '✥' },
  { name: 'Zoom',        label: 'Zoom',    icon: '⊕' },
  { name: 'Length',      label: 'Medir',   icon: '↔' }
];

const {
  PanTool,
  ZoomTool,
  WindowLevelTool,
  LengthTool,
  ToolGroupManager,
  Enums: ToolEnums
} = csTools as any;

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

  // ── Activate a tool on the current group ────────────────────────────────────
  const activateTool = useCallback((toolName: ToolName) => {
    if (!toolGroupRef.current) return;
    const tg = toolGroupRef.current;
    try {
      tg.setToolPassive(PanTool.toolName);
      tg.setToolPassive(ZoomTool.toolName);
      tg.setToolPassive(WindowLevelTool.toolName);
      tg.setToolPassive(LengthTool.toolName);
      const toolMap: Record<ToolName, string> = {
        WindowLevel: WindowLevelTool.toolName,
        Pan:         PanTool.toolName,
        Zoom:        ZoomTool.toolName,
        Length:      LengthTool.toolName
      };
      tg.setToolActive(toolMap[toolName], {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }]
      });
      setActiveTool(toolName);
    } catch {}
  }, []);

  // ── Main initialization effect ───────────────────────────────────────────────
  // Each run of this effect gets its OWN engine + toolGroup IDs (unique per run).
  // This prevents ID collisions when React StrictMode mounts/unmounts/mounts
  // the component in rapid succession, and when imageUrls changes.
  useEffect(() => {
    if (!elementRef.current || !imageUrls.length) return;

    const element = elementRef.current;

    // Unique IDs for this specific effect run — avoids registry conflicts when
    // React StrictMode runs cleanup then immediately re-mounts.
    const engineId    = `cs-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const toolGroupId = `cs-tg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Local references captured by the closure so cleanup doesn't need the refs
    let localEngine:    cornerstone.RenderingEngine | null = null;
    let localToolGroup: any = null;
    let cancelled = false; // set by cleanup to abort in-flight async init

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
        [PanTool, ZoomTool, WindowLevelTool, LengthTool].forEach((t: any) => {
          try { csTools.addTool(t); } catch {}
        });

        const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
        localToolGroup = toolGroup;
        toolGroupRef.current = toolGroup;

        [PanTool.toolName, ZoomTool.toolName, WindowLevelTool.toolName, LengthTool.toolName].forEach((name: string) => {
          try { toolGroup.addTool(name); } catch {}
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
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        console.error('[DicomViewer]', err);
        setError('No se pudo inicializar el visor DICOM. Verifique que los archivos sean DICOM válidos.');
      }
    };

    run();

    // ── Cleanup ──────────────────────────────────────────────────────────────
    // Runs when: (a) imageUrls changes, (b) component unmounts,
    // (c) React StrictMode runs the double-mount cycle in development.
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

      // Clear shared refs only if they still point to this run's objects
      if (engineRef.current === localEngine)   engineRef.current   = null;
      if (toolGroupRef.current === localToolGroup) toolGroupRef.current = null;

      setReady(false);
      setError('');
    };
  }, [imageUrls]); // imageUrls must be stable (memoized in parent) to avoid churn

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

  return (
    <div className="viewer-panel" style={{ height: '100%' }}>
      {/* Toolbar */}
      <div className="viewer-toolbar">
        {TOOL_BUTTONS.map((btn) => (
          <button
            key={btn.name}
            className={`btn btn-sm ${activeTool === btn.name ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => activateTool(btn.name)}
            title={btn.label}
            disabled={!ready}
          >
            <span>{btn.icon}</span>
            <span style={{ fontSize: 12 }}>{btn.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
          {ready
            ? `${imageUrls.length} imagen${imageUrls.length > 1 ? 'es' : ''}`
            : error ? 'Error' : 'Cargando...'}
        </span>
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
                  <div style={{ marginTop: 4, fontSize: 10, opacity: 0.6 }}>
                    Clic: {activeTool} | Clic centro: mover | Clic der: zoom
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
