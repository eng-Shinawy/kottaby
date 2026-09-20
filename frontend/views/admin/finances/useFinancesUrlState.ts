"use client";

/**
 * useFinancesUrlState — the shareable-URL wiring of the finances console
 * (`/admin/finances`), extracted from {@link AdminFinancesContainer} (the
 * oxlint max-lines split; the container keeps the view, this hook owns the
 * bidirectional URL contract):
 *
 *  - the active tab lives in the `?tab=` query string (values `payments` |
 *    `withdrawals` | `wallet`; ANY unknown/absent value resolves to the
 *    default payments tab — fail-safe single-direction flag) and is
 *    mirrored back through `router.replace` (`{ scroll: false }`, no
 *    history churn);
 *  - the wallet tab's `?teacherId=` deep link is read ONCE on mount (a
 *    live params ref would re-seed on every URL write; the picker owns
 *    later edits) as the initial picker selection, and the picker's own
 *    selection writes the param back.
 *
 * Defaults are omitted on write (a pristine surface shares as the bare
 * path). Parsers come from `finances-url-state.ts` — the pure half.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  type FinancesTab,
  parseFinancesUrlTab,
  parseTeacherIdParam,
} from "@/frontend/views/admin/finances/finances-url-state";

/** The tab + picker state, mirrored to and from the query string. */
export function useFinancesUrlState(): {
  readonly activeTab: FinancesTab;
  readonly setActiveTab: (tab: FinancesTab) => void;
  readonly walletTeacherId: number | null;
  readonly setWalletTeacherId: (teacherId: number | null) => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [activeTab, setActiveTab] = useState<FinancesTab>(() => parseFinancesUrlTab(searchParams));
  // The wallet picker's deep-link seed — read ONCE on mount (a live params
  // ref would re-seed on every URL write; the picker owns later edits) as
  // the initial picker selection.
  const [teacherIdSeed] = useState<number | null>(() => parseTeacherIdParam(searchParams));
  // The picker's CURRENT selection (initialized from the mount seed and
  // mirrored back into the URL by the write effect below — the wallet
  // tab's own key). Handed down to the panel so the wallet query follows
  // every picker change.
  const [walletTeacherId, setWalletTeacherId] = useState<number | null>(teacherIdSeed);

  // URL write effect — mirrors the ACTIVE tab's view back into the query
  // string (defaults omitted: a pristine surface shares as the bare path).
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== "payments") {
      params.set("tab", activeTab);
    }
    if (activeTab === "wallet" && walletTeacherId !== null) {
      params.set("teacherId", String(walletTeacherId));
    }
    const urlQuery = params.toString();
    const currentQuery = searchParams.toString();
    if (currentQuery !== urlQuery) {
      router.replace(urlQuery === "" ? pathname : `${pathname}?${urlQuery}`, { scroll: false });
    }
    // `currentQuery` re-runs the guard whenever the URL changes; after the
    // replace it already mirrors the active view, so the effect skips.
  }, [activeTab, walletTeacherId, router, pathname, searchParams]);

  return { activeTab, setActiveTab, walletTeacherId, setWalletTeacherId };
}
