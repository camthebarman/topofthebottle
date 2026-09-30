import { describe, expect, it } from "vitest";
import { CsvParser, csvCell, decodeBytes, detectDelimiter, neutralizeFormula, parseCsv, parseDateTime, parseNumber } from "../src/csv";
import { attachModifierRows, consumedServings, finalizeDedupeKeys, type MappingProfile, normalizeRow, sensitiveHeaders, summarize, validateProfile } from "../src/pos";

describe("csv parsing", () => {
  it("strips a UTF-8 BOM and handles quoted delimiters, doubled quotes and embedded newlines", () => {
    const rows = parseCsv('﻿name,notes\r\n"Gin, London","Said ""hi""\r\nsecond line"\r\nplain,x\r\n');
    expect(rows).toEqual([
      ["name", "notes"],
      ["Gin, London", 'Said "hi"\nsecond line'],
      ["plain", "x"],
    ]);
  });

  it("gives the same result when fed in arbitrary chunks", () => {
    const text = 'a,b\r\n"x\r\ny","1,2"\r\nlast,"q""q"';
    const whole = parseCsv(text);
    for (let size = 1; size < 6; size++) {
      const out: string[][] = [];
      const p = new CsvParser(",", (r) => out.push(r));
      for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size));
      p.end();
      expect(out).toEqual(whole);
    }
  });

  it("rejects unterminated quotes and oversized fields", () => {
    expect(() => parseCsv('a,"b')).toThrow(/Unterminated/);
    expect(() => parseCsv("x".repeat(20), ",", { maxFieldChars: 10, maxColumns: 5, maxRows: 5 })).toThrow(/exceeds/);
    expect(() => parseCsv("a\nb\nc", ",", { maxFieldChars: 10, maxColumns: 5, maxRows: 2 })).toThrow(/more than 2 rows/);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("a;b;c\n1;2,5;3\n4;5;6")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });

  it("decodes Windows-1252 when bytes are not UTF-8", () => {
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9]); // "Café" in cp1252
    expect(decodeBytes(bytes)).toEqual({ text: "Café", encoding: "windows-1252" });
    expect(decodeBytes(new TextEncoder().encode("Café")).encoding).toBe("utf-8");
  });
});

describe("number and date parsing", () => {
  it.each([
    ["$1,234.50", ".", "1234.5"],
    ["(12.00)", ".", "-12"],
    ["12.00-", ".", "-12"],
    ["-$3.25", ".", "-3.25"],
    ["1.234,50", ",", "1234.5"],
    ["3,5", ",", "3.5"],
    ["USD 7.00", ".", "7"],
  ] as const)("parses %s", (raw, sep, expected) => {
    expect(parseNumber(raw, sep)?.toString()).toBe(expected);
  });

  it("rejects ambiguous or non-numeric values", () => {
    expect(parseNumber("12abc")).toBeNull();
    expect(parseNumber("1,2,3")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("parses US and ISO dates with 12-hour times", () => {
    expect(parseDateTime("9/14/2026 1:05 AM", "MM/DD/YYYY")).toEqual({ date: "2026-09-14", time: "01:05", instant: null });
    expect(parseDateTime("14/09/2026 13:05", "DD/MM/YYYY")?.time).toBe("13:05");
    expect(parseDateTime("2026-09-14T01:05:00Z", "ISO")?.instant?.toISOString()).toBe("2026-09-14T01:05:00.000Z");
    expect(parseDateTime("2/30/2026", "MM/DD/YYYY")).toBeNull();
  });
});

describe("formula injection", () => {
  it("neutralizes formula triggers but keeps legitimate numbers", () => {
    expect(neutralizeFormula("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeFormula("+1-2")).toBe("'+1-2");
    expect(neutralizeFormula("-12.50")).toBe("-12.50");
    expect(neutralizeFormula("+3")).toBe("+3");
    expect(csvCell('=cmd|"/c calc"!A1')).toBe('"\'=cmd|""/c calc""!A1"');
  });
});

const profile: MappingProfile = {
  name: "test",
  vendor: "generic",
  kind: "transactions",
  columns: {
    occurred_at: "Time",
    transaction_id: "Check",
    line_id: "Line",
    item_name: "Item",
    quantity: "Qty",
    net_sales: "Net",
    void_flag: "Void",
    comp_flag: "Comp",
    modifiers: "Mods",
    parent_line_id: "Parent",
  },
  dateFormat: "MM/DD/YYYY",
  decimalSeparator: ".",
  verified: false,
  sourceNote: "test fixture",
};
const ctx = { timeZone: "America/New_York", businessDayCutoff: "04:00" };

function row(r: Partial<Record<string, string>>): Record<string, string> {
  return { Time: "9/14/2026 11:00 PM", Check: "100", Line: "1", Item: "Negroni", Qty: "1", Net: "12.00", Void: "", Comp: "", Mods: "", Parent: "", ...r } as Record<string, string>;
}

describe("POS row normalization", () => {
  it("assigns a late-night sale to the previous business date", () => {
    const r = normalizeRow(row({ Time: "9/15/2026 1:30 AM" }), 2, profile, ctx);
    expect(r.ok && r.sale.businessDate).toBe("2026-09-14");
    expect(r.ok && r.sale.occurredAt).toBe("2026-09-15T05:30:00.000Z");
  });

  it("quarantines invalid rows with reasons instead of dropping them", () => {
    const r = normalizeRow(row({ Qty: "two", Time: "nope" }), 3, profile, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasons.join(" ")).toMatch(/not a number/);
      expect(r.reasons.join(" ")).toMatch(/does not match/);
    }
  });

  it("uses transaction and line ids as the dedupe key", () => {
    const r = normalizeRow(row({}), 2, profile, ctx);
    expect(r.ok && r.sale.dedupeKey).toBe("line:100:1");
  });

  it("classifies voids, comps and refunds and applies stock treatment", () => {
    const v = normalizeRow(row({ Void: "yes" }), 2, profile, ctx);
    const c = normalizeRow(row({ Comp: "true" }), 3, profile, ctx);
    const rf = normalizeRow(row({ Qty: "-1", Net: "-12" }), 4, profile, ctx);
    expect(v.ok && v.sale.kind).toBe("void");
    expect(c.ok && c.sale.kind).toBe("comp");
    expect(rf.ok && rf.sale.kind).toBe("refund");
    if (v.ok && c.ok && rf.ok) {
      expect(consumedServings(v.sale).servings.toString()).toBe("0");
      expect(consumedServings(c.sale).servings.toString()).toBe("1");
      expect(consumedServings(rf.sale).servings.toString()).toBe("0");
      expect(consumedServings({ ...v.sale, voidPrepared: true }).servings.toString()).toBe("1");
    }
  });

  it("folds modifier rows into the parent line", () => {
    const a = normalizeRow(row({}), 2, profile, ctx);
    const m = normalizeRow(row({ Line: "2", Parent: "1", Item: "Double", Net: "4" }), 3, profile, ctx);
    const o = normalizeRow(row({ Line: "3", Parent: "99", Item: "Rocks", Net: "0" }), 4, profile, ctx);
    if (!a.ok || !m.ok || !o.ok) throw new Error("fixture");
    const { sales, orphans } = attachModifierRows([a.sale, m.sale, o.sale]);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.modifiers).toEqual(["Double"]);
    expect(orphans).toHaveLength(1);
  });

  it("disambiguates identical fingerprint rows and summarizes totals", () => {
    const p2: MappingProfile = { ...profile, columns: { ...profile.columns, line_id: undefined } };
    const rows = [row({}), row({}), row({ Item: "Martini", Net: "14" })].map((r, i) => normalizeRow(r, i + 2, p2, ctx));
    const sales = rows.flatMap((r) => (r.ok ? [r.sale] : []));
    finalizeDedupeKeys(sales);
    expect(new Set(sales.map((s) => s.dedupeKey)).size).toBe(3);
    const sum = summarize(sales, 3, 0);
    expect(sum.netSales.toString()).toBe("38");
    expect(sum.duplicateKeysInFile).toBe(0);
  });

  it("refuses to map sensitive columns", () => {
    expect(sensitiveHeaders(["Item", "Card Last 4", "Guest Email", "Qty"])).toEqual(["Card Last 4", "Guest Email"]);
    const errs = validateProfile({ ...profile, columns: { ...profile.columns, staff_ref: "Customer Name" } }, ["Time", "Check", "Line", "Item", "Qty", "Net", "Void", "Comp", "Mods", "Parent", "Customer Name"]);
    expect(errs.join(" ")).toMatch(/personal or payment/);
  });
});
