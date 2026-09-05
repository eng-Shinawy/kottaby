// ─── Hijri date & prayer times (Cairo) ──────────────────────────────
// Pure client-side solar astronomy — no external API. Standard
// PrayTimes-style formulas: Julian day → sun declination + equation of
// time; Egyptian General Authority angles (Fajr 19.5°, Isha 17.5°);
// Shafi'i Asr (shadow factor 1). Cairo stays on DST, so the UTC offset
// is derived per-instant from Intl. Rendered post-mount only to keep
// SSR and client markup identical (time-dependent content).

const CAIRO_LAT = 30.0444;
const CAIRO_LNG = 31.2357;
const FAJR_ANGLE = 19.5;
const ISHA_ANGLE = 17.5;
const SUNRISE_ALT_DEG = 0.833; // refraction-corrected solar disc

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
export const fixHour = (h: number): number => ((h % 24) + 24) % 24;

/** Sun declination (deg) and equation of time (hours) for a Julian day. */
function sunPosition(jd: number): { declination: number; equationOfTime: number } {
  const d = jd - 2451545.0;
  const g = (((357.529 + 0.98560028 * d) % 360) + 360) % 360;
  const q = (((280.459 + 0.98564736 * d) % 360) + 360) % 360;
  const l = (((q + 1.915 * Math.sin(toRad(g)) + 0.02 * Math.sin(toRad(2 * g))) % 360) + 360) % 360;
  const e = 23.439 - 0.00000036 * d;
  const ra = toDeg(Math.atan2(Math.cos(toRad(e)) * Math.sin(toRad(l)), Math.cos(toRad(l)))) / 15;
  const declination = toDeg(Math.asin(Math.sin(toRad(e)) * Math.sin(toRad(l))));
  const equationOfTime = q / 15 - fixHour(ra);
  return { declination, equationOfTime };
}

/** Hour angle (hours from local noon) for the sun at `angleDeg` below horizon. */
function hourAngleFor(declination: number, angleDeg: number): number {
  const cosH =
    (-Math.sin(toRad(angleDeg)) - Math.sin(toRad(declination)) * Math.sin(toRad(CAIRO_LAT))) /
    (Math.cos(toRad(declination)) * Math.cos(toRad(CAIRO_LAT)));
  return toDeg(Math.acos(Math.min(1, Math.max(-1, cosH)))) / 15;
}

/** DST-aware UTC offset (hours) for Africa/Cairo at the given instant. */
export function cairoOffsetHours(date: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      timeZoneName: "longOffset",
    }).formatToParts(date);
    const tz = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT+03:00";
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tz);
    if (!m) {
      return 3;
    }
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (Number(m[2]) + Number(m[3]) / 60);
  } catch {
    return 3;
  }
}

export interface PrayerDaySchedule {
  fajr: number;
  sunrise: number;
  dhuhr: number;
  asr: number;
  maghrib: number;
  isha: number;
}

/** Cairo prayer times as local clock hours (0-24) for the date's solar day. */
export function cairoPrayerSchedule(date: Date): PrayerDaySchedule {
  const offset = cairoOffsetHours(date);
  const jd = date.getTime() / 86400000 + 2440587.5 - CAIRO_LNG / (15 * 24);
  const { declination, equationOfTime } = sunPosition(jd);
  const dhuhr = 12 + offset - CAIRO_LNG / 15 - equationOfTime;
  const asrAltitude = toDeg(Math.atan(1 / (1 + Math.tan(toRad(Math.abs(CAIRO_LAT - declination))))));
  return {
    fajr: dhuhr - hourAngleFor(declination, FAJR_ANGLE),
    sunrise: dhuhr - hourAngleFor(declination, SUNRISE_ALT_DEG),
    dhuhr,
    asr: dhuhr + hourAngleFor(declination, -asrAltitude),
    maghrib: dhuhr + hourAngleFor(declination, SUNRISE_ALT_DEG),
    isha: dhuhr + hourAngleFor(declination, ISHA_ANGLE),
  };
}

/** Next prayer (skipping sunrise) as [key, hours-from-now-including-rollover]. */
export function nextPrayer(schedule: PrayerDaySchedule, nowHours: number): { key: string; inHours: number } {
  const order: { key: string; at: number }[] = [
    { key: "fajr", at: schedule.fajr },
    { key: "dhuhr", at: schedule.dhuhr },
    { key: "asr", at: schedule.asr },
    { key: "maghrib", at: schedule.maghrib },
    { key: "isha", at: schedule.isha },
  ];
  for (const p of order) {
    if (p.at > nowHours) {
      return { key: p.key, inHours: p.at - nowHours };
    }
  }
  return { key: "fajr", inHours: schedule.fajr + 24 - nowHours };
}

/** UTC-midnight epoch ms for the date part of `d` (module scope: the React
    compiler misreads the uppercase `Date.UTC` member as a component). */
export function utcMidnightOf(d: Date): number {
  const t = new Date(d);
  t.setUTCHours(0, 0, 0, 0);
  return t.getTime();
}
