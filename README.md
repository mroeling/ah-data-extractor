# AH Data Extractor

Browser-based data filter and exporter for shapefile/GeoJSON registrations. Upload a shapefile (.shp + optional .dbf) or GeoJSON, filter records, page through the results (10/25/50), and export the filtered set as CSV or GeoJSON.

## Getting started

```bash
npm install
npm run dev
```

Open the dev server URL from the console (defaults to http://localhost:5173).

## Usage

- Upload a shapefile (.shp) and optionally the matching .dbf to bring all attributes into the table, or upload a GeoJSON file directly.
- Use filters to search text across attributes, set a date range, and optionally constrain by coordinate bounds. Toggle pagination size between 10, 25, or 50 rows.
- Each row provides a quick Google Maps link (RD is converted to WGS84).
- Export the filtered rows to CSV, Excel (.xls), or GeoJSON.

The `shp/` folder contains a sample shapefile for local testing.

## Scripts

- `npm run dev` – start the Vite dev server
- `npm run build` – production build
- `npm run preview` – preview the production build
- `npm run lint` – type-check the project
