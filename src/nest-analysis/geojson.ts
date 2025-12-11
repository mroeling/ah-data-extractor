// src/nest-analysis/geojson.ts
import { MapBounds, ObservationPoint } from "./shapefile";

export interface ParsedGeoJson {
  points: ObservationPoint[];
  bounds: MapBounds;
}

function updateBounds(b: MapBounds | null, x: number, y: number): MapBounds {
  if (!b) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(b.minX, x),
    minY: Math.min(b.minY, y),
    maxX: Math.max(b.maxX, x),
    maxY: Math.max(b.maxY, y),
  };
}

/**
 * Minimal GeoJSON FeatureCollection parser for Point features (lon/lat).
 */
export function parseGeoJsonPoints(text: string): ParsedGeoJson {
  const json = JSON.parse(text);
  if (!json || json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    throw new Error("GeoJSON moet een FeatureCollection zijn.");
  }

  const points: ObservationPoint[] = [];
  let bounds: MapBounds | null = null;

  for (const feat of json.features) {
    if (!feat || feat.type !== "Feature" || !feat.geometry) continue;
    const geom = feat.geometry;
    if (geom.type !== "Point" || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) continue;
    const [lon, lat] = geom.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const attrs = feat.properties && typeof feat.properties === "object"
      ? { ...feat.properties }
      : {};
    const dateStart = attrs?.datm_start || attrs?.dateStart;
    const dateStop = attrs?.datm_stop || attrs?.dateStop;

    points.push({
      x: lon,
      y: lat,
      dateStart,
      dateStop,
      attributes: attrs,
      recordIndex: points.length
    });
    bounds = updateBounds(bounds, lon, lat);
  }

  if (!bounds) {
    bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { points, bounds };
}
