import type {StyleLayer} from './style_layer.ts';

/**
 * specfocus: a layer drawn some metres away from where its tiles say.
 *
 * CARTO's vector streets are OSM, and OSM sits metres off Esri World Imagery (Grecia: 5.5 m
 * east, 4.2 m north). Esri is the frame of our maps (Lucas, 2026-09-20), so the VECTORS move
 * onto it. The style spec's `*-translate` cannot do it: it moves the drawing inside a tile
 * clipping mask that stays put, and every tile edge opens a seam (maps 0.0.83, reverted). A
 * layer declares the move in its `metadata`, which the spec leaves free:
 * `{"specfocus:translate-m": [east, north]}`, metres, east and north positive.
 *
 * Three places read it, and they must agree:
 *  - the painter, around a layer's draw calls AND around its source's clipping masks, so the
 *    geometry and the mask move together and neighbouring tiles still meet (painter.ts);
 *  - the mercator transform, which shifts a copy of the tile matrix (mercator_transform.ts);
 *  - the style, which asks the source for the tiles under the viewport moved the OTHER way,
 *    because what shows at the screen's edge comes from that far beyond it (style.ts).
 *
 * Every layer of one source must carry the same value: they share one set of masks and one
 * set of tiles. Mercator only; symbols are placed elsewhere and do not follow it.
 */
export const LAYER_TRANSLATE_METADATA_KEY = 'specfocus:translate-m';

export function layerTranslateMetres(layer: StyleLayer): [number, number] | null {
    const value = (layer.metadata as Record<string, unknown> | undefined)?.[LAYER_TRANSLATE_METADATA_KEY];
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [east, north] = value as unknown[];
    if (typeof east !== 'number' || typeof north !== 'number' || !isFinite(east) || !isFinite(north)) return null;
    return east === 0 && north === 0 ? null : [east, north];
}

/**
 * specfocus: a LINE layer drawn without the per-tile clipping mask.
 *
 * A tile holds only the stretch of a line inside it plus a small buffer, and the mask cuts what
 * each tile draws at its own edge. That is invisible while the line is thinner than the buffer.
 * A street kept at its GROUND width (8 m) is tens of pixels wide when a z14 tile is overzoomed to
 * z20, far wider than the buffer: where the road runs along a tile edge, one half of it lies in
 * a tile that has no geometry for it yet, so the mask leaves a flat cut and a round cap shows
 * (Lucas, 2026-09-20). Unclipped, the two tiles' stretches overlap and the road is whole. Only
 * right for OPAQUE lines: the overlap would show as a darker band on a translucent one.
 * `{"specfocus:unclipped": true}` in the layer's `metadata`.
 */
export const LAYER_UNCLIPPED_METADATA_KEY = 'specfocus:unclipped';

export function layerIsUnclipped(layer: StyleLayer): boolean {
    return (layer.metadata as Record<string, unknown> | undefined)?.[LAYER_UNCLIPPED_METADATA_KEY] === true;
}

/** The translate of a source: its first layer that declares one. */
export function sourceTranslateMetres(layers: Iterable<StyleLayer>, sourceId: string): [number, number] | null {
    for (const layer of layers) {
        if (layer.source !== sourceId) continue;
        const translate = layerTranslateMetres(layer);
        if (translate) return translate;
    }
    return null;
}
