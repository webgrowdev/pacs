import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { build as esbuildBuild } from 'esbuild';

// The worker will be bundled (comlink + all relative deps inlined) and served
// from this public path so the browser can load it as a module worker.
const WORKER_PUBLIC_PATH = '/_cs/decodeImageFrameWorker.js';

/**
 * WHY THIS PLUGIN EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 *
 * PROBLEM 1 — Safari / strict-Chrome ESM `export *` SyntaxError:
 *   @cornerstonejs/core/dist/esm/index.js has:
 *     export * from './RenderingEngine/helpers/getOrCreateCanvas'
 *   that file has `export default getOrCreateCanvas`.
 *   Per the ESM spec `export *` must not re-export `default`.
 *   Safari throws SyntaxError when it encounters this in raw browser ESM.
 *
 *   FIX: put all three Cornerstone packages in `optimizeDeps.include`.
 *   esbuild pre-bundles them into flat files — the browser never sees
 *   any raw `export *` pattern.
 *
 * PROBLEM 2 — Worker URL breaks after pre-bundling:
 *   @cornerstonejs/dicom-image-loader/dist/esm/init.js creates the worker:
 *     new Worker(new URL('./decodeImageFrameWorker.js', import.meta.url), …)
 *   When esbuild pre-bundles the package, import.meta.url becomes the URL
 *   of the bundled deps file, not the original dist/esm/ directory.
 *   The relative worker URL therefore resolves to nothing.
 *
 *   FIX (dev): `optimizeDeps.esbuildOptions.plugins` patches init.js
 *   DURING the pre-bundling pass so the worker uses the public path.
 *
 *   FIX (prod): the `transform` hook patches init.js when Rollup sees it.
 *
 * PROBLEM 3 — comlink bare specifier inside the worker:
 *   decodeImageFrameWorker.js imports `comlink` (bare specifier) plus many
 *   `./shared/…` relative imports.  A raw copy served from /public would
 *   fail because the browser can't resolve bare specifiers as native ESM.
 *
 *   FIX: `buildStart` uses esbuild to BUNDLE the worker (comlink + all
 *   relative deps inlined) into a self-contained ES-module file that the
 *   browser can load as `new Worker(url, { type: 'module' })` without
 *   needing any module resolution.
 */
function cornerstonePlugin(): Plugin {
  // esbuild filter — matches dist/esm/init.js inside dicom-image-loader
  const initFilter = /dicom-image-loader[/\\]dist[/\\]esm[/\\]init\.js$/;

  // Regex that matches the Worker constructor in init.js
  const workerUrlRe =
    /new Worker\(\s*new URL\(\s*['"][^'"]*decodeImageFrameWorker[^'"]*['"]\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type\s*:\s*['"]module['"]\s*\}\s*\)/g;
  const workerReplacement = `new Worker('${WORKER_PUBLIC_PATH}', { type: 'module' })`;

  return {
    name: 'cornerstone-dicom',
    enforce: 'pre',

    // ── Runs at dev-server start and at the start of every prod build ──────
    async buildStart() {
      const workerSrc = path.resolve(
        'node_modules/@cornerstonejs/dicom-image-loader/dist/esm/decodeImageFrameWorker.js'
      );
      const destDir = path.resolve(`public${path.dirname(WORKER_PUBLIC_PATH)}`);
      const destFile = path.resolve(`public${WORKER_PUBLIC_PATH}`);

      fs.mkdirSync(destDir, { recursive: true });

      if (!fs.existsSync(workerSrc)) {
        console.warn('[cs-plugin] decodeImageFrameWorker.js not found at', workerSrc);
        return;
      }

      try {
        // Bundle the worker with all its dependencies (comlink, ./shared/…)
        // into a single self-contained ES module so the browser can load it
        // as `new Worker(url, { type: 'module' })` without any bare specifiers.
        await esbuildBuild({
          entryPoints: [workerSrc],
          bundle: true,
          format: 'esm',
          platform: 'browser',
          outfile: destFile,
          logLevel: 'warning',
        });
        console.log('[cs-plugin] ✓ Decode worker bundled →', WORKER_PUBLIC_PATH);
      } catch (e) {
        console.warn('[cs-plugin] Worker bundle failed, falling back to raw copy:', e);
        try { fs.copyFileSync(workerSrc, destFile); } catch {}
      }
    },

    // ── Prod build: Rollup transform (optimizeDeps esbuild plugin below    ──
    // ── handles dev mode)                                                  ──
    transform(code, id) {
      if (initFilter.test(id) && code.includes('decodeImageFrameWorker')) {
        const patched = code.replace(workerUrlRe, workerReplacement);
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
    // Pre-bundle ALL THREE packages with esbuild so the browser never sees
    // the raw ESM files that trigger the `export * from module-with-default`
    // SyntaxError in Safari / strict-mode Chromium.
    include: [
      '@cornerstonejs/core',
      '@cornerstonejs/tools',
      '@cornerstonejs/dicom-image-loader',
    ],

    esbuildOptions: {
      // ── Dev mode: patch init.js DURING the esbuild pre-bundling pass ──
      plugins: [
        {
          name: 'cs-worker-url-patch',
          setup(build: any) {
            build.onLoad({ filter: /dicom-image-loader[/\\]dist[/\\]esm[/\\]init\.js$/ },
              (args: any) => {
                const raw = fs.readFileSync(args.path, 'utf-8');
                const patched = raw.replace(
                  /new Worker\(\s*new URL\(\s*['"][^'"]*decodeImageFrameWorker[^'"]*['"]\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type\s*:\s*['"]module['"]\s*\}\s*\)/g,
                  `new Worker('${WORKER_PUBLIC_PATH}', { type: 'module' })`
                );
                return { contents: patched, loader: 'js' };
              }
            );
          },
        },
      ],
    },
  },
});
