use wasm_bindgen::prelude::*;
use clipper2_rust::{ClipperOffset, EndType as ClipperEndType, JoinType as ClipperJoinType, Path64, Paths64, Point64};
use std::fmt;

// Set panic hook for better error messages in browser console
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

// Join types for path offsetting
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub enum JoinType {
    Square = 0,
    Bevel = 1,
    Round = 2,
    Miter = 3,
}

// End types for open paths
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub enum EndType {
    Polygon = 0,
    Joined = 1,
    Butt = 2,
    Square = 3,
    Round = 4,
}

// Error type for path operations
#[derive(Debug)]
pub enum PathError {
    InvalidPathData(String),
    ClipperError(String),
    EmptyPath,
}

impl fmt::Display for PathError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            PathError::InvalidPathData(msg) => write!(f, "Invalid SVG path data: {}", msg),
            PathError::ClipperError(msg) => write!(f, "Clipper2 error: {}", msg),
            PathError::EmptyPath => write!(f, "Path is empty"),
        }
    }
}

impl From<PathError> for JsValue {
    fn from(err: PathError) -> JsValue {
        JsValue::from_str(&err.to_string())
    }
}

// Parse SVG path and flatten curves to line segments using lyon
fn parse_svg_path_with_lyon(path_data: &str, tolerance: f64, scale: f64) -> Result<Path64, PathError> {
    use lyon_path::{Path as LyonPath, PathEvent};
    use lyon_path::iterator::PathIterator;

    if path_data.trim().is_empty() {
        return Err(PathError::EmptyPath);
    }

    // Build path from SVG string
    let mut builder = LyonPath::builder();

    // Parse SVG path manually (simplified for common commands)
    // This handles M, L, C, Q, Z commands which are sufficient for our use case
    let result = parse_svg_to_lyon(path_data, &mut builder);
    if result.is_err() {
        return Err(PathError::InvalidPathData(format!("{:?}", result.unwrap_err())));
    }

    let lyon_path = builder.build();

    // Flatten curves to line segments
    let mut clipper_path = Path64::new();

    for event in lyon_path.iter().flattened(tolerance as f32) {
        match event {
            PathEvent::Begin { at } => {
                clipper_path.push(Point64::new(
                    (at.x as f64 * scale) as i64,
                    (at.y as f64 * scale) as i64,
                ));
            }
            PathEvent::Line { to, .. } => {
                clipper_path.push(Point64::new(
                    (to.x as f64 * scale) as i64,
                    (to.y as f64 * scale) as i64,
                ));
            }
            PathEvent::End { close: _, .. } => {
                // Path segment ended
            }
            _ => {}
        }
    }

    if clipper_path.is_empty() {
        return Err(PathError::EmptyPath);
    }

    // Calculate signed area to determine winding order
    // Using the shoelace formula
    let mut signed_area: f64 = 0.0;
    for i in 0..clipper_path.len() {
        let j = (i + 1) % clipper_path.len();
        signed_area += (clipper_path[j].x - clipper_path[i].x) as f64
                     * (clipper_path[j].y + clipper_path[i].y) as f64;
    }

    // Clipper2 expects CCW winding for outer paths
    // In screen coordinates (Y-down), positive area = CW = needs reversal
    if signed_area > 0.0 {
        clipper_path.reverse();
    }

    Ok(clipper_path)
}

// Simple SVG parser that converts to lyon path events
fn parse_svg_to_lyon(path_data: &str, builder: &mut lyon_path::path::Builder) -> Result<(), String> {
    use lyon_path::math::Point;

    let path_data = path_data.trim();
    let mut chars = path_data.chars().peekable();
    let mut current_command: Option<char> = None;
    let mut current_pos = Point::new(0.0, 0.0);
    let mut path_started = false;

    while let Some(&ch) = chars.peek() {
        match ch {
            'M' | 'm' | 'L' | 'l' | 'C' | 'c' | 'Q' | 'q' | 'Z' | 'z' => {
                current_command = Some(ch);
                chars.next();
                skip_whitespace(&mut chars);
            }
            _ if ch.is_whitespace() || ch == ',' => {
                chars.next();
            }
            _ => {
                match current_command {
                    Some('M') | Some('m') => {
                        let x = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let y = parse_float(&mut chars)?;

                        let pt = if current_command == Some('M') {
                            Point::new(x as f32, y as f32)
                        } else {
                            Point::new((current_pos.x as f64 + x) as f32, (current_pos.y as f64 + y) as f32)
                        };

                        if path_started {
                            builder.end(false);
                        }
                        builder.begin(pt);
                        current_pos = pt;
                        path_started = true;
                        skip_sep(&mut chars);
                    }
                    Some('L') | Some('l') => {
                        let x = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let y = parse_float(&mut chars)?;

                        let pt = if current_command == Some('L') {
                            Point::new(x as f32, y as f32)
                        } else {
                            Point::new((current_pos.x as f64 + x) as f32, (current_pos.y as f64 + y) as f32)
                        };

                        builder.line_to(pt);
                        current_pos = pt;
                        skip_sep(&mut chars);
                    }
                    Some('C') | Some('c') => {
                        let x1 = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let y1 = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let x2 = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let y2 = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let x = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let y = parse_float(&mut chars)?;

                        let (ctrl1, ctrl2, to) = if current_command == Some('C') {
                            (
                                Point::new(x1 as f32, y1 as f32),
                                Point::new(x2 as f32, y2 as f32),
                                Point::new(x as f32, y as f32),
                            )
                        } else {
                            (
                                Point::new((current_pos.x as f64 + x1) as f32, (current_pos.y as f64 + y1) as f32),
                                Point::new((current_pos.x as f64 + x2) as f32, (current_pos.y as f64 + y2) as f32),
                                Point::new((current_pos.x as f64 + x) as f32, (current_pos.y as f64 + y) as f32),
                            )
                        };

                        builder.cubic_bezier_to(ctrl1, ctrl2, to);
                        current_pos = to;
                        skip_sep(&mut chars);
                    }
                    Some('Q') | Some('q') => {
                        let x1 = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let y1 = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let x = parse_float(&mut chars)?;
                        skip_sep(&mut chars);
                        let y = parse_float(&mut chars)?;

                        let (ctrl, to) = if current_command == Some('Q') {
                            (
                                Point::new(x1 as f32, y1 as f32),
                                Point::new(x as f32, y as f32),
                            )
                        } else {
                            (
                                Point::new((current_pos.x as f64 + x1) as f32, (current_pos.y as f64 + y1) as f32),
                                Point::new((current_pos.x as f64 + x) as f32, (current_pos.y as f64 + y) as f32),
                            )
                        };

                        builder.quadratic_bezier_to(ctrl, to);
                        current_pos = to;
                        skip_sep(&mut chars);
                    }
                    Some('Z') | Some('z') => {
                        builder.end(true);
                        path_started = false;
                        current_command = None;
                    }
                    _ => {
                        return Err(format!("Unexpected character: {}", ch));
                    }
                }
            }
        }
    }

    if path_started {
        builder.end(true);  // CHANGE: Always close paths to ensure Clipper2 compatibility
    }

    Ok(())
}

fn skip_whitespace(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while chars.peek().map_or(false, |c| c.is_whitespace()) {
        chars.next();
    }
}

fn skip_sep(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while chars.peek().map_or(false, |c| c.is_whitespace() || *c == ',') {
        chars.next();
    }
}

fn parse_float(chars: &mut std::iter::Peekable<std::str::Chars>) -> Result<f64, String> {
    skip_whitespace(chars);

    let mut num_str = String::new();
    let mut has_dot = false;
    let mut has_digit = false;
    let mut has_exp = false;

    // Handle negative sign
    if chars.peek() == Some(&'-') {
        num_str.push('-');
        chars.next();
    }

    while let Some(&ch) = chars.peek() {
        match ch {
            '0'..='9' => {
                num_str.push(ch);
                chars.next();
                has_digit = true;
            }
            '.' if !has_dot && !has_exp => {
                num_str.push(ch);
                chars.next();
                has_dot = true;
            }
            'e' | 'E' if has_digit && !has_exp => {
                num_str.push(ch);
                chars.next();
                has_exp = true;
                // Handle optional sign after exponent
                if chars.peek() == Some(&'-') || chars.peek() == Some(&'+') {
                    num_str.push(chars.next().unwrap());
                }
            }
            _ => break,
        }
    }

    if !has_digit {
        return Err("Expected number".to_string());
    }

    num_str.parse::<f64>()
        .map_err(|_| format!("Invalid number: {}", num_str))
}

// Compute bounding box of a Path64: (min_x, min_y, max_x, max_y)
fn bbox(path: &Path64) -> (i64, i64, i64, i64) {
    let mut min_x = i64::MAX;
    let mut min_y = i64::MAX;
    let mut max_x = i64::MIN;
    let mut max_y = i64::MIN;
    for p in path.iter() {
        min_x = min_x.min(p.x);
        min_y = min_y.min(p.y);
        max_x = max_x.max(p.x);
        max_y = max_y.max(p.y);
    }
    (min_x, min_y, max_x, max_y)
}

// Convert Clipper2 Path64 back to SVG path string
fn path64_to_svg(path: &Path64, scale: f64) -> String {
    if path.is_empty() {
        return String::new();
    }

    let mut result = String::new();

    for (i, point) in path.iter().enumerate() {
        let x = point.x as f64 / scale;
        let y = point.y as f64 / scale;

        if i == 0 {
            result.push_str(&format!("M {:.2} {:.2}", x, y));
        } else {
            result.push_str(&format!(" L {:.2} {:.2}", x, y));
        }
    }

    result.push_str(" Z");
    result
}

// Convert multiple Clipper2 paths back to a single SVG path string
fn paths64_to_svg(paths: &Paths64, scale: f64) -> String {
    paths.iter()
        .filter(|p| !p.is_empty())
        .map(|p| path64_to_svg(p, scale))
        .collect::<Vec<_>>()
        .join(" ")
}

// Main offset function
#[wasm_bindgen]
pub fn offset_svg_path(
    path_data: &str,
    offset_amount: f64,
    join_type: JoinType,
    end_type: EndType,
    miter_limit: f64,
    arc_tolerance: f64,
    origin_x: Option<f64>,
    origin_y: Option<f64>,
) -> Result<String, JsValue> {
    // Guard against NaN/invalid offset
    if offset_amount.is_nan() || offset_amount.is_infinite() {
        return Err(PathError::InvalidPathData("Offset amount is NaN or infinite".to_string()).into());
    }

    // For zero offset, return the original path as-is (Clipper2 returns empty for offset=0)
    if offset_amount.abs() < 0.001 {
        return Ok(path_data.to_string());
    }

    // Scale factor for precision (Clipper2 uses integer coordinates)
    let scale = 1000.0;

    // Flatten tolerance - controls curve approximation quality
    // Lower = more accurate (more points), higher = fewer points
    let flatten_tolerance = 0.1;

    // Parse SVG path and flatten curves to line segments
    let path = parse_svg_path_with_lyon(path_data, flatten_tolerance, scale)?;

    // Validate path before offsetting
    if path.len() < 3 {
        return Err(PathError::InvalidPathData(
            format!("Path must have at least 3 points, got {}", path.len())
        ).into());
    }

    // Convert join type
    let clipper_join_type = match join_type {
        JoinType::Square => ClipperJoinType::Square,
        JoinType::Bevel => ClipperJoinType::Bevel,
        JoinType::Round => ClipperJoinType::Round,
        JoinType::Miter => ClipperJoinType::Miter,
    };

    // Convert end type
    let clipper_end_type = match end_type {
        EndType::Polygon => ClipperEndType::Polygon,
        EndType::Joined => ClipperEndType::Joined,
        EndType::Butt => ClipperEndType::Butt,
        EndType::Square => ClipperEndType::Square,
        EndType::Round => ClipperEndType::Round,
    };

    // Create ClipperOffset instance
    let mut clipper = ClipperOffset::new(miter_limit, arc_tolerance, false, false);

    // Add path
    clipper.add_path(&path, clipper_join_type, clipper_end_type);

    // Execute offset
    let mut offset_paths = Paths64::new();
    let scaled_offset = offset_amount * scale;
    clipper.execute(scaled_offset, &mut offset_paths);

    // Empty result means the path was deflated to nothing (valid for large negative offsets)
    if offset_paths.is_empty() {
        return Ok(String::new());
    }

    // Pin anchor point: translate offset path so the origin stays fixed
    let (orig_min_x, orig_min_y, orig_max_x, orig_max_y) = bbox(&path);
    let (off_min_x, off_min_y, off_max_x, off_max_y) = bbox(&offset_paths[0]);

    let dx = origin_x.map_or(0, |x| {
        let anchor_x = orig_min_x as f64 + (orig_max_x - orig_min_x) as f64 * x;
        let off_anchor_x = off_min_x as f64 + (off_max_x - off_min_x) as f64 * x;
        (anchor_x - off_anchor_x) as i64
    });

    let dy = origin_y.map_or(0, |y| {
        let anchor_y = orig_min_y as f64 + (orig_max_y - orig_min_y) as f64 * y;
        let off_anchor_y = off_min_y as f64 + (off_max_y - off_min_y) as f64 * y;
        (anchor_y - off_anchor_y) as i64
    });

    for point in offset_paths[0].iter_mut() {
        point.x += dx;
        point.y += dy;
    }

    let result_svg = path64_to_svg(&offset_paths[0], scale);

    Ok(result_svg)
}

// Simplified version with default options
#[wasm_bindgen]
pub fn offset_svg_path_simple(
    path_data: &str,
    offset_amount: f64,
) -> Result<String, JsValue> {
    offset_svg_path(
        path_data,
        offset_amount,
        JoinType::Round,
        EndType::Polygon,
        2.0,
        0.25,
        None,
        None,
    )
}

// Test function for simple path offsetting
#[wasm_bindgen]
pub fn test_simple_offset() -> Result<String, JsValue> {
    // Simple closed rectangle: 100x100 square
    let simple_path = "M 100 100 L 200 100 L 200 200 L 100 200 Z";

    offset_svg_path(
        simple_path,
        10.0,  // Inflate by 10
        JoinType::Round,
        EndType::Polygon,
        2.0,
        0.25,
        None,
        None,
    )
}

// Validate SVG path
#[wasm_bindgen]
pub fn validate_svg_path(path_data: &str) -> bool {
    parse_svg_path_with_lyon(path_data, 0.1, 1000.0).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_path() {
        let path = "M 0 0 L 100 0 L 100 100 Z";
        let result = parse_svg_path_with_lyon(path, 0.1, 1000.0);
        assert!(result.is_ok());
        let clipper_path = result.unwrap();
        assert!(!clipper_path.is_empty());
    }

    #[test]
    fn test_parse_bezier_path() {
        // Test with cubic Bezier curve (C command)
        let path = "M 0 0 C 10 10 20 20 30 30 Z";
        let result = parse_svg_path_with_lyon(path, 0.1, 1000.0);
        assert!(result.is_ok());
        let clipper_path = result.unwrap();
        assert!(!clipper_path.is_empty());
        // Should have more than 2 points due to curve flattening
        assert!(clipper_path.len() > 2);
    }

    #[test]
    fn test_parse_invalid_path() {
        let path = "INVALID";
        assert!(parse_svg_path_with_lyon(path, 0.1, 1000.0).is_err());
    }

    #[test]
    fn test_validate_path() {
        assert!(validate_svg_path("M 0 0 L 100 0 Z"));
        assert!(validate_svg_path("M 0 0 C 10 10 20 20 30 30 Z"));
        assert!(!validate_svg_path("INVALID"));
    }
}
