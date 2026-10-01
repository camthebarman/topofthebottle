import { describe, expect, it } from "vitest";
import { z } from "zod";
import { action } from "@/lib/action";
import { fromDbError, UserError } from "@/lib/errors";
import { vetExplanation } from "@/server/ai/provider";
import { csvInvoice } from "@/server/jobs/invoice";
import { pdfPageCount, sniff } from "@/server/uploads";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("server action wrapper", () => {
  it("reports a persistence failure instead of claiming success", async () => {
    const act = action(z.object({ n: z.string() }), async () => {
      throw new Error("connection reset by peer");
    });
    const state = await act({ status: "idle" }, fd({ n: "1" }));
    expect(state).toEqual({ status: "error", message: "Something went wrong and nothing was saved. Please try again." });
  });

  it("shows database messages written for people, hides internals", () => {
    expect(fromDbError({ code: "40001", message: "This record was changed by someone else. Reload and try again." }).message).toMatch(/changed by someone else/);
    expect(fromDbError({ code: "42501", message: "new row violates row-level security policy for table \"products\"" }).message).toBe("You do not have permission to do that.");
    expect(fromDbError({ code: "XX000", message: "internal detail" }).message).not.toMatch(/internal/);
  });

  it("returns field errors for invalid input", async () => {
    const act = action(z.object({ email: z.email() }), async () => ({ status: "success" as const }));
    const state = await act({ status: "idle" }, fd({ email: "nope" }));
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.fieldErrors?.email).toBeTruthy();
  });

  it("passes user errors through", async () => {
    const act = action(z.object({}), async () => {
      throw new UserError("Count session is not open");
    });
    expect(await act({ status: "idle" }, fd({}))).toEqual({ status: "error", message: "Count session is not open" });
  });
});

describe("upload sniffing", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("identifies files by content, not name", () => {
    expect(sniff(enc("%PDF-1.7\n..."))).toBe("application/pdf");
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniff(enc("Item,Qty\nGin,2\n"))).toBe("text/csv");
    expect(sniff(enc("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniff(enc("<svg onload=alert(1)>"))).toBeNull();
    expect(sniff(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull(); // Windows executable
  });

  it("counts PDF pages from the page tree", () => {
    expect(pdfPageCount(enc("<< /Type /Pages /Kids [1 0 R 2 0 R] /Count 2 >> << /Type /Page >> << /Type /Page >>"))).toBe(2);
  });
});

describe("CSV invoices", () => {
  it("reads lines without AI and never fabricates header fields", () => {
    const c = csvInvoice("Description,Qty,Unit Price,Total\nGin 12x750,2,180.00,360.00\n=HYPERLINK(\"x\"),1,1,1\n");
    expect(c.lines).toHaveLength(2);
    expect(c.lines[0]).toMatchObject({ description: "Gin 12x750", quantity: "2", unit_price: "180", line_total: "360" });
    expect(c.supplier_name).toBeNull();
    expect(c.total).toBeNull();
  });

  it("reports rows it could not read and lines beyond the limit instead of dropping them silently", () => {
    const body = Array.from({ length: 205 }, (_, i) => `Item ${i},1,2.00,2.00`).join("\n");
    const c = csvInvoice(`Description,Qty,Unit Price,Total\n${body}\nInvoice total,,,410.00\nLime,two,1,1\n`);
    expect(c.lines).toHaveLength(200);
    expect(c.notes).toMatch(/2 row\(s\) had no description or no readable quantity/);
    expect(c.notes).toMatch(/Only the first 200 of 205 lines were read/);
  });
});

describe("AI explanation vetting", () => {
  const base = { summary: "Gin shows unexplained usage.", findings: [{ evidence_ids: ["v:1"], observation: "Unexplained 150 mL", possible_explanations: ["Unlogged waste"], recommended_checks: ["Recount"] }], data_gaps: [] };
  it("accepts grounded, non-accusatory output", () => {
    expect(vetExplanation(base, new Set(["v:1"]))).toBeNull();
  });
  it("rejects accusations and invented evidence", () => {
    expect(vetExplanation({ ...base, summary: "A bartender may be stealing." }, new Set(["v:1"]))).toMatch(/accusatory/);
    expect(vetExplanation({ ...base, findings: [{ ...base.findings[0]!, observation: "Likely theft" }] }, new Set(["v:1"]))).toMatch(/accusatory/);
    expect(vetExplanation(base, new Set(["v:2"]))).toMatch(/unknown evidence/);
  });
});
