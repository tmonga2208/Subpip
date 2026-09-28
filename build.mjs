// Builds the extension into dist/ (load that folder as the unpacked extension).
//   node build.mjs          one-off build
//   node build.mjs --watch  rebuild on change
import * as esbuild from 'esbuild';
import { cp, rm, mkdir } from 'node:fs/promises';

const outdir = 'dist';
const watch = process.argv.includes('--watch');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
for (const file of ['manifest.json', 'popup.html', 'popup.css', 'assets']) {
  await cp(`src/${file}`, `${outdir}/${file}`, { recursive: true });
}

const options = {
  entryPoints: {
    'script': 'src/content/index.js',            // page script (MAIN world)
    'translate-relay': 'src/relay.js',           // ISOLATED world relay
    'background': 'src/background.js',           // service worker
    'popup': 'src/popup/index.js'
  },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info'
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
