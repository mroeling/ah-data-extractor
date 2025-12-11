import { bindable, customElement, INode } from 'aurelia';
import template from './data-extractor-view.html?raw';
import './data-extractor.css';
import { MapBounds, ObservationPoint, parseShapefile } from '../nest-analysis/shapefile';
import { DbfField, parseDbf } from '../nest-analysis/dbf';
import { parseGeoJsonPoints } from '../nest-analysis/geojson';
import { CRC_TABLE } from './crc-table';

type SourceType = 'shp' | 'geojson';

interface DataRow {
  id: number;
  x: number;
  y: number;
  recordIndex?: number;
  source: SourceType;
  date: string | null;
  attributes: Record<string, string | number | boolean | null>;
}

@customElement({
  name: 'data-extractor-view',
  template
})
export class DataExtractorView {
  @bindable shpFile: File | null = null;
  @bindable dbfFile: File | null = null;
  @bindable geoJsonFile: File | null = null;

  sourceType: SourceType | null = null;
  infoMessage: string | null = null;
  loadError: string | null = null;
  isBusy = false;

  dataRows: DataRow[] = [];
  filteredRows: DataRow[] = [];
  pageRows: DataRow[] = [];
  attributeColumns: string[] = [];
  fieldsFromDbf: DbfField[] = [];

  boundsFromData: MapBounds | null = null;
  boundsInput: MapBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  filters = {
    text: '',
    from: '',
    to: '',
    onlyWithDate: false,
    boundsEnabled: false,
    sortDate: 'none' as 'none' | 'asc' | 'desc'
  };

  pageSizeOptions = [10, 25, 50];
  pageSize = 10;
  currentPage = 1;

  private host: HTMLElement | null = null;

  created(owningView: INode) {
    this.host = owningView as HTMLElement;
  }

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
  }

  get hasData(): boolean {
    return this.dataRows.length > 0;
  }

  get resultSummary(): string {
    if (!this.hasData) return 'Nog geen data geladen.';
    if (!this.filteredRows.length) return 'Geen resultaten na filteren.';
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.filteredRows.length, start + this.pageSize - 1);
    return `${start}–${end} van ${this.filteredRows.length} gefilterde registraties (${this.dataRows.length} totaal).`;
  }

  shpFileChanged(file: File | null) {
    this.sourceType = 'shp';
    this.shpFile = file;
    this.loadData();
  }

  dbfFileChanged(file: File | null) {
    this.dbfFile = file;
    if (this.sourceType === 'shp') {
      this.loadData();
    }
  }

  geoJsonFileChanged(file: File | null) {
    this.sourceType = 'geojson';
    this.geoJsonFile = file;
    this.loadData();
  }

  onFilterChange() {
    this.applyFilters();
  }

  onPageSizeChange(value: string | number) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return;
    if (!this.pageSizeOptions.includes(parsed)) return;
    this.pageSize = parsed;
    this.currentPage = 1;
    this.updatePageRows();
  }

  goToPage(page: number) {
    const safePage = Math.min(Math.max(page, 1), this.pageCount);
    if (safePage !== this.currentPage) {
      this.currentPage = safePage;
      this.updatePageRows();
    }
  }

  changePage(delta: number) {
    this.goToPage(this.currentPage + delta);
  }

  resetFilters() {
    this.filters = { text: '', from: '', to: '', onlyWithDate: false, boundsEnabled: false };
    if (this.boundsFromData) {
      this.boundsInput = { ...this.boundsFromData };
    }
    this.applyFilters();
  }

  async exportCsv() {
    if (!this.filteredRows.length) return;
    const header = ['x', 'y', 'date', ...this.attributeColumns];
    const lines = [header.join(',')];

    for (const row of this.filteredRows) {
      const vals = header.map(col => this.csvEscape(this.getValue(row, col)));
      lines.push(vals.join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    this.downloadBlob(blob, 'registraties.csv');
  }

  async exportExcel() {
    if (!this.filteredRows.length) return;
    const headers = ['#', 'x', 'y', 'date', ...this.attributeColumns];
    const rows = this.filteredRows.map((row, idx) => ([
      (idx + 1).toString(),
      row.x,
      row.y,
      row.date ?? '',
      ...this.attributeColumns.map(col => this.formatValue(row.attributes[col]))
    ]));

    const xlsxBytes = this.buildXlsx([headers, ...rows], 'Registraties');
    const blob = new Blob([xlsxBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    this.downloadBlob(blob, 'registraties.xlsx');
  }

  async exportGeoJson() {
    if (!this.filteredRows.length) return;
    const features = this.filteredRows.map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.x, row.y] },
      properties: {
        ...row.attributes,
        date: row.date,
        source: row.source
      }
    }));

    const collection = { type: 'FeatureCollection', features };
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' });
    this.downloadBlob(blob, 'registraties.geojson');
  }

  googleMapsUrl(row: DataRow): string {
    const { lon, lat } = this.toWgs(row);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '#';
    const latStr = lat.toFixed(6);
    const lonStr = lon.toFixed(6);
    return `https://www.google.com/maps?q=${latStr},${lonStr}`;
  }

  obsUrl(value: unknown): string {
    const raw = this.formatValue(value).trim();
    if (!raw) return '#';
    let url = raw;
    if (url.startsWith('//')) {
      url = `https:${url}`;
    } else if (!/^https?:\/\//i.test(url)) {
      url = `https://${url.replace(/^https?:\/\//i, '')}`;
    } else if (/^http:\/\//i.test(url)) {
      url = url.replace(/^http:\/\//i, 'https://');
    }
    return url;
  }

  obsLabel(value: unknown): string {
    const raw = this.formatValue(value).trim();
    if (!raw) return '-';
    try {
      const url = new URL(this.obsUrl(raw));
      return url.hostname;
    } catch {
      return raw;
    }
  }

  private async loadData() {
    if (!this.shpFile && !this.geoJsonFile) {
      this.resetData();
      return;
    }

    this.setBusy(true);
    this.loadError = null;

    try {
      if (this.sourceType === 'geojson' && this.geoJsonFile) {
        await this.loadGeoJson();
      } else if (this.shpFile) {
        await this.loadShapefile();
      }
      this.applyFilters();
    } catch (err) {
      console.error('Kon data niet laden', err);
      this.loadError = 'Kon data niet laden. Controleer het bestand en probeer opnieuw.';
      this.resetData();
    } finally {
      this.setBusy(false);
    }
  }

  private async loadShapefile() {
    if (!this.shpFile) return;
    const shpBuffer = await this.shpFile.arrayBuffer();
    const parsed = parseShapefile(shpBuffer);

    let dbfData: { records: Record<string, string | number | boolean | null>[]; fields: DbfField[] } | null = null;
    if (this.dbfFile) {
      try {
        const dbfBuffer = await this.dbfFile.arrayBuffer();
        dbfData = parseDbf(dbfBuffer);
        this.fieldsFromDbf = dbfData.fields;
      } catch (err) {
        console.warn('DBF kon niet gelezen worden; attributen worden overgeslagen.', err);
        this.fieldsFromDbf = [];
      }
    } else {
      this.fieldsFromDbf = [];
    }

    const rows: DataRow[] = parsed.points.map((point, idx) => {
      const recordIdx = point.recordIndex ?? idx;
      const attributes = (dbfData?.records[recordIdx] ?? {}) as Record<string, string | number | boolean | null>;
      const date = this.pickDate(point, attributes);
      return {
        id: idx + 1,
        x: point.x,
        y: point.y,
        recordIndex: recordIdx,
        source: 'shp',
        date,
        attributes
      };
    });

    this.dataRows = rows;
    this.boundsFromData = parsed.bounds;
    this.boundsInput = { ...parsed.bounds };
    this.attributeColumns = this.deriveAttributeColumns(rows, this.fieldsFromDbf);
    this.infoMessage = `${rows.length} registraties ingelezen uit shapefile`;
  }

  private async loadGeoJson() {
    if (!this.geoJsonFile) return;
    const text = await this.geoJsonFile.text();
    const parsed = parseGeoJsonPoints(text);

    const rows: DataRow[] = parsed.points.map((point, idx) => {
      const attributes = (point.attributes ?? {}) as Record<string, string | number | boolean | null>;
      const date = this.pickDate(point, attributes);
      return {
        id: idx + 1,
        x: point.x,
        y: point.y,
        recordIndex: point.recordIndex,
        source: 'geojson',
        date,
        attributes
      };
    });

    this.dataRows = rows;
    this.boundsFromData = parsed.bounds;
    this.boundsInput = { ...parsed.bounds };
    this.attributeColumns = this.deriveAttributeColumns(rows);
    this.infoMessage = `${rows.length} registraties ingelezen uit GeoJSON`;
  }

  private applyFilters() {
    const { text, from, to, onlyWithDate, boundsEnabled } = this.filters;
    const search = text.trim().toLowerCase();
    const hasBounds = boundsEnabled && this.isValidBounds(this.boundsInput);

    const filtered = this.dataRows.filter(row => {
      const rowDate = this.normalizeDate(
        row.date ||
        row.attributes?.datm_start ||
        row.attributes?.dateStart ||
        row.attributes?.date
      );
      if (onlyWithDate && !rowDate) return false;
      if (from && rowDate && rowDate < from) return false;
      if (to && rowDate && rowDate > to) return false;

      if (hasBounds) {
        const { minX, minY, maxX, maxY } = this.boundsInput;
        if (row.x < minX || row.x > maxX || row.y < minY || row.y > maxY) {
          return false;
        }
      }

      if (search) {
        const haystack = this.buildSearchHaystack(row);
        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    const sorted = this.sortByDate(filtered, this.filters.sortDate);

    this.filteredRows = sorted;
    this.currentPage = 1;
    this.updatePageRows();
  }

  private updatePageRows() {
    const start = (this.currentPage - 1) * this.pageSize;
    this.pageRows = this.filteredRows.slice(start, start + this.pageSize);
  }

  private sortByDate(rows: DataRow[], direction: 'none' | 'asc' | 'desc'): DataRow[] {
    if (direction === 'none') return [...rows];
    return [...rows].sort((a, b) => {
      const da = this.normalizeDate(a.date) ?? '';
      const db = this.normalizeDate(b.date) ?? '';
      if (da === db) return 0;
      return direction === 'asc' ? (da < db ? -1 : 1) : (da > db ? -1 : 1);
    });
  }

  private toWgs(row: DataRow): { lon: number; lat: number } {
    if (row.source === 'geojson') {
      return { lon: row.x, lat: row.y };
    }
    const rd = { x: row.x, y: row.y };
    const wgs = this.rdToWgs(rd);
    return { lon: wgs.x, lat: wgs.y };
  }

  // RD New to WGS84 approximation (matches earlier implementation).
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

  private buildSearchHaystack(row: DataRow): string {
    const parts: string[] = [
      row.x.toString(),
      row.y.toString(),
      row.date ?? ''
    ];
    for (const key of Object.keys(row.attributes)) {
      const val = row.attributes[key];
      parts.push(key, this.formatValue(val));
    }
    return parts.join(' ').toLowerCase();
  }

  private deriveAttributeColumns(rows: DataRow[], orderedFields: DbfField[] = []): string[] {
    const exclude = new Set(['datm_start', 'datm_stop', 'dateStart', 'dateStop', 'date']);
    const cols: string[] = [];
    for (const f of orderedFields) {
      if (!exclude.has(f.name) && !cols.includes(f.name)) {
        cols.push(f.name);
      }
    }
    for (const row of rows) {
      Object.keys(row.attributes).forEach(key => {
        if (!exclude.has(key) && !cols.includes(key)) {
          cols.push(key);
        }
      });
    }
    return cols;
  }

  private pickDate(point: ObservationPoint, attributes: Record<string, string | number | boolean | null>): string | null {
    const start = this.normalizeDate(point.dateStart || attributes?.datm_start || attributes?.dateStart || attributes?.start);
    const stop = this.normalizeDate(point.dateStop || attributes?.datm_stop || attributes?.dateStop || attributes?.stop);
    return start || stop;
  }

  private normalizeDate(input: unknown): string | null {
    if (input === undefined || input === null) return null;
    if (input instanceof Date) {
      return isNaN(input.getTime()) ? null : input.toISOString().slice(0, 10);
    }
    const str = String(input).trim();
    if (!str) return null;
    const digits = str.replace(/\D/g, '');
    if (digits.length === 8) {
      const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      const d = new Date(iso);
      return isNaN(d.getTime()) ? null : iso;
    }
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  private isValidBounds(bounds: MapBounds): boolean {
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  }

  private getValue(row: DataRow, key: string): string | number | boolean | null {
    switch (key) {
      case 'x':
        return row.x;
      case 'y':
        return row.y;
      case 'date':
        return row.date;
      default:
        return row.attributes[key] ?? null;
    }
  }

  private csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '';
    return String(value);
  }

  private buildXlsx(rows: (string | number)[][], sheetName: string): Uint8Array {
    const sheetXml = this.buildSheetXml(rows);
    const workbookXml = this.buildWorkbookXml(sheetName);
    const workbookRels = this.buildWorkbookRels();
    const contentTypes = this.buildContentTypes();
    const rels = this.buildRootRels();

    const files = [
      { path: '[Content_Types].xml', data: this.utf8(contentTypes) },
      { path: '_rels/.rels', data: this.utf8(rels) },
      { path: 'xl/workbook.xml', data: this.utf8(workbookXml) },
      { path: 'xl/_rels/workbook.xml.rels', data: this.utf8(workbookRels) },
      { path: 'xl/worksheets/sheet1.xml', data: this.utf8(sheetXml) },
    ];

    return this.buildZip(files);
  }

  private buildSheetXml(rows: (string | number)[][]): string {
    const cells = (row: (string | number)[], rIdx: number) => row.map((value, cIdx) => {
      const col = this.columnName(cIdx + 1);
      const addr = `${col}${rIdx}`;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${addr}"><v>${value}</v></c>`;
      }
      const text = this.xmlEscape(String(value ?? ''));
      return `<c r="${addr}" t="inlineStr"><is><t>${text}</t></is></c>`;
    }).join('');

    const rowsXml = rows.map((row, idx) => `<row r="${idx + 1}">${cells(row, idx + 1)}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rowsXml}
  </sheetData>
</worksheet>`;
  }

  private buildWorkbookXml(sheetName: string): string {
    const safeName = this.xmlEscape(sheetName || 'Sheet1');
    return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${safeName}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
  }

  private buildWorkbookRels(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  }

  private buildContentTypes(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  }

  private buildRootRels(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  }

  private columnName(index: number): string {
    let n = index;
    let name = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  private buildZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
    const encoder = new TextEncoder();
    let offset = 0;
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];

    for (const file of files) {
      const nameBytes = encoder.encode(file.path);
      const crc = this.crc32(file.data);
      const size = file.data.length;

      const localHeader = new DataView(new ArrayBuffer(30));
      localHeader.setUint32(0, 0x04034b50, true);
      localHeader.setUint16(4, 20, true);
      localHeader.setUint16(6, 0, true);
      localHeader.setUint16(8, 0, true);
      localHeader.setUint16(10, 0, true);
      localHeader.setUint16(12, 0, true);
      localHeader.setUint32(14, crc, true);
      localHeader.setUint32(18, size, true);
      localHeader.setUint32(22, size, true);
      localHeader.setUint16(26, nameBytes.length, true);
      localHeader.setUint16(28, 0, true);

      const localBuf = this.concatBuffers([new Uint8Array(localHeader.buffer), nameBytes, file.data]);
      localParts.push(localBuf);

      const centralHeader = new DataView(new ArrayBuffer(46));
      centralHeader.setUint32(0, 0x02014b50, true);
      centralHeader.setUint16(4, 20, true);
      centralHeader.setUint16(6, 20, true);
      centralHeader.setUint16(8, 0, true);
      centralHeader.setUint16(10, 0, true);
      centralHeader.setUint16(12, 0, true);
      centralHeader.setUint16(14, 0, true);
      centralHeader.setUint32(16, crc, true);
      centralHeader.setUint32(20, size, true);
      centralHeader.setUint32(24, size, true);
      centralHeader.setUint16(28, nameBytes.length, true);
      centralHeader.setUint16(30, 0, true);
      centralHeader.setUint16(32, 0, true);
      centralHeader.setUint16(34, 0, true);
      centralHeader.setUint16(36, 0, true);
      centralHeader.setUint32(38, 0, true);
      centralHeader.setUint32(42, offset, true);

      const centralBuf = this.concatBuffers([new Uint8Array(centralHeader.buffer), nameBytes]);
      centralParts.push(centralBuf);

      offset += localBuf.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const centralOffset = offset;
    const endHeader = new DataView(new ArrayBuffer(22));
    endHeader.setUint32(0, 0x06054b50, true);
    endHeader.setUint16(4, 0, true);
    endHeader.setUint16(6, 0, true);
    endHeader.setUint16(8, files.length, true);
    endHeader.setUint16(10, files.length, true);
    endHeader.setUint32(12, centralSize, true);
    endHeader.setUint32(16, centralOffset, true);
    endHeader.setUint16(20, 0, true);

    const output = this.concatBuffers([
      ...localParts,
      ...centralParts,
      new Uint8Array(endHeader.buffer)
    ]);
    return output;
  }

  private concatBuffers(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  private utf8(input: string): Uint8Array {
    return new TextEncoder().encode(input);
  }

  private crc32(data: Uint8Array): number {
    let crc = 0 ^ (-1);
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
    }
    return (crc ^ (-1)) >>> 0;
  }

  private xmlEscape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  resetData() {
    this.dataRows = [];
    this.filteredRows = [];
    this.pageRows = [];
    this.attributeColumns = [];
    this.boundsFromData = null;
    this.boundsInput = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.fieldsFromDbf = [];
    this.infoMessage = null;
    this.loadError = null;
  }

  private setBusy(state: boolean) {
    this.isBusy = state;
    this.host?.classList?.toggle('is-busy', state);
    if (typeof document !== 'undefined' && document.body) {
      document.body.style.cursor = state ? 'progress' : 'default';
    }
  }
}
