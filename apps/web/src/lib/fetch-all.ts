import "server-only";

const PAGE = 1000;

/**
 * Read every row of a query in pages. PostgREST caps each response (max_rows,
 * 1000 by default), so a single request can silently return a partial list.
 * The query must have a deterministic order.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>, maxRows = 1_000_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(`Result exceeds ${maxRows} rows`);
}
