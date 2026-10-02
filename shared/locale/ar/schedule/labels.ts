import type { ScheduleLabels } from "@/shared/locale/types/schedule";

export const scheduleAr: ScheduleLabels = {
  pageTitle: "الجدول الأسبوعي",
  previousWeekLabel: "الأسبوع السابق",
  nextWeekLabel: "الأسبوع التالي",
  thisWeekLabel: "هذا الأسبوع",
  weekRangeLabel: (from: string, to: string) => `${from} – ${to}`,
  weekSessionsLabel: "جلسات الأسبوع",
  weekActiveLabel: "نشطة / قادمة",
  weekCompletedLabel: "مكتملة",
  weekCancelledLabel: "ملغاة",
  todayChip: "اليوم",
  dayColumnAria: (day: string, date: string) => `${day}، ${date}`,
  dayCountLine: (count: number) => {
    if (count === 1) return "جلسة واحدة";
    if (count === 2) return "جلستان";
    if (count >= 3 && count <= 10) return `${count} جلسات`;
    return `${count} جلسة`;
  },
  sessionChipAria: (status: string, time: string) => `${status}، ${time}`,
  emptyWeekTitle: "لا توجد جلسات هذا الأسبوع",
  emptyWeekBody:
    "تظهر الجلسات على الجدول في يوم بدايتها (أو يوم حجزها). تنقّل بين الأسابيع أو احجز جلسات لترى نشاطك التدريسي هنا.",
  errorTitle: "تعذّر تحميل الجدول",
  errorBody: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
  loadingLabel: "جارٍ تحميل الجدول",
  manageSessionsCta: "إدارة الجلسات",
};
