import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The repo root, one level above this app package.
const repoRoot = resolve(import.meta.dirname, '..');
const patchFile = resolve(repoRoot, 'patches', 'borland.json');

/**
 * Serve the canonical patch (patches/borland.json) at /borland.json in dev and
 * emit it into the build output. This keeps patches/ pure (only patches) and the
 * engine free of any build-tool coupling — the player fetches it at boot and falls
 * back to the bundled default if the request fails.
 */
function servePatch(): Plugin {
  return {
    name: 'borland:serve-patch',
    configureServer(server) {
      server.middlewares.use('/borland.json', (_req, res) => {
        try {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-cache');
          res.end(readFileSync(patchFile));
        } catch {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'borland.json',
        source: readFileSync(patchFile),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), servePatch()],
  resolve: {
    alias: {
      // Consume the framework-agnostic engine as TypeScript source, so the whole
      // thing is one Vite graph (HMR + `new URL('./x.worklet.ts', import.meta.url)`
      // bundling just work). The engine's package.json still enforces the boundary
      // (it lists only tone/three/zod — never React).
      '@borland/engine': resolve(repoRoot, 'packages/engine/src/index.ts'),
    },
  },
  server: {
    // Allow Vite to read engine source + the patch from outside the app folder.
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: resolve(repoRoot, 'dist'),
    emptyOutDir: true,
    // Never inline AudioWorklet modules as data: URIs — iOS Safari refuses
    // audioWorklet.addModule() from a data: URL. Emit them as real asset files.
    assetsInlineLimit: (filePath: string) =>
      filePath.endsWith('.worklet.js') ? false : undefined,
  },
});
