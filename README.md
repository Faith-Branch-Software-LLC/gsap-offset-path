# gsap-offset-path

A GSAP plugin for animating SVG path offsets using Clipper2 WASM. Expand or shrink SVG `<path>` elements smoothly over time.

> **Early stage** -- This plugin is in active development. The API may change between minor versions. Feedback and issues are welcome, though I know there are many issues at this time.
> I will continue to make changes to make this easier to use as time goes on and have a plan for a web demo in the works.

## Install

```bash
npm install gsap-offset-path
```

The package includes pre-built WASM files in `wasm/pkg/`. You need to serve these from your web server (see [Setup](#setup)).

## Setup

### 1. Copy the WASM files to your public directory

The plugin depends on a WASM binary at runtime. Copy the files from the package into a directory your server can serve:

```bash
mkdir -p public/wasm
cp node_modules/gsap-offset-path/wasm/pkg/* public/wasm/
```

Or add a script to your `package.json`:

```json
{
  "scripts": {
    "wasm:copy": "mkdir -p public/wasm && cp node_modules/gsap-offset-path/wasm/pkg/* public/wasm/"
  }
}
```

### 2. Register the plugin and initialize WASM

```ts
import gsap from "gsap";
import { OffsetPathPlugin, initOffsetPath } from "gsap-offset-path";

gsap.registerPlugin(OffsetPathPlugin);

await initOffsetPath({
  glueUrl: "/wasm/clipper_offset.js",
  wasmUrl: "/wasm/clipper_offset_bg.wasm",
});
```

`initOffsetPath` loads the WASM binary asynchronously. Animations that use `offsetPath` won't render until this completes, so you should wait for it before building your timeline.

### 3. Animate

```ts
gsap.to(svgPathElement, {
  offsetPath: { offset: -20, originX: 0.5, originY: 1.0 },
  duration: 2,
});
```

## Waiting for WASM (React example)

Because the WASM module loads asynchronously, you need to wait for it before running animations. Here's a React pattern using state to gate the animation:

```tsx
import { useRef, useEffect, useState } from "react";
import gsap from "gsap";
import { OffsetPathPlugin, initOffsetPath } from "gsap-offset-path";

gsap.registerPlugin(OffsetPathPlugin);

function AnimatedPath() {
  const pathRef = useRef<SVGPathElement>(null);
  const [wasmReady, setWasmReady] = useState(false);

  // Initialize WASM once on mount
  useEffect(() => {
    initOffsetPath({
      glueUrl: "/wasm/clipper_offset.js",
      wasmUrl: "/wasm/clipper_offset_bg.wasm",
    })
      .then(() => setWasmReady(true))
      .catch((err) => console.error("WASM failed to load:", err));
  }, []);

  // Run animation only after WASM is ready
  useEffect(() => {
    if (!pathRef.current || !wasmReady) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(pathRef.current,
        { offsetPath: { offset: -30, originX: 0.5, originY: 1.0 } },
        { offsetPath: { offset: 0, originX: 0.5, originY: 1.0 }, duration: 2 }
      );
    });

    return () => ctx.revert();
  }, [wasmReady]);

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

### `initOffsetPath(options)`

Initialize the WASM module. Must be called before animations will render.

| Option | Type | Description |
|--------|------|-------------|
| `glueUrl` | `string` | URL to the WASM glue JS file (`clipper_offset.js`) |
| `wasmUrl` | `string` | URL to the `.wasm` binary (`clipper_offset_bg.wasm`) |

Returns a `Promise<void>` that resolves when WASM is ready. Safe to call multiple times -- subsequent calls return the same promise.

### `isReady()`

Returns `true` if WASM has been initialized.

### `offsetPath` tween property

Use as a GSAP tween property on `SVGPathElement` targets.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `offset` | `number` | -- | Offset in SVG units. Positive = expand, negative = shrink. |
| `joinType` | `JoinType` | `Round` | How corners are joined (`Square`, `Bevel`, `Round`, `Miter`). |
| `endType` | `EndType` | `Polygon` | How open paths are capped (`Polygon`, `Joined`, `Butt`, `Square`, `Round`). |
| `miterLimit` | `number` | `2.0` | Max distance for miter joins before they're beveled. |
| `arcTolerance` | `number` | `0.25` | Curve approximation tolerance for round joins. |
| `originX` | `number` | -- | Anchor X (0.0 = left, 1.0 = right). Keeps this point fixed during offset. |
| `originY` | `number` | -- | Anchor Y (0.0 = top, 1.0 = bottom). Keeps this point fixed during offset. |

Shorthand -- pass a number directly to set just the offset:

```ts
gsap.to(path, { offsetPath: -20, duration: 1 });
```

## How it works

The plugin uses [Clipper2](https://github.com/AngusJohnson/Clipper2) (compiled to WASM via Rust) to compute polygon offsets. On each animation frame, GSAP interpolates the offset value and the plugin:

1. Reads the original SVG path `d` attribute
2. Parses and flattens curves to line segments (using [lyon](https://github.com/nickel-matt/lyon))
3. Runs Clipper2's offset algorithm at the interpolated distance
4. Translates the result to keep the anchor point fixed
5. Writes the new path data back to the element

## License

MIT
