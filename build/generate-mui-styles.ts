import fs from 'fs';
import postcss from 'postcss';
import postcssConfig from '../postcss.config.js';

/** The stylesheet source that `npm run build-css` compiles into `dist/maplibre-gl.css`. */
const sourcePath = 'src/css/maplibre-gl.css';

/** The module that hands the compiled stylesheet to `src/mui/maplibre-global-styles.tsx`. */
const targetPath = 'src/mui/maplibre-gl-stylesheet.g.ts';

/**
 * Compiles the stylesheet with the plugins in `postcss.config.js`, the same ones `npm run build-css`
 * runs, so the result is the stylesheet `dist/maplibre-gl.css` holds, control icons inlined as SVG
 * data URIs.
 */
async function compileStylesheet(): Promise<string> {
    const css = fs.readFileSync(sourcePath, 'utf8');
    const result = await postcss(postcssConfig.plugins).process(css, {from: sourcePath, map: false});
    return result.css;
}

/**
 * Writes the stylesheet as a TypeScript string constant. JSON escaping preserves both quote characters
 * the data URIs use, so the constant holds the stylesheet byte for byte.
 */
function stylesheetToTs(css: string): string {
    return `// This file is generated from ${sourcePath} by build/generate-mui-styles.ts. Edit the CSS, then run \`npm run generate-mui-styles\`.
/** The compiled maplibre-gl stylesheet, identical to what \`npm run build-css\` writes to \`dist/maplibre-gl.css\`. */
const maplibreGlStylesheet: string = ${JSON.stringify(css)};
export default maplibreGlStylesheet;
`;
}

console.log('Generating MUI global styles');

const stylesheet = await compileStylesheet();
fs.writeFileSync(targetPath, stylesheetToTs(stylesheet));

console.log(`Wrote ${stylesheet.length} characters of CSS to ${targetPath}`);
