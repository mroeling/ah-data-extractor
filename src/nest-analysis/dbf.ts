// src/nest-analysis/dbf.ts
// Minimal DBF reader to extract date fields from .dbf that accompanies a shapefile.

export interface RecordDates {
  start?: string; // YYYYMMDD
  stop?: string;  // YYYYMMDD
}

interface FieldDef {
  name: string;
  type: string;
  size: number;
  offset: number;
}

function parseHeader(view: DataView) {
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  return { recordCount, headerLength, recordLength };
}

function parseFields(view: DataView, headerLength: number): FieldDef[] {
  const fields: FieldDef[] = [];
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

    if (!name) break;

    fields.push({
      name,
      type,
      size,
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
  return new TextDecoder("latin1").decode(bytes).trim().replace(/\u0000/g, "");
}

/**
 * Extract date strings (YYYYMMDD) for start/stop fields if present.
 */
export function parseDbfDates(
  buffer: ArrayBuffer,
  startField = "datm_start",
  stopField = "datm_stop"
): RecordDates[] {
  const view = new DataView(buffer);
  const { recordCount, headerLength, recordLength } = parseHeader(view);
  const fields = parseFields(view, headerLength);

  const startDef = fields.find(f => f.name.toLowerCase() === startField.toLowerCase());
  const stopDef = fields.find(f => f.name.toLowerCase() === stopField.toLowerCase());

  const results: RecordDates[] = [];
  let offset = headerLength;

  for (let i = 0; i < recordCount; i++) {
    if (offset + recordLength > view.byteLength) break;

    const deletedFlag = view.getUint8(offset);
    const rec: RecordDates = {};

    if (deletedFlag !== 0x2A) { // not deleted
      if (startDef) {
        const raw = readString(view, offset + startDef.offset, startDef.size);
        if (raw) rec.start = raw;
      }
      if (stopDef) {
        const raw = readString(view, offset + stopDef.offset, stopDef.size);
        if (raw) rec.stop = raw;
      }
    }

    results.push(rec);
    offset += recordLength;
  }

  return results;
}
