/**
 * The hostile search payload matrix — the shared fixture vocabulary of the
 * search-surface hostile-payload suites (teacher matching, the admin
 * teacher directory, and the admin student-payments audit).
 *
 * TEST-ONLY module: imported by `*.test.ts` suites only — never from
 * production code (services, resolvers, jobs).
 *
 * Every payload must behave as a LITERAL substring at its search surface:
 * the service layer's single escape point neutralizes the LIKE/ILIKE
 * wildcards (`%`, `_`, `\`), the bound query parameter carries the
 * SQL-injection strings to the database as inert data, and a widened
 * (wildcard-semantics) match is impossible. Each case pairs the payload
 * with decoy NAME fragments that WOULD surface if the metacharacters kept
 * their wildcard meaning — a payload-search result that contains a decoy
 * row proves the escape discipline regressed. Decoys never contain the
 * payload as a literal substring, so a correctly escaped surface matches
 * exactly the literal carrier row and nothing else.
 */

/** One hostile payload plus the decoy name fragments its wildcard semantics would surface. */
export interface HostileSearchPayload {
  /** Human-readable case label (interpolated by `test.each`). */
  label: string;
  /** The raw search string a hostile caller submits. */
  payload: string;
  /**
   * Name fragments that must NEVER appear in the payload's result set:
   * each either stands in for the characters the payload's wildcards
   * would match (e.g. `1000` for the `%` in `100%`) or is a sibling
   * injection string sharing no literal substring with the payload.
   */
  decoys: string[];
}

/** The matrix: classic SQL-injection strings + LIKE-wildcard metacharacter payloads. */
export const HOSTILE_SEARCH_PAYLOADS: HostileSearchPayload[] = [
  {
    label: "stacked-statement SQL string",
    payload: "'; DROP TABLE users; --",
    decoys: ["Robert'); DROP TABLE students;--"],
  },
  {
    label: "quote-terminated SQL string",
    payload: " Robert'); DROP TABLE students;--",
    decoys: ["'; DROP TABLE users; --"],
  },
  {
    label: "bare % wildcard",
    payload: "%",
    decoys: ["50off", "100xyz"],
  },
  {
    label: "bare _ wildcard",
    payload: "_",
    decoys: ["Q", "x"],
  },
  {
    label: "bare backslash escape character",
    payload: "\\",
    decoys: ["%"],
  },
  {
    label: "trailing % quantity",
    payload: "100%",
    decoys: ["1000", "100xyz"],
  },
  {
    label: "wrapped %admin%",
    payload: "%admin%",
    decoys: ["admin", "administrator"],
  },
  {
    label: "mixed metacharacters",
    payload: "a%b_c\\d",
    decoys: ["a0b9cd", "a%b_cd"],
  },
];
