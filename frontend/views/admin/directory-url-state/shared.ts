/**
 * Directory URL state — shared primitives.
 *
 * The dependency-free core of the split `directory-url-state` module: the
 * `ReadableSearchParams` shape every parser accepts, the pagination
 * whitelist, the shared `q`/`page`/`size` trio (parse + serialize) and the
 * enum-ish wire→state param reader. Each admin directory surface
 * (`/students`, `/teachers`, `/users`) composes these in its own sibling
 * module; the `directory-url-state.ts` entry barrel re-exports the whole
 * public contract.
 */

/** Minimal shape this module needs from `useSearchParams()` (dependency-
 * free: tests pass plain objects, the framework passes a live params ref). */
export interface ReadableSearchParams {
  get(name: string): string | null;
}

/** Whitelisted page sizes — mirrors `DirectoryPagination`'s options. */
type DirectoryPageSize = 10 | 25 | 50 | 100;

const PAGE_SIZE_OPTIONS: readonly DirectoryPageSize[] = [10, 25, 50, 100];

const DEFAULT_PAGE_SIZE: DirectoryPageSize = 10;
/** Hard clamp for a hand-edited `page` — a stray `page=99999999` resolves
 * to the last real page server-side anyway; this just keeps arithmetic sane
 * (the 1-BASED page is capped at 10,000, then converted to the 0-based
 * internal index). */
const MAX_PAGE_ONE_BASED = 10_000;

/** Reads one page-int param: 1-based, clamped; `null`/junk → `null` (default). */
function parsePageParam(searchParams: ReadableSearchParams): number | null {
  const raw = searchParams.get("page");
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  // Internal state is 0-based — cap the 1-based page, then shift down.
  return Math.min(parsed, MAX_PAGE_ONE_BASED) - 1;
}

/** Reads one `size` param against the pagination whitelist; junk → `null`. */
function parsePageSizeParam(searchParams: ReadableSearchParams): DirectoryPageSize | null {
  const raw = searchParams.get("size");
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  // Whitelist membership IS the validation: `find` returns the matching
  // option with its narrow literal type already — no assertion required.
  return PAGE_SIZE_OPTIONS.find(option => option === parsed) ?? null;
}

/**
 * Reads one enum-ish param against an explicit lowercase wire→state map.
 * Unknown values fail safe to the map's absence (`null` = "not shared").
 */
export function parseMappedParam<T extends string>(
  searchParams: ReadableSearchParams,
  key: string,
  wireToState: Readonly<Record<string, T>>
): T | null {
  const raw = searchParams.get(key);
  if (raw === null) {
    return null;
  }
  return wireToState[raw] ?? null;
}

/** Shared parse result: the applied search substring + pagination pair. */
export interface BaseDirectoryUrlState {
  readonly q: string;
  readonly page: number;
  readonly pageSize: DirectoryPageSize;
}

/** Shared serializer input — mirrors the listing hooks' applied state. */
interface BaseDirectoryUrlInput {
  readonly q: string;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Appends the shared `q`/`page`/`size` keys onto `params` — defaults
 * omitted, stable order (q, then surface keys, then page, size).
 */
export function appendBaseParams(params: URLSearchParams, input: BaseDirectoryUrlInput): void {
  if (input.q !== "") {
    params.set("q", input.q);
  }
  if (input.page !== 0) {
    params.set("page", String(input.page + 1));
  }
  if (input.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("size", String(input.pageSize));
  }
}

/**
 * Parses the shared trio off a params object.
 */
export function parseBaseParams(
  searchParams: ReadableSearchParams
): Pick<BaseDirectoryUrlState, "q" | "page" | "pageSize"> {
  return {
    q: searchParams.get("q") ?? "",
    page: parsePageParam(searchParams) ?? 0,
    pageSize: parsePageSizeParam(searchParams) ?? DEFAULT_PAGE_SIZE,
  };
}
