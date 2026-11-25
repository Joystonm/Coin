import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The web front-end.
 *
 * The imports in `src/ui/*` point at `src/lib/*` with an explicit `.ts`
 * extension, because that is how the CLI, the MCP server and the test suite
 * import the same files — one set of pure functions, one set of numbers.
 * Vite resolves those specifiers as-is (the file exists at exactly that path),
 * so no alias plugin is needed.
 */
export default defineConfig({
  plugins: [react()],
  // Where the site is served from. '/' for a root domain (Vercel), and
  // '/<repo>/' for GitHub Pages, where the project lives under a subpath.
  // Set BASE_PATH in the environment to change it; the front-end reads the
  // same value back through `import.meta.env.BASE_URL`.
  base: process.env.BASE_PATH ?? '/',
  build: {
    outDir: 'dist',
    // The app is a single static bundle; no code splitting beyond the default.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
  },
});
