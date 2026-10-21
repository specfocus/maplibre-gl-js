import {describe, expect, test} from 'vitest';
import {resolveTilePyramids} from './tile_pyramids_source.ts';
import {encodeCoverageTree, parseTileCoverage, type TileCoverage} from './tile_coverage.ts';

const MIRAGE = 'https://maps.umbiliko.com/tiles/cri/mirage/{z}/{x}/{y}.webp?v=1';

/** A country at z4: one tile, 4/4/7, and all of it below to z6; opaque except 6/16/28 (a coast). */
const inCountry = (z: number, x: number, y: number): boolean => z >= 4 && Math.floor(x / 2 ** (z - 4)) === 4 && Math.floor(y / 2 ** (z - 4)) === 7;
const opaque = (z: number, x: number, y: number): boolean => inCountry(z, x, y) && `${z}/${x}/${y}` !== '6/16/28' && !(z < 6 && Math.floor(16 / 2 ** (6 - z)) === x && Math.floor(28 / 2 ** (6 - z)) === y);
const coverage = (): TileCoverage => parseTileCoverage({
    minZoom: 4, maxZoom: 6,
    roots: {'4/4/7': encodeCoverageTree({z: 4, x: 4, y: 7}, 6, inCountry, inCountry)},
    opaque: {'4/4/7': encodeCoverageTree({z: 4, x: 4, y: 7}, 6, opaque, (z, x, y) => {
        for (let dz = 0; z + dz <= 6; dz++) {
            const n = 2 ** dz;
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (opaque(z + dz, x * n + i, y * n + j)) return true;
        }
        return false;
    })},
});

describe('tile-pyramids resolution (Lucas, 2026-10-20)', () => {
    const mirage = {tiles: [MIRAGE], minzoom: 4, maxzoom: 6, overzoom: true, tileCoverage: coverage()};

    test('an opaque covered tile is the picture alone: the ground is never asked for', () => {
        expect(resolveTilePyramids([mirage], true, {z: 5, x: 9, y: 14})).toEqual({kind: 'picture', url: 'https://maps.umbiliko.com/tiles/cri/mirage/5/9/14.webp?v=1', ground: false});
    });

    test('a covered tile with transparent parts is the picture over its ground, in one tile', () => {
        expect(resolveTilePyramids([mirage], true, {z: 6, x: 16, y: 28})).toMatchObject({kind: 'picture', ground: true});
    });

    test('deeper than the pyramid, over a tile it has, is drawn by the loaded ancestor: no request', () => {
        expect(resolveTilePyramids([mirage], true, {z: 7, x: 34, y: 58})).toEqual({kind: 'parent'});
        expect(resolveTilePyramids([{...mirage, overzoom: false}], true, {z: 7, x: 34, y: 58})).toEqual({kind: 'ground'});
    });

    test('where no pyramid covers the tile, the ground answers; without a ground, nothing is drawn', () => {
        expect(resolveTilePyramids([mirage], true, {z: 5, x: 0, y: 0})).toEqual({kind: 'ground'});
        expect(resolveTilePyramids([mirage], true, {z: 7, x: 0, y: 0})).toEqual({kind: 'ground'});
        expect(resolveTilePyramids([mirage], true, {z: 3, x: 2, y: 3})).toEqual({kind: 'ground'});
        expect(resolveTilePyramids([mirage], false, {z: 5, x: 0, y: 0})).toEqual({kind: 'empty'});
    });

    test('a pyramid without coverage is asked for every tile, with its ground', () => {
        const unknown = {tiles: [MIRAGE], minzoom: 4, maxzoom: 6, overzoom: true};
        expect(resolveTilePyramids([unknown], true, {z: 5, x: 0, y: 0})).toMatchObject({kind: 'picture', ground: true});
        expect(resolveTilePyramids([unknown], false, {z: 5, x: 0, y: 0})).toMatchObject({kind: 'picture', ground: false});
    });

    test('a scope limits a pyramid to its node, and the first pyramid that covers wins', () => {
        const campaign = {tiles: ['https://c/{z}/{x}/{y}.webp'], scope: '5/9/14', scopeTile: {z: 5, x: 9, y: 14}};
        expect(resolveTilePyramids([campaign, mirage], true, {z: 6, x: 18, y: 29})).toMatchObject({kind: 'picture', url: 'https://c/6/18/29.webp'});
        expect(resolveTilePyramids([campaign, mirage], true, {z: 6, x: 16, y: 29})).toMatchObject({kind: 'picture', url: 'https://maps.umbiliko.com/tiles/cri/mirage/6/16/29.webp?v=1'});
    });
});
