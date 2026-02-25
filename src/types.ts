/** Join types for path offsetting corners */
export enum JoinType {
  Square = 0,
  Bevel = 1,
  Round = 2,
  Miter = 3,
}

/** End types for open path endings */
export enum EndType {
  Polygon = 0,
  Joined = 1,
  Butt = 2,
  Square = 3,
  Round = 4,
}

/** Options for the offsetPath GSAP property */
export interface OffsetPathOptions {
  /** Offset amount in SVG units. Positive = expand outward, negative = shrink inward. */
  offset: number;
  /** How to join offset segments at corners. Default: Round */
  joinType?: JoinType;
  /** How to end open paths. Default: Polygon */
  endType?: EndType;
  /** Limit on miter joins. Default: 2.0 */
  miterLimit?: number;
  /** Curve approximation tolerance. Default: 0.25 */
  arcTolerance?: number;
  /** Anchor X position (0.0 = left, 1.0 = right). Keeps this point fixed during offset. */
  originX?: number;
  /** Anchor Y position (0.0 = top, 1.0 = bottom). Keeps this point fixed during offset. */
  originY?: number;
}

// Extend GSAP's TweenVars interface
declare module 'gsap' {
  interface TweenVars {
    offsetPath?: OffsetPathOptions | number;
  }
}
