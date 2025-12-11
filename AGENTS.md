# AGENTS.md

> Internal guide for AI coding agents (OpenAI Codex / ChatGPT) working on this repo.

---

## 1. Project overview

**Goal:** Browser-based data extractor (TypeScript + Aurelia 2 + Vite) that ingests shapefile/GeoJSON registrations, lets users filter and page through the data, and exports the filtered set to CSV, Excel, or GeoJSON. Heatmap functionality has been removed.

Key behaviours:
- Accept shapefile (.shp) with optional .dbf attribute table; GeoJSON is an alternative input.
- Preserve record order; `recordIndex` links shapefile geometries to DBF rows.
- Filters: text search across attributes, date range filter (start/stop), optional coordinate bounds, and pagination sizes 10/25/50.
- Per-row Google Maps link; shapefile (RD) coords are converted to WGS84 for the link.
- Exports: filtered rows to CSV, Excel (.xls), or GeoJSON.

---

## 2. Tech stack & skeleton

- **Language:** TypeScript
- **Framework:** Aurelia 2
- **Bundler/dev server:** Vite
- **Target:** Browser-only (no backend)

---

## 3. Data flow

1. **Parse shapefile (.shp)**  
   `src/nest-analysis/shapefile.ts` reads Point/MultiPoint/Polyline/Polygon, returns centroids/points with bounds and `recordIndex` to keep DBF alignment.

2. **Attributes (.dbf)**  
   `src/nest-analysis/dbf.ts` exposes `parseDbf` for all fields (strings/numbers/booleans/dates) and `parseDbfDates` compatibility helper. Records are kept in shapefile order (deleted rows become empty objects).

3. **GeoJSON input**  
   `src/nest-analysis/geojson.ts` parses Point FeatureCollections, keeps properties, bounds, and assigns `recordIndex`.

4. **UI + filtering/export**  
   `src/components/data-extractor-view.ts/.html/.css` combine geometry + attributes, apply filters (search, date range, coordinate bounds), paginate (10/25/50), and export the filtered rows to CSV/GeoJSON. `src/main.ts` boots this component.

---

## 4. Dev workflow

1. `npm install`
2. `npm run dev`
3. Use the sample shapefile in `shp/` for local testing.

Verify that uploads load into the table, filters update counts, pagination works for 10/25/50 rows, and exports reflect the filtered subset.
