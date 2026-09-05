import type { MockLink } from "@apollo/client/testing";
import {
  Gender,
  type MeQuery_me,
  RecitationReading,
  UserRole,
  AppLocale as WireAppLocale,
} from "@/frontend/graphql/generated/gql/graphql";
import { meQueryDocument } from "@/frontend/graphql/sharedDocuments";

/**
 * Deterministic fixtures for the `Pages/Profile` stories — the `me` query
 * mocks consumed by the real `AuthProvider` session-restore effect.
 *
 * MockLink passes `result.data` through AS-IS (Apollo does not synthesize
 * `__typename` on mocked results), and without it the cache cannot normalize
 * the `User:id` entry the language-preference card's cache-only read relies
 * on (the profile-view component-test precedent).
 */
export type MeUserFixture = MeQuery_me & { readonly __typename: "User" };

/** Complete teacher user — every field of the `me` selection populated. */
export function teacherUser(): MeUserFixture {
  return {
    __typename: "User",
    id: 10,
    email: "maryam.alqari\u0040kottaby.academy",
    fullName: "Maryam Al-Qari",
    phone: "+966501234567",
    country: "Saudi Arabia",
    gender: Gender.Female,
    locale: WireAppLocale.En,
    role: UserRole.Teacher,
    preferredRecitation: RecitationReading.HafsAnAsim,
    isDeleted: false,
    suspended: false,
    isBlocked: false,
  };
}

/**
 * `me` mock answering with the given user. `maxUsageCount` is unlimited —
 * the AuthProvider's restore effect fetches with `network-only` on every
 * mount, and a re-mounted story (docs remount, toolbar toggles) must not
 * exhaust the mock.
 */
export function meMock(user: MeUserFixture): MockLink.MockedResponse {
  return {
    request: { query: meQueryDocument },
    result: { data: { me: user } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

/** Never-resolving `me` mock — keeps the AuthProvider in the loading branch. */
export function pendingMeMock(): MockLink.MockedResponse {
  return {
    request: { query: meQueryDocument },
    result: { data: { me: null } },
    delay: Number.POSITIVE_INFINITY,
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}
