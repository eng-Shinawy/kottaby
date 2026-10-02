import type { UpNextLabels } from "@/shared/locale/types/upNext";

export const upNextAr: UpNextLabels = {
  upNextTitle: "ما التالي؟",
  upcomingHeading: "الجلسات القادمة",
  upcomingEmpty: "لا جلسات قادمة بعد — ستظهر هنا الجلسات التي تحجزها.",
  upcomingEmptyTeacher: "لا جلسات قادمة بعد — ستظهر هنا الجلسات التي يحجزها الطلاب معك.",
  upcomingEmptyChild: "لا جلسات قادمة بعد — ستظهر هنا الجلسات التي تحجزها له.",
  upcomingEmptyParentNoChildren: "لا أبناء مرتبطين بعد — اربط ابنك لتتابع جلساته القادمة.",
  linkChildCta: "اربط ابني",
  sessionLine: (id: number) => `الجلسة #${id}`,
  bookedPrefix: "حُجزت في",
  sessionsCta: "عرض الجلسات",
  homeworkHeading: "الواجبات",
  homeworkPendingLine: (count: number) => {
    if (count === 0) return "لا واجبات بانتظار التقييم";
    if (count === 1) return "واجب واحد بانتظار التقييم";
    if (count === 2) return "واجبان بانتظار التقييم";
    if (count <= 10) return `${count} واجبات بانتظار التقييم`;
    return `${count} واجبًا بانتظار التقييم`;
  },
  homeworkAllGraded: "أحسنت! لا شيء بانتظار التقييم",
  scheduledMoreLine: (count: number) => {
    if (count === 1) return "جلسة واحدة إضافية مجدولة";
    if (count === 2) return "جلساتان إضافيتان مجدولتان";
    if (count <= 10) return `${count} جلسات إضافية مجدولة`;
    return `${count} جلسة إضافية مجدولة`;
  },
  loadingLabel: "جارٍ تحميل خطواتك التالية",
  errorBody: "تعذَّر تحميل خطواتك التالية.",
};
