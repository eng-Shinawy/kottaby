/**
 * Type-Level Guard Suite — StudentRepository lane debit/refund signatures.
 * Validated by `bun tsgo` (the compiler is the test runner).
 * `.test-d.ts` suffix = outside the bun test runner glob.
 *
 * Proves the `lane` parameter accepts ONLY `HeldBalanceLane` enum members:
 * an arbitrary caller string — even the exact member spelling as a bare
 * literal — is a compile error, so the frozen lane → column map inside
 * `student.repository.ts` is structurally unreachable by string injection.
 * Runtime counterparts: the source pins in `student-lane-debit.test.ts`.
 */

import { StudentRepository } from "@/backend/db/repo";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import type { DBTransaction } from "@/backend/types";

/** Helper to consume variables for TS6133. */
const v = (x: unknown): boolean => Boolean(x);

declare const tx: DBTransaction;
declare const arbitraryString: string;

// Positive — enum members compile; the return types surface the
// boolean (debit) / void (refund) contract exactly.
const debitHit: Promise<boolean> = StudentRepository.decrementLaneIfAvailable(1, HeldBalanceLane.Trial, tx);
const debitMiss: Promise<boolean> = StudentRepository.decrementLaneIfAvailable(1, HeldBalanceLane.Hifz, tx);
const refund: Promise<void> = StudentRepository.incrementLane(1, HeldBalanceLane.Tajweed, tx);
v(debitHit);
v(debitMiss);
v(refund);

// Positive — `tx` is optional and LAST: standalone calls against the global
// handle compile with the same lane discipline.
const standalone: Promise<boolean> = StudentRepository.decrementLaneIfAvailable(1, HeldBalanceLane.Hifz);
v(standalone);

// Negative — an arbitrary runtime string can never select a lane column.
// @ts-expect-error — decrementLaneIfAvailable requires a HeldBalanceLane member, not a string
const stringDebit: Promise<boolean> = StudentRepository.decrementLaneIfAvailable(1, arbitraryString, tx);
v(stringDebit);

// @ts-expect-error — incrementLane requires a HeldBalanceLane member, not a string
const stringRefund: Promise<void> = StudentRepository.incrementLane(1, arbitraryString, tx);
v(stringRefund);

// Negative — even the exact member spelling as a bare string literal is
// rejected: only enum members carry the lane identity.
// @ts-expect-error — a bare "trial" literal is not the HeldBalanceLane.Trial member
const literalDebit: Promise<boolean> = StudentRepository.decrementLaneIfAvailable(1, "trial", tx);
v(literalDebit);

// @ts-expect-error — same for the refund path
const literalRefund: Promise<void> = StudentRepository.incrementLane(1, "hifz", tx);
v(literalRefund);
