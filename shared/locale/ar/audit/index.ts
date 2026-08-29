import type { AuditLabels } from "@/shared/locale/types/audit";

/**
 * Arabic labels for the admin audit-trail viewer (`audit` namespace,
 * DEV3-020 Phase 1).
 */
export const auditAr: AuditLabels = {
  // Page header
  pageTitle: "سجل التدقيق",
  pageSubtitle: "كل إجراء إداري، مسجَّل بشكل دائم لا يمكن تغييره.",

  // Async states
  loading: "جارٍ تحميل سجل التدقيق…",
  emptyStateTitle: "لا توجد إدخالات",
  emptyStateBody: "لا توجد إجراءات إدارية مطابقة للمرشحات الحالية.",
  errorStateTitle: "تعذّر تحميل سجل التدقيق",
  errorStateBody: "حدث خطأ أثناء قراءة السجل. يرجى المحاولة مرة أخرى.",
  errorStateRetry: "إعادة المحاولة",

  // Filter bar
  labelActionType: "الإجراء",
  filterActionAll: "كل الإجراءات",
  labelEntityType: "الكيان",
  filterEntityAll: "كل الكيانات",
  labelActorId: "معرّف المُنفِّذ",
  labelEntityId: "معرّف الكيان",
  labelDateFrom: "من",
  labelDateTo: "إلى",
  applyFilters: "تطبيق المرشحات",
  clearFilters: "مسح المرشحات",
  invalidDateRange: "لا يمكن أن يكون تاريخ البداية بعد تاريخ النهاية.",

  // Table
  colTimestamp: "التوقيت (UTC)",
  colActor: "المُنفِّذ",
  colAction: "الإجراء",
  colEntity: "الكيان",
  colEntityId: "معرّف الكيان",
  colDetails: "التفاصيل",
  detailsEmpty: "—",

  // Action verbs
  actionCreate: "إنشاء",
  actionUpdate: "تحديث",
  actionDelete: "حذف",
  actionOverride: "تجاوز",
  actionAdjust: "تعديل رصيد",
  actionSuspend: "إيقاف",
  actionReactivate: "إعادة تنشيط",

  // Entity families
  entityPlans: "باقة",
  entitySubscriptions: "اشتراك",
  entityOther: "أخرى",

  // Pagination
  paginationPrev: "السابق",
  paginationNext: "التالي",
  pageInfo: (from, to, total) => `${from}–${to} من ${total}`,
  tableSummary: "سجل تدقيق غير قابل للتغيير لجميع الإجراءات الإدارية",
  rowsPerPage: "عدد الصفوف",
};
