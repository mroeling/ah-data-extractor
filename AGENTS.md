# AGENTS.md

> Internal guide for AI coding agents (OpenAI Codex / ChatGPT) working on this repo.

---

## 1. Project overview

**Goal:**
Browser-based nest probability tool (TypeScript + Aurelia 2 + Vite) that:

1. Takes **registrations from a shapefile** (RD New / EPSG:28992) and a **clean base map image** of the same area.
2. Produces:
   - A **bare heatmap** showing likely hornet nest zones (ecology × ability to explain observations).
   - A **heatmap with iso-score lines** (e.g. 50%, 75%, 90%).

The tool is exploratory: it highlights **where to search**, not an exact nest coordinate.

Local development will use **OpenAI’s Codex / ChatGPT** to generate and refactor code.

---

## 2. Tech stack & skeleton

- **Language:** TypeScript
- **Framework:** Aurelia 2
- **Bundler/dev server:** Vite
- **Rendering:** HTML Canvas 2D
- **Target:** Browser-only (no backend)

Assume a basic Aurelia 2 + Vite skeleton exists with a view/component for the heatmap feature. Do **not** change the build setup unless asked.

---

## 3. Core feature: shapefile-driven nest probability heatmap

### Inputs

- **Shapefile (.shp)** with hornet registrations in RD New (EPSG:28992). Polygons/lines are reduced to centroids; points are used directly.
- **Base map image** of the same geographic extent (no observations), used for ecological analysis and rendering.
- **Map bounds (minX, minY, maxX, maxY)** in meters for the base map. Default comes from the shapefile bounding box but can be overridden in the UI if the image shows a different cutout.

### Outputs

- `heatmapCanvas`: base map + semi-transparent heat overlay.
- `isoCanvas`: heatmap + grey iso-score lines (default 0.5, 0.75, 0.9).

Both canvases are converted to PNG data URLs in the view.

**Date filtering**
- Default filter: current calendar year (from/to inputs in the UI).
- User can override with a custom period; filtering uses `datm_start` from the DBF. Records without a date are included only if no date filter is set.

---

## 4. Algorithm (browser / TypeScript)

Implementation lives in `src/nest-analysis` and mirrors the validated Python logic, adjusted for shapefile input.

1. **Parse shapefile**
   - `src/nest-analysis/shapefile.ts` parses Point/MultiPoint/Polyline/Polygon.
   - Polygons: area-weighted centroid per part; polylines: average of vertices.
   - Returns `ObservationPoint[]` and `MapBounds`.

2. **Map coordinates → pixels**
   - Convert map coords (meters) to pixel coords on the base image using the provided bounds.
   - Filter observations outside the bounds.
   - Derive meters-per-pixel from bounds vs. image size.

3. **Domain mask**
   - Union of circles around each observation with radius `coverageKm` (converted to pixels using meters-per-pixel average).

4. **Ecological suitability (on the clean base map)**
   - Convert image to `ImageData`.
   - Classify per pixel:
     - **Trees**: muted greens (`h` 80–150, `s` 10–55, `l` 20–55) → `treeScore`.
     - **Grass**: brighter greens (`h` 70–140, `s` ≥ 40, `l` ≥ 55) → `grassScore`.
     - **Water**: blue-dominant (`B > G + 15` and `B > R + 15`) → 0.
   - Filter text-like thin clusters out of the tree mask.
   - **Water proximity bonus:** add up to `nearWaterBonus` within ~250 m (converted to px) but never on water.

5. **Coverage (2 km rule)**
   - For each pixel in the domain mask, compute the fraction of observations within `coverageKm` (in pixels).

6. **Base score**
   - `raw = eco * coverageFactor` (with `wObs = 0.8` weighting).
   - Normalize to `[0,1]`.

7. **Local smoothing**
   - Gaussian blur with radius = `smoothMeters` converted to pixels (meters-per-pixel avg).
   - Renormalize within the domain mask to `[0,1]` → `localNorm`.

8. **Heatmap rendering**
   - Apply gamma (`value^gamma`), alpha floor (`minAlpha`), and blend `heatColor` over the base map.
   - Draw small white crosses at each observation location.

9. **Iso-score lines**
   - For each `isoLevel` in `(0,1)`: threshold `localNorm`, erode with a 3×3 kernel, and paint edge pixels grey.
   - Also draw observation crosses.

---

## 5. Configurability (UI bindings)

- **Heatmap color:** `heatColor.r/g/b`
- **Ecological scores:** `treeScore`, `grassScore`, `nearWaterBonus`
- **Distances (pixels):** `coveragePx` (slider + numeric), `smoothPixels`
- **Iso-levels:** editable list via comma string (e.g. `0.5,0.75,0.9`)
- **Map bounds:** editable numeric inputs (`minX`, `minY`, `maxX`, `maxY`) defaulted from the shapefile

All values must be bound via Aurelia (e.g. `value.bind="config.treeScore"`).

---

## 6. File layout & responsibilities

- `src/nest-analysis/shapefile.ts`
  - Minimal parser for .shp files → `ObservationPoint[]`, `MapBounds`. Keeps record order.
- `src/nest-analysis/dbf.ts`
  - Reads .dbf to extract date fields (`datm_start`, `datm_stop`) aligned with shapefile record order.
- `src/nest-analysis/nest-heatmap.ts`
  - Interfaces: `HeatmapConfig`, `HeatmapResult`, `MapBounds`, `ObservationPoint` (includes optional `dateStart`/`dateStop`).
  - Main entrypoint: `computeNestHeatmap(baseImg: HTMLImageElement, observations: ObservationPoint[], mapBounds: MapBounds, config: HeatmapConfig): HeatmapResult`.
  - Pure analysis/rendering logic (no Aurelia imports or DOM queries beyond canvas creation).
- `src/components/nest-heatmap-view.ts` / `.html`
  - Handles shapefile + DBF + base image uploads, map bounds inputs, CRS selection (RD default; optional WGS84 for WebMerc/OSM exports), date filters (default current year), config bindings, and calls `computeNestHeatmap`.
  - Stores `heatmapUrl` / `isoUrl`.
  - Template is imported with `?raw` for runtime compilation (avoids Vite HTML parser issues).

Keep numeric “magic” at the top or in config, avoid `any`, and stick to Canvas 2D + raw pixel loops (no OpenCV).

---

## 7. Dev workflow

1. `npm install` then `npm run dev`.
2. Use the sample shapefile in `shp/` for local testing.
3. Verify:
   - Registrations are read from the shapefile (counts match).
   - Heatmap overlays the clean base map.
   - Iso-lines appear at configured levels.
   - Map bounds edits shift/scale observation positions correctly.

---

## 8. Style & naming

- Code comments in **English**. UI labels may be in **Dutch**.
- Use descriptive names (`parseShapefile`, `mapCoordsToPixels`, `renderIsoLines`).
- Keep the public API limited to the `computeNestHeatmap` entrypoint noted above.

Respect the algorithm here unless explicitly asked to change it. The goal is parity with the validated Python logic while using shapefile-based registrations. 



## IGNORE
codex resume 019afffa-418e-7211-b733-ed4f675c5cb6
## END IGNORE