// src/nest-analysis/shapefile.ts
// Minimal shapefile parser for point/multipoint/polyline/polygon geometries.
// Focused on extracting registration coordinates client-side without external libs.

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ObservationPoint {
  x: number;
  y: number;
  dateStart?: string; // YYYYMMDD
  dateStop?: string;  // YYYYMMDD
  recordIndex?: number;
  attributes?: Record<string, unknown>;
}

export interface ParsedShapefile {
  points: ObservationPoint[];
  bounds: MapBounds;
  shapeType: number;
}

interface PolygonCentroid {
  centroid: ObservationPoint;
  area: number;
}

function parseHeader(view: DataView): { shapeType: number; bounds: MapBounds } {
  if (view.byteLength < 100) {
    throw new Error("SHP file too small to contain a valid header.");
  }

  const fileCode = view.getInt32(0, false);
  if (fileCode !== 9994) {
    throw new Error(`Unexpected SHP file code: ${fileCode}`);
  }

  const shapeType = view.getInt32(32, true);
  const minX = view.getFloat64(36, true);
  const minY = view.getFloat64(44, true);
  const maxX = view.getFloat64(52, true);
  const maxY = view.getFloat64(60, true);

  return {
    shapeType,
    bounds: { minX, minY, maxX, maxY }
  };
}

function polygonCentroid(points: ObservationPoint[]): PolygonCentroid | null {
  if (points.length < 3) {
    return null;
  }

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < points.length; i++) {
    const { x: x0, y: y0 } = points[i];
    const { x: x1, y: y1 } = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    return null;
  }

  const factor = 1 / (6 * area);
  return {
    centroid: { x: cx * factor, y: cy * factor },
    area: Math.abs(area)
  };
}

function averagePoint(points: ObservationPoint[]): ObservationPoint {
  if (!points.length) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  return { x: sumX / points.length, y: sumY / points.length };
}

function readPolyRecord(
  view: DataView,
  offset: number
): { centroid: ObservationPoint | null; next: number } {
  // Record layout (little endian):
  // int32 shapeType
  // double[4] box
  // int32 numParts
  // int32 numPoints
  // int32[numParts] parts
  // Point[numPoints] points
  const shapeType = view.getInt32(offset, true);
  if (shapeType === 0) {
    return { centroid: null, next: offset };
  }

  const numParts = view.getInt32(offset + 36, true);
  const numPoints = view.getInt32(offset + 40, true);
  const partOffset = offset + 44;
  const pointsOffset = partOffset + numParts * 4;

  const partStarts: number[] = [];
  for (let i = 0; i < numParts; i++) {
    partStarts.push(view.getInt32(partOffset + i * 4, true));
  }
  partStarts.push(numPoints); // sentinel for easy slicing

  const points: ObservationPoint[] = [];
  for (let i = 0; i < numPoints; i++) {
    const base = pointsOffset + i * 16;
    points.push({
      x: view.getFloat64(base, true),
      y: view.getFloat64(base + 8, true)
    });
  }

  let weightedCx = 0;
  let weightedCy = 0;
  let totalArea = 0;

  for (let p = 0; p < numParts; p++) {
    const start = partStarts[p];
    const end = partStarts[p + 1];
    const slice = points.slice(start, end);
    const centroid = polygonCentroid(slice);
    if (centroid) {
      weightedCx += centroid.centroid.x * centroid.area;
      weightedCy += centroid.centroid.y * centroid.area;
      totalArea += centroid.area;
    }
  }

  if (totalArea > 0) {
    return {
      centroid: { x: weightedCx / totalArea, y: weightedCy / totalArea },
      next: pointsOffset + numPoints * 16
    };
  }

  return {
    centroid: averagePoint(points),
    next: pointsOffset + numPoints * 16
  };
}

function readMultiPointRecord(
  view: DataView,
  offset: number
): { points: ObservationPoint[]; next: number } {
  const numPoints = view.getInt32(offset + 36, true);
  const points: ObservationPoint[] = [];
  const start = offset + 40;

  for (let i = 0; i < numPoints; i++) {
    const base = start + i * 16;
    points.push({
      x: view.getFloat64(base, true),
      y: view.getFloat64(base + 8, true)
    });
  }

  return { points, next: start + numPoints * 16 };
}

/**
 * Parse a .shp file ArrayBuffer and return observation points + bounds.
 * Supports Point (1), MultiPoint (8), PolyLine (3), Polygon (5).
 */
export function parseShapefile(buffer: ArrayBuffer): ParsedShapefile {
  const view = new DataView(buffer);
  const header = parseHeader(view);
  const points: ObservationPoint[] = [];
  let recordIndex = 0;

  let offset = 100; // after header
  while (offset + 12 <= view.byteLength) {
    // Record header (big endian)
    const contentLengthWords = view.getInt32(offset + 4, false);
    const contentBytes = contentLengthWords * 2;
    offset += 8;
    const recordStart = offset;
    const recordEnd = recordStart + contentBytes;
    if (recordEnd > view.byteLength) {
      break;
    }

    const shapeType = view.getInt32(recordStart, true);
    if (shapeType === 0) {
      offset = recordEnd;
      continue; // Null shape
    }

    switch (shapeType) {
      case 1: { // Point
        const x = view.getFloat64(recordStart + 4, true);
        const y = view.getFloat64(recordStart + 12, true);
        points.push({ x, y, recordIndex });
        break;
      }
      case 8: { // MultiPoint
        const { points: pts, next } = readMultiPointRecord(view, recordStart);
        points.push(...pts.map(p => ({ ...p, recordIndex })));
        if (recordStart + contentBytes !== next) {
          // align to record end if our parser didn't consume everything
        }
        break;
      }
      case 3: // PolyLine
      case 5: { // Polygon
        const { centroid } = readPolyRecord(view, recordStart);
        if (centroid) {
          points.push({ ...centroid, recordIndex });
        }
        break;
      }
      default:
        // Unsupported shape type, skip
        break;
    }

    recordIndex++;
    offset = recordEnd;
  }

  return {
    points,
    bounds: header.bounds,
    shapeType: header.shapeType
  };
}
