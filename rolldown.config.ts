import {defineConfig, type RolldownOptions} from 'rolldown';
import {dts} from 'rolldown-plugin-dts';
import banner from './build/banner';
import packageJSON from './package.json' with {type: 'json'};

const production = process.env.BUILD === 'production';
const typesOnly = process.env.BUILD === 'types';
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
 * specfocus: the main bundle and the worker are built as two SELF-CONTAINED entries, not as
 * two entries sharing a `maplibre-gl-shared` chunk. Upstream's shared chunk is imported by
 * the worker through a relative `./maplibre-gl-shared.mjs`; a bundler that copies the
 * worker as a static asset under a hashed name (Next/Turbopack does) leaves that relative
 * import dangling, the worker dies on load, and every VECTOR source silently loads nothing
 * while raster sources keep working (casa.club, 2026-09-14). Some code is duplicated across
 * the two files; each of them now works wherever it is copied.
 */
const browserBundle = (input: Record<string, string>): RolldownOptions => ({
    input,
    platform: 'browser',
    treeshake: production,
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

const config: RolldownOptions[] = defineConfig(typesOnly ? [dtsBundle] : [
    browserBundle({'maplibre-gl': 'src/index.ts'}),
    browserBundle({'maplibre-gl-worker': 'src/source/worker.ts'}),
    ...(production ? [dtsBundle] : []),
]);

export default config;
