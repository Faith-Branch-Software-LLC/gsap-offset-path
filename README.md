# gsap-offset-path

A GSAP plugin for animating SVG path offsets. Expand or shrink SVG `<path>` elements smoothly over time — zero dependencies, no WASM, no file copying.

> **Early stage** — This plugin is in active development. The API may change between minor versions. Feedback and issues are welcome.

## Install

```bash
npm install gsap-offset-path
```

## Usage

```ts
import gsap from "gsap";
import { OffsetPathPlugin } from "gsap-offset-path";

gsap.registerPlugin(OffsetPathPlugin);

gsap.to(svgPathElement, {
  offsetPath: { offset: -20, originX: 0.5, originY: 1.0 },
  duration: 2,
});
```

### Script tag (no bundler)

```html
<script src="https://cdn.jsdelivr.net/npm/gsap"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap-offset-path/dist/index.js"></script>
<script>
  gsap.registerPlugin(OffsetPathPlugin);

  gsap.to(document.querySelector("path"), {
    offsetPath: { offset: 20 },
    duration: 1,
    repeat: -1,
    yoyo: true,
  });
</script>
```

### React example

```tsx
import { useRef, useEffect } from "react";
import gsap from "gsap";
import { OffsetPathPlugin } from "gsap-offset-path";

gsap.registerPlugin(OffsetPathPlugin);

function AnimatedPath() {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!pathRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        pathRef.current,
        { offsetPath: { offset: -30, originX: 0.5, originY: 1.0 } },
        { offsetPath: { offset: 0,  originX: 0.5, originY: 1.0 }, duration: 2 }
      );
    });

    return () => ctx.revert();
  }, []);

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

### `offsetPath` tween property

Use as a GSAP tween property on any `SVGPathElement` target.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `offset` | `number` | — | Offset in SVG units. Positive = expand outward, negative = shrink inward. |
| `joinType` | `JoinType` | `Round` | How corners are joined at convex vertices. |
| `endType` | `EndType` | `Polygon` | How open path ends are capped. |
| `miterLimit` | `number` | `2.0` | Maximum miter distance before a corner falls back to bevel. |
| `arcTolerance` | `number` | `0.25` | Curve approximation tolerance for round joins and caps. |
| `originX` | `number` | — | Anchor X (0.0 = left, 1.0 = right). Keeps this point fixed during offset. |
| `originY` | `number` | — | Anchor Y (0.0 = top, 1.0 = bottom). Keeps this point fixed during offset. |

Shorthand — pass a number directly to set just the offset amount:

```ts
gsap.to(path, { offsetPath: -20, duration: 1 });
```

### `JoinType` enum

Controls how adjacent offset edges are connected at convex corners.

| Value | Description |
|-------|-------------|
| `JoinType.Round` | Arc between the two edge normals *(default)* |
| `JoinType.Miter` | Edges extended to a sharp point, capped by `miterLimit` |
| `JoinType.Bevel` | Straight cut between the two edge endpoints |
| `JoinType.Square` | Square cap projected from the corner |

### `EndType` enum

Controls how open path ends are treated.

| Value | Description |
|-------|-------------|
| `EndType.Polygon` | Treat path as a closed polygon *(default)* |
| `EndType.Joined` | Close the path then offset as a filled shape |
| `EndType.Butt` | Flat end, no cap |
| `EndType.Square` | Square cap at each end |
| `EndType.Round` | Round cap at each end |

## How it works

On each animation frame GSAP interpolates the offset value and the plugin:

1. Parses the original SVG path `d` attribute (handles `M`, `L`, `H`, `V`, `C`, `Q`, `Z` and their relative variants)
2. Flattens Bézier curves to line segments via De Casteljau subdivision
3. Scales to integer coordinates and normalises winding order
4. Runs a vertex-bisector polygon offset algorithm with the configured join and end types
5. Translates the result to keep the anchor point (`originX`/`originY`) fixed
6. Writes the new path data back to the element

Everything runs synchronously in pure TypeScript

> **Note:** Self-intersections that can occur with large offsets on complex concave paths are not resolved. For typical animation use (small offsets on simple shapes) this is not noticeable.

## License

MIT
