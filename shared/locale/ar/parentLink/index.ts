import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

export const parentLinkAr: ParentLinkLabels = {
  studentPageTitle: "طلبات الربط",
  studentPageSubtitle: "راجع طلبات أولياء الأمور الراغبين في الربط بحسابك.",
  incomingEmptyTitle: "لا توجد طلبات ربط بعد",
  incomingEmptyBody: "عندما يرسل ولي أمر طلب ربط، سيظهر هنا.",
  listSummaryLabel: "ملخص حالات الطلبات",
  summaryCountChip: (statusLabel: string, count: number) => `${statusLabel} · ${count.toLocaleString("ar")}`,
  incomingHintBody: "طلبات الربط الجديدة من أولياء الأمور ستظهر هنا.",
  fromLabel: "من",
  sentAtLabel: "أُرسل في",
  expiresLine: (date: string) => `ينتهي في ${date}`,
  statusPending: "قيد الانتظار",
  statusConfirmed: "تم التأكيد",
  statusRejected: "مرفوض",
  statusExpired: "منتهي",
  confirmAction: "تأكيد",
  rejectAction: "رفض",
  confirmDialogTitle: "تأكيد طلب الربط هذا؟",
  confirmDialogBody: (parentName: string) => `سيتم ربط ${parentName} بحسابك وسيتمكن من متابعة تقدمك.`,
  rejectDialogTitle: "رفض طلب الربط هذا؟",
  rejectDialogBody: (parentName: string) => `لن يتم ربط ${parentName} بحسابك. يمكنه إرسال طلب جديد لاحقاً.`,
  confirmSuccessToast: "تم تأكيد طلب الربط.",
  rejectSuccessToast: "تم رفض طلب الربط.",
  dashboardCardTitle: "طلبات ربط قيد الانتظار",
  // Plural classes mirror the card's render contract (branch 4 is N ≥ 1 —
  // the card renders null at zero, so there is deliberately NO 0 branch,
  // matching the en map's structure): 1 / 2 / 3–10 / 11+.
  dashboardCardCount: (count: number) => {
    if (count === 1) return "طلب ربط واحد قيد الانتظار";
    if (count === 2) return "طلبا ربط قيد الانتظار";
    if (count <= 10) return `${count.toLocaleString("ar")} طلبات ربط قيد الانتظار`;
    return `${count.toLocaleString("ar")} طلب ربط قيد الانتظار`;
  },
  dashboardCardLatestRequester: (parentName: string) => `أحدث طلب من ${parentName}`,
  dashboardCardCta: "مراجعة الطلبات",
  dashboardCardLoading: "جارٍ تحميل طلبات الربط…",
  dashboardCardLoadError: "تعذر تحميل طلبات الربط الآن. يرجى المحاولة مرة أخرى.",
  cancelAction: "إلغاء الطلب",
  cancelDialogTitle: "إلغاء طلب الربط هذا؟",
  cancelDialogBody: "سيتم سحب هذا الطلب ولن يراه الطالب بعد الآن.",
  cancelSuccessToast: "تم إلغاء طلب الربط.",
  outgoingTitle: "الطلبات التي أرسلتها",
  outgoingEmptyTitle: "لم ترسل أي طلبات بعد",
  outgoingEmptyBody: "عندما ترسل طلب ربط، ستظهر حالته هنا.",
  sendRequestAction: "إرسال طلب ربط",
  sendRequestSuccessToast: "تم إرسال طلب الربط.",
  requestPendingNotice: "تم إرسال طلب الربط — سيبقى قيد الانتظار حتى يوافق الطالب على الربط.",
  sendUnavailableNotice: "تعذر إرسال طلب الربط الآن. يرجى المحاولة لاحقاً.",
};
