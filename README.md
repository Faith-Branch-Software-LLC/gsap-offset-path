# gsap-offset-path

[![npm version](https://img.shields.io/npm/v/gsap-offset-path)](https://www.npmjs.com/package/gsap-offset-path)
[![npm downloads](https://img.shields.io/npm/dm/gsap-offset-path)](https://www.npmjs.com/package/gsap-offset-path)
[![bundle size](https://img.shields.io/bundlephobia/minzip/gsap-offset-path)](https://bundlephobia.com/package/gsap-offset-path)
[![license](https://img.shields.io/npm/l/gsap-offset-path)](https://github.com/Faith-Branch-Software-LLC/gsap-offset-path/blob/main/LICENSE)
[![github](https://img.shields.io/badge/github-source-black?logo=github)](https://github.com/Faith-Branch-Software-LLC/gsap-offset-path)

A GSAP plugin for animating SVG path offsets. Expand or shrink SVG `<path>` elements smoothly over time, powered by [Clipper2](https://github.com/AngusJohnson/Clipper2) via WebAssembly for precise, production-quality polygon offsetting.

> **Early stage.** This plugin is in active development. The API may change between minor versions. Feedback and issues are welcome.

## Install

```bash
npm install gsap-offset-path
```

## Setup

```ts
import gsap from "gsap";
import { OffsetPathPlugin, initOffsetPath } from "gsap-offset-path";

gsap.registerPlugin(OffsetPathPlugin);

// Initialize the bundled WASM module before animating.
await initOffsetPath();
```

`initOffsetPath` takes no arguments. The WASM binary is embedded in the package and loaded at runtime without any network requests or file system access.

## Usage

```ts
gsap.to(svgPathElement, {
  offsetPath: { offset: -20, originX: 0.5, originY: 1.0 },
  duration: 2,
});
```

Pass a plain number as shorthand when you only need to set the offset amount:

```ts
gsap.to(path, { offsetPath: -20, duration: 1 });
```

### React example

```tsx
import { useRef, useEffect, useState } from "react";
import gsap from "gsap";
import { OffsetPathPlugin, initOffsetPath } from "gsap-offset-path";

gsap.registerPlugin(OffsetPathPlugin);

function AnimatedPath() {
  const pathRef = useRef<SVGPathElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initOffsetPath().then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready || !pathRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        pathRef.current,
        { offsetPath: { offset: -30, originX: 0.5, originY: 1.0 } },
        { offsetPath: { offset: 0,   originX: 0.5, originY: 1.0 }, duration: 2 }
      );
    });

    return () => ctx.revert();
  }, [ready]);

  return (
    <svg viewBox="0 0 200 200">
      <path
        ref={pathRef}
        d="M 50 50 L 150 50 L 150 150 L 50 150 Z"
        fill="currentColor"
      />
    </svg>
  );
}
```

## API

### `initOffsetPath()`

Loads and initializes the bundled WASM module. Must be called and awaited before any animations will render. Safe to call multiple times; subsequent calls are no-ops.

### `isReady()`

Returns `true` if the WASM module has been initialized and is ready to use.

### `offsetPath` tween property

Use as a GSAP tween property on any `SVGPathElement` target.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `offset` | `number` | | Offset in SVG units. Positive expands outward, negative shrinks inward. |
| `joinType` | `JoinType` | `Round` | How corners are joined at convex vertices. |
| `endType` | `EndType` | `Polygon` | How open path ends are capped. |
| `miterLimit` | `number` | `2.0` | Maximum miter distance before a corner falls back to bevel. |
| `arcTolerance` | `number` | `0.25` | Curve approximation tolerance for round joins and caps. |
| `originX` | `number` | | Anchor X (0.0 = left, 1.0 = right). Keeps this point fixed during offset. |
| `originY` | `number` | | Anchor Y (0.0 = top, 1.0 = bottom). Keeps this point fixed during offset. |

### `JoinType` enum

Controls how adjacent offset edges are connected at convex corners.

| Value | Description |
|-------|-------------|
| `JoinType.Round` | Arc between the two edge normals (default) |
| `JoinType.Miter` | Edges extended to a sharp point, capped by `miterLimit` |
| `JoinType.Bevel` | Straight cut between the two edge endpoints |
| `JoinType.Square` | Square cap projected from the corner |

### `EndType` enum

Controls how open path ends are treated.

| Value | Description |
|-------|-------------|
| `EndType.Polygon` | Treat path as a closed polygon (default) |
| `EndType.Joined` | Close the path then offset as a filled shape |
| `EndType.Butt` | Flat end, no cap |
| `EndType.Square` | Square cap at each end |
| `EndType.Round` | Round cap at each end |

## How it works

On each animation frame GSAP interpolates the offset value and the plugin calls Clipper2 (via WebAssembly) to compute the new path. The pipeline:

1. Parses the original SVG path `d` attribute using [Lyon](https://github.com/nical/lyon) (handles `M`, `L`, `H`, `V`, `C`, `Q`, `Z` and their relative variants)
2. Flattens Bezier curves to line segments
3. Scales to integer coordinates and normalizes winding order
4. Runs Clipper2's `ClipperOffset` algorithm with the configured join and end types
5. Cleans up self-intersections via polygon union
6. Translates the result to keep the anchor point (`originX`/`originY`) fixed
7. Writes the new path data back to the element

The WASM module is compiled from Rust using [clipper2-rust](https://github.com/larsbrubaker/clipper2-rust), a port of Angus Johnson's [Clipper2](https://github.com/AngusJohnson/Clipper2) library.

## Building the WASM module

If you need to modify the Rust source and rebuild the WASM:

**Prerequisites:** [Rust](https://rustup.rs/) and [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

```bash
npm run build:wasm   # compiles Rust, copies WASM files, and generates the bundled data
npm run build        # builds the TypeScript plugin
```

## License

MIT
