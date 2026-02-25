import type { gsap } from 'gsap';
import type { OffsetPathOptions } from './types';
import { JoinType, EndType } from './types';

// ---------------------------------------------------------------------------
// Constants (match Rust defaults)
// ---------------------------------------------------------------------------
const SCALE = 1000.0;
const FLATTEN_TOLERANCE = 0.1;

// ---------------------------------------------------------------------------
// 2D point helpers
// ---------------------------------------------------------------------------
type Pt = [number, number];

function sub(a: Pt, b: Pt): Pt { return [a[0] - b[0], a[1] - b[1]]; }
function add(a: Pt, b: Pt): Pt { return [a[0] + b[0], a[1] + b[1]]; }
function scale2(a: Pt, s: number): Pt { return [a[0] * s, a[1] * s]; }
function dot(a: Pt, b: Pt): number { return a[0] * b[0] + a[1] * b[1]; }
function cross(a: Pt, b: Pt): number { return a[0] * b[1] - a[1] * b[0]; }
function len(a: Pt): number { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
function norm(a: Pt): Pt {
  const l = len(a);
  return l > 1e-10 ? [a[0] / l, a[1] / l] : [0, 0];
}
// Outward-left normal (for CCW polygon, this points outward)
function leftNormal(e: Pt): Pt { return [-e[1], e[0]]; }

// ---------------------------------------------------------------------------
// SVG path parser (port of parse_svg_to_lyon from lib.rs)
// Handles M, m, L, l, C, c, Q, q, Z, z
// Returns array of subpaths, each a flat [x,y] array
// ---------------------------------------------------------------------------

interface ParseState {
  src: string;
  pos: number;
}

function skipSep(s: ParseState): void {
  while (s.pos < s.src.length) {
    const ch = s.src[s.pos];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') {
      s.pos++;
    } else {
      break;
    }
  }
}

function parseNumber(s: ParseState): number {
  skipSep(s);
  let start = s.pos;
  if (s.src[s.pos] === '-' || s.src[s.pos] === '+') s.pos++;
  while (s.pos < s.src.length && s.src[s.pos] >= '0' && s.src[s.pos] <= '9') s.pos++;
  if (s.pos < s.src.length && s.src[s.pos] === '.') {
    s.pos++;
    while (s.pos < s.src.length && s.src[s.pos] >= '0' && s.src[s.pos] <= '9') s.pos++;
  }
  if (s.pos < s.src.length && (s.src[s.pos] === 'e' || s.src[s.pos] === 'E')) {
    s.pos++;
    if (s.pos < s.src.length && (s.src[s.pos] === '-' || s.src[s.pos] === '+')) s.pos++;
    while (s.pos < s.src.length && s.src[s.pos] >= '0' && s.src[s.pos] <= '9') s.pos++;
  }
  return parseFloat(s.src.slice(start, s.pos));
}

// Parse SVG path data into subpaths of [x,y] pairs (pre-flattening, float coords).
// Each subpath also records its cubic/quadratic segments for the flattener.
interface Segment {
  type: 'M' | 'L' | 'C' | 'Q';
  pts: Pt[]; // for M/L: [to]; for C: [c1, c2, to]; for Q: [ctrl, to]
}

interface Subpath {
  segs: Segment[];
  closed: boolean;
}

function parseSvgPath(pathData: string): Subpath[] {
  const s: ParseState = { src: pathData.trim(), pos: 0 };
  const subpaths: Subpath[] = [];
  let current: Subpath | null = null;
  let cx = 0, cy = 0; // current position
  let cmd = '';

  while (s.pos < s.src.length) {
    const ch = s.src[s.pos];
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
      cmd = ch;
      s.pos++;
      skipSep(s);
    }

    if (cmd === 'Z' || cmd === 'z') {
      if (current) current.closed = true;
      cmd = '';
      skipSep(s);
      continue;
    }

    if (cmd === '' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') {
      skipSep(s);
      if (s.pos >= s.src.length) break;
      // If next char is a command letter, loop back
      const nc = s.src[s.pos];
      if ((nc >= 'A' && nc <= 'Z') || (nc >= 'a' && nc <= 'z')) continue;
      if (cmd === '') break;
    }

    // Peek: if next char is a letter, don't try to parse numbers
    if (s.pos < s.src.length) {
      const nc = s.src[s.pos];
      if ((nc >= 'A' && nc <= 'Z') || (nc >= 'a' && nc <= 'z')) continue;
    }

    if (cmd === 'M' || cmd === 'm') {
      const x = parseNumber(s); skipSep(s);
      const y = parseNumber(s);
      const ax = cmd === 'M' ? x : cx + x;
      const ay = cmd === 'M' ? y : cy + y;
      current = { segs: [{ type: 'M', pts: [[ax, ay]] }], closed: false };
      subpaths.push(current);
      cx = ax; cy = ay;
      // Subsequent coords after M are implicit L
      cmd = cmd === 'M' ? 'L' : 'l';
    } else if (cmd === 'L' || cmd === 'l') {
      const x = parseNumber(s); skipSep(s);
      const y = parseNumber(s);
      const ax = cmd === 'L' ? x : cx + x;
      const ay = cmd === 'L' ? y : cy + y;
      if (!current) { current = { segs: [{ type: 'M', pts: [[ax, ay]] }], closed: false }; subpaths.push(current); }
      current.segs.push({ type: 'L', pts: [[ax, ay]] });
      cx = ax; cy = ay;
    } else if (cmd === 'H' || cmd === 'h') {
      const x = parseNumber(s);
      const ax = cmd === 'H' ? x : cx + x;
      if (!current) { current = { segs: [{ type: 'M', pts: [[ax, cy]] }], closed: false }; subpaths.push(current); }
      current.segs.push({ type: 'L', pts: [[ax, cy]] });
      cx = ax;
    } else if (cmd === 'V' || cmd === 'v') {
      const y = parseNumber(s);
      const ay = cmd === 'V' ? y : cy + y;
      if (!current) { current = { segs: [{ type: 'M', pts: [[cx, ay]] }], closed: false }; subpaths.push(current); }
      current.segs.push({ type: 'L', pts: [[cx, ay]] });
      cy = ay;
    } else if (cmd === 'C' || cmd === 'c') {
      const x1 = parseNumber(s); skipSep(s); const y1 = parseNumber(s); skipSep(s);
      const x2 = parseNumber(s); skipSep(s); const y2 = parseNumber(s); skipSep(s);
      const x  = parseNumber(s); skipSep(s); const y  = parseNumber(s);
      const rel = cmd === 'c';
      const c1: Pt = rel ? [cx + x1, cy + y1] : [x1, y1];
      const c2: Pt = rel ? [cx + x2, cy + y2] : [x2, y2];
      const to: Pt = rel ? [cx + x,  cy + y ] : [x,  y ];
      if (!current) { current = { segs: [{ type: 'M', pts: [[cx, cy]] }], closed: false }; subpaths.push(current); }
      current.segs.push({ type: 'C', pts: [c1, c2, to] });
      cx = to[0]; cy = to[1];
    } else if (cmd === 'Q' || cmd === 'q') {
      const x1 = parseNumber(s); skipSep(s); const y1 = parseNumber(s); skipSep(s);
      const x  = parseNumber(s); skipSep(s); const y  = parseNumber(s);
      const rel = cmd === 'q';
      const ctrl: Pt = rel ? [cx + x1, cy + y1] : [x1, y1];
      const to: Pt   = rel ? [cx + x,  cy + y ] : [x,  y ];
      if (!current) { current = { segs: [{ type: 'M', pts: [[cx, cy]] }], closed: false }; subpaths.push(current); }
      current.segs.push({ type: 'Q', pts: [ctrl, to] });
      cx = to[0]; cy = to[1];
    } else {
      // Unknown command — skip character
      s.pos++;
    }

    skipSep(s);
  }

  return subpaths;
}

// ---------------------------------------------------------------------------
// Bezier flattening via De Casteljau (port of lyon flattened iterator)
// ---------------------------------------------------------------------------

function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, out: Pt[]): void {
  // Flatness test: max deviation of control polygon from chord
  const ux = 3 * p1[0] - 2 * p0[0] - p3[0];
  const uy = 3 * p1[1] - 2 * p0[1] - p3[1];
  const vx = 3 * p2[0] - 2 * p3[0] - p0[0];
  const vy = 3 * p2[1] - 2 * p3[1] - p0[1];
  if (Math.max(ux * ux + uy * uy, vx * vx + vy * vy) <= 16 * tol * tol) {
    out.push(p3);
    return;
  }
  // Midpoint subdivision
  const m01: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const m23: Pt = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const m012: Pt = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  const m123: Pt = [(m12[0] + m23[0]) / 2, (m12[1] + m23[1]) / 2];
  const mid: Pt  = [(m012[0] + m123[0]) / 2, (m012[1] + m123[1]) / 2];
  flattenCubic(p0, m01, m012, mid, tol, out);
  flattenCubic(mid, m123, m23, p3, tol, out);
}

function flattenQuadratic(p0: Pt, p1: Pt, p2: Pt, tol: number, out: Pt[]): void {
  // Elevate quadratic to cubic then flatten
  const c1: Pt = [p0[0] + (2 / 3) * (p1[0] - p0[0]), p0[1] + (2 / 3) * (p1[1] - p0[1])];
  const c2: Pt = [p2[0] + (2 / 3) * (p1[0] - p2[0]), p2[1] + (2 / 3) * (p1[1] - p2[1])];
  flattenCubic(p0, c1, c2, p2, tol, out);
}

// ---------------------------------------------------------------------------
// SVG path → integer points (scale + winding check)
// Returns null if invalid (empty / < 3 points)
// ---------------------------------------------------------------------------

function svgToPoints(pathData: string, sc: number, tol: number): Pt[] | null {
  const subpaths = parseSvgPath(pathData);
  if (subpaths.length === 0) return null;

  // Use first subpath only (matches Rust behaviour)
  const sp = subpaths[0];
  const floatPts: Pt[] = [];

  let cur: Pt = [0, 0];
  for (const seg of sp.segs) {
    if (seg.type === 'M') {
      cur = seg.pts[0];
      floatPts.push(cur);
    } else if (seg.type === 'L') {
      cur = seg.pts[0];
      floatPts.push(cur);
    } else if (seg.type === 'C') {
      flattenCubic(cur, seg.pts[0], seg.pts[1], seg.pts[2], tol, floatPts);
      cur = seg.pts[2];
    } else if (seg.type === 'Q') {
      flattenQuadratic(cur, seg.pts[0], seg.pts[1], tol, floatPts);
      cur = seg.pts[1];
    }
  }

  if (floatPts.length < 3) return null;

  // Scale to integers
  const pts: Pt[] = floatPts.map(([x, y]) => [Math.round(x * sc), Math.round(y * sc)]);

  // Winding check via shoelace (CCW required)
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  }
  if (area > 0) pts.reverse();

  return pts;
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

interface BBox { minX: number; minY: number; maxX: number; maxY: number; }

function bbox(pts: Pt[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Points → SVG path string (port of path64_to_svg)
// ---------------------------------------------------------------------------

function pointsToSvg(pts: Pt[], sc: number): string {
  if (pts.length === 0) return '';
  let d = `M ${(pts[0][0] / sc).toFixed(2)} ${(pts[0][1] / sc).toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${(pts[i][0] / sc).toFixed(2)} ${(pts[i][1] / sc).toFixed(2)}`;
  }
  return d + ' Z';
}

// ---------------------------------------------------------------------------
// Polygon offset algorithm (vertex-bisector method, port of ClipperOffset logic)
// ---------------------------------------------------------------------------

function addRoundJoin(
  cx: number, cy: number,
  n1: Pt, n2: Pt,
  offsetAmt: number,
  arcTolerance: number,
  result: Pt[],
): void {
  // Number of arc steps based on arcTolerance
  const a1 = Math.atan2(n1[1], n1[0]);
  const a2 = Math.atan2(n2[1], n2[0]);
  let da = a2 - a1;
  // Normalize to [-PI, PI]
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;

  const r = Math.abs(offsetAmt);
  const steps = Math.max(2, Math.ceil(Math.abs(da) / (2 * Math.acos(1 - arcTolerance / r))));
  const stepAngle = da / steps;

  for (let i = 0; i <= steps; i++) {
    const a = a1 + stepAngle * i;
    result.push([Math.round(cx + Math.cos(a) * offsetAmt), Math.round(cy + Math.sin(a) * offsetAmt)]);
  }
}

function offsetPolygon(
  pts: Pt[],
  offsetAmt: number,
  joinType: JoinType,
  endType: EndType,
  miterLimit: number,
  arcTolerance: number,
): Pt[] {
  const n = pts.length;
  if (n < 3) return [];
  const result: Pt[] = [];

  // For closed polygon (EndType.Polygon / Joined), process all vertices
  const isOpen = endType === EndType.Butt || endType === EndType.Square || endType === EndType.Round;
  const loopCount = isOpen ? n - 1 : n;

  for (let i = 0; i < loopCount; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    // Edge vectors
    const e1 = norm(sub(curr, prev));
    const e2 = norm(sub(next, curr));

    // Outward normals for each edge (left normal for CCW)
    const outN1: Pt = leftNormal(e1);
    const outN2: Pt = leftNormal(e2);

    // Cross product of edge vectors: positive = left turn (convex corner for CCW)
    const cr = cross(e1, e2);
    // Dot product: cosine of angle between edges
    const dp = dot(e1, e2);

    // For concave corners (right turns, cr < 0) when offsetting outward,
    // or convex corners when offsetting inward — just use bisector
    const offsetDir = offsetAmt > 0 ? 1 : -1;
    const isConvex = cr * offsetDir > 0;

    if (!isConvex || Math.abs(cr) < 1e-6) {
      // Concave corner or nearly parallel: bisector point
      const bisect = norm(add(outN1, outN2));
      const sinHalf = cross(e1, bisect);
      if (Math.abs(sinHalf) < 1e-6) {
        // Parallel edges: simple offset along normal
        result.push([Math.round(curr[0] + outN1[0] * offsetAmt), Math.round(curr[1] + outN1[1] * offsetAmt)]);
      } else {
        const dist = offsetAmt / sinHalf;
        result.push([Math.round(curr[0] + bisect[0] * dist), Math.round(curr[1] + bisect[1] * dist)]);
      }
    } else {
      // Convex corner
      switch (joinType) {
        case JoinType.Miter: {
          const bisect = norm(add(outN1, outN2));
          const sinHalf = cross(e1, bisect);
          if (Math.abs(sinHalf) > 1e-6) {
            const dist = offsetAmt / sinHalf;
            if (Math.abs(dist) <= miterLimit * Math.abs(offsetAmt)) {
              result.push([Math.round(curr[0] + bisect[0] * dist), Math.round(curr[1] + bisect[1] * dist)]);
              break;
            }
          }
          // Miter limit exceeded → fall through to bevel
        }
        // eslint-disable-next-line no-fallthrough
        case JoinType.Bevel:
        case JoinType.Square: {
          // Add two points: one for each adjacent edge normal
          result.push([Math.round(curr[0] + outN1[0] * offsetAmt), Math.round(curr[1] + outN1[1] * offsetAmt)]);
          result.push([Math.round(curr[0] + outN2[0] * offsetAmt), Math.round(curr[1] + outN2[1] * offsetAmt)]);
          break;
        }
        case JoinType.Round:
        default: {
          addRoundJoin(curr[0], curr[1], outN1, outN2, offsetAmt, arcTolerance, result);
          break;
        }
      }
    }
  }

  // Handle open path end caps
  if (isOpen && n >= 2) {
    // Start cap
    const startPt = pts[0];
    const startEdge = norm(sub(pts[1], pts[0]));
    const startNorm: Pt = leftNormal(startEdge);
    const backDir: Pt = [-startEdge[0], -startEdge[1]];

    if (endType === EndType.Round) {
      addRoundJoin(startPt[0], startPt[1], [-startNorm[0], -startNorm[1]], startNorm, offsetAmt, arcTolerance, result);
    } else if (endType === EndType.Square) {
      result.unshift(
        [Math.round(startPt[0] - startNorm[0] * offsetAmt + backDir[0] * offsetAmt), Math.round(startPt[1] - startNorm[1] * offsetAmt + backDir[1] * offsetAmt)],
        [Math.round(startPt[0] + startNorm[0] * offsetAmt + backDir[0] * offsetAmt), Math.round(startPt[1] + startNorm[1] * offsetAmt + backDir[1] * offsetAmt)],
      );
    } else {
      // Butt: nothing extra at ends
    }

    // End cap
    const endPt = pts[n - 1];
    const endEdge = norm(sub(pts[n - 1], pts[n - 2]));
    const endNorm: Pt = leftNormal(endEdge);

    if (endType === EndType.Round) {
      addRoundJoin(endPt[0], endPt[1], endNorm, [-endNorm[0], -endNorm[1]], offsetAmt, arcTolerance, result);
    } else if (endType === EndType.Square) {
      result.push(
        [Math.round(endPt[0] + endNorm[0] * offsetAmt + endEdge[0] * offsetAmt), Math.round(endPt[1] + endNorm[1] * offsetAmt + endEdge[1] * offsetAmt)],
        [Math.round(endPt[0] - endNorm[0] * offsetAmt + endEdge[0] * offsetAmt), Math.round(endPt[1] - endNorm[1] * offsetAmt + endEdge[1] * offsetAmt)],
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main offset orchestrator (replaces wasmModule.offset_svg_path)
// ---------------------------------------------------------------------------

function offsetSvgPath(
  pathData: string,
  offsetAmt: number,
  joinType: number,
  endType: number,
  miterLimit: number,
  arcTolerance: number,
  originX: number | null,
  originY: number | null,
): string {
  if (!isFinite(offsetAmt) || Math.abs(offsetAmt) < 0.001) return pathData;

  const pts = svgToPoints(pathData, SCALE, FLATTEN_TOLERANCE);
  if (!pts || pts.length < 3) return '';

  const jt: JoinType = (joinType as JoinType) ?? JoinType.Round;
  const et: EndType  = (endType  as EndType)  ?? EndType.Polygon;

  const offsetPts = offsetPolygon(pts, offsetAmt * SCALE, jt, et, miterLimit, arcTolerance);
  if (offsetPts.length < 3) return '';

  // Anchor translation (port of Rust origin_x / origin_y logic)
  if (originX !== null || originY !== null) {
    const origBox = bbox(pts);
    const offBox  = bbox(offsetPts);

    const dx = originX !== null
      ? Math.round((origBox.minX + (origBox.maxX - origBox.minX) * originX)
                 - (offBox.minX  + (offBox.maxX  - offBox.minX)  * originX))
      : 0;
    const dy = originY !== null
      ? Math.round((origBox.minY + (origBox.maxY - origBox.minY) * originY)
                 - (offBox.minY  + (offBox.maxY  - offBox.minY)  * originY))
      : 0;

    if (dx !== 0 || dy !== 0) {
      for (const p of offsetPts) { p[0] += dx; p[1] += dy; }
    }
  }

  return pointsToSvg(offsetPts, SCALE);
}

// ---------------------------------------------------------------------------
// GSAP Plugin
// ---------------------------------------------------------------------------

export const OffsetPathPlugin: gsap.Plugin = {
  name: 'offsetPath',
  version: '2.0.0',

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
      joinType:      options.joinType      ?? JoinType.Round,
      endType:       options.endType       ?? EndType.Polygon,
      miterLimit:    options.miterLimit    ?? 2.0,
      arcTolerance:  options.arcTolerance  ?? 0.25,
      originX:       options.originX       ?? null,
      originY:       options.originY       ?? null,
    };

    data._startOffset = (target as any).__gsapOffsetPath ?? 0;
    data._endOffset   = options.offset;

    return true;
  },

  render(progress: number, data: any) {
    const offsetAmount =
      data._startOffset + (data._endOffset - data._startOffset) * progress;

    (data._target as any).__gsapOffsetPath = offsetAmount;

    try {
      if (Math.abs(offsetAmount) < 0.001) {
        data._target.style.visibility = 'visible';
        data._target.setAttribute('d', data._originalPath);
        return;
      }

      const result = offsetSvgPath(
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
