/**
 * CSV reading and writing.
 *
 * The parser is incremental: feed it chunks and it emits complete records, so
 * large files are processed without holding every row in memory. It follows
 * RFC 4180 (quoted fields, doubled quotes, delimiters and newlines inside
 * quotes) and tolerates the common deviations found in POS exports (CRLF or LF
 * line endings, a UTF-8 byte-order mark, semicolon or tab delimiters).
 */
import { Decimal } from "./decimal";

export interface CsvLimits {
  maxFieldChars: number;
  maxColumns: number;
  maxRows: number;
}

export const DEFAULT_CSV_LIMITS: CsvLimits = { maxFieldChars: 10_000, maxColumns: 200, maxRows: 500_000 };

export class CsvLimitError extends Error {}

export class CsvParser {
  private field = "";
  private record: string[] = [];
  private inQuotes = false;
  private quoteSeen = false;
  private pendingCR = false;
  private rows = 0;
  private started = false;
  /** 1-based physical line where the current record began. */
  private line = 1;
  private recordLine = 1;

  constructor(
    private readonly delimiter: string,
    private readonly onRecord: (fields: string[], line: number) => void,
    private readonly limits: CsvLimits = DEFAULT_CSV_LIMITS,
  ) {
    if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
      throw new RangeError("Delimiter must be a single character other than quote or newline");
    }
  }

  push(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      let ch = chunk[i]!;
      if (!this.started) {
        this.started = true;
        if (ch === "﻿") continue;
      }
      if (this.pendingCR) {
        this.pendingCR = false;
        if (ch === "\n") continue;
      }
      if (this.inQuotes) {
        if (ch === '"') {
          this.inQuotes = false;
          this.quoteSeen = true;
        } else {
          if (ch === "\n" || ch === "\r") this.line++;
          if (ch === "\r") {
            // Normalise embedded CRLF to LF.
            if (chunk[i + 1] === "\n") i++;
            else if (i + 1 === chunk.length) this.pendingCR = true;
            ch = "\n";
          }
          this.append(ch);
        }
        continue;
      }
      if (ch === '"') {
        if (this.quoteSeen) {
          // Doubled quote inside a quoted field: "" -> "
          this.append('"');
          this.inQuotes = true;
          this.quoteSeen = false;
        } else if (this.field.length === 0) {
          this.inQuotes = true;
        } else {
          // Stray quote in an unquoted field; keep it literally.
          this.append(ch);
        }
        continue;
      }
      this.quoteSeen = false;
      if (ch === this.delimiter) {
        this.endField();
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r") {
          if (chunk[i + 1] === "\n") i++;
          else if (i + 1 === chunk.length) this.pendingCR = true;
        }
        this.endRecord();
        this.line++;
        this.recordLine = this.line;
      } else {
        this.append(ch);
      }
    }
  }

  /** Flush the final record. Throws if a quoted field was never closed. */
  end(): void {
    if (this.inQuotes) throw new CsvLimitError(`Unterminated quoted field starting on line ${this.recordLine}`);
    if (this.field.length || this.record.length) this.endRecord();
  }

  private append(ch: string) {
    if (this.field.length >= this.limits.maxFieldChars) throw new CsvLimitError(`Field on line ${this.recordLine} exceeds ${this.limits.maxFieldChars} characters`);
    this.field += ch;
  }

  private endField() {
    if (this.record.length >= this.limits.maxColumns) throw new CsvLimitError(`Row on line ${this.recordLine} has more than ${this.limits.maxColumns} columns`);
    this.record.push(this.field);
    this.field = "";
    this.quoteSeen = false;
  }

  private endRecord() {
    this.endField();
    const rec = this.record;
    this.record = [];
    // Skip fully blank lines.
    if (rec.length === 1 && rec[0] === "") return;
    this.rows++;
    if (this.rows > this.limits.maxRows) throw new CsvLimitError(`File has more than ${this.limits.maxRows} rows`);
    this.onRecord(rec, this.recordLine);
  }
}

export function parseCsv(text: string, delimiter = ",", limits?: CsvLimits): string[][] {
  const out: string[][] = [];
  const p = new CsvParser(delimiter, (r) => out.push(r), limits);
  p.push(text);
  p.end();
  return out;
}

/** Pick the delimiter that gives the most consistent column count over a sample. */
export function detectDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const c of candidates) {
    let rows: string[][];
    try {
      rows = [];
      const p = new CsvParser(c, (r) => rows.push(r), { ...DEFAULT_CSV_LIMITS, maxRows: 50 });
      try {
        p.push(sample);
      } catch {
        /* sample limit reached */
      }
    } catch {
      continue;
    }
    rows = rows.slice(0, 20);
    if (!rows.length) continue;
    const widths = rows.map((r) => r.length);
    const first = widths[0]!;
    if (first < 2) continue;
    const consistent = widths.filter((w) => w === first).length / widths.length;
    const score = consistent * 100 + Math.min(first, 50);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export type DetectedEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/** Decode uploaded bytes, honouring BOMs and falling back to Windows-1252. */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: DetectedEncoding } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

// ---------- numbers ----------

export type DecimalSeparator = "." | ",";

/**
 * Parse a number as exported by spreadsheets and POS systems:
 * "$1,234.50", "(12.00)", "12.00-", "1.234,50" (with "," separator), "15%".
 */
export function parseNumber(raw: string, decimalSeparator: DecimalSeparator = "."): Decimal | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(/[$€£¥\s %]/g, "").replace(/^([-+]?)[A-Z]{3}(?=[\d.,])/, "$1");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  const thousands = decimalSeparator === "." ? "," : ".";
  if (decimalSeparator === "." && /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (decimalSeparator === "," && /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  if (s.includes(thousands) && decimalSeparator === ",") return null;
  if (decimalSeparator === ",") s = s.replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = new Decimal(s);
  return negative ? v.negated() : v;
}

// ---------- dates ----------

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY" | "ISO";

export interface ParsedDateTime {
  date: string;
  /** HH:MM, or null when the cell carried a date only. */
  time: string | null;
  /** Present when the value carried an explicit UTC offset. */
  instant: Date | null;
}

export function parseDateTime(raw: string, format: DateFormat): ParsedDateTime | null {
  const s = raw.trim();
  if (!s) return null;
  if (format === "ISO" || /\d{4}-\d{2}-\d{2}T/.test(s)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
    if (!m) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!validDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
    const time = m[4] ? `${m[4]}:${m[5]}` : null;
    const instant = m[7] ? new Date(`${date}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}${m[7] === "Z" ? "Z" : m[7].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")}`) : null;
    return { date, time, instant: instant && !Number.isNaN(instant.getTime()) ? instant : null };
  }
  const m = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s);
  if (!m) return null;
  let y: number, mo: number, da: number;
  if (format === "YYYY-MM-DD") [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if (format === "MM/DD/YYYY") [mo, da, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else [da, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 100) y += 2000;
  if (!validDate(y, mo, da)) return null;
  let time: string | null = null;
  if (m[4]) {
    let h = Number(m[4]);
    const ampm = m[7]?.toLowerCase();
    if (ampm) {
      if (h < 1 || h > 12) return null;
      if (ampm === "pm" && h !== 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    }
    if (h > 23 || Number(m[5]) > 59) return null;
    time = `${String(h).padStart(2, "0")}:${m[5]}`;
  }
  return { date: `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`, time, instant: null };
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// ---------- writing ----------

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * Make a cell safe to open in a spreadsheet. Text that starts with a formula
 * trigger is prefixed with an apostrophe; legitimate numbers such as "-12.50"
 * are left alone so they stay numeric.
 */
export function neutralizeFormula(value: string): string {
  if (!value) return value;
  if (NUMERIC.test(value)) return value;
  return /^[=+\-@\t\r|%]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = neutralizeFormula(value instanceof Decimal ? value.toFixed() : String(value));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
