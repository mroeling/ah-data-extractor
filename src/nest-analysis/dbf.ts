// src/nest-analysis/dbf.ts
// Minimal DBF reader that can expose all fields and help extract date columns.

export interface RecordDates {
  start?: string; // YYYYMMDD
  stop?: string;  // YYYYMMDD
}

export interface DbfField {
  name: string;
  type: string;
  size: number;
  decimals: number;
  offset: number;
}

export interface ParsedDbf {
  records: Record<string, string | number | boolean | null>[];
  fields: DbfField[];
}

function parseHeader(view: DataView) {
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  return { recordCount, headerLength, recordLength };
}

function parseFields(view: DataView, headerLength: number): DbfField[] {
  const fields: DbfField[] = [];
  let offset = 32;
  let recordOffset = 1; // first byte is deletion flag

  while (offset + 32 <= headerLength - 1) {
    const nameBytes = new Uint8Array(view.buffer, offset, 11);
    const zeroIdx = nameBytes.indexOf(0);
    const name = new TextDecoder("ascii").decode(
      zeroIdx >= 0 ? nameBytes.slice(0, zeroIdx) : nameBytes
    ).trim();
    const type = String.fromCharCode(view.getUint8(offset + 11));
    const size = view.getUint8(offset + 16);
    const decimals = view.getUint8(offset + 17);

    if (!name) break;

    fields.push({
      name,
      type,
      size,
      decimals,
      offset: recordOffset
    });

    recordOffset += size;
    offset += 32;
  }

  return fields;
}

function readString(
  view: DataView,
  base: number,
  size: number
): string {
  const bytes = new Uint8Array(view.buffer, base, size);
  return new TextDecoder("latin1").decode(bytes).replace(/\u0000/g, "").trim();
}

function normalizeDateString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length === 8 && /^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseValue(
  view: DataView,
  field: DbfField,
  recordOffset: number
): string | number | boolean | null {
  const raw = readString(view, recordOffset + field.offset, field.size);
  if (!raw) return null;

  switch (field.type) {
    case "N":
    case "F": {
      const num = Number(raw);
      return Number.isFinite(num) ? num : raw;
    }
    case "D":
      return normalizeDateString(raw);
    case "L":
      return ["y", "t", "1"].includes(raw.toLowerCase());
    default:
      return raw;
  }
}

export function parseDbf(buffer: ArrayBuffer): ParsedDbf {
  const view = new DataView(buffer);
  const { recordCount, headerLength, recordLength } = parseHeader(view);
  const fields = parseFields(view, headerLength);

  const records: Record<string, string | number | boolean | null>[] = [];
  let offset = headerLength;

  for (let i = 0; i < recordCount; i++) {
    if (offset + recordLength > view.byteLength) break;
    const deletedFlag = view.getUint8(offset);
    const rec: Record<string, string | number | boolean | null> = {};

    if (deletedFlag !== 0x2A) {
      for (const field of fields) {
        const value = parseValue(view, field, offset);
        rec[field.name] = value;
      }
    }

    records.push(rec);
    offset += recordLength;
  }

  return { records, fields };
}

/**
 * Extract date strings (YYYY-MM-DD) for start/stop fields if present.
 */
export function parseDbfDates(
  buffer: ArrayBuffer,
  startField = "datm_start",
  stopField = "datm_stop"
): RecordDates[] {
  const { records } = parseDbf(buffer);
  return records.map(rec => {
    const start = rec[startField];
    const stop = rec[stopField];
    return {
      start: typeof start === "string" ? start.replace(/-/g, "") : start ? String(start) : undefined,
      stop: typeof stop === "string" ? stop.replace(/-/g, "") : stop ? String(stop) : undefined
    };
  });
}
