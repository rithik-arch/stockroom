import { copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.jsx'],
  outdir: 'dist/assets',
  bundle: true,
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
await copyFile('index.html', 'dist/index.html');
