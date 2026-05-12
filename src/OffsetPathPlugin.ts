import { gsap } from 'gsap';
import type { OffsetPathOptions, ClipperOffsetWasm } from './types';
import { wasmBase64, glueText } from './generated/wasm-data';

let wasmModule: ClipperOffsetWasm | null = null;
let wasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Initialize the WASM module for the OffsetPathPlugin.
 * Must be called (and awaited) before any offsetPath animations will render.
 * The WASM binary is bundled in the package — no file copying or URL config needed.
 */
export async function initOffsetPath(): Promise<void> {
  if (wasmInitialized) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      const glueBlob = new Blob([glueText], { type: 'text/javascript' });
      const glueBlobUrl = URL.createObjectURL(glueBlob);

      // new Function hides the import from webpack/turbopack static analysis.
      // The blob URL is always a runtime value, never a bundleable path.
      const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<ClipperOffsetWasm>;
      let module: ClipperOffsetWasm;
      try {
        module = await dynamicImport(glueBlobUrl);
      } finally {
        URL.revokeObjectURL(glueBlobUrl);
      }

      const wasmBytes = Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0));
      await module.default({ module_or_path: wasmBytes });

      wasmModule = module;
      wasmInitialized = true;
    } catch (error) {
      wasmInitPromise = null;
      throw error;
    }
  })();

  return wasmInitPromise;
}

/**
 * Returns true if the WASM module has been initialized and is ready.
 */
export function isReady(): boolean {
  return wasmInitialized;
}

/**
 * GSAP OffsetPath Plugin
 *
 * Animates SVG path offsetting using Clipper2 WASM. Supports expanding
 * (positive offset) and shrinking (negative offset) SVG paths with
 * configurable join types, anchor points, and smooth interpolation.
 *
 * Usage:
 * ```ts
 * gsap.registerPlugin(OffsetPathPlugin);
 * await initOffsetPath();
 *
 * gsap.to(svgPathElement, {
 *   offsetPath: { offset: -20, originX: 0.5, originY: 1 },
 *   duration: 1
 * });
 * ```
 */
export const OffsetPathPlugin: gsap.Plugin = {
  name: 'offsetPath',
  version: '1.0.0',

  init(target: any, value: OffsetPathOptions | number) {
    if (!(target instanceof SVGPathElement)) {
      console.warn('[OffsetPathPlugin] Target must be SVGPathElement, got:', target);
      return false;
    }

    const originalPath = target.getAttribute('d');
    if (!originalPath) {
      console.warn("[OffsetPathPlugin] Path element has no 'd' attribute");
      return false;
    }

    const options: OffsetPathOptions =
      typeof value === 'number' ? { offset: value } : { ...value };

    const data = this as any;
    data._target = target;
    data._originalPath = originalPath;
    data._options = {
      joinType: options.joinType ?? 2,
      endType: options.endType ?? 0,
      miterLimit: options.miterLimit ?? 2.0,
      arcTolerance: options.arcTolerance ?? 0.25,
      originX: options.originX ?? null,
      originY: options.originY ?? null,
    };

    data._startOffset = (target as any).__gsapOffsetPath ?? 0;
    data._endOffset = options.offset;

    return true;
  },

  render(progress: number, data: any) {
    const offsetAmount =
      data._startOffset + (data._endOffset - data._startOffset) * progress;

    (data._target as any).__gsapOffsetPath = offsetAmount;

    if (!wasmInitialized || !wasmModule) {
      if (!wasmInitPromise) {
        console.error(
          '[gsap-offset-path] WASM not initialized. Call `await initOffsetPath()` before animating.',
        );
      }
      return;
    }

    try {
      if (Math.abs(offsetAmount) < 0.001) {
        data._target.style.visibility = 'visible';
        data._target.setAttribute('d', data._originalPath);
        return;
      }

      const result = wasmModule.offset_svg_path(
        data._originalPath,
        offsetAmount,
        data._options.joinType,
        data._options.endType,
        data._options.miterLimit,
        data._options.arcTolerance,
        data._options.originX,
        data._options.originY,
      );

      if (!result || result.trim() === '') {
        data._target.style.visibility = 'hidden';
        return;
      }

      data._target.style.visibility = 'visible';
      data._target.setAttribute('d', result);
    } catch (error) {
      console.error('[OffsetPathPlugin] Error during render:', error);
      data._target.style.visibility = 'hidden';
    }
  },

  kill() {
    const data = this as any;
    if (data._target && data._originalPath) {
      data._target.setAttribute('d', data._originalPath);
    }
  },
};
