import {describe, expect, test} from 'vitest';
import {coverageHas, coverageOpaque, encodeCoverageTree, parseTileCoverage} from './tile_coverage.ts';

/** A small pyramid: one root at z2, a ragged edge at z3, a full block from z3 down to z5, and an orphan. */
const tiles = new Set<string>();
const add = (z: number, x: number, y: number): void => {
    tiles.add(`${z}/${x}/${y}`);
};
add(2, 1, 1);
add(3, 2, 2);
add(3, 3, 3);
for (let z = 3; z <= 5; z++) {
    const n = 2 ** (z - 3);
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) add(z, 2 * n + x, 3 * n + y); // under 3/2/3, full
}
add(5, 13, 13); // under 3/3/3, parent 4/6/6 missing
const exists = (z: number, x: number, y: number): boolean => tiles.has(`${z}/${x}/${y}`);
const below = (set: (z: number, x: number, y: number) => boolean) => (z: number, x: number, y: number): boolean => {
    for (const key of tiles) {
        const [tz, tx, ty] = key.split('/').map(Number);
        if (tz < z) continue;
        const scale = 2 ** (tz - z);
        if (Math.floor(tx / scale) === x && Math.floor(ty / scale) === y && set(tz, tx, ty)) return true;
    }
    return false;
};
/** Opaque: everything under 3/2/3 except one z5 tile on a coast. */
const opaque = (z: number, x: number, y: number): boolean => exists(z, x, y) && Math.floor(x / 2 ** (z - 3)) === 2 && Math.floor(y / 2 ** (z - 3)) === 3 && `${z}/${x}/${y}` !== '5/8/12';

describe('tile coverage', () => {
    const text = encodeCoverageTree({z: 2, x: 1, y: 1}, 5, exists, below(exists));
    const coverage = parseTileCoverage({minZoom: 2, maxZoom: 5, roots: {'2/1/1': text}});

    test('answers exactly the tiles that exist, at every zoom of the pyramid', () => {
        expect(coverage).toBeDefined();
        for (let z = 2; z <= 5; z++) {
            const n = 2 ** z;
            for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
                expect(coverageHas(coverage, {z, x, y})).toBe(exists(z, x, y));
            }
        }
    });

    test('collapses a full block to one node', () => {
        // root, 3/2/2, 3/2/3 (full), 3/3/3, 4/6/6 (missing, on the way), 5/13/13
        expect(text).toHaveLength(6);
    });

    test('is nothing outside its zooms or roots, and refuses a malformed document', () => {
        expect(coverageHas(coverage, {z: 6, x: 32, y: 48})).toBe(false);
        expect(coverageHas(coverage, {z: 1, x: 0, y: 0})).toBe(false);
        expect(coverageHas(coverage, {z: 3, x: 0, y: 0})).toBe(false);
        expect(parseTileCoverage({maxZoom: 5, roots: {'2/1/1': `${text}A`}})).toBeUndefined();
        expect(parseTileCoverage({maxZoom: 5, roots: {'2/1/1': '!'}})).toBeUndefined();
        expect(parseTileCoverage(null)).toBeUndefined();
    });

    test('says nothing about opacity when the document does not', () => {
        expect(coverageOpaque(coverage, {z: 3, x: 2, y: 3})).toBeUndefined();
    });

    test('answers opacity per tile from the opaque tree', () => {
        const withOpaque = parseTileCoverage({minZoom: 2, maxZoom: 5, roots: {'2/1/1': text}, opaque: {'2/1/1': encodeCoverageTree({z: 2, x: 1, y: 1}, 5, opaque, below(opaque))}});
        expect(withOpaque).toBeDefined();
        for (const key of tiles) {
            const [z, x, y] = key.split('/').map(Number);
            expect(coverageOpaque(withOpaque, {z, x, y})).toBe(opaque(z, x, y));
        }
        expect(coverageOpaque(withOpaque, {z: 5, x: 8, y: 12})).toBe(false);
        expect(parseTileCoverage({minZoom: 2, maxZoom: 5, roots: {'2/1/1': text}, opaque: {'3/2/3': 'D'}})).toBeUndefined();
    });
});
