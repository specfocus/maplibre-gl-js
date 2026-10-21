/**
 * specfocus: which tiles of a baked pyramid EXIST, and which of them are OPAQUE, so the map never
 * asks for a tile the pyramid lacks and never asks for the ground under a tile that hides it.
 *
 * Moved here from `@specfocus/maps` (tile-sources/tile-coverage.ts) on 2026-10-20: the
 * `tile-pyramids` source resolves every tile from it inside MapLibre, and the bakes write it.
 *
 * `coverage.json` sits at the root of the pyramid, beside `{z}/`:
 *
 *   { "minZoom": 4, "maxZoom": 15,
 *     "roots":  { "4/4/7": "<preorder>" },     the tiles that exist
 *     "opaque": { "4/4/7": "<preorder>" } }    optional: the tiles with no transparent pixel
 *
 * Each root is a quadtree written in preorder, ONE base64url character per node:
 *   bit 0  the tile exists (in `opaque`: the tile is opaque)
 *   bit 1  FULL: the tile and every descendant down to `maxZoom` do (no children follow)
 *   bits 2-5  which children follow, in the order (2x,2y) (2x+1,2y) (2x,2y+1) (2x+1,2y+1)
 * A compact footprint compresses to its edges: terra's 583,845 tiles are about 5,200 nodes.
 */

export type TileAddress = {z: number; x: number; y: number};

export type TileCoverageDocument = {
    minZoom: number;
    maxZoom: number;
    roots: Readonly<Record<string, string>>;
    opaque?: Readonly<Record<string, string>>;
};

type CoverageNode = {exists: boolean; full: boolean; children: (CoverageNode | null)[]};

type CoverageRoots = ReadonlyMap<string, CoverageNode>;

export type TileCoverage = {
    maxZoom: number;
    rootZoom: number;
    roots: CoverageRoots;
    /** Absent when the document does not say: then opacity is unknown, never assumed. */
    opaque?: CoverageRoots;
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const EXISTS = 1;
const FULL = 2;
const CHILD_OFFSETS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1], [1, 1]];

/**
 * Write one root's quadtree. `holds(z, x, y)` answers for one tile (exists, or is opaque);
 * `hasAnyBelow(z, x, y)` is true when the tile or any descendant holds.
 */
export function encodeCoverageTree(
    root: TileAddress,
    maxZoom: number,
    holds: (z: number, x: number, y: number) => boolean,
    hasAnyBelow: (z: number, x: number, y: number) => boolean
): string {
    const fullMemo = new Map<string, boolean>();
    const isFull = (z: number, x: number, y: number): boolean => {
        const key = `${z}/${x}/${y}`;
        const known = fullMemo.get(key);
        if (known !== undefined) return known;
        const full = holds(z, x, y) && (z >= maxZoom || CHILD_OFFSETS.every(([dx, dy]) => isFull(z + 1, 2 * x + dx, 2 * y + dy)));
        fullMemo.set(key, full);
        return full;
    };
    const out: string[] = [];
    const walk = (z: number, x: number, y: number): void => {
        if (isFull(z, x, y)) {
            out.push(ALPHABET[EXISTS | FULL]);
            return;
        }
        let mask = 0;
        if (z < maxZoom) {
            CHILD_OFFSETS.forEach(([dx, dy], i) => {
                if (hasAnyBelow(z + 1, 2 * x + dx, 2 * y + dy)) mask |= 1 << i;
            });
        }
        out.push(ALPHABET[(holds(z, x, y) ? EXISTS : 0) | (mask << 2)]);
        CHILD_OFFSETS.forEach(([dx, dy], i) => {
            if (mask & (1 << i)) walk(z + 1, 2 * x + dx, 2 * y + dy);
        });
    };
    walk(root.z, root.x, root.y);
    return out.join('');
}

function decodeTree(text: string): CoverageNode | undefined {
    let at = 0;
    const read = (): CoverageNode | undefined => {
        const value = ALPHABET.indexOf(text[at++] ?? '');
        if (value < 0) return undefined;
        const node: CoverageNode = {exists: (value & EXISTS) !== 0, full: (value & FULL) !== 0, children: [null, null, null, null]};
        if (node.full) return node;
        for (let i = 0; i < 4; i++) {
            if (value & (1 << (i + 2))) {
                const child = read();
                if (child === undefined) return undefined;
                node.children[i] = child;
            }
        }
        return node;
    };
    const tree = read();
    return tree !== undefined && at === text.length ? tree : undefined;
}

const ROOT_KEY = /^(\d{1,2})\/(\d+)\/(\d+)$/;

/** The roots of one tree, all at one zoom; undefined when anything is malformed. */
function parseRoots(value: unknown, rootZoom: number | undefined): {roots: Map<string, CoverageNode>; rootZoom: number} | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const roots = new Map<string, CoverageNode>();
    let zoom = rootZoom;
    for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
        const match = ROOT_KEY.exec(key);
        if (!match || typeof text !== 'string') return undefined;
        const z = Number(match[1]);
        if (zoom !== undefined && z !== zoom) return undefined;
        zoom = z;
        const node = decodeTree(text);
        if (node === undefined) return undefined;
        roots.set(key, node);
    }
    return zoom === undefined ? undefined : {roots, rootZoom: zoom};
}

/** A malformed document is no coverage at all: the source then asks for every tile. */
export function parseTileCoverage(value: unknown): TileCoverage | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const doc = value as Partial<TileCoverageDocument>;
    if (typeof doc.maxZoom !== 'number') return undefined;
    const exists = parseRoots(doc.roots, undefined);
    if (exists === undefined) return undefined;
    const coverage: TileCoverage = {maxZoom: doc.maxZoom, rootZoom: exists.rootZoom, roots: exists.roots};
    if (doc.opaque !== undefined) {
        const opaque = parseRoots(doc.opaque, exists.rootZoom);
        if (opaque === undefined) return undefined;
        coverage.opaque = opaque.roots;
    }
    return coverage;
}

function lookup(roots: CoverageRoots, rootZoom: number, maxZoom: number, tile: TileAddress): boolean {
    if (tile.z < rootZoom || tile.z > maxZoom) return false;
    const depth = tile.z - rootZoom;
    // specfocus: no 32-bit shift, a tile x passes 2^31 from z31 (the fork reaches z40)
    const scale = 2 ** depth;
    let node = roots.get(`${rootZoom}/${Math.floor(tile.x / scale)}/${Math.floor(tile.y / scale)}`);
    if (node === undefined) return false;
    for (let d = depth - 1; d >= 0; d--) {
        if (node.full) return true;
        const step = 2 ** d;
        const child = node.children[(Math.floor(tile.x / step) % 2) + 2 * (Math.floor(tile.y / step) % 2)];
        if (!child) return false;
        node = child;
    }
    return node.exists;
}

/** True when the pyramid has this tile. */
export function coverageHas(coverage: TileCoverage, tile: TileAddress): boolean {
    return lookup(coverage.roots, coverage.rootZoom, coverage.maxZoom, tile);
}

/** True or false when the document says whether the tile is opaque; undefined when it does not say. */
export function coverageOpaque(coverage: TileCoverage, tile: TileAddress): boolean | undefined {
    return coverage.opaque === undefined ? undefined : lookup(coverage.opaque, coverage.rootZoom, coverage.maxZoom, tile);
}
