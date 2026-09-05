type QueryResult<T> = { data: T[] | null; error: { message: string; code?: string } | null };

/** Keep pages below PostgREST's row cap; callers must specify a stable ordering. */
export async function readAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<QueryResult<T>>): Promise<QueryResult<T>> {
  const rows: T[] = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const result = await fetchPage(offset, offset + size - 1);
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < size) return { data: rows, error: null };
  }
}
