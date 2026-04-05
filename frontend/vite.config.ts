import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { buildSync } from 'esbuild';

// ─── Worker public path ───────────────────────────────────────────────────────
const WORKER_PUBLIC = '/_cs/decodeImageFrameWorker.js';

// =============================================================================
// Pre-bundle the decode worker SYNCHRONOUSLY at vite.config.ts load time.
//
// WHY SYNC: this must complete before optimizeDeps, buildStart, or any browser
// request.  esbuild's buildSync() is a blocking call — safe here because
// vite.config.ts runs in Node, not in the browser.
//
// WHAT IT DOES:
//   decodeImageFrameWorker.js imports bare specifier 'comlink' plus many
//   relative './shared/...' modules.  A raw copy to /public would break in
//   any browser because bare specifiers are not resolvable in native ESM
//   module workers.  esbuild bundles everything into a single self-contained
//   ES-module that the browser CAN load as new Worker(url, {type:'module'}).
// =============================================================================
;(function prebundleWorker() {
  const src  = path.resolve('node_modules/@cornerstonejs/dicom-image-loader/dist/esm/decodeImageFrameWorker.js');
  const dest = path.resolve(`public${WORKER_PUBLIC}`);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    buildSync({
      entryPoints: [src],
      bundle:      true,
      format:      'esm',
      platform:    'browser',
      outfile:     dest,
      logLevel:    'silent',
      // The Cornerstone codec WASM wrappers (openjpeg, charls, libjpeg, openjph)
      // are Emscripten-generated and contain dead-code paths for Node.js that
      // reference 'fs' and 'path' behind an ENVIRONMENT_IS_NODE guard.
      // Marking them as external is safe: they are never called in the browser.
      external: ['fs', 'path', 'crypto'],
      define: {
        // Help esbuild tree-shake the Node.js branches
        'process.versions.node': 'undefined',
      },
    });
  } catch {
    // Fallback: raw copy (worker will still fail in browser, but at least
    // the dev server starts)
    try { fs.copyFileSync(src, dest); } catch {}
  }
})();

// =============================================================================
// Vite plugin — two transforms:
//
// 1. Patch @cornerstonejs/dicom-image-loader/dist/esm/init.js
//    The `workerFn` inside creates the worker with a relative URL:
//      new Worker(new URL('./decodeImageFrameWorker.js', import.meta.url), …)
//    When dicom-image-loader is excluded from optimizeDeps (served raw), Vite
//    resolves import.meta.url to the /@fs/ URL of init.js.  The resulting
//    worker URL is /@fs/…/decodeImageFrameWorker.js.  Native module workers
//    loaded from /@fs/ don't go through Vite's transform pipeline, so bare
//    specifiers like 'comlink' fail.
//    FIX: replace the whole Worker constructor with our pre-bundled path.
//
// 2. Patch @cornerstonejs/core/dist/esm/index.js star-export
//    export * from './RenderingEngine/helpers/getOrCreateCanvas'
//    that file has export default → Safari / strict Chrome throw SyntaxError.
//    FIX: replace with explicit named re-export (no `default` leaks out).
// =============================================================================
function cornerstonePlugin(): Plugin {
  const WORKER_RE = /new Worker\(\s*new URL\(\s*['"][^'"]*decodeImageFrameWorker[^'"]*['"]\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type\s*:\s*['"]module['"]\s*\}\s*\)/g;

  return {
    name:    'cornerstone-patch',
    enforce: 'pre',

    transform(code, id) {
      // ── 1. init.js worker URL ──────────────────────────────────────────────
      if (
        id.includes('@cornerstonejs') &&
        id.includes('dicom-image-loader') &&
        code.includes('decodeImageFrameWorker')
      ) {
        const patched = code.replace(
          WORKER_RE,
          `new Worker('${WORKER_PUBLIC}', { type: 'module' })`
        );
        if (patched !== code) return { code: patched, map: null };
      }

      // ── 2. core star-export (Safari ESM bug) ──────────────────────────────
      if (
        id.includes('@cornerstonejs/core') &&
        id.endsWith('index.js') &&
        code.includes("export * from './RenderingEngine/helpers/getOrCreateCanvas'")
      ) {
        const patched = code.replace(
          "export * from './RenderingEngine/helpers/getOrCreateCanvas';",
          "export { EPSILON, createCanvas, createViewportElement, setCanvasCreator, getOrCreateCanvas } from './RenderingEngine/helpers/getOrCreateCanvas';"
        );
        if (patched !== code) return { code: patched, map: null };
      }

      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), cornerstonePlugin()],

  server: {
    port: 5173,
    proxy: {
      '/api':   'http://localhost:4000',
      '/files': 'http://localhost:4000',
    },
  },

  worker: { format: 'es' },

  optimizeDeps: {
    // Pre-bundle core + tools with esbuild so the browser never sees the raw
    // ESM files that trigger the 'export * from module-with-default' SyntaxError
    // in Safari / strict Chrome.
    //
    // dicom-image-loader is EXCLUDED so Vite serves its individual files through
    // its own transform pipeline.  Our cornerstonePlugin transform hook above
    // patches init.js before the browser sees it, replacing the worker URL.
    include: [
      '@cornerstonejs/core',
      '@cornerstonejs/tools',
    ],
    exclude: [
      '@cornerstonejs/dicom-image-loader',
    ],
  },
});
