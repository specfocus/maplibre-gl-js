import {type AddProtocolAction, config} from './config.ts';
import type {default as MaplibreWorker} from '../source/worker.ts';
import type {WorkerSourceConstructor} from '../source/worker_source.ts';
import type {GetResourceResponse, RequestParameters} from './ajax.ts';

export interface WorkerGlobalScopeInterface {
    registerWorkerSource: (sourceName: string, sourceConstructor: WorkerSourceConstructor) => void;
    registerRTLTextPlugin: (_: any) => void;
    addProtocol: (customProtocol: string, loadFn: AddProtocolAction) => void;
    removeProtocol: (customProtocol: string) => void;
    makeRequest: (request: RequestParameters, abortController: AbortController) => Promise<GetResourceResponse<any>>;
    worker: MaplibreWorker;
}

function isCrossOrigin(url: string): boolean {
    if (!url) return false;
    const loc = (globalThis as any).location;
    if (!loc) return false;
    try {
        return new URL(url, loc.href).origin !== loc.origin;
    } catch {
        return false;
    }
}

function defaultWorkerUrl(): string {
    const moduleUrl = import.meta.url;
    if (!/^https?:/.test(moduleUrl)) return '';
    const workerName = moduleUrl.endsWith('-dev.mjs')
        ? 'maplibre-gl-worker-dev.mjs'
        : 'maplibre-gl-worker.mjs';
    return new URL(`./${workerName}`, moduleUrl).href;
}

function createWorker(url: string, asModule: boolean): Worker {
    if (asModule) {
        try {
            return new Worker(url, {type: 'module'});
        } catch (e) {
            console.warn('Module worker not supported, falling back to classic worker', e);
        }
    }
    return new Worker(url);
}

async function fetchAsBlobUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch worker script (${response.status}): ${url}`);
    }
    const code = await response.text();
    const blob = new Blob([code], {type: 'text/javascript'});
    return URL.createObjectURL(blob);
}

function importAsBlobUrl(url: string): string {
    // specfocus: `String(...)` around the base on purpose. A bundler that reads this file as
    // SOURCE (Turbopack, when the fork is a workspace member and not a node_modules package)
    // takes the exact shape `new URL(x, import.meta.url)` for an asset reference and fails the
    // build with "Can't resolve <dynamic>", because `x` is only known at run time.
    const blob = new Blob([`import ${JSON.stringify(new URL(url, String(import.meta.url)).href)}`], {type: 'text/javascript'});
    return URL.createObjectURL(blob);
}

/**
 * specfocus: the worker's own source, embedded at build time (rolldown's
 * `virtual:maplibre-gl-worker-source`, see rolldown.config.ts). Empty when the code
 * runs unbundled (tests, `src/` consumers), in which case the URL path below applies.
 */
async function inlineWorkerSource(): Promise<string> {
    try {
        const mod = await import('virtual:maplibre-gl-worker-source');
        return typeof mod.workerSource === 'string' ? mod.workerSource : '';
    } catch {
        return '';
    }
}

/**
 * A worker spawned from the embedded source: no URL to guess, no sibling file a bundler
 * can rename or move, no cross-origin fetch. The source is a self-contained ES module,
 * so the worker is a module worker; a Blob URL is same-origin by definition.
 */
function createInlineWorker(source: string): Worker {
    const blobUrl = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    try {
        return new Worker(blobUrl, {type: 'module'});
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

export async function workerFactory(): Promise<Worker> {
    if (!config.WORKER_URL) {
        const source = await inlineWorkerSource();
        if (source) return createInlineWorker(source);
    }
    const url = config.WORKER_URL || defaultWorkerUrl();
    const asModule = url?.endsWith('.cjs') ? false : true;

    if (!isCrossOrigin(url)) {
        return createWorker(url, asModule);
    }

    if (asModule) {
        const blobUrl = importAsBlobUrl(url);
        try {
            return createWorker(blobUrl, asModule);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }

    const blobUrl = await fetchAsBlobUrl(url);
    try {
        return createWorker(blobUrl, asModule);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}
