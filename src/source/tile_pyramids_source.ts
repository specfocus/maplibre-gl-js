import {extend} from '../util/util.ts';
import {ImageRequest} from '../util/image_request.ts';
import {ResourceType} from '../util/request_manager.ts';
import {getJSON} from '../util/ajax.ts';
import {type Evented} from '../util/evented.ts';
import {MapSourceDataEvent} from '../ui/events.ts';
import {Texture} from '../webgl/texture.ts';
import {RGBAImage} from '../util/image.ts';
import {isAbortError} from '../util/abort_error.ts';
import {RasterTileSource} from './raster_tile_source.ts';
import {coverageHas, coverageOpaque, parseTileCoverage, type TileAddress, type TileCoverage} from './tile_coverage.ts';

import type {Dispatcher} from '../util/dispatcher.ts';
import type {Tile} from '../tile/tile.ts';
import type {RasterSourceSpecification} from '@maplibre/maplibre-gl-style-spec';

/**
 * specfocus: one baked pyramid inside a `tile-pyramids` source.
 */
export type TilePyramidSpecification = {
    /** `{z}/{x}/{y}` templates, as a raster source's `tiles`; the pyramid's version goes in the query. */
    tiles: string[];
    minzoom?: number;
    maxzoom?: number;
    /** A tile `z/x/y`: the pyramid answers only inside it. Absent: the whole world. */
    scope?: string;
    /** The pyramid's `coverage.json` (see tile_coverage.ts): which tiles exist and which are opaque. */
    coverage?: string;
    /**
     * Past `maxzoom`, where an ancestor at `maxzoom` exists, the loaded ancestor keeps being drawn,
     * stretched, instead of what lies below this pyramid. Default false.
     */
    overzoom?: boolean;
};

/**
 * specfocus (Lucas, 2026-10-20): a raster source that decides PER TILE which image it draws.
 *
 *   { "type": "tile-pyramids", "tileSize": 256, "maxzoom": 19,
 *     "pyramids": [ { "tiles": [...mirage...], "minzoom": 4, "maxzoom": 15, "coverage": "...", "overzoom": true } ],
 *     "ground": [ "https://world.umbiliko.com/{z}/{x}/{y}.jpg" ] }
 *
 * The first pyramid that covers a tile wins; where none does, the `ground` chain (tried in
 * order) answers. A covered tile whose coverage says it is opaque is ONE image; one with
 * transparent parts is drawn over its ground in the same tile (`groundTexture`, draw_raster.ts).
 * Nothing is drawn from a second layer, so the ground can never show before the picture.
 *
 * Every pyramid's coverage is read before the source announces itself, as a TileJSON is, so
 * no tile is requested before the source knows who covers it. A pyramid without coverage is
 * asked for every tile, together with its ground, until its bake publishes one.
 *
 * Replaces `@specfocus/maps`'s `umbiliko://` protocol: no protocol, no copied buffers, no
 * decoding in the page to measure opacity, no 404 to simulate overzoom.
 */
export type TilePyramidsSourceSpecification = Omit<RasterSourceSpecification, 'type' | 'tiles' | 'url'> & {
    type: 'tile-pyramids';
    pyramids: TilePyramidSpecification[];
    ground?: string[];
};

type Pyramid = TilePyramidSpecification & {scopeTile?: TileAddress; tileCoverage?: TileCoverage};

const SCOPE = /^(\d{1,2})\/(\d+)\/(\d+)$/;

const parseScope = (scope: string | undefined): TileAddress | undefined => {
    const match = scope === undefined ? null : SCOPE.exec(scope);
    return match ? {z: Number(match[1]), x: Number(match[2]), y: Number(match[3])} : undefined;
};

/** The ancestor of `tile` at zoom `z` (z <= tile.z); `2 **`, not a shift, past z31. */
const ancestorAt = (tile: TileAddress, z: number): TileAddress => {
    const scale = 2 ** (tile.z - z);
    return {z, x: Math.floor(tile.x / scale), y: Math.floor(tile.y / scale)};
};

const inScope = (pyramid: Pyramid, tile: TileAddress): boolean => {
    const scope = pyramid.scopeTile;
    if (scope === undefined) return true;
    if (tile.z < scope.z) return false;
    const a = ancestorAt(tile, scope.z);
    return a.x === scope.x && a.y === scope.y;
};

const fill = (templates: readonly string[], tile: TileAddress): string => {
    const template = templates[(tile.x + tile.y) % templates.length];
    return template.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
};

/** What one tile shows, decided without touching the network. */
export type TilePyramidsResolution =
    | {kind: 'picture'; url: string; ground: boolean}
    | {kind: 'ground'}
    | {kind: 'parent'}
    | {kind: 'empty'};

/** Resolution of one tile against the pyramids, in order. Exported for tests. */
export function resolveTilePyramids(pyramids: readonly Pyramid[], hasGround: boolean, tile: TileAddress): TilePyramidsResolution {
    for (const pyramid of pyramids) {
        if (!inScope(pyramid, tile)) continue;
        const minzoom = pyramid.minzoom ?? 0;
        const maxzoom = pyramid.maxzoom ?? Infinity;
        if (tile.z < minzoom) continue;
        const coverage = pyramid.tileCoverage;
        if (tile.z > maxzoom) {
            if (pyramid.overzoom && (coverage === undefined || coverageHas(coverage, ancestorAt(tile, maxzoom)))) return {kind: 'parent'};
            continue;
        }
        if (coverage !== undefined && !coverageHas(coverage, tile)) continue;
        const opaque = coverage === undefined ? undefined : coverageOpaque(coverage, tile);
        return {kind: 'picture', url: fill(pyramid.tiles, tile), ground: hasGround && opaque !== true};
    }
    return hasGround ? {kind: 'ground'} : {kind: 'empty'};
}

export class TilePyramidsSource extends RasterTileSource {
    pyramids: Pyramid[];
    ground: string[];
    _pyramidsOptions: TilePyramidsSourceSpecification;

    constructor(id: string, options: TilePyramidsSourceSpecification, dispatcher: Dispatcher, eventedParent: Evented) {
        super(id, {...options, type: 'raster'} as RasterSourceSpecification, dispatcher, eventedParent);
        // A raster in every other respect: fading, retained parents, the raster draw.
        this.type = 'raster';
        this._pyramidsOptions = extend({}, options);
        extend(this, {minzoom: options.minzoom ?? 0, maxzoom: options.maxzoom ?? 22, tileSize: options.tileSize ?? 512});
        this.pyramids = options.pyramids.map((pyramid: TilePyramidSpecification): Pyramid => ({...pyramid, scopeTile: parseScope(pyramid.scope)}));
        this.ground = options.ground ?? [];
    }

    async load(sourceDataChanged: boolean = false): Promise<void> {
        this._loaded = false;
        this.fire(new MapSourceDataEvent('dataloading'));
        const request = new AbortController();
        this._tileJSONRequest = request;
        // Every coverage before any tile: a pyramid whose coverage cannot be read is asked for every tile.
        await Promise.all(this.pyramids.map(async (pyramid: Pyramid): Promise<void> => {
            if (pyramid.coverage === undefined) return;
            try {
                const parameters = await this.map._requestManager.transformRequest(pyramid.coverage, ResourceType.Source);
                const {data} = await getJSON<unknown>(parameters, request);
                pyramid.tileCoverage = parseTileCoverage(data);
            } catch (err) {
                if (!isAbortError(err)) pyramid.tileCoverage = undefined;
            }
        }));
        if (request.signal.aborted) return;
        this._tileJSONRequest = null;
        this._loaded = true;
        this.fire(new MapSourceDataEvent('data', {sourceDataType: 'metadata'}));
        this.fire(new MapSourceDataEvent('data', {sourceDataType: 'content', sourceDataChanged}));
    }

    serialize(): any {
        return extend({}, this._pyramidsOptions);
    }

    /** One image, or null where the server has none (404). Any other failure throws. */
    async _image(url: string, abortController: AbortController): Promise<HTMLImageElement | ImageBitmap | RGBAImage | null> {
        try {
            // Through fetch, never an <img>: an <img> that fails says nothing of the status, and a
            // missing tile (404) must be told apart from a broken one.
            const response = await ImageRequest.transformAndGetImage(this.map._requestManager, url, ResourceType.Tile, abortController, true);
            return response.data ?? new RGBAImage({width: 1, height: 1}, new Uint8Array(4));
        } catch (err) {
            if ((err as {status?: number}).status === 404) return null;
            throw err;
        }
    }

    /** The ground chain, in order: the first that has the tile. */
    async _groundImage(tile: TileAddress, abortController: AbortController): Promise<HTMLImageElement | ImageBitmap | RGBAImage | null> {
        for (const template of this.ground) {
            const image = await this._image(fill([template], tile), abortController).catch((err: unknown) => {
                if (isAbortError(err)) throw err;
                return null; // a ground that errors is skipped like one that is missing
            });
            if (image !== null) return image;
        }
        return null;
    }

    _texture(image: HTMLImageElement | ImageBitmap | RGBAImage): Texture {
        const context = this.map.painter.context;
        const gl = context.gl;
        const premultiply = this._premultiplyAlpha;
        let texture = this.map.painter.getTileTexture(image.width);
        if (texture) {
            texture.update(image, {useMipmap: true, premultiply});
        } else {
            texture = new Texture(context, image, gl.RGBA, {useMipmap: true, premultiply});
            texture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE, gl.LINEAR_MIPMAP_NEAREST);
        }
        return texture;
    }

    async loadTile(tile: Tile): Promise<void> {
        const canonical = tile.tileID.canonical;
        const address: TileAddress = {z: canonical.z, x: canonical.x, y: canonical.y};
        const resolution = resolveTilePyramids(this.pyramids, this.ground.length > 0, address);
        if (resolution.kind === 'parent') {
            // The loaded ancestor is kept and drawn, stretched (tile_manager.ts, silent 404).
            tile.state = 'errored';
            throw Object.assign(new Error(`tile-pyramids: ${canonical.z}/${canonical.x}/${canonical.y} is drawn by its ancestor`), {status: 404});
        }
        if (resolution.kind === 'empty') {
            tile.texture = this._texture(new RGBAImage({width: 1, height: 1}, new Uint8Array(4)));
            tile.state = 'loaded';
            return;
        }
        tile.abortController = new AbortController();
        try {
            const [picture, ground] = await Promise.all([
                resolution.kind === 'picture' ? this._image(resolution.url, tile.abortController) : Promise.resolve(null),
                resolution.kind === 'ground' || (resolution.kind === 'picture' && resolution.ground) ? this._groundImage(address, tile.abortController) : Promise.resolve(null),
            ]);
            delete tile.abortController;
            if (tile.aborted) {
                tile.state = 'unloaded';
                return;
            }
            // A picture its coverage promised but the server lacks falls to the ground, then to the parent.
            const top = picture ?? (resolution.kind === 'picture' && !resolution.ground && this.ground.length > 0 ? await this._groundImage(address, new AbortController()) : ground);
            if (top === null && this.ground.length === 0) {
                // An overlay with nothing here draws nothing, and what is under it shows.
                tile.texture = this._texture(new RGBAImage({width: 1, height: 1}, new Uint8Array(4)));
                tile.state = 'loaded';
                return;
            }
            if (top === null) {
                tile.state = 'errored';
                throw Object.assign(new Error(`tile-pyramids: nothing at ${canonical.z}/${canonical.x}/${canonical.y}`), {status: 404});
            }
            tile.texture = this._texture(top);
            tile.groundTexture = picture !== null && ground !== null ? this._texture(ground) : undefined;
            tile.state = 'loaded';
        } catch (err) {
            delete tile.abortController;
            if (tile.aborted || isAbortError(err)) {
                tile.state = 'unloaded';
            } else {
                tile.state = 'errored';
                throw err;
            }
        }
    }

    async unloadTile(tile: Tile): Promise<void> {
        if (tile.texture) this.map.painter.saveTileTexture(tile.texture);
        if (tile.groundTexture) {
            this.map.painter.saveTileTexture(tile.groundTexture);
            tile.groundTexture = undefined;
        }
    }
}
