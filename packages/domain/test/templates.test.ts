import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv";
import { type MappingProfile, normalizeRow, sensitiveHeaders, validateProfile } from "../src/pos";
import { guessColumns } from "../src/pos-presets";

// The templates published in docs/import-templates must import cleanly with the automatic mapping.
const dir = new URL("../../../docs/import-templates/", import.meta.url);

function load(name: string) {
  const [header, ...rows] = parseCsv(readFileSync(new URL(name, dir), "utf8"), ",");
  return { header: header!, records: rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ""]))) };
}

function profile(header: string[], kind: MappingProfile["kind"]): MappingProfile {
  return { name: "template", vendor: "generic", kind, columns: guessColumns(header), dateFormat: "YYYY-MM-DD", decimalSeparator: ".", modifierSeparator: ";", verified: false, sourceNote: "" };
}

describe("published import templates", () => {
  it("item-level template maps automatically and every row is accepted with the right kinds", () => {
    const { header, records } = load("generic-pos-transactions.csv");
    const p = profile(header, "transactions");
    expect(validateProfile(p, header)).toEqual([]);
    expect(sensitiveHeaders(header)).toEqual([]);
    const results = records.map((r, i) => normalizeRow(r, i + 2, p, { timeZone: "America/New_York", businessDayCutoff: "04:00" }));
    expect(results.map((r) => ("reasons" in r ? r.reasons : []))).toEqual(results.map(() => []));
    const kinds = results.map((r) => ("sale" in r ? r.sale.kind : null));
    expect(kinds).toEqual(["sale", "sale", "comp", "void"]);
  });

  it("product-mix template maps automatically for a stated date range", () => {
    const { header, records } = load("generic-pos-product-mix.csv");
    const p = profile(header, "aggregate");
    expect(validateProfile(p, header)).toEqual([]);
    const results = records.map((r, i) => normalizeRow(r, i + 2, p, { timeZone: "America/New_York", businessDayCutoff: "04:00", reportStart: "2026-09-21", reportEnd: "2026-09-27" }));
    expect(results.every((r) => "sale" in r)).toBe(true);
  });
});
