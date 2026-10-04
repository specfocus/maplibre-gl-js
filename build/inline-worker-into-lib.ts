/**
 * specfocus: gives `lib/` the worker it embeds in `dist/`.
 *
 * The bundle (rolldown) inlines the worker through the virtual module
 * `virtual:maplibre-gl-worker-source` and spawns it from a Blob URL. `lib/` is plain tsc output,
 * and a consumer's bundler (Next/Turbopack in casa.club) cannot resolve that virtual id: the
 * dynamic import fails, the source comes back empty, and `web_worker` falls back to
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)` -- a file next to the CONSUMER's chunk,
 * which does not exist. The server answers its 404 page, the worker never starts ("Failed to
 * load module script ... MIME type text/html"), and the map never paints (casa.club, since
 * 6.9.10 made `lib/index.js` the entry; found 2026-10-04).
 *
 * So after tsc, the worker's own text is written as a REAL module, `lib/util/worker-source.js`,
 * and the virtual import in `lib/util/web_worker.js` is pointed at it. The publish runs
 * `build-dist` before `npm publish` (whose prepack runs `build`), so the worker exists by then.
 * Without it (a lib-only build) the module exports '' and the URL fallback stays as it was.
 */
import fs from 'node:fs';
import path from 'node:path';

const VIRTUAL_ID = 'virtual:maplibre-gl-worker-source';
const workerFile = path.resolve('dist', 'maplibre-gl-worker.mjs');
const loaderFile = path.resolve('lib', 'util', 'web_worker.js');
const sourceFile = path.resolve('lib', 'util', 'worker-source.js');

const workerSource = fs.existsSync(workerFile) ? fs.readFileSync(workerFile, 'utf8') : '';
if (workerSource === '') {
    console.warn(`[inline-worker-into-lib] ${workerFile} is missing: lib/ keeps the URL fallback (run build-dist first)`);
}
fs.writeFileSync(sourceFile, `export const workerSource = ${JSON.stringify(workerSource)};\n`);

const loader = fs.readFileSync(loaderFile, 'utf8');
const needle = `import('${VIRTUAL_ID}')`;
if (!loader.includes(needle)) {
    throw new Error(`[inline-worker-into-lib] ${loaderFile} no longer imports ${VIRTUAL_ID}; update this script`);
}
fs.writeFileSync(loaderFile, loader.split(needle).join(`import('./worker-source.js')`));
console.log(`[inline-worker-into-lib] lib/util/worker-source.js: ${workerSource.length} chars`);
