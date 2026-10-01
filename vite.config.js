import { defineConfig } from 'vite';

// base './' keeps built asset paths relative, so dist/ works on Cloudflare Pages, Vercel,
// or a GitHub Pages project subpath without changes.
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true }
});
