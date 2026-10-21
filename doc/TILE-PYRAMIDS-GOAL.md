# tile-pyramids: per-tile source resolution inside the fork

Lucas, 2026-10-20: the fork is private, so what the picture map needs is built into MapLibre
itself, optimised for us, instead of bent through extension points (`addProtocol`).

## What it is

A built-in source type, `tile-pyramids` (`src/source/tile_pyramids_source.ts`), registered in
`src/source/source.ts`. It is a raster source in every other respect (`type` is `raster` once
created), so fading, retained parents, overzoom and the raster draw apply unchanged.

```jsonc
{ "type": "tile-pyramids", "tileSize": 256, "maxzoom": 16,
  "pyramids": [ { "tiles": [".../cri/mirage/{z}/{x}/{y}.webp?v=…"], "minzoom": 4, "maxzoom": 15,
                  "overzoom": true, "coverage": ".../cri/mirage/coverage.json?v=…", "scope": "z/x/y" } ],
  "ground": [ "https://world.umbiliko.com/{z}/{x}/{y}.jpg" ] }
```

- `load()` reads every pyramid's `coverage.json` before announcing the source (the TileJSON
  pattern), so no tile is requested before the source knows who covers it.
- Per tile (`resolveTilePyramids`, pure, no network), the first pyramid that covers it wins:
  - covered and opaque (coverage `opaque` tree): the picture alone; the ground is never asked for;
  - covered with transparent parts, or opacity unknown: picture and ground loaded in parallel and
    kept in one tile (`Tile.groundTexture`), drawn ground first then picture with LEQUAL in the same
    sublayer (`src/webgl/draw/draw_raster.ts`);
  - deeper than an overzooming pyramid whose last-level ancestor exists: errored 404 with no
    request, so the loaded ancestor is drawn stretched;
  - nothing covers it: the ground chain in order; without a ground (an overlay), a transparent tile.
- Images are fetched through `fetch` (`ImageRequest`, refresh on), never an `<img>`, so a missing
  tile (404) is told apart from a broken one and stays silent.

## coverage.json

`src/source/tile_coverage.ts` (moved here from `@specfocus/maps`): a preorder quadtree per root,
one base64url character per node (exists, FULL, child mask), plus an optional `opaque` tree with
the same roots and encoding. Written by `@specfocus/visualize`'s bakes
(`src/divisions/pyramid-coverage.ts`) and by `@specfocus/maps/scripts/write-tile-coverage.ts`.

## Verification

`src/source/tile_pyramids_source.test.ts` (resolution: opaque, partial, deeper than the pyramid,
no pyramid, no coverage, scope order) and `src/source/tile_coverage.test.ts` (codec, opacity).
On casa-club localhost: no `umbiliko:` requests; at map zoom 14.7 over La Sabana the z16 ground
tiles resolve to their z15 mirage ancestor instead of the satellite.
