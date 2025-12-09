// src/components/nest-heatmap-view.ts
import { bindable, customElement, INode } from 'aurelia';
import template from './nest-heatmap-view.html?raw';
import {
  computeNestHeatmap,
  HeatmapConfig,
  HeatmapResult
} from '../nest-analysis/nest-heatmap';
import {
  MapBounds,
  ObservationPoint,
  parseShapefile
} from '../nest-analysis/shapefile';
import { parseDbfDates } from '../nest-analysis/dbf';
import { parseGeoJsonPoints } from '../nest-analysis/geojson';
import './nest-heatmap.css';

@customElement({
  name: 'nest-heatmap-view', // <nest-heatmap-view> in index.html
  template,
})
export class NestHeatmapView {
  @bindable baseFile: File | null = null;
  @bindable shpFile: File | null = null;
  @bindable dbfFile: File | null = null;
  @bindable geoJsonFile: File | null = null;
  baseSource: 'online' | 'upload' = 'online';

  config: HeatmapConfig = {
    treeScore: 1.0,
    grassScore: 0.15,
    nearWaterBonus: 0.1,
    wObs: 0.8,
    treeColor: { r: 0xdc, g: 0xeb, b: 0xcd },
    grassColor: { r: 0xe8, g: 0xf0, b: 0xdc },
    waterColor: { r: 0xd5, g: 0xe8, b: 0xeb },
    treeTolerance: 45,
    grassTolerance: 45,
    waterTolerance: 32,
    smoothPixels: 20,
    coveragePx: 90,
    isoLevels: [0.5, 0.75, 0.9],
    heatColor: { r: 180, g: 0, b: 200 },
    minAlpha: 80,
    gamma: 0.6
  };

  isoString = '0.5,0.75,0.9';

  heatmapUrl: string | null = null;
  isoUrl: string | null = null;
  isBusy = false;

  observationsAll: ObservationPoint[] = [];
  observationsFiltered: ObservationPoint[] = [];
  shpBounds: MapBounds | null = null;
  boundsInput: MapBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  shapefileInfo: string | null = null;

  fromDate = '';
  toDate = '';
  boundsCrs: 'rd' | 'wgs84' = 'rd';
  observationSource: 'shp' | 'geojson' = 'shp';
  private host: HTMLElement | null = null;
  private rootEl: HTMLElement | null = null;

  created(owningView: INode) {
    this.host = owningView as HTMLElement;
  }

  baseFileChanged(newFile: File | null) {
    this.baseFile = newFile;
  }

  shpFileChanged(newFile: File | null) {
    this.shpFile = newFile;
    this.observationSource = 'shp';
    this.loadObservationData();
  }

  dbfFileChanged(newFile: File | null) {
    this.dbfFile = newFile;
    this.loadObservationData();
  }

  geoJsonFileChanged(newFile: File | null) {
    this.geoJsonFile = newFile;
    this.observationSource = 'geojson';
    this.loadObservationData();
  }

  isoStringChanged(newValue: string) {
    if (!newValue) {
      this.config.isoLevels = [];
      return;
    }

    const parts = newValue
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v) && v > 0 && v < 1);

    if (parts.length) {
      this.config.isoLevels = parts;
    }
  }

  get canRun(): boolean {
    const hasObs = this.observationSource === 'geojson'
      ? !!this.geoJsonFile
      : !!this.shpFile;
    const hasBase = this.baseSource === 'upload' ? !!this.baseFile : true;
    return hasObs && hasBase;
  }

  get canExport(): boolean {
    return !!this.shpFile;
  }

  async run(event?: Event) {
    if (event) {
      event.preventDefault();
    }

    // Make sure we use the latest date selection even if bindings didn't trigger yet.
    const filtered = this.filterObservationsByDate();
    this.observationsFiltered = filtered;
    this.updateInfoMessage();

    if (this.observationSource === 'geojson' && !this.geoJsonFile) {
      console.warn('GeoJSON met registraties is nodig.');
      return;
    }
    if (this.observationSource === 'shp' && !this.shpFile) {
      console.warn('Shapefile (.shp) is nodig.');
      return;
    }

    try {
      this.setBusy(true);
      if (!this.observationsFiltered.length) {
        console.warn('Geen registraties binnen de geselecteerde periode.');
        return;
      }

      const bounds = this.resolveBounds() ?? this.shpBounds;
      if (!bounds) {
        console.warn('Kaart-extents ontbreken of zijn ongeldig.');
        return;
      }

      const mappedData = await this.prepareBaseMapAndData(bounds, this.observationsFiltered);
      if (!mappedData) {
        return;
      }

      const result: HeatmapResult = computeNestHeatmap(
        mappedData.baseImg,
        mappedData.observations,
        mappedData.mapBounds,
        this.config
      );

      this.heatmapUrl = result.heatmapCanvas.toDataURL('image/png');
      this.isoUrl = result.isoCanvas.toDataURL('image/png');
    } catch (err) {
      console.error('Error while computing heatmap:', err);
    } finally {
      this.setBusy(false);
    }
  }

  private async prepareBaseMapAndData(bounds: MapBounds, points: ObservationPoint[]): Promise<{ baseImg: HTMLImageElement; mapBounds: MapBounds; observations: ObservationPoint[] } | null> {
    if (this.baseSource === 'online') {
      const boundsWgs = this.ensureWgsBounds(bounds);
      const fetched = await this.fetchCartoBaseMap(boundsWgs);
      const mapped = this.prepareDataForWebMerc(fetched.webMercBounds, points);
      return {
        baseImg: fetched.image,
        mapBounds: fetched.webMercBounds,
        observations: mapped.observations
      };
    }

    if (!this.baseFile) {
      console.warn('Basiskaart is nodig.');
      return null;
    }

    const mapped = this.prepareDataForMap(bounds, points);
    const baseImg = await this.loadImageFromFile(this.baseFile);
    const boundsMatched = this.matchBoundsToImage(mapped.bounds, baseImg);

    return {
      baseImg,
      mapBounds: boundsMatched,
      observations: mapped.observations
    };
  }

  private prepareDataForMap(bounds: MapBounds, points: ObservationPoint[]): { bounds: MapBounds; observations: ObservationPoint[] } {
    if (this.boundsCrs === 'rd') {
      return { bounds, observations: points };
    }

    const boundsWgs = this.ensureWgsBounds(bounds);
    const boundsWebMerc = this.boundsToWebMerc(boundsWgs);

    const observations = points.map(p => {
      const asWgs = this.observationSource === 'shp'
        ? this.rdToWgsObservation(p)
        : p;
      return this.wgsToWebMercObservation(asWgs);
    });

    return { bounds: boundsWebMerc, observations };
  }

  private prepareDataForWebMerc(bounds: MapBounds, points: ObservationPoint[]): { bounds: MapBounds; observations: ObservationPoint[] } {
    const boundsWgs = this.ensureWgsBounds(bounds);
    const boundsWebMerc = this.boundsToWebMerc(boundsWgs);

    const observations = points.map(p => {
      const asWgs = this.observationSource === 'shp'
        ? this.rdToWgsObservation(p)
        : p;
      return this.wgsToWebMercObservation(asWgs);
    });

    return { bounds: boundsWebMerc, observations };
  }

  private matchBoundsToImage(bounds: MapBounds, img: HTMLImageElement): MapBounds {
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;
    if (!imgW || !imgH) return bounds;

    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (width <= 0 || height <= 0) return bounds;

    const targetRatio = imgW / imgH;
    const boundsRatio = width / height;
    if (Math.abs(boundsRatio - targetRatio) < 1e-4) {
      return bounds;
    }

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;

    if (boundsRatio < targetRatio) {
      // bounds too tall; expand width to match image aspect
      const newWidth = targetRatio * height;
      return {
        minX: cx - newWidth / 2,
        maxX: cx + newWidth / 2,
        minY: bounds.minY,
        maxY: bounds.maxY
      };
    }

    // bounds too wide; expand height
    const newHeight = width / targetRatio;
    return {
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: cy - newHeight / 2,
      maxY: cy + newHeight / 2
    };
  }

  // RD New to WGS84 (approximate), matching the standard formula.
  private rdToWgs(point: { x: number; y: number }): { x: number; y: number } {
    const X0 = 155000.0;
    const Y0 = 463000.0;
    const phi0 = 52.15517440;
    const lam0 = 5.38720621;
    const K = [
      [0, 1, 3235.65389], [2, 0, -32.58297], [0, 2, -0.2475],
      [2, 1, -0.84978], [0, 3, -0.0655], [2, 2, -0.01709],
      [1, 0, -0.00738], [4, 0, 0.0053], [2, 3, -0.00039],
      [4, 1, 0.00033], [1, 1, -0.00012],
    ];
    const L = [
      [1, 0, 5260.52916], [1, 1, 105.94684], [1, 2, 2.45656],
      [3, 0, -0.81885], [1, 3, 0.05594], [3, 1, -0.05607],
      [0, 1, 0.01199], [3, 2, -0.00256], [1, 4, 0.00128],
      [0, 2, 0.00022], [2, 0, -0.00022], [5, 0, 0.00026],
    ];

    const dx = (point.x - X0) / 100000.0;
    const dy = (point.y - Y0) / 100000.0;

    let phi = phi0;
    let lam = lam0;
    for (const [p, q, c] of K) {
      phi += (c * Math.pow(dx, p) * Math.pow(dy, q)) / 3600.0;
    }
    for (const [p, q, c] of L) {
      lam += (c * Math.pow(dx, p) * Math.pow(dy, q)) / 3600.0;
    }
    return { x: lam, y: phi };
  }

  private rdToWgsObservation(p: ObservationPoint): ObservationPoint {
    const conv = this.rdToWgs({ x: p.x, y: p.y });
    return { ...p, x: conv.x, y: conv.y };
  }

  private wgsToWebMerc(point: { x: number; y: number }): { x: number; y: number } {
    const lon = point.x;
    const lat = Math.max(Math.min(point.y, 85.05112878), -85.05112878);
    const x = lon * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 20037508.34 / Math.PI;
    return { x, y };
  }

  private wgsToWebMercObservation(p: ObservationPoint): ObservationPoint {
    const merc = this.wgsToWebMerc({ x: p.x, y: p.y });
    return { ...p, x: merc.x, y: merc.y };
  }

  private ensureWgsBounds(bounds: MapBounds): MapBounds {
    const looksLikeWgs =
      Math.abs(bounds.minX) <= 180 &&
      Math.abs(bounds.maxX) <= 180 &&
      Math.abs(bounds.minY) <= 90 &&
      Math.abs(bounds.maxY) <= 90;

    if (looksLikeWgs) {
      return bounds;
    }

    const sw = this.rdToWgs({ x: bounds.minX, y: bounds.minY });
    const ne = this.rdToWgs({ x: bounds.maxX, y: bounds.maxY });
    return {
      minX: sw.x,
      minY: sw.y,
      maxX: ne.x,
      maxY: ne.y
    };
  }

  private boundsToWebMerc(bounds: MapBounds): MapBounds {
    const sw = this.wgsToWebMerc({ x: bounds.minX, y: bounds.minY });
    const ne = this.wgsToWebMerc({ x: bounds.maxX, y: bounds.maxY });
    return {
      minX: sw.x,
      minY: sw.y,
      maxX: ne.x,
      maxY: ne.y
    };
  }

  private lonLatToTileX(lon: number, zoom: number): number {
    const n = Math.pow(2, zoom);
    return ((lon + 180) / 360) * n;
  }

  private latToTileY(lat: number, zoom: number): number {
    const n = Math.pow(2, zoom);
    const latRad = (Math.max(Math.min(lat, 85.05112878), -85.05112878) * Math.PI) / 180;
    return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  }

  private tileXToLon(x: number, zoom: number): number {
    const n = Math.pow(2, zoom);
    return (x / n) * 360 - 180;
  }

  private tileYToLat(y: number, zoom: number): number {
    const n = Math.pow(2, zoom);
    const mercN = Math.PI - (2 * Math.PI * y) / n;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(mercN) - Math.exp(-mercN)));
  }

  private computeTileSpan(boundsWgs: MapBounds, zoom: number) {
    const tileMinX = Math.floor(this.lonLatToTileX(boundsWgs.minX, zoom));
    const tileMaxX = Math.floor(this.lonLatToTileX(boundsWgs.maxX, zoom));
    const tileMinY = Math.floor(this.latToTileY(boundsWgs.maxY, zoom));
    const tileMaxY = Math.floor(this.latToTileY(boundsWgs.minY, zoom));

    const widthTiles = tileMaxX - tileMinX + 1;
    const heightTiles = tileMaxY - tileMinY + 1;
    const tileSize = 256;

    return {
      minX: tileMinX,
      maxX: tileMaxX,
      minY: tileMinY,
      maxY: tileMaxY,
      widthPx: widthTiles * tileSize,
      heightPx: heightTiles * tileSize
    };
  }

  private pickTileZoom(boundsWgs: MapBounds): number {
    const maxZoom = 17;
    const minZoom = 4;
    const targetPx = 1536;

    for (let z = maxZoom; z >= minZoom; z--) {
      const span = this.computeTileSpan(boundsWgs, z);
      if (span.widthPx <= targetPx && span.heightPx <= targetPx) {
        return z;
      }
    }

    return minZoom;
  }

  private async fetchCartoBaseMap(boundsWgs: MapBounds): Promise<{ image: HTMLImageElement; webMercBounds: MapBounds }> {
    const zoom = this.pickTileZoom(boundsWgs);
    const span = this.computeTileSpan(boundsWgs, zoom);
    const canvas = document.createElement('canvas');
    canvas.width = span.widthPx;
    canvas.height = span.heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Kon geen canvas context maken voor basiskaart.');
    }

    const subs = ['a', 'b', 'c', 'd'];
    const tileSize = 256;
    const jobs: Promise<void>[] = [];

    for (let ty = span.minY; ty <= span.maxY; ty++) {
      for (let tx = span.minX; tx <= span.maxX; tx++) {
        const sub = subs[(tx + ty) % subs.length];
        const url = `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}.png`;
        const px = (tx - span.minX) * tileSize;
        const py = (ty - span.minY) * tileSize;

        const drawTile = async () => {
          const img = await this.loadImageFromUrl(url, true);
          ctx.drawImage(img, px, py, tileSize, tileSize);
        };

        jobs.push(drawTile());
      }
    }

    await Promise.all(jobs);

    const stitchedUrl = canvas.toDataURL('image/png');
    const image = await this.loadImageFromUrl(stitchedUrl, false);

    const westLon = this.tileXToLon(span.minX, zoom);
    const eastLon = this.tileXToLon(span.maxX + 1, zoom);
    const northLat = this.tileYToLat(span.minY, zoom);
    const southLat = this.tileYToLat(span.maxY + 1, zoom);

    const sw = this.wgsToWebMerc({ x: westLon, y: southLat });
    const ne = this.wgsToWebMerc({ x: eastLon, y: northLat });

    const webMercBounds: MapBounds = {
      minX: sw.x,
      minY: sw.y,
      maxX: ne.x,
      maxY: ne.y
    };

    return { image, webMercBounds };
  }

  // RD shapefile -> WGS84 GeoJSON download (points only)
  async exportShpToGeoJson() {
    if (!this.shpFile) {
      console.warn('Geen shapefile geselecteerd.');
      return;
    }
    try {
      this.setBusy(true);
      const shpBuffer = await this.shpFile.arrayBuffer();
      const parsedShp = parseShapefile(shpBuffer);

      let dates: ReturnType<typeof parseDbfDates> | null = null;
      if (this.dbfFile) {
        try {
          const dbfBuffer = await this.dbfFile.arrayBuffer();
          dates = parseDbfDates(dbfBuffer);
        } catch (err) {
          console.warn('DBF kon niet gelezen worden; datums worden overgeslagen.', err);
        }
      }

      const features = parsedShp.points.map((p, idx) => {
        const dateInfo = dates && dates[idx] ? dates[idx] : undefined;
        const wgs = this.rdToWgs({ x: p.x, y: p.y });
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [wgs.x, wgs.y] },
          properties: {
            datm_start: dateInfo?.start ?? null,
            datm_stop: dateInfo?.stop ?? null
          }
        };
      });

      const fc = {
        type: 'FeatureCollection',
        features
      };

      const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'registrations_wgs84.geojson';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Kon shapefile niet converteren naar GeoJSON:', err);
    } finally {
      this.setBusy(false);
    }
  }

  private loadImageFromUrl(url: string, useCors: boolean): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (useCors) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  }

  private loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  private resolveBounds(): MapBounds | null {
    if (!this.boundsInput) return null;
    const parsed: MapBounds = {
      minX: Number((this.boundsInput as MapBounds).minX),
      minY: Number((this.boundsInput as MapBounds).minY),
      maxX: Number((this.boundsInput as MapBounds).maxX),
      maxY: Number((this.boundsInput as MapBounds).maxY)
    };

    const hasNaN = Object.values(parsed).some(v => Number.isNaN(v));
    const width = parsed.maxX - parsed.minX;
    const height = parsed.maxY - parsed.minY;
    if (hasNaN || width <= 0 || height <= 0) {
      return null;
    }
    return parsed;
  }

  private async loadObservationData() {
    if (this.observationSource === 'geojson') {
      if (!this.geoJsonFile) {
        this.resetObservations();
        return;
      }
      try {
        const text = await this.geoJsonFile.text();
        const parsed = parseGeoJsonPoints(text);
        this.observationsAll = parsed.points;
        this.shpBounds = parsed.bounds;
        this.boundsInput = { ...parsed.bounds };
        this.boundsCrs = 'wgs84';
        this.ensureDefaultDateRange();
        this.applyDateFilter();
        this.updateInfoMessage();
      } catch (err) {
        console.error('Kon GeoJSON niet lezen:', err);
        this.resetObservations('Fout bij inlezen GeoJSON');
      }
      return;
    }

    if (!this.shpFile) {
      this.resetObservations();
      return;
    }

    try {
      const shpBuffer = await this.shpFile.arrayBuffer();
      const parsedShp = parseShapefile(shpBuffer);

      let dates: ReturnType<typeof parseDbfDates> | null = null;
      if (this.dbfFile) {
        try {
          const dbfBuffer = await this.dbfFile.arrayBuffer();
          dates = parseDbfDates(dbfBuffer);
        } catch (err) {
          console.warn('DBF kon niet gelezen worden; datums worden overgeslagen.', err);
        }
      }

      const obs: ObservationPoint[] = parsedShp.points.map((p, idx) => {
        const dateInfo = dates && dates[idx] ? dates[idx] : undefined;
        return {
          ...p,
          dateStart: dateInfo?.start,
          dateStop: dateInfo?.stop
        };
      });

      this.observationsAll = obs;
      this.shpBounds = parsedShp.bounds;
      this.boundsInput = { ...parsedShp.bounds };
      this.boundsCrs = 'rd';

      this.ensureDefaultDateRange();
      this.applyDateFilter();
      this.updateInfoMessage();
    } catch (err) {
      console.error('Kon shapefile niet lezen:', err);
      this.resetObservations('Fout bij inlezen shapefile');
    }
  }

  private resetObservations(message: string | null = null) {
    this.observationsAll = [];
    this.observationsFiltered = [];
    this.shpBounds = null;
    this.boundsInput = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.shapefileInfo = message;
  }

  private ensureDefaultDateRange() {
    const now = new Date();
    const year = now.getFullYear();
    const defaultFrom = `${year}-01-01`;
    const defaultTo = `${year}-12-31`;

    if (!this.fromDate) {
      this.fromDate = defaultFrom;
    }
    if (!this.toDate) {
      this.toDate = defaultTo;
    }
  }

  fromDateChanged() {
    this.applyDateFilter();
  }

  toDateChanged() {
    this.applyDateFilter();
  }

  private filterObservationsByDate(): ObservationPoint[] {
    const hasDates = this.observationsAll.some(o => !!o.dateStart);
    if (!hasDates) {
      return [...this.observationsAll];
    }

    const from = this.parseDate(this.fromDate);
    const to = this.parseDate(this.toDate);

    return this.observationsAll.filter(obs => {
      if (!from && !to) return true;
      if (!obs.dateStart) return false;

      const obsDate = this.parseDate(obs.dateStart);
      if (!obsDate) return false;

      if (from && obsDate < from) return false;
      if (to && obsDate > to) return false;
      return true;
    });
  }

  private applyDateFilter() {
    this.observationsFiltered = this.filterObservationsByDate();
    this.updateInfoMessage();
  }

  private parseDate(input: string | number | Date | undefined | null): Date | null {
    if (input instanceof Date) {
      return isNaN(input.getTime()) ? null : input;
    }
    if (input === undefined || input === null) {
      return null;
    }

    const str = String(input).trim();
    if (!str) return null;

    // Accept YYYYMMDD, YYYY-MM-DD, or ISO strings with time.
    const clean = str.includes('-')
      ? str.slice(0, 10)
      : `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;

    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
  }

  private updateInfoMessage() {
    const total = this.observationsAll.length;
    const filtered = this.filterObservationsByDate().length;
    if (!total) {
      this.shapefileInfo = null;
      return;
    }

    const from = this.fromDate || '...';
    const to = this.toDate || '...';
    const hasDates = this.observationsAll.some(o => !!o.dateStart);
    const suffix = hasDates
      ? ''
      : ' (geen datumvelden gevonden; filter wordt niet toegepast)';
    this.shapefileInfo = `${filtered} van ${total} registraties binnen selectie (${from} t/m ${to}).${suffix}`;
  }

  private setBusy(state: boolean) {
    this.isBusy = state;
    this.host?.classList?.toggle('is-busy', state);
    this.rootEl?.classList?.toggle('is-busy', state);
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.cursor = state ? 'progress' : 'default';
    }
  }
}
