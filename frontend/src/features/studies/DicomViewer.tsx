import { useEffect, useRef } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';

const { PanTool, ZoomTool, WindowLevelTool, LengthTool, ToolGroupManager, Enums } = csTools as any;

export function DicomViewer({ imageUrls }: { imageUrls: string[] }) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!elementRef.current || !imageUrls.length) return;

    const run = async () => {
      await cornerstone.init();
      await csTools.init();
      const renderingEngineId = 'engine';
      const viewportId = 'dicomViewport';
      const renderingEngine = new cornerstone.RenderingEngine(renderingEngineId);
      const element = elementRef.current!;
      renderingEngine.setViewports([{ viewportId, type: cornerstone.Enums.ViewportType.STACK, element }]);

      const toolGroup = ToolGroupManager.createToolGroup('default-tools');
      csTools.addTool(PanTool); csTools.addTool(ZoomTool); csTools.addTool(WindowLevelTool); csTools.addTool(LengthTool);
      toolGroup.addTool(PanTool.toolName); toolGroup.addTool(ZoomTool.toolName); toolGroup.addTool(WindowLevelTool.toolName); toolGroup.addTool(LengthTool.toolName);
      toolGroup.addViewport(viewportId, renderingEngineId);
      toolGroup.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }] });
      toolGroup.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: Enums.MouseBindings.Secondary }] });
      toolGroup.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: Enums.MouseBindings.Primary }] });
      toolGroup.setToolActive(LengthTool.toolName, { bindings: [{ mouseButton: Enums.MouseBindings.Primary, modifierKey: Enums.KeyboardBindings.Shift }] });

      const vp = renderingEngine.getViewport(viewportId) as any;
      await vp.setStack(imageUrls.map((u) => `wadouri:${u}`), 0);
      vp.render();
    };

    run();
  }, [imageUrls]);

  return <div ref={elementRef} style={{ height: 480, background: '#000', borderRadius: 12 }} />;
}
