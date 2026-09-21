import {describe, expect, test} from 'vitest';
import {LAYER_TRANSLATE_METADATA_KEY, layerTranslateMetres, sourceTranslateMetres} from './layer_translate.ts';
import type {StyleLayer} from './style_layer.ts';

const layer = (source: string, metadata?: unknown): StyleLayer => ({source, metadata} as unknown as StyleLayer);

describe('layerTranslateMetres', () => {
    test('reads [east, north] metres from the layer metadata', () => {
        expect(layerTranslateMetres(layer('streets', {[LAYER_TRANSLATE_METADATA_KEY]: [-5.5, -4.2]}))).toEqual([-5.5, -4.2]);
    });

    test('is null without metadata, for a zero move and for anything malformed', () => {
        expect(layerTranslateMetres(layer('streets'))).toBeNull();
        expect(layerTranslateMetres(layer('streets', {[LAYER_TRANSLATE_METADATA_KEY]: [0, 0]}))).toBeNull();
        expect(layerTranslateMetres(layer('streets', {[LAYER_TRANSLATE_METADATA_KEY]: [1]}))).toBeNull();
        expect(layerTranslateMetres(layer('streets', {[LAYER_TRANSLATE_METADATA_KEY]: ['1', 2]}))).toBeNull();
        expect(layerTranslateMetres(layer('streets', {[LAYER_TRANSLATE_METADATA_KEY]: [Infinity, 2]}))).toBeNull();
    });
});

describe('sourceTranslateMetres', () => {
    test('is the translate of the first layer of that source that declares one', () => {
        const layers = [
            layer('satellite'),
            layer('streets'),
            layer('streets', {[LAYER_TRANSLATE_METADATA_KEY]: [-5.5, -4.2]}),
        ];
        expect(sourceTranslateMetres(layers, 'streets')).toEqual([-5.5, -4.2]);
        expect(sourceTranslateMetres(layers, 'satellite')).toBeNull();
    });
});
