/**
 * Explicit data-quality issues. Calculations never silently drop inputs they
 * cannot resolve; they return an issue and mark the result incomplete.
 */
export type IssueCode =
  | "missing_component"
  | "missing_mapping"
  | "missing_price"
  | "missing_conversion"
  | "unit_mismatch"
  | "invalid_yield"
  | "invalid_quantity"
  | "invalid_price"
  | "cycle"
  | "stale_price"
  | "unmapped_pos_item"
  | "unmapped_modifier"
  | "approximate_measurement"
  | "missing_count"
  | "reconciliation_mismatch";

export interface Issue {
  code: IssueCode;
  message: string;
  /** Path of references that led to the issue, e.g. recipe -> prep -> product. */
  path?: string[];
  ref?: string;
}

export function issue(code: IssueCode, message: string, extra: Partial<Issue> = {}): Issue {
  return { code, message, ...extra };
}

/** Deduplicate by code+ref+message so a repeated component reports once. */
export function uniqueIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const i of issues) {
    const key = `${i.code}|${i.ref ?? ""}|${i.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(i);
    }
  }
  return out;
}
