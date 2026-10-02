import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

export const studentOnboardingAr: StudentOnboardingLabels = {
  title: "تجهيز حساب طالب",
  sections: {
    profile: "بيانات الطالب",
    parent: "ولي الأمر (اختياري)",
    plan: "الخطة",
    payment: "الدفع اليدوي",
  },
  fields: {
    fullName: "الاسم الكامل",
    email: "البريد الإلكتروني",
    phone: "رقم الهاتف",
    phoneInvalid: "يرجى إدخال رقم هاتف صحيح.",
    password: "كلمة المرور الأولية",
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
    generatePassword: "توليد كلمة مرور قوية",
    gender: "الجنس",
    country: "الدولة",
  },
  strength: {
    weak: "ضعيفة",
    fair: "مقبولة",
    good: "جيدة",
    strong: "قوية",
  },
  parentSection: {
    none: "بدون ولي أمر — يُربط لاحقاً",
    loadingParents: "جارٍ تحميل أولياء الأمور…",
    linkedTo: "مرتبط بـ",
    searchPlaceholder: "ابحث بالاسم أو البريد الإلكتروني",
  },
  planSection: {
    sessions: count => {
      if (count === 1) return "جلسة واحدة";
      if (count === 2) return "جلستان";
      // CLDR Arabic classes: one/two apply to n = 1/2 EXACTLY; few = 3–10
      // (counted plural جلسات); many/other = 11–99 and the ×100 re-entries
      // (tamyiz singular جلسة).
      const cycle = count % 100;
      if (cycle >= 3 && cycle <= 10) return `${count} جلسات`;
      return `${count} جلسة`;
    },
    intervalDays: days => {
      if (days === 1) return "دورة كل يوم واحد";
      if (days === 2) return "دورة كل يومين";
      // Same CLDR class branches as the session count (the counted noun
      // flips to يوم/أيام/يوماً).
      const cycle = days % 100;
      if (cycle >= 3 && cycle <= 10) return `دورة كل ${days} أيام`;
      return `دورة كل ${days} يوماً`;
    },
    emptyCatalog: "لا توجد خطط نشطة متاحة بعد. يجب أن تكون هناك خطة نشطة قبل تجهيز الطالب.",
    loadingPlans: "جارٍ تحميل الخطط النشطة…",
    lane: {
      hifz: "حفظ القرآن",
      tajweed: "تجويد",
      reviews: "مراجعة",
    },
  },
  paymentSection: {
    methods: {
      offlineCash: "نقداً عند الاستلام",
      bankTransfer: "تحويل بنكي",
      scholarship: "منحة",
    },
    reference: "مرجع الدفع",
    referenceHelper: "رقم الإيصال أو أمر التحويل، من 1 إلى 255 حرفاً — ويجب أن يكون فريداً لكل اشتراك.",
    generateReference: "توليد مرجع للمنحة",
    referenceCleaned: "نُظِّف المرجع تلقائياً (أُزيلت المسافات الزائدة).",
  },
  actions: {
    submit: "تجهيز الطالب",
    cancel: "إلغاء",
    saving: "جارٍ الحفظ...",
    submitHint: "Ctrl + Enter للتجهيز",
  },
  draft: {
    restored: "تمت استعادة مسودتك غير المحفوظة.",
    clear: "مسح المسودة",
    progressLabel: "نسبة اكتمال بيانات التجهيز",
    progressValue: percent => `اكتمل ${percent}٪`,
    savedAt: time => `حُفظت في ${time}`,
  },
  success: {
    title: "تم تجهيز حساب الطالب",
    handshakeCode: code => `رمز الربط بولي الأمر: ${code}`,
    balanceCredited: count => {
      if (count === 1) return "تمت إضافة جلسة واحدة إلى رصيد الطالب.";
      if (count === 2) return "تمت إضافة جلستين إلى رصيد الطالب.";
      // Same CLDR class branches as `planSection.sessions`.
      const cycle = count % 100;
      if (cycle >= 3 && cycle <= 10) return `تمت إضافة ${count} جلسات إلى رصيد الطالب.`;
      return `تمت إضافة ${count} جلسة إلى رصيد الطالب.`;
    },
    copyCode: "نسخ الرمز",
    codeCopied: "تم نسخ الرمز",
    copyDetails: "نسخ تفاصيل التسليم",
    detailsCopied: "تم نسخ التفاصيل",
    copyFailed: "تعذّر النسخ — حدّد النص وانسخه يدوياً.",
    recentTitle: "تم تجهيزهم مؤخراً",
    onboardAnother: "تجهيز طالب آخر",
    onboardAnotherSamePlan: "آخر طالب بنفس الخطة",
    done: "تم",
  },
  errors: {
    methodRequired: "اختر طريقة دفع يدوية.",
    methodNotOffline: "طريقة الدفع المحددة غير مدعومة في تجهيز الطلاب المباشر.",
    referenceInvalid: "أدخل مرجع دفع يتكوّن من 1 إلى 255 حرفاً.",
    planInactive: "الخطة المحددة لم تعد نشطة. اختر خطة أخرى.",
    planLaneUnconfigured: "لا يمكن للخطة المحددة إضافة رصيد جلسات لأن مسار الرصيد المخصص لها غير مهيأ.",
    parentRoleInvalid: "الحساب المحدد ليس حساب ولي أمر.",
    parentsRowMissing: "حساب ولي الأمر المحدد غير جاهز للربط بعد.",
    duplicateReference: "مرجع الدفع هذا مستخدم بالفعل في اشتراك آخر.",
  },
};
