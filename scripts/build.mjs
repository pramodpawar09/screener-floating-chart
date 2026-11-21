// Bundles the three extension entry points as classic IIFE scripts.
// MV3 content scripts cannot be ES modules, and each entry must be self-contained,
// so a tiny esbuild script is simpler and more predictable than a multi-entry Vite config.
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

const options = {
  entryPoints: {
    content: 'src/content/content.js',
    background: 'src/background/service-worker.js',
    popup: 'src/popup/popup.js',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'eof',
  loader: { '.css': 'text' },
  logLevel: 'info',
  // Test hook only: lets the UI smoke test swap in a chart stub. Never set for real builds.
  alias: process.env.SFC_CHART_STUB ? { 'lightweight-charts': process.env.SFC_CHART_STUB } : {},
};

async function copyStatic() {
  await cp('manifest.json', 'dist/manifest.json');
  await cp('src/popup/popup.html', 'dist/popup.html');
  await cp('src/popup/popup.css', 'dist/popup.css');
  await cp('public/icons', 'dist/icons', { recursive: true });
}

await copyStatic();
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching… (static files are copied once; re-run if you change manifest/popup HTML/CSS)');
} else {
  await build(options);
  console.log('Build complete → dist/');
}
