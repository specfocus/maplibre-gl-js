import GlobalStyles from '@mui/material/GlobalStyles';
import * as React from 'react';
import maplibreGlStylesheet from './maplibre-gl-stylesheet.g.ts';

/**
 * Injects the maplibre-gl stylesheet into the document through MUI's `GlobalStyles`, so a React
 * application styles the map, its controls, popups and markers by rendering this component instead
 * of importing `maplibre-gl.css`. Render it once in the tree of any component that shows a map.
 *
 * The stylesheet reaches Emotion as a single CSS string, the compiled output of
 * `src/css/maplibre-gl.css` written by `build/generate-mui-styles.ts`, so the page receives the same
 * rules `dist/maplibre-gl.css` contains, control icons included as SVG data URIs.
 *
 * The library entry `src/index.ts` carries no framework and loads in applications that have neither
 * React nor MUI installed, so this module is imported by its own path,
 * `@specfocus/maplibre-gl/lib/mui/maplibre-global-styles`, and is never re-exported from the entry.
 */
const MaplibreGlobalStyles = (): React.JSX.Element => <GlobalStyles styles={maplibreGlStylesheet} />;

export default MaplibreGlobalStyles;
