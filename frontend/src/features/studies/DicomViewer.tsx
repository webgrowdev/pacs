import { useEffect, useRef, useState, useCallback } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
// Static import — dynamic import() fails for this package in browser ESM
// because it mixes named + default exports (SyntaxError: star export resolution).
// The 'init' named export registers 'wadouri' / 'wadors' / 'dicomfile' loaders
// with @cornerstonejs/core via registerImageLoader() internally.
import { init as dicomLoaderInit } from '@cornerstonejs/dicom-image-loader';
import { getAccessToken } from '../../lib/auth';

// Initialization guards (one-time per app session)
let cornerstoneInitialized = false;
let dicomLoaderInitialized = false;

function initializeDicomLoader() {
  if (dicomLoaderInitialized) return;
  dicomLoaderInitialized = true;

  // In @cornerstonejs/dicom-image-loader v3+, options (incl. beforeSend) are
  // passed directly to init(). There is no separate .configure() method.
  // init() calls setOptions() then registerLoaders() which registers the
  // 'wadouri', 'wadors' and 'dicomfile' schemes with Cornerstone Core.
  dicomLoaderInit({
    maxWebWorkers: 1,
    // Inject Bearer token on every XHR request for protected /files endpoints
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
  initializeDicomLoader(); // must run after cornerstone.init(), before any imageId load
  await csTools.init();
}

interface DicomViewerProps {
  imageUrls: string[];
}

type ToolName = 'WindowLevel' | 'Pan' | 'Zoom' | 'Length';

const TOOL_BUTTONS: Array<{ name: ToolName; label: string; icon: string }> = [
  { name: 'WindowLevel', label: 'Ventana', icon: '◑' },
  { name: 'Pan', label: 'Mover', icon: '✥' },
  { name: 'Zoom', label: 'Zoom', icon: '⊕' },
  { name: 'Length', label: 'Medir', icon: '↔' }
];

const {
  PanTool,
  ZoomTool,
  WindowLevelTool,
  LengthTool,
  ToolGroupManager,
  Enums: ToolEnums
} = csTools as any;

export function DicomViewer({ imageUrls }: DicomViewerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<cornerstone.RenderingEngine | null>(null);
  const toolGroupRef = useRef<any>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [activeTool, setActiveTool] = useState<ToolName>('WindowLevel');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const engineId = useRef(`engine-${Math.random().toString(36).slice(2)}`);
  const toolGroupId = useRef(`tg-${Math.random().toString(36).slice(2)}`);
  const viewportId = 'dicom-vp';

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
        Pan: PanTool.toolName,
        Zoom: ZoomTool.toolName,
        Length: LengthTool.toolName
      };
      tg.setToolActive(toolMap[toolName], {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }]
      });
      setActiveTool(toolName);
    } catch {}
  }, []);

  useEffect(() => {
    if (!elementRef.current || !imageUrls.length) return;

    const element = elementRef.current;
    let mounted = true;

    const run = async () => {
      try {
        await initializeCornerstone();
        if (!mounted) return;

        const renderingEngine = new cornerstone.RenderingEngine(engineId.current);
        engineRef.current = renderingEngine;

        renderingEngine.setViewports([{
          viewportId,
          type: cornerstone.Enums.ViewportType.STACK,
          element
        }]);

        // Herramientas
        if (!csTools.addTool) return;
        [PanTool, ZoomTool, WindowLevelTool, LengthTool].forEach((t: any) => {
          try { csTools.addTool(t); } catch {}
        });

        const toolGroup = ToolGroupManager.createToolGroup(toolGroupId.current);
        toolGroupRef.current = toolGroup;
        [PanTool.toolName, ZoomTool.toolName, WindowLevelTool.toolName, LengthTool.toolName].forEach((name: string) => {
          try { toolGroup.addTool(name); } catch {}
        });
        toolGroup.addViewport(viewportId, engineId.current);

        // Activar WindowLevel por defecto
        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }]
        });
        toolGroup.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }]
        });
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }]
        });

        // Cargar imágenes
        const imageIds = imageUrls.map((u) => `wadouri:${u}`);
        const vp = renderingEngine.getViewport(viewportId) as any;
        await vp.setStack(imageIds, 0);
        vp.render();
        setTotalFrames(imageIds.length);
        setReady(true);
      } catch (err) {
        console.error('[DicomViewer]', err);
        setError('No se pudo inicializar el visor DICOM. Verifique que los archivos sean DICOM válidos.');
      }
    };

    run();

    return () => {
      mounted = false;
      try {
        if (toolGroupRef.current) {
          ToolGroupManager.destroyToolGroup(toolGroupId.current);
          toolGroupRef.current = null;
        }
      } catch {}
      try {
        if (engineRef.current) {
          engineRef.current.destroy();
          engineRef.current = null;
        }
      } catch {}
      setReady(false);
    };
  }, [imageUrls]);

  const navigate = useCallback(async (newIndex: number) => {
    if (!engineRef.current || newIndex < 0 || newIndex >= totalFrames) return;
    try {
      const vp = engineRef.current.getViewport(viewportId) as any;
      await vp.setImageIdIndex(newIndex);
      vp.render();
      setCurrentIndex(newIndex);
    } catch {}
  }, [totalFrames]);

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
          {ready ? `${imageUrls.length} imagen${imageUrls.length > 1 ? 'es' : ''}` : 'Cargando...'}
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

            {/* Overlay info */}
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
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(0)}
            disabled={currentIndex === 0}
          >
            «
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(currentIndex - 1)}
            disabled={currentIndex === 0}
          >
            ‹ Anterior
          </button>
          <span style={{ padding: '0 8px' }}>
            {currentIndex + 1} / {totalFrames}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(currentIndex + 1)}
            disabled={currentIndex >= totalFrames - 1}
          >
            Siguiente ›
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(totalFrames - 1)}
            disabled={currentIndex >= totalFrames - 1}
          >
            »
          </button>
        </div>
      )}
    </div>
  );
}
