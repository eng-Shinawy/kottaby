"use client";

import { useEffect, useMemo, useState } from "react";
import {
  cairoOffsetHours,
  cairoPrayerSchedule,
  fixHour,
  nextPrayer,
  utcMidnightOf,
} from "@/frontend/views/landing/utils";
import { Landing, useAppLocale, useAppTranslation } from "@/shared/locale";

interface HijriPrayerModel {
  readonly hijri: string;
  readonly times: readonly { key: string; label: string; value: string }[];
  readonly nextKey: string;
  readonly countdown: string;
}

/** Hijri date + Cairo prayer schedule model; null until first client mount tick. */
export function useHijriPrayerModel(): HijriPrayerModel | null {
  const t = useAppTranslation(Landing);
  const locale = useAppLocale();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // rAF-deferred initial read (set-state-in-effect: sync setState inside
    // effects triggers cascading renders — same pattern as ScrollProgressBar).
    let id: ReturnType<typeof setInterval> | undefined;
    const raf = requestAnimationFrame(() => {
      setNow(new Date());
      id = setInterval(() => setNow(new Date()), 30000);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (id !== undefined) {
        clearInterval(id);
      }
    };
  }, []);

  return useMemo(() => {
    if (!now) {
      return null;
    }
    const offset = cairoOffsetHours(now);
    const schedule = cairoPrayerSchedule(now);
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
    const nowHours = fixHour(utcHours + offset);
    const next = nextPrayer(schedule, nowHours);
    const utcMidnight = utcMidnightOf(now);
    const timeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Africa/Cairo",
    });
    const fmt = (hours: number): string => timeFmt.format(new Date(utcMidnight + (hours - offset) * 3600000));
    const hijriFmt = new Intl.DateTimeFormat(
      locale === "ar" ? "ar-EG-u-ca-islamic-umalqura" : "en-u-ca-islamic-umalqura",
      { day: "numeric", month: "long", year: "numeric" }
    );
    const totalMin = Math.max(0, Math.round(next.inHours * 60));
    const cdH = Math.floor(totalMin / 60);
    const cdM = totalMin % 60;
    return {
      hijri: hijriFmt.format(now),
      times: [
        { key: "fajr", label: t.prayerFajr, value: fmt(schedule.fajr) },
        { key: "sunrise", label: t.prayerSunrise, value: fmt(schedule.sunrise) },
        { key: "dhuhr", label: t.prayerDhuhr, value: fmt(schedule.dhuhr) },
        { key: "asr", label: t.prayerAsr, value: fmt(schedule.asr) },
        { key: "maghrib", label: t.prayerMaghrib, value: fmt(schedule.maghrib) },
        { key: "isha", label: t.prayerIsha, value: fmt(schedule.isha) },
      ],
      nextKey: next.key,
      countdown: cdH > 0 ? `${cdH}:${String(cdM).padStart(2, "0")}` : `${cdM}:00`,
    };
  }, [now, locale, t]);
}

export type { HijriPrayerModel };
