/**
 * The benchmark's data plan, pure over inputs the database adapter supplies:
 *
 *  - `buildVolumeSteps` turns the descending volume list into the exact
 *    window-narrowing steps the run performs. A volume cell benchmarks the
 *    FIRST `volume` eligible seeded teachers (by teacher id, ascending —
 *    deterministic); every teacher beyond the window is temporarily marked
 *    offline so the live browse sees exactly the window. Steps are
 *    cumulative in descending order, so each step flips only the delta
 *    between the previous (larger) window and its own.
 *
 *  - `planCallers` resolves the two seeded caller identities the matrix
 *    browses as, mirroring the service's own language resolution: a caller
 *    whose profile resolves to NO language filter (absent or
 *    Arabic-baseline — the platform lingua franca) and a caller whose
 *    profile resolves to a non-Arabic hard-filter token. When the seed run
 *    carries no suitable identity, the plan specifies a bench-owned caller
 *    row to insert (prefix-stamped, so the run's cleanup removes it).
 */

/** One student identity the caller resolution may pick or insert. */
export interface StudentCandidateRow {
  readonly id: number;
  readonly primaryLanguage: string | null;
  readonly anotherLanguage: string | null;
}

/** A bench-owned caller row to insert (used only when no seeded identity fits). */
export interface BenchCallerInsert {
  readonly email: string;
  readonly fullName: string;
  readonly phone: string;
  readonly handshakeCode: string;
  readonly primaryLanguage: string;
  readonly locale: "ar" | "en";
  readonly passwordHash: string;
}

/** The resolved caller identities plus any rows the run must insert first. */
export interface BenchCallerPlan {
  readonly noFilterCallerId: number | null;
  readonly languageCallerId: number | null;
  readonly inserts: readonly BenchCallerInsert[];
}

/** One volume's window-narrowing step. */
export interface VolumeStep {
  readonly volume: number;
  readonly windowSize: number;
  /** Teacher ids to mark offline for this step (the delta beyond the window). */
  readonly flipIds: readonly number[];
}

/**
 * Builds the descending, cumulative window steps. `volumes` must be sorted
 * strictly descending with every value at most the census length; the first
 * step's window starts from the full census.
 */
export function buildVolumeSteps(volumes: readonly number[], censusIds: readonly number[]): VolumeStep[] {
  const steps: VolumeStep[] = [];
  let previousBoundary = censusIds.length;
  for (const volume of volumes) {
    steps.push({
      volume,
      windowSize: Math.min(volume, censusIds.length),
      flipIds: censusIds.slice(volume, previousBoundary),
    });
    previousBoundary = volume;
  }
  return steps;
}

/** Arabic-baseline tokens — a caller resolving to one of these browses unfiltered. */
const ARABIC_LANGUAGE_TOKENS: ReadonlySet<string> = new Set(["arabic", "ar", "عربي", "العربية"]);

/** Mirrors the service's language-token cap and character gate. */
const MAX_LANGUAGE_TOKEN_LENGTH = 50;

/**
 * Resolves a student's profile languages to the language-filter outcome,
 * mirroring the service's own resolution: `null` = no filter (absent
 * profile or Arabic baseline); otherwise the normalized token the service
 * would hard-filter on; `"invalid"` when the token would make the service
 * deny (character gate or cap) — such identities are never picked.
 */
export function resolveCallerLanguageToken(
  primaryLanguage: string | null,
  anotherLanguage: string | null
): string | null {
  const rawToken = primaryLanguage ?? anotherLanguage;
  if (rawToken === null) {
    return null;
  }
  const normalized = rawToken.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_LANGUAGE_TOKEN_LENGTH ||
    normalized.includes('"') ||
    normalized.includes("\\")
  ) {
    return "invalid";
  }
  return ARABIC_LANGUAGE_TOKENS.has(normalized) ? null : normalized;
}

/** Bench-owned caller row for one caller kind (prefix-stamped; cleanup removes it). */
function benchCallerInsert(prefix: string, kind: "baseline" | "english", passwordHash: string): BenchCallerInsert {
  return kind === "baseline"
    ? {
        email: `${prefix}bench-caller-baseline@test.local`,
        fullName: `${prefix}Bench Caller Baseline`,
        phone: "+20990000001",
        handshakeCode: `${prefix}BENCH-BASELINE`,
        primaryLanguage: "arabic",
        locale: "ar",
        passwordHash,
      }
    : {
        email: `${prefix}bench-caller-english@test.local`,
        fullName: `${prefix}Bench Caller English`,
        phone: "+20990000002",
        handshakeCode: `${prefix}BENCH-ENGLISH`,
        primaryLanguage: "english",
        locale: "en",
        passwordHash,
      };
}

/**
 * Resolves the two matrix callers from the seeded student identities (id
 * order, deterministic). A student whose language resolves to `null` is a
 * no-filter caller; a student resolving to a clean non-Arabic token is a
 * language caller (prefer the exact `english` token the seed draws). Any
 * missing kind gets a bench-owned insert; identities whose tokens would
 * make the service deny are never picked.
 */
export function planCallers(
  students: readonly StudentCandidateRow[],
  prefix: string,
  passwordHash: string
): BenchCallerPlan {
  let noFilterCallerId: number | null = null;
  let englishCallerId: number | null = null;
  let languageCallerId: number | null = null;
  for (const student of students) {
    const token = resolveCallerLanguageToken(student.primaryLanguage, student.anotherLanguage);
    if (token === "invalid") {
      continue;
    }
    if (noFilterCallerId === null && token === null) {
      noFilterCallerId = student.id;
    }
    if (token !== null) {
      if (englishCallerId === null && token === "english") {
        englishCallerId = student.id;
      }
      languageCallerId ??= student.id;
    }
  }
  const languagePick = englishCallerId ?? languageCallerId;
  const inserts: BenchCallerInsert[] = [];
  if (noFilterCallerId === null) {
    inserts.push(benchCallerInsert(prefix, "baseline", passwordHash));
  }
  if (languagePick === null) {
    inserts.push(benchCallerInsert(prefix, "english", passwordHash));
  }
  return { noFilterCallerId, languageCallerId: languagePick, inserts };
}
