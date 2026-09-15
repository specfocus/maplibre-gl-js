import fs from 'node:fs';
import path from 'node:path';
import {defineConfig, type RolldownOptions} from 'rolldown';
import {dts} from 'rolldown-plugin-dts';
import banner from './build/banner';
import packageJSON from './package.json' with {type: 'json'};

const production = process.env.BUILD === 'production';
const typesOnly = process.env.BUILD === 'types';
/** `worker` builds the worker alone, `main` the main bundle alone (the default builds both, worker first). */
const target = process.env.TARGET ?? 'all';
const outputPostfix = production ? '' : '-dev';

const dtsBundle: RolldownOptions = {
    input: {'maplibre-gl': 'src/index.ts'},
    output: {
        dir: 'dist',
        format: 'es',
    },
    external: Object.keys(packageJSON.dependencies),
    plugins: [dts({emitDtsOnly: true, generator: 'oxc'})],
};

/**
 * specfocus: the worker is INLINED into the main bundle.
 *
 * Upstream ships the worker as a sibling file the main bundle locates at runtime with
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. That guess fails under every
 * bundler we use: Next/Turbopack serves the chunk under a hashed name in another folder
 * (404 → dead worker), Vite's dependency optimizer rewrites `import.meta.url` (empty
 * URL → no worker). A dead worker means every VECTOR source silently loads nothing while
 * raster sources keep working (casa.club, 2026-09-14, streets.umbiliko.com never asked).
 *
 * So the worker is built first as a self-contained module, then the main bundle embeds
 * its text through the virtual module `virtual:maplibre-gl-worker-source` and spawns it
 * from a Blob URL (see `src/util/web_worker.ts`). `setWorkerUrl()` still overrides.
 */
const WORKER_SOURCE_ID = 'virtual:maplibre-gl-worker-source';
const workerFile = (): string => path.resolve('dist', `maplibre-gl-worker${outputPostfix}.mjs`);

const inlineWorkerSource = () => ({
    name: 'maplibre-inline-worker-source',
    resolveId(id: string) {
        return id === WORKER_SOURCE_ID ? `\0${WORKER_SOURCE_ID}` : null;
    },
    load(id: string) {
        if (id !== `\0${WORKER_SOURCE_ID}`) return null;
        const file = workerFile();
        if (!fs.existsSync(file)) {
            throw new Error(`${file} is missing: build the worker first (TARGET=worker) so the main bundle can inline it`);
        }
        return `export const workerSource = ${JSON.stringify(fs.readFileSync(file, 'utf8'))};`;
    },
});

const browserBundle = (input: Record<string, string>, plugins: RolldownOptions['plugins'] = []): RolldownOptions => ({
    input,
    platform: 'browser',
    treeshake: production,
    plugins,
    output: {
        dir: 'dist',
        format: 'es',
        sourcemap: true,
        banner,
        minify: production ? true : 'dce-only',
        entryFileNames: `[name]${outputPostfix}.mjs`,
        inlineDynamicImports: true,
    },
});

const workerBundle = browserBundle({'maplibre-gl-worker': 'src/source/worker.ts'});
const mainBundle = browserBundle({'maplibre-gl': 'src/index.ts'}, [inlineWorkerSource()]);

const config: RolldownOptions[] = defineConfig(
    typesOnly ? [dtsBundle]
        : target === 'worker' ? [workerBundle]
            : target === 'main' ? [mainBundle, ...(production ? [dtsBundle] : [])]
                : [workerBundle, mainBundle, ...(production ? [dtsBundle] : [])],
);

export default config;
