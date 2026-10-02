import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

/** The plain plan-change success line — the suppressed zero-count form. */
const PLAN_CHANGE_PLAIN = "تم تغيير الخطة.";

export const subscriptionAdminAr: SubscriptionAdminLabels = {
  title: "الاشتراكات",
  emptyState: {
    title: "لا توجد اشتراكات",
    message: "لا توجد سجلات اشتراك لهذا الطالب بعد.",
  },
  fields: {
    plan: "الخطة",
    status: "الحالة",
    start: "البداية",
    end: "النهاية",
    lastAction: "آخر إجراء تدقيق",
  },
  planFacts: {
    sessions: sessions => {
      if (sessions === 1) return "جلسة واحدة";
      if (sessions === 2) return "جلستان";
      // CLDR Arabic classes mirror `success.planChangeCarried`: one/two
      // apply to n = 1/2 EXACTLY; few = 3–10 (counted plural جلسات);
      // many/other = 11–99 and the ×100 re-entries (tamyiz singular جلسة).
      const cycle = sessions % 100;
      if (cycle >= 3 && cycle <= 10) return `${sessions} جلسات`;
      return `${sessions} جلسة`;
    },
    cycle: days => {
      if (days === 1) return "دورة كل يوم واحد";
      if (days === 2) return "دورة كل يومين";
      // Same CLDR class branches as the session count (the counted noun
      // flips to يوم/أيام/يوماً).
      const cycle = days % 100;
      if (cycle >= 3 && cycle <= 10) return `دورة كل ${days} أيام`;
      return `دورة كل ${days} يوماً`;
    },
  },
  status: {
    active: "نشط",
    expired: "منتهي",
    pending: "قيد الانتظار",
    cancelled: "ملغي",
    suspended: "موقوف",
  },
  actions: {
    extend: "تمديد",
    renew: "تجديد",
    cancel: "إلغاء الاشتراك",
    changePlan: "تغيير الخطة",
  },
  filter: {
    all: "الكل",
    empty: "لا توجد اشتراكات بهذه الحالة.",
  },
  summary: {
    nextExpiry: "أقرب انتهاء",
    nextExpiryNone: "لا توجد فترة نشطة",
  },
  expiryBadge: {
    upcoming: days => {
      if (days === 0) return "ينتهي اليوم";
      if (days === 1) return "ينتهي خلال يوم واحد";
      if (days === 2) return "ينتهي خلال يومين";
      // CLDR Arabic classes mirror `success.extend`: one/two apply to
      // n = 1/2 EXACTLY; few = 3–10 (counted plural أيام); many/other =
      // 11–99 and the ×100 re-entries (tamyiz singular يوماً).
      const cycle = days % 100;
      if (cycle >= 3 && cycle <= 10) return `ينتهي خلال ${days} أيام`;
      return `ينتهي خلال ${days} يوماً`;
    },
    past: days => {
      if (days === 1) return "انتهى منذ يوم واحد";
      if (days === 2) return "انتهى منذ يومين";
      // Same CLDR class branches as `upcoming` (the elapsed count is
      // strictly positive here, so no zero arm).
      const cycle = days % 100;
      if (cycle >= 3 && cycle <= 10) return `انتهى منذ ${days} أيام`;
      return `انتهى منذ ${days} يوماً`;
    },
  },
  copyId: {
    copy: "نسخ معرّف الاشتراك",
    copied: "تم النسخ",
  },
  auditLink: "عرض في سجل التدقيق",
  auditLinkCount: count => {
    if (count === 1) return "مدخل واحد";
    if (count === 2) return "مدخلان";
    // Same CLDR Arabic class branches as the counted-copy leaves above:
    // one/two apply to n = 1/2 EXACTLY (spelled as words — the parity
    // gate's digit-carry starts at the counted-plural class), few = 3–10
    // (counted plural مداخلات), many/other = 11–99 and the ×100
    // re-entries (tamyiz singular مدخلاً).
    const cycle = count % 100;
    if (cycle >= 3 && cycle <= 10) return `${count} مداخلات`;
    return `${count} مدخلاً`;
  },
  digest: {
    copy: "نسخ ملخص الاشتراكات",
    copied: "تم نسخ الملخص",
  },
  extend: {
    title: "تمديد الاشتراك",
    daysLabel: "عدد الأيام المضافة",
    daysHelper: "تُضاف إلى تاريخ نهاية الفترة الحالي.",
    daysInvalid: "أدخل عدد أيام صحيحاً أكبر من صفر.",
  },
  renew: {
    title: "تجديد الاشتراك",
    message: "يفتح التجديد فترة نشطة جديدة على خطة هذا الاشتراك ويضاف إلى رصيد الطالب عدد جلسات الخطة كاملاً.",
  },
  cancel: {
    title: "إلغاء الاشتراك",
    message: "يؤدي الإلغاء إلى إنهاء هذا الاشتراك مع إبقاء أرصدة جلسات الطالب كما هي دون أي تغيير.",
    reasonLabel: "السبب (اختياري)",
    reasonCounter: (count, max) => `${count}/${max} — حتى ${max} حرفاً، ويُسجَّل في سجل التدقيق.`,
  },
  changePlan: {
    title: "تغيير الخطة",
    message:
      "يُلغى الاشتراك الحالي وتفتح فترة جديدة على الخطة المحددة. لا تصلح إلا الخطط النشطة التي تُقيَّد على مسار الرصيد نفسه.",
    planLabel: "الخطة الجديدة",
    noPlans: "لا توجد خطة نشطة أخرى تُقيَّد على مسار الرصيد نفسه.",
    errorState: {
      title: "تعذر تحميل الخطط",
      message: "حدث خطأ أثناء تحميل قائمة الخطط. أعد المحاولة لتحميل الخطط مرة أخرى.",
    },
  },
  success: {
    extend: days => {
      if (days === 1) return "تم تمديد الاشتراك يوماً واحداً.";
      if (days === 2) return "تم تمديد الاشتراك يومين.";
      // CLDR Arabic classes: one/two apply to n = 1/2 EXACTLY; few = 3–10
      // (counted plural أيام); many = 11–99 (tamyiz singular يوماً);
      // everything else — including 100/101/102 and their ×100 re-entries
      // — is `other` (same tamyiz form).
      const cycle = days % 100;
      if (cycle >= 3 && cycle <= 10) return `تم تمديد الاشتراك ${days} أيام.`;
      return `تم تمديد الاشتراك ${days} يوماً.`;
    },
    renew: "تم تجديد الاشتراك — فترة جديدة نشطة الآن.",
    cancel: "تم إلغاء الاشتراك. أُبقيت أرصدة الجلسات كما هي.",
    planChange: PLAN_CHANGE_PLAIN,
    planChangeCarried: carry => {
      if (carry === 0) return PLAN_CHANGE_PLAIN;
      if (carry === 1) return "تم تغيير الخطة — تم ترحيل جلسة واحدة.";
      if (carry === 2) return "تم تغيير الخطة — تم ترحيل جلستين.";
      // Same CLDR class branches as `success.extend`.
      const cycle = carry % 100;
      if (cycle >= 3 && cycle <= 10) return `تم تغيير الخطة — تم ترحيل ${carry} جلسات.`;
      return `تم تغيير الخطة — تم ترحيل ${carry} جلسة.`;
    },
    planChangeForfeited: forfeit => {
      if (forfeit === 0) return PLAN_CHANGE_PLAIN;
      if (forfeit === 1) return "تم تغيير الخطة — تمت مصادرة جلسة واحدة متبقية.";
      if (forfeit === 2) return "تم تغيير الخطة — تمت مصادرة جلستين متبقيتين.";
      // Same CLDR class branches as `planChangeCarried`.
      const cycle = forfeit % 100;
      if (cycle >= 3 && cycle <= 10) return `تم تغيير الخطة — تمت مصادرة ${forfeit} جلسات متبقية.`;
      return `تم تغيير الخطة — تمت مصادرة ${forfeit} جلسة متبقية.`;
    },
  },
  errorState: {
    title: "تعذر تحميل الاشتراكات",
    message: "حدث خطأ أثناء تحميل اشتراكات هذا الطالب.",
    retry: "إعادة المحاولة",
  },
  genericError: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
};
