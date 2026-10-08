/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type AdjustTeacherWalletInput = {
  amount: string;
  direction: WalletAdjustmentDirection;
  reason: string;
  teacherId: string | number;
};

/** Why a student is flagged as needing academic attention (reasons may co-occur). */
export enum AdminAcademicAttentionReason {
  LowGrade = 'lowGrade',
  StaleProgress = 'staleProgress'
}

export type AdminApplicantFiltersInput = {
  search: string | null | undefined;
  status: string | null | undefined;
};

export enum AdminApplicantOverrideAction {
  Certify = 'Certify',
  GrantReEvaluation = 'GrantReEvaluation',
  Reject = 'Reject'
}

export type AdminAuditLogFiltersInput = {
  actionType: AuditActionType | null | undefined;
  actorId: number | null | undefined;
  entityId: number | null | undefined;
  entityType: string | null | undefined;
  from: string | null | undefined;
  to: string | null | undefined;
};

export type AdminBroadcastFiltersInput = {
  audienceType: BroadcastAudienceType | null | undefined;
  status: BroadcastStatus | null | undefined;
  titleSearch: string | null | undefined;
};

export type AdminBroadcastNotificationInput = {
  audience: BroadcastAudienceInput;
  body: string | null | undefined;
  title: string;
};

export type AdminCreateUserInput = {
  country: string;
  email: string;
  fullName: string;
  gender: Gender | null | undefined;
  password: string;
  phone: string;
  role: RegisterPublicRole;
};

export type AdminOnboardStudentOfflineInput = {
  /** The student's country of residence. */
  country: string;
  /** The student's login email — globally unique; a duplicate conflicts. */
  email: string;
  /** The student's full name, stored on the new user row. */
  fullName: string;
  /** Optional gender; omitted leaves the student's gender unset. */
  gender: Gender | null | undefined;
  /** Optional id of the parent to link to the new student; omitted or null onboards unlinked. Must reference an existing parent user (server-validated). */
  parentId: number | null | undefined;
  /** Admin-authored initial password for the new student account. */
  password: string;
  /** Offline payment method of the collection (offline cash, bank transfer, or scholarship); online gateways are rejected server-side. */
  paymentMethod: PaymentGateway;
  /** Human reference of the offline payment (1–255 characters after trimming; unique across subscriptions). */
  paymentReference: string;
  /** The student's contact phone number. */
  phone: string;
  /** Id of the subscription plan to activate (must be an active plan with a configured credit lane; server-validated). */
  planId: number;
};

export type AdminSessionCancelInput = {
  reason: string | null | undefined;
  sessionId: string | number;
};

export type AdminSessionJoinInput = {
  sessionId: string | number;
};

export type AdminSessionListFilterInput = {
  dateFrom: string | null | undefined;
  dateTo: string | null | undefined;
  status: SessionStatus | null | undefined;
  studentUserId: number | null | undefined;
  teacherUserId: number | null | undefined;
  type: SessionType | null | undefined;
};

export type AdminSessionReassignInput = {
  newTeacherUserId: string | number;
  sessionId: string | number;
};

export type AdminSessionRescheduleInput = {
  endedAt: string;
  sessionId: string | number;
  startedAt: string;
};

export type AdminSetUserPasswordInput = {
  mustChangePassword: boolean;
  password: string;
};

export type AdminStudentFiltersInput = {
  hasParent: boolean | null | undefined;
  language: string | null | undefined;
  search: string | null | undefined;
};

export type AdminStudentPaymentsFilterInput = {
  from: string | null | undefined;
  paymentGateway: PaymentGateway | null | undefined;
  status: PaymentStatus | null | undefined;
  studentId: string | number | null | undefined;
  studentName: string | null | undefined;
  to: string | null | undefined;
};

export type AdminTeacherFiltersInput = {
  approval: boolean | null | undefined;
  evaluator: boolean | null | undefined;
  online: boolean | null | undefined;
  search: string | null | undefined;
};

export type AdminUpdateUserInput = {
  country: string | null | undefined;
  dateOfBirth: string | null | undefined;
  fullName: string | null | undefined;
  gender: Gender | null | undefined;
  phone: string | null | undefined;
};

export type AdminUserFiltersInput = {
  applicantStatus: ApplicantStatus | null | undefined;
  cooldownExpiringSoon: boolean | null | undefined;
  cooldownState: ApplicantCooldownState | null | undefined;
  country: string | null | undefined;
  governance: AdminUserGovernanceFilter | null | undefined;
  role: UserRole | null | undefined;
  search: string | null | undefined;
};

export enum AdminUserGovernanceFilter {
  Active = 'Active',
  Blocked = 'Blocked',
  Deleted = 'Deleted',
  Suspended = 'Suspended'
}

export type AdminWalletTransactionFilterInput = {
  from: string | null | undefined;
  status: TransactionStatus | null | undefined;
  to: string | null | undefined;
  type: TransactionType | null | undefined;
};

export enum AppLocale {
  Ar = 'Ar',
  En = 'En'
}

export enum ApplicantCooldownState {
  Active = 'Active',
  Expired = 'Expired',
  None = 'None'
}

export enum ApplicantStatus {
  Failed = 'Failed',
  InEvaluation = 'InEvaluation',
  Passed = 'Passed',
  Pending = 'Pending'
}

export enum AuditActionType {
  Adjust = 'Adjust',
  Create = 'Create',
  Delete = 'Delete',
  Override = 'Override',
  Reactivate = 'Reactivate',
  Suspend = 'Suspend',
  Update = 'Update'
}

export type BookEvaluationSessionInput = {
  /** The bookable evaluator's users.id — the ONLY client-owned field. */
  evaluatorId: string | number;
};

export type BroadcastAudienceInput = {
  country: string | null | undefined;
  planId: number | null | undefined;
  role: UserRole | null | undefined;
  type: BroadcastAudienceType;
};

export enum BroadcastAudienceType {
  All = 'All',
  Country = 'Country',
  Plan = 'Plan',
  Role = 'Role'
}

export enum BroadcastStatus {
  Active = 'Active',
  Stopped = 'Stopped'
}

/** Input for cancelling an active subscription while preserving its balance lanes. */
export type CancelSubscriptionInput = {
  /** Optional free-text reason for the cancellation (trimmed and bounded to 200 characters server-side). */
  reason: string | null | undefined;
  /** ID of the active subscription row to cancel. */
  subscriptionId: string | number;
};

export type ChangeMyPasswordInput = {
  currentPassword: string;
  newPassword: string;
};

/** Input for changing an active subscription onto a different plan in the same balance lane. */
export type ChangeSubscriptionPlanInput = {
  /** ID of the target plan (must be active and credit the same balance lane; server-guarded). */
  newPlanId: string | number;
  /** ID of the active subscription row to re-plan. */
  subscriptionId: string | number;
};

/** Input fields required to create a new lesson. */
export type CreateLessonInput = {
  /** Identifier of the subscription plan this lesson belongs to. */
  planId: number;
  /** Short human-readable label of the lesson. */
  title: string;
};

/** Input fields required to create a new subscription plan. */
export type CreatePlanInput = {
  /** Balance lane to assign to the plan. Omitted or null leaves the plan unconfigured — purchases fail closed until a lane is set. */
  balanceLane: SubscriptionCreditLane | null | undefined;
  /** 3-letter uppercase currency code (e.g. 'EGP'). */
  currency: string;
  /** Plan duration in days (integer >= 1). */
  intervalDays: number;
  /** Exact price formatted as numeric string (e.g. '150.00'). */
  price: string;
  /** Total sessions included (integer >= 1). */
  sessionCount: number;
  /** Plan title (1..255 characters). */
  title: string;
};

export type CreateSessionInput = {
  intent: SessionIntent;
  teacherId: string | number;
};

export enum DisputeResolution {
  Cancel = 'Cancel',
  Complete = 'Complete',
  PartialRefund = 'PartialRefund',
  Refund = 'Refund',
  Uphold = 'Uphold'
}

/** Input for extending an active subscription's validity window. */
export type ExtendSubscriptionInput = {
  /** Whole number of days to add to the window's current end (>= 1, server-validated). */
  days: number;
  /** ID of the subscription row to extend. */
  subscriptionId: string | number;
};

export enum Gender {
  Female = 'Female',
  Male = 'Male',
  Other = 'Other'
}

export type HomeWorkAssignmentInput = {
  jadid: HomeWorkBlockInput | null | undefined;
  madi: HomeWorkBlockInput | null | undefined;
};

export type HomeWorkBlockInput = {
  fromAyah: number;
  surahJuz: SurahJuzRef;
  toAyah: number;
};

export type HomeWorkGradeInput = {
  currentGrade: number;
  revisionGrade: number;
};

export enum LinkStatus {
  Confirmed = 'Confirmed',
  Expired = 'Expired',
  Pending = 'Pending',
  Rejected = 'Rejected'
}

export type MyNotificationsFilterInput = {
  isRead: boolean | null | undefined;
  limit: number | null | undefined;
  offset: number | null | undefined;
  type: NotificationType | null | undefined;
};

export enum NotificationType {
  ApplicantOutcome = 'ApplicantOutcome',
  EvaluationResult = 'EvaluationResult',
  ParentLinkRequest = 'ParentLinkRequest',
  PaymentConfirmation = 'PaymentConfirmation',
  SessionCancellation = 'SessionCancellation',
  SessionCompletion = 'SessionCompletion',
  SessionDisputeOpened = 'SessionDisputeOpened',
  SessionDisputeResolved = 'SessionDisputeResolved',
  SessionRequest = 'SessionRequest',
  SystemBroadcast = 'SystemBroadcast'
}

export enum PaymentGateway {
  BankTransfer = 'BankTransfer',
  Fawry = 'Fawry',
  Mock = 'Mock',
  OfflineCash = 'OfflineCash',
  Other = 'Other',
  Paymob = 'Paymob',
  Paypal = 'Paypal',
  Scholarship = 'Scholarship',
  Stripe = 'Stripe'
}

export enum PaymentStatus {
  Failed = 'Failed',
  Paid = 'Paid',
  Pending = 'Pending',
  Refunded = 'Refunded'
}

export enum ProrationDirection {
  Downgrade = 'Downgrade',
  Upgrade = 'Upgrade'
}

/** Whitelist for a purchase attempt — the plan selector is the only client-owned field. */
export type PurchaseSubscriptionInput = {
  /** ID of the subscription plan to purchase. */
  planId: string | number;
};

export enum RecitationReading {
  AlBazziAnIbnKathir = 'AL_BAZZI_AN_IBN_KATHIR',
  AlDuriAnAbiAmr = 'AL_DURI_AN_ABI_AMR',
  AlSusiAnAbiAmr = 'AL_SUSI_AN_ABI_AMR',
  HafsAnAsim = 'HAFS_AN_ASIM',
  KhalafAnHamzah = 'KHALAF_AN_HAMZAH',
  KhalladAnAsim = 'KHALLAD_AN_ASIM',
  QalunAnNafi = 'QALUN_AN_NAFI',
  QunbulAnIbnKathir = 'QUNBUL_AN_IBN_KATHIR',
  ShubahAnAsim = 'SHUBAH_AN_ASIM',
  WarshAnNafi = 'WARSH_AN_NAFI'
}

export enum RegisterPublicRole {
  Parent = 'Parent',
  Student = 'Student',
  Teacher = 'Teacher'
}

export type RegisterUserInput = {
  country: string;
  email: string;
  fullName: string;
  gender: Gender | null | undefined;
  password: string;
  phone: string;
  preferredRecitation: RecitationReading | null | undefined;
  role: RegisterPublicRole;
};

/** Input for renewing an expired subscription into a fresh active period. */
export type RenewSubscriptionInput = {
  /** ID of the expired subscription row to renew. */
  subscriptionId: string | number;
};

export type RequestWithdrawalInput = {
  /** The payout amount as a decimal string (e.g. "125.00"). */
  amount: string;
};

export type RubricEvaluationSubmitInput = {
  /** Qualitative observations (trimmed non-empty, <= 2000 chars). */
  notes: string;
  /** Integer 0..100 — the per-evaluation verdict is DERIVED (score >= 80), never supplied. */
  score: number;
  /** Failure area — required iff score < 80, forbidden otherwise. */
  weaknessArea: RubricWeaknessArea | null | undefined;
};

export enum RubricWeaknessArea {
  Hifz = 'Hifz',
  Tajweed = 'Tajweed'
}

export enum SessionIntent {
  Evaluation = 'Evaluation',
  Hifz = 'Hifz',
  Tajweed = 'Tajweed'
}

export type SessionListFilterInput = {
  status: SessionStatus | null | undefined;
};

export type SessionRecitationInput = {
  description: string | null | undefined;
  name: string;
};

export enum SessionStatus {
  Cancelled = 'Cancelled',
  Completed = 'Completed',
  Disputed = 'Disputed',
  Scheduled = 'Scheduled',
  Started = 'Started'
}

export enum SessionType {
  ReEvaluation = 'ReEvaluation',
  StudentSession = 'StudentSession',
  TeacherEvaluation = 'TeacherEvaluation'
}

export type SubmitSessionReportInput = {
  homework: HomeWorkAssignmentInput | null | undefined;
  previousGrades: HomeWorkGradeInput | null | undefined;
  studentRatingByTeacher: number;
  teacherNotes: string;
};

export type SubmitTeacherEvaluationInput = {
  rating: number;
};

export enum SubscriptionCreditLane {
  Hifz = 'Hifz',
  Reviews = 'Reviews',
  Tajweed = 'Tajweed'
}

export enum SubscriptionStatus {
  Active = 'Active',
  Cancelled = 'Cancelled',
  Expired = 'Expired',
  Pending = 'Pending',
  Suspended = 'Suspended'
}

export enum SurahJuzRef {
  Juz1 = 'Juz1',
  Juz2 = 'Juz2',
  Juz3 = 'Juz3',
  Juz4 = 'Juz4',
  Juz5 = 'Juz5',
  Juz6 = 'Juz6',
  Juz7 = 'Juz7',
  Juz8 = 'Juz8',
  Juz9 = 'Juz9',
  Juz10 = 'Juz10',
  Juz11 = 'Juz11',
  Juz12 = 'Juz12',
  Juz13 = 'Juz13',
  Juz14 = 'Juz14',
  Juz15 = 'Juz15',
  Juz16 = 'Juz16',
  Juz17 = 'Juz17',
  Juz18 = 'Juz18',
  Juz19 = 'Juz19',
  Juz20 = 'Juz20',
  Juz21 = 'Juz21',
  Juz22 = 'Juz22',
  Juz23 = 'Juz23',
  Juz24 = 'Juz24',
  Juz25 = 'Juz25',
  Juz26 = 'Juz26',
  Juz27 = 'Juz27',
  Juz28 = 'Juz28',
  Juz29 = 'Juz29',
  Juz30 = 'Juz30',
  SurahAalImran = 'SurahAalImran',
  SurahAbasa = 'SurahAbasa',
  SurahAdDhariyat = 'SurahAdDhariyat',
  SurahAdDuha = 'SurahAdDuha',
  SurahAdDukhan = 'SurahAdDukhan',
  SurahAlAdiyat = 'SurahAlAdiyat',
  SurahAlAhqaf = 'SurahAlAhqaf',
  SurahAlAhzab = 'SurahAlAhzab',
  SurahAlAla = 'SurahAlAla',
  SurahAlAlaq = 'SurahAlAlaq',
  SurahAlAnam = 'SurahAlAnam',
  SurahAlAnbiya = 'SurahAlAnbiya',
  SurahAlAnfal = 'SurahAlAnfal',
  SurahAlAnkabut = 'SurahAlAnkabut',
  SurahAlAraf = 'SurahAlAraf',
  SurahAlAsr = 'SurahAlAsr',
  SurahAlBalad = 'SurahAlBalad',
  SurahAlBaqarah = 'SurahAlBaqarah',
  SurahAlBayyinah = 'SurahAlBayyinah',
  SurahAlBuruj = 'SurahAlBuruj',
  SurahAlFajr = 'SurahAlFajr',
  SurahAlFalaq = 'SurahAlFalaq',
  SurahAlFath = 'SurahAlFath',
  SurahAlFatihah = 'SurahAlFatihah',
  SurahAlFil = 'SurahAlFil',
  SurahAlFurqan = 'SurahAlFurqan',
  SurahAlGhashiyah = 'SurahAlGhashiyah',
  SurahAlHadid = 'SurahAlHadid',
  SurahAlHajj = 'SurahAlHajj',
  SurahAlHaqqah = 'SurahAlHaqqah',
  SurahAlHashr = 'SurahAlHashr',
  SurahAlHijr = 'SurahAlHijr',
  SurahAlHujurat = 'SurahAlHujurat',
  SurahAlHumazah = 'SurahAlHumazah',
  SurahAlIkhlas = 'SurahAlIkhlas',
  SurahAlInfitar = 'SurahAlInfitar',
  SurahAlInsan = 'SurahAlInsan',
  SurahAlInshiqaq = 'SurahAlInshiqaq',
  SurahAlIsra = 'SurahAlIsra',
  SurahAlJathiyah = 'SurahAlJathiyah',
  SurahAlJinn = 'SurahAlJinn',
  SurahAlJumuah = 'SurahAlJumuah',
  SurahAlKafirun = 'SurahAlKafirun',
  SurahAlKahf = 'SurahAlKahf',
  SurahAlKawthar = 'SurahAlKawthar',
  SurahAlLayl = 'SurahAlLayl',
  SurahAlMaarij = 'SurahAlMaarij',
  SurahAlMaidah = 'SurahAlMaidah',
  SurahAlMasad = 'SurahAlMasad',
  SurahAlMaun = 'SurahAlMaun',
  SurahAlMuddaththir = 'SurahAlMuddaththir',
  SurahAlMujadilah = 'SurahAlMujadilah',
  SurahAlMulk = 'SurahAlMulk',
  SurahAlMuminun = 'SurahAlMuminun',
  SurahAlMumtahanah = 'SurahAlMumtahanah',
  SurahAlMunafiqun = 'SurahAlMunafiqun',
  SurahAlMursalat = 'SurahAlMursalat',
  SurahAlMutaffifin = 'SurahAlMutaffifin',
  SurahAlMuzzammil = 'SurahAlMuzzammil',
  SurahAlQadr = 'SurahAlQadr',
  SurahAlQalam = 'SurahAlQalam',
  SurahAlQamar = 'SurahAlQamar',
  SurahAlQariah = 'SurahAlQariah',
  SurahAlQasas = 'SurahAlQasas',
  SurahAlQiyamah = 'SurahAlQiyamah',
  SurahAlWaqiah = 'SurahAlWaqiah',
  SurahAnNaba = 'SurahAnNaba',
  SurahAnNahl = 'SurahAnNahl',
  SurahAnNajm = 'SurahAnNajm',
  SurahAnNaml = 'SurahAnNaml',
  SurahAnNas = 'SurahAnNas',
  SurahAnNasr = 'SurahAnNasr',
  SurahAnNaziat = 'SurahAnNaziat',
  SurahAnNisa = 'SurahAnNisa',
  SurahAnNur = 'SurahAnNur',
  SurahArRad = 'SurahArRad',
  SurahArRahman = 'SurahArRahman',
  SurahArRum = 'SurahArRum',
  SurahAsSaff = 'SurahAsSaff',
  SurahAsSaffat = 'SurahAsSaffat',
  SurahAsSajdah = 'SurahAsSajdah',
  SurahAshShams = 'SurahAshShams',
  SurahAshSharh = 'SurahAshSharh',
  SurahAshShuara = 'SurahAshShuara',
  SurahAshShura = 'SurahAshShura',
  SurahAtTaghabun = 'SurahAtTaghabun',
  SurahAtTahrim = 'SurahAtTahrim',
  SurahAtTakathur = 'SurahAtTakathur',
  SurahAtTakwir = 'SurahAtTakwir',
  SurahAtTalaq = 'SurahAtTalaq',
  SurahAtTariq = 'SurahAtTariq',
  SurahAtTawbah = 'SurahAtTawbah',
  SurahAtTin = 'SurahAtTin',
  SurahAtTur = 'SurahAtTur',
  SurahAzZalzalah = 'SurahAzZalzalah',
  SurahAzZukhruf = 'SurahAzZukhruf',
  SurahAzZumar = 'SurahAzZumar',
  SurahFatir = 'SurahFatir',
  SurahFussilat = 'SurahFussilat',
  SurahGhafir = 'SurahGhafir',
  SurahHud = 'SurahHud',
  SurahIbrahim = 'SurahIbrahim',
  SurahLuqman = 'SurahLuqman',
  SurahMaryam = 'SurahMaryam',
  SurahMuhammad = 'SurahMuhammad',
  SurahNuh = 'SurahNuh',
  SurahQaf = 'SurahQaf',
  SurahQuraysh = 'SurahQuraysh',
  SurahSaba = 'SurahSaba',
  SurahSad = 'SurahSad',
  SurahTaHa = 'SurahTaHa',
  SurahYaSin = 'SurahYaSin',
  SurahYunus = 'SurahYunus',
  SurahYusuf = 'SurahYusuf'
}

export enum TeacherMatchingSort {
  NameAsc = 'NameAsc',
  Newest = 'Newest',
  RatingDesc = 'RatingDesc'
}

export enum TransactionStatus {
  Completed = 'Completed',
  Failed = 'Failed',
  Pending = 'Pending'
}

export enum TransactionType {
  ArbitrationReversal = 'ArbitrationReversal',
  Bonus = 'Bonus',
  Earning = 'Earning',
  Withdrawal = 'Withdrawal'
}

/** Input fields accepted when updating an existing lesson. */
export type UpdateLessonInput = {
  /** New identifier of the subscription plan this lesson belongs to. */
  planId: number | null | undefined;
  /** New short human-readable label of the lesson. */
  title: string | null | undefined;
};

/** Mutable fields for updating an existing subscription plan. */
export type UpdatePlanInput = {
  /** Updated balance lane. Omitted leaves the stored lane untouched; null clears it (purchases fail closed while unconfigured). */
  balanceLane: SubscriptionCreditLane | null | undefined;
  /** Updated currency code. */
  currency: string | null | undefined;
  /** Updated duration in days. */
  intervalDays: number | null | undefined;
  /** Updated price string. */
  price: string | null | undefined;
  /** Updated session count. */
  sessionCount: number | null | undefined;
  /** Updated plan title. */
  title: string | null | undefined;
};

export enum UserRole {
  Admin = 'Admin',
  Parent = 'Parent',
  Student = 'Student',
  Teacher = 'Teacher'
}

export enum WalletAdjustmentDirection {
  Credit = 'Credit',
  Debit = 'Debit'
}

export type AdminAcademicDashboardQuery_adminAcademicDashboard_items_latestJadidPosition = { surahJuz: SurahJuzRef, fromAyah: number | null, toAyah: number | null };

export type AdminAcademicDashboardQuery_adminAcademicDashboard_items_latestMadiPosition = { surahJuz: SurahJuzRef, fromAyah: number | null, toAyah: number | null };

export type AdminAcademicDashboardQuery_adminAcademicDashboard_items_jadidGradeSummary = { gradedCount: number, averageGrade: number | null };

export type AdminAcademicDashboardQuery_adminAcademicDashboard_items_madiGradeSummary = { gradedCount: number, averageGrade: number | null };

export type AdminAcademicDashboardQuery_adminAcademicDashboard_items_needsAttention = { reasons: Array<AdminAcademicAttentionReason> };

export type AdminAcademicDashboardQuery_adminAcademicDashboard_items = { id: string, fullName: string, email: string, progressRowCount: number, lastGradedHomeworkAt: string | null, latestJadidPosition: AdminAcademicDashboardQuery_adminAcademicDashboard_items_latestJadidPosition | null, latestMadiPosition: AdminAcademicDashboardQuery_adminAcademicDashboard_items_latestMadiPosition | null, jadidGradeSummary: AdminAcademicDashboardQuery_adminAcademicDashboard_items_jadidGradeSummary | null, madiGradeSummary: AdminAcademicDashboardQuery_adminAcademicDashboard_items_madiGradeSummary | null, needsAttention: AdminAcademicDashboardQuery_adminAcademicDashboard_items_needsAttention | null };

export type AdminAcademicDashboardQuery_adminAcademicDashboard_stats = { trackedStudentCount: number, studentsWithGradedHomeworkCount: number, averageJadidGrade: number | null, averageMadiGrade: number | null, needingAttentionCount: number };

export type AdminAcademicDashboardQuery_adminAcademicDashboard = { total: number, page: number, pageSize: number, pageCount: number, items: Array<AdminAcademicDashboardQuery_adminAcademicDashboard_items>, stats: AdminAcademicDashboardQuery_adminAcademicDashboard_stats };

export type AdminAcademicDashboardQuery = { adminAcademicDashboard: AdminAcademicDashboardQuery_adminAcademicDashboard };


export type AdminAcademicDashboardQueryVariables = Exact<{
  page: number | null | undefined;
  pageSize: number | null | undefined;
  search: string | null | undefined;
}>;

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_student = { id: string, fullName: string, email: string, isDeleted: boolean };

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage_items_jadid = { surahJuz: SurahJuzRef | null, fromAyah: number | null, toAyah: number | null, grade: number | null };

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage_items_madi = { surahJuz: SurahJuzRef | null, fromAyah: number | null, toAyah: number | null, grade: number | null };

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage_items = { id: string, sessionId: number, sessionStartedAt: string | null, teacherName: string, createdAt: string, jadid: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage_items_jadid | null, madi: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage_items_madi | null };

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage = { total: number, page: number, pageSize: number, pageCount: number, items: Array<AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage_items> };

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_reportPage_items = { id: string, sessionId: number, sessionStartedAt: string | null, teacherName: string, teacherNotes: string | null, studentRatingByTeacher: number | null, createdAt: string };

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_reportPage = { total: number, page: number, pageSize: number, pageCount: number, items: Array<AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_reportPage_items> };

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_needsAttention = { reasons: Array<AdminAcademicAttentionReason> };

export type AdminStudentAcademicDetailQuery_adminStudentAcademicDetail = { progressRowCount: number, student: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_student, homeworkPage: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage, reportPage: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_reportPage, needsAttention: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_needsAttention | null };

export type AdminStudentAcademicDetailQuery = { adminStudentAcademicDetail: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail };


export type AdminStudentAcademicDetailQueryVariables = Exact<{
  studentId: number;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type AdminStudentPaymentsQuery_adminStudentPayments_items = { id: string, studentId: string, studentName: string, subscriptionId: string | null, amount: string, currency: string, paymentGateway: PaymentGateway, status: PaymentStatus, createdAt: string };

export type AdminStudentPaymentsQuery_adminStudentPayments = { totalCount: number, page: number, pageSize: number, items: Array<AdminStudentPaymentsQuery_adminStudentPayments_items> };

export type AdminStudentPaymentsQuery = { adminStudentPayments: AdminStudentPaymentsQuery_adminStudentPayments };


export type AdminStudentPaymentsQueryVariables = Exact<{
  filters: AdminStudentPaymentsFilterInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type AdminTeacherWalletQuery_adminTeacherWallet_transactions = { id: string, type: TransactionType, status: TransactionStatus, amount: string, description: string | null, sessionId: string | null, createdAt: string };

export type AdminTeacherWalletQuery_adminTeacherWallet = { balance: string | null, totalEarning: string | null, currency: string, teacherId: string, teacherName: string, totalCount: number, page: number, pageSize: number, transactions: Array<AdminTeacherWalletQuery_adminTeacherWallet_transactions> };

export type AdminTeacherWalletQuery = { adminTeacherWallet: AdminTeacherWalletQuery_adminTeacherWallet };


export type AdminTeacherWalletQueryVariables = Exact<{
  teacherId: string | number;
  filters: AdminWalletTransactionFilterInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items_transaction = { id: string, type: TransactionType, status: TransactionStatus, amount: string, description: string | null, createdAt: string };

export type AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items = { teacherName: string, walletBalance: string, transaction: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items_transaction };

export type AdminPendingWithdrawalsQuery_adminPendingWithdrawals = { totalCount: number, totalAmount: string, page: number, pageSize: number, items: Array<AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items> };

export type AdminPendingWithdrawalsQuery = { adminPendingWithdrawals: AdminPendingWithdrawalsQuery_adminPendingWithdrawals };


export type AdminPendingWithdrawalsQueryVariables = Exact<{
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type ApproveWithdrawalMutation_approveWithdrawal = { id: string, type: TransactionType, status: TransactionStatus, amount: string, description: string | null, walletId: string, sessionId: string | null, createdAt: string };

export type ApproveWithdrawalMutation = { approveWithdrawal: ApproveWithdrawalMutation_approveWithdrawal };


export type ApproveWithdrawalMutationVariables = Exact<{
  transactionId: string | number;
}>;

export type RejectWithdrawalMutation_rejectWithdrawal = { id: string, type: TransactionType, status: TransactionStatus, amount: string, description: string | null, walletId: string, sessionId: string | null, createdAt: string };

export type RejectWithdrawalMutation = { rejectWithdrawal: RejectWithdrawalMutation_rejectWithdrawal };


export type RejectWithdrawalMutationVariables = Exact<{
  transactionId: string | number;
  reason: string;
}>;

export type AdjustTeacherWalletMutation_adjustTeacherWallet = { id: string, type: TransactionType, status: TransactionStatus, amount: string, description: string | null, walletId: string, sessionId: string | null, createdAt: string };

export type AdjustTeacherWalletMutation = { adjustTeacherWallet: AdjustTeacherWalletMutation_adjustTeacherWallet };


export type AdjustTeacherWalletMutationVariables = Exact<{
  input: AdjustTeacherWalletInput;
}>;

export type AdminOrderTeacherReEvaluationMutation_adminOrderTeacherReEvaluation = { teacherId: string, amountCharged: string, currency: string, walletBalance: string, reEvaluationStartedAt: string };

export type AdminOrderTeacherReEvaluationMutation = { adminOrderTeacherReEvaluation: AdminOrderTeacherReEvaluationMutation_adminOrderTeacherReEvaluation };


export type AdminOrderTeacherReEvaluationMutationVariables = Exact<{
  teacherId: string | number;
  reason: string;
}>;

export type AdminSessionsQuery_adminSessions_items = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null, needsAttention: boolean };

export type AdminSessionsQuery_adminSessions = { page: number, pageSize: number, totalCount: number, items: Array<AdminSessionsQuery_adminSessions_items> };

export type AdminSessionsQuery = { adminSessions: AdminSessionsQuery_adminSessions };


export type AdminSessionsQueryVariables = Exact<{
  filter: AdminSessionListFilterInput;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type AdminSessionQuery_adminSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null, needsAttention: boolean };

export type AdminSessionQuery = { adminSession: AdminSessionQuery_adminSession | null };


export type AdminSessionQueryVariables = Exact<{
  id: string | number;
}>;

export type AdminSessionRescheduleMutation_adminRescheduleSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null, needsAttention: boolean };

export type AdminSessionRescheduleMutation = { adminRescheduleSession: AdminSessionRescheduleMutation_adminRescheduleSession };


export type AdminSessionRescheduleMutationVariables = Exact<{
  input: AdminSessionRescheduleInput;
}>;

export type AdminSessionCancelMutation_adminCancelSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null, needsAttention: boolean };

export type AdminSessionCancelMutation = { adminCancelSession: AdminSessionCancelMutation_adminCancelSession };


export type AdminSessionCancelMutationVariables = Exact<{
  input: AdminSessionCancelInput;
}>;

export type AdminSessionReassignMutation_adminReassignTeacher = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null, needsAttention: boolean };

export type AdminSessionReassignMutation = { adminReassignTeacher: AdminSessionReassignMutation_adminReassignTeacher };


export type AdminSessionReassignMutationVariables = Exact<{
  input: AdminSessionReassignInput;
}>;

export type AdminSessionJoinMutation_adminJoinSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null, needsAttention: boolean };

export type AdminSessionJoinMutation = { adminJoinSession: AdminSessionJoinMutation_adminJoinSession };


export type AdminSessionJoinMutationVariables = Exact<{
  input: AdminSessionJoinInput;
}>;

export type AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student_applicant = { id: number, status: ApplicantStatus, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, cooldownActive: boolean, canPurchaseVerification: boolean };

export type AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student_teacher = { isApproved: boolean, isEvaluator: boolean, isOnline: boolean, averageRating: string | null };

export type AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student_student = { handshakeCode: string, parentId: number | null, primaryLanguage: string | null, anotherLanguage: string | null, hasParentLink: boolean, hasActiveSubscription: boolean, balanceHifz: number | null, balanceTajweed: number | null, balanceReviews: number | null, balanceTrial: number | null, trialGrantedAt: string | null };

export type AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student_parent = { linkedChildrenCount: number };

export type AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student_applicant | null, teacher: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student_teacher | null, student: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student_student | null, parent: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student_parent | null };

export type AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_subscription = { id: string, status: SubscriptionStatus, paymentMethod: PaymentGateway | null, paymentReference: string | null, paymentVerifiedAt: string | null };

export type AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment = { creditedLane: SubscriptionCreditLane, creditedSessions: number, handshakeCode: string, student: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_student, subscription: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment_subscription };

export type AdminOnboardStudentWithOfflinePaymentMutation = { adminOnboardStudentWithOfflinePayment: AdminOnboardStudentWithOfflinePaymentMutation_adminOnboardStudentWithOfflinePayment };


export type AdminOnboardStudentWithOfflinePaymentMutationVariables = Exact<{
  input: AdminOnboardStudentOfflineInput;
}>;

export type AdminStudentListItemFieldsFragment = { id: number, name: string, email: string, phone: string | null, country: string | null, balanceHifz: number, balanceReviews: number, balanceTajweed: number, balanceTrial: number, trialGrantedAt: string | null, primaryLanguage: string | null, anotherLanguage: string | null, hasParent: boolean, parentName: string | null, parentEmail: string | null, createdAt: string };

export type AdminStudentsQuery_adminStudents_items = { id: number, name: string, email: string, phone: string | null, country: string | null, balanceHifz: number, balanceReviews: number, balanceTajweed: number, balanceTrial: number, trialGrantedAt: string | null, primaryLanguage: string | null, anotherLanguage: string | null, hasParent: boolean, parentName: string | null, parentEmail: string | null, createdAt: string };

export type AdminStudentsQuery_adminStudents = { total: number, page: number, pageSize: number, pageCount: number, items: Array<AdminStudentsQuery_adminStudents_items> };

export type AdminStudentsQuery = { adminStudents: AdminStudentsQuery_adminStudents };


export type AdminStudentsQueryVariables = Exact<{
  filters: AdminStudentFiltersInput | null | undefined;
  page: number;
  pageSize: number;
}>;

export type AdminStudentsExportQuery_adminStudentsExport_rows = { id: number, name: string, email: string, phone: string | null, country: string | null, balanceHifz: number, balanceReviews: number, balanceTajweed: number, balanceTrial: number, trialGrantedAt: string | null, primaryLanguage: string | null, anotherLanguage: string | null, hasParent: boolean, parentName: string | null, parentEmail: string | null, createdAt: string };

export type AdminStudentsExportQuery_adminStudentsExport = { total: number, truncated: boolean, rows: Array<AdminStudentsExportQuery_adminStudentsExport_rows> };

export type AdminStudentsExportQuery = { adminStudentsExport: AdminStudentsExportQuery_adminStudentsExport };


export type AdminStudentsExportQueryVariables = Exact<{
  filters: AdminStudentFiltersInput | null | undefined;
}>;

export type AdminSubscriptionRowFieldsFragment_auditTrailPeek = { actionType: AuditActionType, at: string };

export type AdminSubscriptionRowFieldsFragment_plan = { id: string, title: string, sessionCount: number, intervalDays: number, price: string, currency: string, balanceLane: SubscriptionCreditLane | null };

export type AdminSubscriptionRowFieldsFragment = { id: string, planId: number, status: SubscriptionStatus, startDate: string | null, endDate: string | null, createdAt: string, updatedAt: string, auditEntriesCount: number, auditTrailPeek: AdminSubscriptionRowFieldsFragment_auditTrailPeek | null, plan: AdminSubscriptionRowFieldsFragment_plan };

export type AdminStudentSubscriptionsQuery_adminStudentSubscriptions = { id: string, planId: number, status: SubscriptionStatus, startDate: string | null, endDate: string | null, createdAt: string, updatedAt: string, auditEntriesCount: number, auditTrailPeek: AdminSubscriptionRowFieldsFragment_auditTrailPeek | null, plan: AdminSubscriptionRowFieldsFragment_plan };

export type AdminStudentSubscriptionsQuery = { adminStudentSubscriptions: Array<AdminStudentSubscriptionsQuery_adminStudentSubscriptions> };


export type AdminStudentSubscriptionsQueryVariables = Exact<{
  userId: string | number;
}>;

export type AdminSubscriptionExtendMutation_adminExtendSubscription = { id: string, planId: number, status: SubscriptionStatus, startDate: string | null, endDate: string | null, createdAt: string, updatedAt: string, auditEntriesCount: number, auditTrailPeek: AdminSubscriptionRowFieldsFragment_auditTrailPeek | null, plan: AdminSubscriptionRowFieldsFragment_plan };

export type AdminSubscriptionExtendMutation = { adminExtendSubscription: AdminSubscriptionExtendMutation_adminExtendSubscription };


export type AdminSubscriptionExtendMutationVariables = Exact<{
  input: ExtendSubscriptionInput;
}>;

export type AdminSubscriptionRenewMutation_adminRenewSubscription = { id: string, planId: number, status: SubscriptionStatus, startDate: string | null, endDate: string | null, createdAt: string, updatedAt: string, auditEntriesCount: number, auditTrailPeek: AdminSubscriptionRowFieldsFragment_auditTrailPeek | null, plan: AdminSubscriptionRowFieldsFragment_plan };

export type AdminSubscriptionRenewMutation = { adminRenewSubscription: AdminSubscriptionRenewMutation_adminRenewSubscription };


export type AdminSubscriptionRenewMutationVariables = Exact<{
  input: RenewSubscriptionInput;
}>;

export type AdminSubscriptionCancelMutation_adminCancelSubscription = { id: string, planId: number, status: SubscriptionStatus, startDate: string | null, endDate: string | null, createdAt: string, updatedAt: string, auditEntriesCount: number, auditTrailPeek: AdminSubscriptionRowFieldsFragment_auditTrailPeek | null, plan: AdminSubscriptionRowFieldsFragment_plan };

export type AdminSubscriptionCancelMutation = { adminCancelSubscription: AdminSubscriptionCancelMutation_adminCancelSubscription };


export type AdminSubscriptionCancelMutationVariables = Exact<{
  input: CancelSubscriptionInput;
}>;

export type AdminSubscriptionPlanChangeMutation_adminChangeSubscriptionPlan_subscription = { id: string, planId: number, status: SubscriptionStatus, startDate: string | null, endDate: string | null, createdAt: string, updatedAt: string, auditEntriesCount: number, auditTrailPeek: AdminSubscriptionRowFieldsFragment_auditTrailPeek | null, plan: AdminSubscriptionRowFieldsFragment_plan };

export type AdminSubscriptionPlanChangeMutation_adminChangeSubscriptionPlan = { direction: ProrationDirection, carrySessions: number, forfeitedSessions: number, subscription: AdminSubscriptionPlanChangeMutation_adminChangeSubscriptionPlan_subscription };

export type AdminSubscriptionPlanChangeMutation = { adminChangeSubscriptionPlan: AdminSubscriptionPlanChangeMutation_adminChangeSubscriptionPlan };


export type AdminSubscriptionPlanChangeMutationVariables = Exact<{
  input: ChangeSubscriptionPlanInput;
}>;

export type AdminApplicantListItemFieldsFragment = { id: number, name: string, email: string, phone: string | null, country: string | null, status: string, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, createdAt: string };

export type AdminTeacherApplicantsQuery_adminTeacherApplicants_items = { id: number, name: string, email: string, phone: string | null, country: string | null, status: string, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, createdAt: string };

export type AdminTeacherApplicantsQuery_adminTeacherApplicants_statusCounts = { pending: number, inEvaluation: number, failed: number, passed: number };

export type AdminTeacherApplicantsQuery_adminTeacherApplicants = { total: number, page: number, pageSize: number, pageCount: number, items: Array<AdminTeacherApplicantsQuery_adminTeacherApplicants_items>, statusCounts: AdminTeacherApplicantsQuery_adminTeacherApplicants_statusCounts };

export type AdminTeacherApplicantsQuery = { adminTeacherApplicants: AdminTeacherApplicantsQuery_adminTeacherApplicants };


export type AdminTeacherApplicantsQueryVariables = Exact<{
  filters: AdminApplicantFiltersInput | null | undefined;
  page: number;
  pageSize: number;
}>;

export type AdminTeacherApplicantsExportQuery_adminTeacherApplicantsExport_rows = { id: number, name: string, email: string, phone: string | null, country: string | null, status: string, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, createdAt: string };

export type AdminTeacherApplicantsExportQuery_adminTeacherApplicantsExport = { total: number, truncated: boolean, rows: Array<AdminTeacherApplicantsExportQuery_adminTeacherApplicantsExport_rows> };

export type AdminTeacherApplicantsExportQuery = { adminTeacherApplicantsExport: AdminTeacherApplicantsExportQuery_adminTeacherApplicantsExport };


export type AdminTeacherApplicantsExportQueryVariables = Exact<{
  filters: AdminApplicantFiltersInput | null | undefined;
}>;

export type AdminTeacherListItemFieldsFragment = { id: number, name: string, email: string, phone: string | null, country: string | null, isApproved: boolean, isEvaluator: boolean, averageRating: number | null, isOnline: boolean, subjects: Array<string>, isDeleted: boolean, suspended: boolean, isBlocked: boolean, createdAt: string };

export type AdminTeachersQuery_adminTeachers_items = { id: number, name: string, email: string, phone: string | null, country: string | null, isApproved: boolean, isEvaluator: boolean, averageRating: number | null, isOnline: boolean, subjects: Array<string>, isDeleted: boolean, suspended: boolean, isBlocked: boolean, createdAt: string };

export type AdminTeachersQuery_adminTeachers = { total: number, page: number, pageSize: number, pageCount: number, items: Array<AdminTeachersQuery_adminTeachers_items> };

export type AdminTeachersQuery = { adminTeachers: AdminTeachersQuery_adminTeachers };


export type AdminTeachersQueryVariables = Exact<{
  filters: AdminTeacherFiltersInput | null | undefined;
  page: number;
  pageSize: number;
}>;

export type AdminTeachersExportQuery_adminTeachersExport_rows = { id: number, name: string, email: string, phone: string | null, country: string | null, isApproved: boolean, isEvaluator: boolean, averageRating: number | null, isOnline: boolean, subjects: Array<string>, isDeleted: boolean, suspended: boolean, isBlocked: boolean, createdAt: string };

export type AdminTeachersExportQuery_adminTeachersExport = { total: number, truncated: boolean, rows: Array<AdminTeachersExportQuery_adminTeachersExport_rows> };

export type AdminTeachersExportQuery = { adminTeachersExport: AdminTeachersExportQuery_adminTeachersExport };


export type AdminTeachersExportQueryVariables = Exact<{
  filters: AdminTeacherFiltersInput | null | undefined;
}>;

export type AdminUserListItemFieldsFragment = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, gender: Gender | null, dateOfBirth: string | null, country: string | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, lastActiveAt: string | null, createdAt: string, applicantStatus: ApplicantStatus | null, cooldownState: ApplicantCooldownState | null, cooldownUntil: string | null, teacherIsApproved: boolean | null, teacherIsEvaluator: boolean | null, studentHasParentLink: boolean | null, studentHasActiveSubscription: boolean | null, parentLinkedChildrenCount: number | null };

export type AdminUserDetailFieldsFragment_applicant = { id: number, status: ApplicantStatus, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, cooldownState: ApplicantCooldownState, cooldownActive: boolean, canPurchaseVerification: boolean };

export type AdminUserDetailFieldsFragment_teacher = { isApproved: boolean, isEvaluator: boolean, isOnline: boolean, averageRating: string | null };

export type AdminUserDetailFieldsFragment_student = { handshakeCode: string, parentId: number | null, primaryLanguage: string | null, anotherLanguage: string | null, hasParentLink: boolean, hasActiveSubscription: boolean, balanceHifz: number | null, balanceTajweed: number | null, balanceReviews: number | null, balanceTrial: number | null, trialGrantedAt: string | null };

export type AdminUserDetailFieldsFragment_parent = { linkedChildrenCount: number };

export type AdminUserDetailFieldsFragment = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, mustChangePassword: boolean, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminApplicantProfileFieldsFragment = { id: number, status: ApplicantStatus, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, cooldownState: ApplicantCooldownState, cooldownActive: boolean, canPurchaseVerification: boolean };

export type AdminUsersQuery_adminUsers_items = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, gender: Gender | null, dateOfBirth: string | null, country: string | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, lastActiveAt: string | null, createdAt: string, applicantStatus: ApplicantStatus | null, cooldownState: ApplicantCooldownState | null, cooldownUntil: string | null, teacherIsApproved: boolean | null, teacherIsEvaluator: boolean | null, studentHasParentLink: boolean | null, studentHasActiveSubscription: boolean | null, parentLinkedChildrenCount: number | null };

export type AdminUsersQuery_adminUsers = { totalCount: number, page: number, pageSize: number, items: Array<AdminUsersQuery_adminUsers_items> };

export type AdminUsersQuery = { adminUsers: AdminUsersQuery_adminUsers };


export type AdminUsersQueryVariables = Exact<{
  filters: AdminUserFiltersInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type AdminUserStatsQuery_adminUserStats = { totalCount: number, activeCount: number, suspendedCount: number, blockedCount: number, deletedCount: number, adminsCount: number, teachersCount: number, studentsCount: number, parentsCount: number, newThisWeekCount: number };

export type AdminUserStatsQuery = { adminUserStats: AdminUserStatsQuery_adminUserStats };


export type AdminUserStatsQueryVariables = Exact<{ [key: string]: never; }>;

export type AdminApplicantCooldownStatsQuery_adminApplicantCooldownStats = { activeCount: number, expiringSoonCount: number, expiredCount: number, expiringSoonWindowDays: number };

export type AdminApplicantCooldownStatsQuery = { adminApplicantCooldownStats: AdminApplicantCooldownStatsQuery_adminApplicantCooldownStats };


export type AdminApplicantCooldownStatsQueryVariables = Exact<{ [key: string]: never; }>;

export type AdminUserCountryBreakdownQuery_adminUserCountryBreakdown_buckets = { code: string, label: string, flag: string, count: number };

export type AdminUserCountryBreakdownQuery_adminUserCountryBreakdown = { unresolvedCount: number, buckets: Array<AdminUserCountryBreakdownQuery_adminUserCountryBreakdown_buckets> };

export type AdminUserCountryBreakdownQuery = { adminUserCountryBreakdown: AdminUserCountryBreakdownQuery_adminUserCountryBreakdown };


export type AdminUserCountryBreakdownQueryVariables = Exact<{
  limit: number | null | undefined;
}>;

export type AdminUserDetailQuery_adminUserDetail = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, mustChangePassword: boolean, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminUserDetailQuery = { adminUserDetail: AdminUserDetailQuery_adminUserDetail };


export type AdminUserDetailQueryVariables = Exact<{
  id: number;
}>;

export type AdminUserActivityQuery_adminUserActivity = { id: number, actionType: AuditActionType, entityType: string, caption: string | null, actorName: string, changedFields: Array<string> | null, createdAt: string };

export type AdminUserActivityQuery = { adminUserActivity: Array<AdminUserActivityQuery_adminUserActivity> };


export type AdminUserActivityQueryVariables = Exact<{
  id: number;
  limit: number | null | undefined;
}>;

export type AdminCreateUserMutation_adminCreateUser = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, mustChangePassword: boolean, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminCreateUserMutation = { adminCreateUser: AdminCreateUserMutation_adminCreateUser };


export type AdminCreateUserMutationVariables = Exact<{
  input: AdminCreateUserInput;
}>;

export type AdminUpdateUserMutation_adminUpdateUser = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, mustChangePassword: boolean, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminUpdateUserMutation = { adminUpdateUser: AdminUpdateUserMutation_adminUpdateUser };


export type AdminUpdateUserMutationVariables = Exact<{
  id: number;
  input: AdminUpdateUserInput;
}>;

export type AdminSetUserPasswordMutation_adminSetUserPassword = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, mustChangePassword: boolean, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminSetUserPasswordMutation = { adminSetUserPassword: AdminSetUserPasswordMutation_adminSetUserPassword };


export type AdminSetUserPasswordMutationVariables = Exact<{
  id: number;
  input: AdminSetUserPasswordInput;
}>;

export type AdminSetUserDeletedMutation_adminSetUserDeleted = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, mustChangePassword: boolean, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminSetUserDeletedMutation = { adminSetUserDeleted: AdminSetUserDeletedMutation_adminSetUserDeleted };


export type AdminSetUserDeletedMutationVariables = Exact<{
  id: number;
  deleted: boolean;
}>;

export type AdminSetUserSuspendedMutation_adminSetUserSuspended = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, mustChangePassword: boolean, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminSetUserSuspendedMutation = { adminSetUserSuspended: AdminSetUserSuspendedMutation_adminSetUserSuspended };


export type AdminSetUserSuspendedMutationVariables = Exact<{
  id: number;
  suspended: boolean;
  periodDays: number | null | undefined;
}>;

export type AdminExtendApplicantCooldownMutation_adminExtendApplicantCooldown = { id: number, status: ApplicantStatus, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, cooldownState: ApplicantCooldownState, cooldownActive: boolean, canPurchaseVerification: boolean };

export type AdminExtendApplicantCooldownMutation = { adminExtendApplicantCooldown: AdminExtendApplicantCooldownMutation_adminExtendApplicantCooldown };


export type AdminExtendApplicantCooldownMutationVariables = Exact<{
  applicantId: number;
  additionalDays: number;
}>;

export type AdminOverrideApplicantEvaluationMutation_adminOverrideApplicantEvaluation = { id: number, status: ApplicantStatus, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, cooldownState: ApplicantCooldownState, cooldownActive: boolean, canPurchaseVerification: boolean };

export type AdminOverrideApplicantEvaluationMutation = { adminOverrideApplicantEvaluation: AdminOverrideApplicantEvaluationMutation_adminOverrideApplicantEvaluation };


export type AdminOverrideApplicantEvaluationMutationVariables = Exact<{
  applicantId: number;
  action: AdminApplicantOverrideAction;
  cooldownDays: number | null | undefined;
}>;

export type AdminSetUserBlockedMutation_adminSetUserBlocked = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, mustChangePassword: boolean, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminSetUserBlockedMutation = { adminSetUserBlocked: AdminSetUserBlockedMutation_adminSetUserBlocked };


export type AdminSetUserBlockedMutationVariables = Exact<{
  id: number;
  blocked: boolean;
}>;

export type AdminAuditLogsQuery_adminAuditLogs_items = { id: string, actionType: AuditActionType, actorId: number, actorName: string, entityType: string, entityId: number | null, details: string | null, createdAt: string };

export type AdminAuditLogsQuery_adminAuditLogs = { totalCount: number, page: number, pageSize: number, items: Array<AdminAuditLogsQuery_adminAuditLogs_items> };

export type AdminAuditLogsQuery = { adminAuditLogs: AdminAuditLogsQuery_adminAuditLogs };


export type AdminAuditLogsQueryVariables = Exact<{
  filters: AdminAuditLogFiltersInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_users = { totalCount: number, activeCount: number, suspendedCount: number, blockedCount: number, deletedCount: number, adminsCount: number, teachersCount: number, studentsCount: number, parentsCount: number, newThisWeekCount: number, recentlyActive24h: number };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_sessions = { total: number, today: number, thisWeek: number, thisMonth: number, scheduled: number, started: number, completed: number, cancelled: number, disputed: number, awaitingConfirmation: number };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_revenue_gatewayRevenueByCurrency = { currency: string, totalAmount: string, last30DaysAmount: string, paidPaymentsCount: number };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_revenue = { offlineActivationsCount: number, gatewayRevenueByCurrency: Array<AdminPlatformAnalyticsQuery_adminPlatformAnalytics_revenue_gatewayRevenueByCurrency> };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_subscriptions = { total: number, active: number, pending: number, expired: number, cancelled: number, suspended: number, activeInWindowNow: number };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_teachers = { certifiedCount: number, evaluatorCount: number, onlineNowCount: number };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_ratings = { averageSessionRating: number | null, sessionRatingsCount: number, averageEvaluationScore: number | null, evaluationScoresCount: number };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_health = { pendingDisputes: number, pendingWithdrawals: number };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_sessionTrendDaily = { bucketStart: string, sessionCount: number };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics_revenueTrendDaily = { bucketStart: string, currency: string, amount: string };

export type AdminPlatformAnalyticsQuery_adminPlatformAnalytics = { generatedAt: string, users: AdminPlatformAnalyticsQuery_adminPlatformAnalytics_users, sessions: AdminPlatformAnalyticsQuery_adminPlatformAnalytics_sessions, revenue: AdminPlatformAnalyticsQuery_adminPlatformAnalytics_revenue, subscriptions: AdminPlatformAnalyticsQuery_adminPlatformAnalytics_subscriptions, teachers: AdminPlatformAnalyticsQuery_adminPlatformAnalytics_teachers, ratings: AdminPlatformAnalyticsQuery_adminPlatformAnalytics_ratings, health: AdminPlatformAnalyticsQuery_adminPlatformAnalytics_health, sessionTrendDaily: Array<AdminPlatformAnalyticsQuery_adminPlatformAnalytics_sessionTrendDaily>, revenueTrendDaily: Array<AdminPlatformAnalyticsQuery_adminPlatformAnalytics_revenueTrendDaily> };

export type AdminPlatformAnalyticsQuery = { adminPlatformAnalytics: AdminPlatformAnalyticsQuery_adminPlatformAnalytics };


export type AdminPlatformAnalyticsQueryVariables = Exact<{ [key: string]: never; }>;

export type AdminCertifyTeacherColdStartMutation_adminCertifyTeacherColdStart_applicant = { id: number, status: ApplicantStatus };

export type AdminCertifyTeacherColdStartMutation_adminCertifyTeacherColdStart_teacher = { isApproved: boolean, isEvaluator: boolean, isOnline: boolean, averageRating: string | null };

export type AdminCertifyTeacherColdStartMutation_adminCertifyTeacherColdStart = { id: number, role: UserRole, isDeleted: boolean | null, suspended: boolean | null, isBlocked: boolean | null, applicant: AdminCertifyTeacherColdStartMutation_adminCertifyTeacherColdStart_applicant | null, teacher: AdminCertifyTeacherColdStartMutation_adminCertifyTeacherColdStart_teacher | null };

export type AdminCertifyTeacherColdStartMutation = { adminCertifyTeacherColdStart: AdminCertifyTeacherColdStartMutation_adminCertifyTeacherColdStart };


export type AdminCertifyTeacherColdStartMutationVariables = Exact<{
  userId: number;
  makeEvaluator?: boolean | null | undefined;
}>;

export type RegisterUserMutation_registerUser = { id: number, email: string, fullName: string, role: UserRole };

export type RegisterUserMutation = { registerUser: RegisterUserMutation_registerUser };


export type RegisterUserMutationVariables = Exact<{
  input: RegisterUserInput;
}>;

export type MeQuery_me = { id: number, email: string, fullName: string, phone: string | null, country: string | null, gender: Gender | null, locale: AppLocale | null, role: UserRole, preferredRecitation: RecitationReading | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, mustChangePassword: boolean };

export type MeQuery = { me: MeQuery_me | null };


export type MeQueryVariables = Exact<{ [key: string]: never; }>;

export type LoginMutation_login_user = { id: number, email: string, fullName: string, phone: string | null, country: string | null, gender: Gender | null, locale: AppLocale | null, role: UserRole, preferredRecitation: RecitationReading | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, mustChangePassword: boolean };

export type LoginMutation_login = { accessToken: string, refreshToken: string, user: LoginMutation_login_user };

export type LoginMutation = { login: LoginMutation_login };


export type LoginMutationVariables = Exact<{
  email: string;
  password: string;
}>;

export type UpdateMyLocaleMutation_updateMyLocale = { id: number, email: string, locale: AppLocale | null };

export type UpdateMyLocaleMutation = { updateMyLocale: UpdateMyLocaleMutation_updateMyLocale };


export type UpdateMyLocaleMutationVariables = Exact<{
  locale: AppLocale;
}>;

export type ChangeMyPasswordMutation_changeMyPassword = { id: number, email: string, fullName: string, role: UserRole, mustChangePassword: boolean };

export type ChangeMyPasswordMutation = { changeMyPassword: ChangeMyPasswordMutation_changeMyPassword };


export type ChangeMyPasswordMutationVariables = Exact<{
  input: ChangeMyPasswordInput;
}>;

export type RefreshTokenMutation_refreshToken = { accessToken: string, refreshToken: string };

export type RefreshTokenMutation = { refreshToken: RefreshTokenMutation_refreshToken };


export type RefreshTokenMutationVariables = Exact<{
  refreshToken: string | null | undefined;
}>;

export type LogoutMutation_logout = { success: boolean };

export type LogoutMutation = { logout: LogoutMutation_logout };


export type LogoutMutationVariables = Exact<{ [key: string]: never; }>;

export type RecordMyActivityMutation = { recordMyActivity: boolean };


export type RecordMyActivityMutationVariables = Exact<{ [key: string]: never; }>;

export type RecitationReadingsQuery = { recitationReadings: Array<RecitationReading> };


export type RecitationReadingsQueryVariables = Exact<{ [key: string]: never; }>;

export type PlanCatalogQuery_planCatalog = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string, balanceLane: SubscriptionCreditLane | null };

export type PlanCatalogQuery = { planCatalog: Array<PlanCatalogQuery_planCatalog> };


export type PlanCatalogQueryVariables = Exact<{ [key: string]: never; }>;

export type AdminPlansQuery_adminPlans = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string, balanceLane: SubscriptionCreditLane | null };

export type AdminPlansQuery = { adminPlans: Array<AdminPlansQuery_adminPlans> };


export type AdminPlansQueryVariables = Exact<{
  includeInactive: boolean | null | undefined;
}>;

export type CreatePlanMutation_createPlan = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string, balanceLane: SubscriptionCreditLane | null };

export type CreatePlanMutation = { createPlan: CreatePlanMutation_createPlan };


export type CreatePlanMutationVariables = Exact<{
  input: CreatePlanInput;
}>;

export type UpdatePlanMutation_updatePlan = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string, balanceLane: SubscriptionCreditLane | null };

export type UpdatePlanMutation = { updatePlan: UpdatePlanMutation_updatePlan };


export type UpdatePlanMutationVariables = Exact<{
  id: string | number;
  input: UpdatePlanInput;
}>;

export type SetPlanActiveStatusMutation_setPlanActiveStatus = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string };

export type SetPlanActiveStatusMutation = { setPlanActiveStatus: SetPlanActiveStatusMutation_setPlanActiveStatus };


export type SetPlanActiveStatusMutationVariables = Exact<{
  id: string | number;
  isActive: boolean;
}>;

export type PurchaseSubscriptionPlanMutation_purchaseSubscription_subscription_plan = { id: string, title: string };

export type PurchaseSubscriptionPlanMutation_purchaseSubscription_subscription = { id: string, planId: number, status: SubscriptionStatus, startDate: string | null, endDate: string | null, paymentMethod: PaymentGateway | null, paymentReference: string | null, paymentVerifiedAt: string | null, createdAt: string, updatedAt: string, plan: PurchaseSubscriptionPlanMutation_purchaseSubscription_subscription_plan };

export type PurchaseSubscriptionPlanMutation_purchaseSubscription_payment = { id: string, subscriptionId: number | null, amount: string, currency: string, paymentGateway: PaymentGateway, status: PaymentStatus, createdAt: string, updatedAt: string };

export type PurchaseSubscriptionPlanMutation_purchaseSubscription_checkout = { provider: PaymentGateway, providerReference: string, checkoutUrl: string | null };

export type PurchaseSubscriptionPlanMutation_purchaseSubscription = { subscription: PurchaseSubscriptionPlanMutation_purchaseSubscription_subscription, payment: PurchaseSubscriptionPlanMutation_purchaseSubscription_payment, checkout: PurchaseSubscriptionPlanMutation_purchaseSubscription_checkout };

export type PurchaseSubscriptionPlanMutation = { purchaseSubscription: PurchaseSubscriptionPlanMutation_purchaseSubscription };


export type PurchaseSubscriptionPlanMutationVariables = Exact<{
  input: PurchaseSubscriptionInput;
}>;

export type MySubscriptionsQuery_mySubscriptions_plan = { id: string, title: string };

export type MySubscriptionsQuery_mySubscriptions = { id: string, planId: number, status: SubscriptionStatus, startDate: string | null, endDate: string | null, paymentMethod: PaymentGateway | null, paymentReference: string | null, paymentVerifiedAt: string | null, createdAt: string, updatedAt: string, plan: MySubscriptionsQuery_mySubscriptions_plan };

export type MySubscriptionsQuery = { mySubscriptions: Array<MySubscriptionsQuery_mySubscriptions> };


export type MySubscriptionsQueryVariables = Exact<{ [key: string]: never; }>;

export type PurchaseVerificationPlanMutation_purchaseVerificationPlan_subscription = { id: string, status: SubscriptionStatus, planId: number };

export type PurchaseVerificationPlanMutation_purchaseVerificationPlan_payment = { id: string, amount: string, currency: string, status: PaymentStatus };

export type PurchaseVerificationPlanMutation_purchaseVerificationPlan_checkout = { provider: PaymentGateway, providerReference: string, checkoutUrl: string | null };

export type PurchaseVerificationPlanMutation_purchaseVerificationPlan = { subscription: PurchaseVerificationPlanMutation_purchaseVerificationPlan_subscription, payment: PurchaseVerificationPlanMutation_purchaseVerificationPlan_payment, checkout: PurchaseVerificationPlanMutation_purchaseVerificationPlan_checkout };

export type PurchaseVerificationPlanMutation = { purchaseVerificationPlan: PurchaseVerificationPlanMutation_purchaseVerificationPlan };


export type PurchaseVerificationPlanMutationVariables = Exact<{ [key: string]: never; }>;

export type MyWalletQuery_myWallet_transactions = { id: string, walletId: string, sessionId: string | null, amount: string, description: string | null, type: TransactionType, status: TransactionStatus, createdAt: string, updatedAt: string };

export type MyWalletQuery_myWallet = { id: string, balance: string, totalEarning: string, currency: string, createdAt: string, updatedAt: string, transactions: Array<MyWalletQuery_myWallet_transactions> };

export type MyWalletQuery = { myWallet: MyWalletQuery_myWallet };


export type MyWalletQueryVariables = Exact<{ [key: string]: never; }>;

export type MyWalletLedgerQuery_myWalletLedger_rows = { id: string, walletId: string, sessionId: string | null, amount: string, description: string | null, type: TransactionType, status: TransactionStatus, createdAt: string, updatedAt: string };

export type MyWalletLedgerQuery_myWalletLedger = { totalCount: number, hasMore: boolean, rows: Array<MyWalletLedgerQuery_myWalletLedger_rows> };

export type MyWalletLedgerQuery = { myWalletLedger: MyWalletLedgerQuery_myWalletLedger };


export type MyWalletLedgerQueryVariables = Exact<{
  limit: number;
  offset: number;
}>;

export type RequestWithdrawalMutation_requestWithdrawal_transactions = { id: string, walletId: string, sessionId: string | null, amount: string, description: string | null, type: TransactionType, status: TransactionStatus, createdAt: string, updatedAt: string };

export type RequestWithdrawalMutation_requestWithdrawal = { id: string, balance: string, totalEarning: string, currency: string, createdAt: string, updatedAt: string, transactions: Array<RequestWithdrawalMutation_requestWithdrawal_transactions> };

export type RequestWithdrawalMutation = { requestWithdrawal: RequestWithdrawalMutation_requestWithdrawal };


export type RequestWithdrawalMutationVariables = Exact<{
  input: RequestWithdrawalInput;
}>;

export type PlanLessonsQuery_planLessons = { id: string, planId: number | null, title: string | null, createdAt: string };

export type PlanLessonsQuery = { planLessons: Array<PlanLessonsQuery_planLessons> };


export type PlanLessonsQueryVariables = Exact<{
  planId: string | number;
}>;

export type CreateLessonMutation_createLesson = { id: string, planId: number | null, title: string | null };

export type CreateLessonMutation = { createLesson: CreateLessonMutation_createLesson };


export type CreateLessonMutationVariables = Exact<{
  input: CreateLessonInput;
}>;

export type UpdateLessonMutation_updateLesson = { id: string, planId: number | null, title: string | null };

export type UpdateLessonMutation = { updateLesson: UpdateLessonMutation_updateLesson };


export type UpdateLessonMutationVariables = Exact<{
  id: string | number;
  input: UpdateLessonInput;
}>;

export type DeleteLessonMutation_deleteLesson = { id: string, planId: number | null, title: string | null };

export type DeleteLessonMutation = { deleteLesson: DeleteLessonMutation_deleteLesson };


export type DeleteLessonMutationVariables = Exact<{
  id: string | number;
}>;

export type AdminBroadcastNotificationMutation = { adminBroadcastNotification: number };


export type AdminBroadcastNotificationMutationVariables = Exact<{
  input: AdminBroadcastNotificationInput;
}>;

export type AdminBroadcastEntryFieldsFragment = { id: string, title: string, body: string, status: BroadcastStatus, audienceType: BroadcastAudienceType | null, audienceRole: UserRole | null, audienceCountry: string | null, audiencePlanId: number | null, recipientCount: number, sentAt: string, sentById: number, sentByName: string, stoppedAt: string | null, stoppedById: number | null, stoppedByName: string | null };

export type AdminBroadcastsQuery_adminBroadcasts_items = { id: string, title: string, body: string, status: BroadcastStatus, audienceType: BroadcastAudienceType | null, audienceRole: UserRole | null, audienceCountry: string | null, audiencePlanId: number | null, recipientCount: number, sentAt: string, sentById: number, sentByName: string, stoppedAt: string | null, stoppedById: number | null, stoppedByName: string | null };

export type AdminBroadcastsQuery_adminBroadcasts = { totalCount: number, page: number, pageSize: number, items: Array<AdminBroadcastsQuery_adminBroadcasts_items> };

export type AdminBroadcastsQuery = { adminBroadcasts: AdminBroadcastsQuery_adminBroadcasts };


export type AdminBroadcastsQueryVariables = Exact<{
  filters: AdminBroadcastFiltersInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type AdminBroadcastDetailQuery_adminBroadcastDetail_entry = { id: string, title: string, body: string, status: BroadcastStatus, audienceType: BroadcastAudienceType | null, audienceRole: UserRole | null, audienceCountry: string | null, audiencePlanId: number | null, recipientCount: number, sentAt: string, sentById: number, sentByName: string, stoppedAt: string | null, stoppedById: number | null, stoppedByName: string | null };

export type AdminBroadcastDetailQuery_adminBroadcastDetail = { liveDeliveredCount: number, liveReadCount: number, entry: AdminBroadcastDetailQuery_adminBroadcastDetail_entry };

export type AdminBroadcastDetailQuery = { adminBroadcastDetail: AdminBroadcastDetailQuery_adminBroadcastDetail };


export type AdminBroadcastDetailQueryVariables = Exact<{
  broadcastId: number;
}>;

export type AdminStopBroadcastMutation = { adminStopBroadcast: number };


export type AdminStopBroadcastMutationVariables = Exact<{
  broadcastId: number;
}>;

export type MyNotificationsQuery_myNotifications_items = { id: string, type: NotificationType, title: string, body: string | null, isRead: boolean, relatedEntityType: string | null, relatedEntityId: number | null, createdAt: string };

export type MyNotificationsQuery_myNotifications = { totalCount: number, hasMore: boolean, items: Array<MyNotificationsQuery_myNotifications_items> };

export type MyNotificationsQuery = { myNotifications: MyNotificationsQuery_myNotifications };


export type MyNotificationsQueryVariables = Exact<{
  filter: MyNotificationsFilterInput | null | undefined;
}>;

export type MyUnreadNotificationCountQuery = { myUnreadNotificationCount: number };


export type MyUnreadNotificationCountQueryVariables = Exact<{ [key: string]: never; }>;

export type MarkNotificationReadMutation_markNotificationRead = { id: string, type: NotificationType, title: string, body: string | null, isRead: boolean, relatedEntityType: string | null, relatedEntityId: number | null, createdAt: string };

export type MarkNotificationReadMutation = { markNotificationRead: MarkNotificationReadMutation_markNotificationRead };


export type MarkNotificationReadMutationVariables = Exact<{
  id: string | number;
}>;

export type MarkAllNotificationsReadMutation = { markAllNotificationsRead: number };


export type MarkAllNotificationsReadMutationVariables = Exact<{
  type: NotificationType | null | undefined;
}>;

export type MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests = { id: string, status: LinkStatus, studentMaskedName: string, createdAt: string, expiresAt: string, respondedAt: string | null };

export type MyOutgoingParentLinkRequestsQuery = { myOutgoingParentLinkRequests: Array<MyOutgoingParentLinkRequestsQuery_myOutgoingParentLinkRequests> };


export type MyOutgoingParentLinkRequestsQueryVariables = Exact<{ [key: string]: never; }>;

export type MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests = { id: string, status: LinkStatus, parentFullName: string, createdAt: string, expiresAt: string, respondedAt: string | null };

export type MyIncomingParentLinkRequestsQuery = { myIncomingParentLinkRequests: Array<MyIncomingParentLinkRequestsQuery_myIncomingParentLinkRequests> };


export type MyIncomingParentLinkRequestsQueryVariables = Exact<{ [key: string]: never; }>;

export type RequestParentChildLinkMutation_requestParentChildLink = { id: string, status: LinkStatus, studentMaskedName: string, createdAt: string, expiresAt: string, respondedAt: string | null };

export type RequestParentChildLinkMutation = { requestParentChildLink: RequestParentChildLinkMutation_requestParentChildLink | null };


export type RequestParentChildLinkMutationVariables = Exact<{
  code: string;
}>;

export type RespondToParentLinkRequestMutation_respondToParentLinkRequest = { id: string, status: LinkStatus, parentFullName: string, createdAt: string, expiresAt: string, respondedAt: string | null };

export type RespondToParentLinkRequestMutation = { respondToParentLinkRequest: RespondToParentLinkRequestMutation_respondToParentLinkRequest };


export type RespondToParentLinkRequestMutationVariables = Exact<{
  requestId: string | number;
  accept: boolean;
}>;

export type CancelParentLinkRequestMutation_cancelParentLinkRequest = { id: string, status: LinkStatus, studentMaskedName: string, createdAt: string, expiresAt: string, respondedAt: string | null };

export type CancelParentLinkRequestMutation = { cancelParentLinkRequest: CancelParentLinkRequestMutation_cancelParentLinkRequest };


export type CancelParentLinkRequestMutationVariables = Exact<{
  requestId: string | number;
}>;

export type MyLinkedChildrenQuery_myLinkedChildren = { id: string, fullName: string, createdAt: string };

export type MyLinkedChildrenQuery = { myLinkedChildren: Array<MyLinkedChildrenQuery_myLinkedChildren> };


export type MyLinkedChildrenQueryVariables = Exact<{ [key: string]: never; }>;

export type MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions_child = { id: string, fullName: string, createdAt: string };

export type MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions_upcomingSessions = { sessionId: number, fee: string | null, createdAt: string };

export type MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions = { scheduledTotalCount: number, child: MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions_child, upcomingSessions: Array<MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions_upcomingSessions> };

export type MyChildrenUpcomingSessionsQuery = { myChildrenUpcomingSessions: Array<MyChildrenUpcomingSessionsQuery_myChildrenUpcomingSessions> };


export type MyChildrenUpcomingSessionsQueryVariables = Exact<{ [key: string]: never; }>;

export type ParentChildProgressQuery_parentChildProgress_child = { id: string, fullName: string, createdAt: string };

export type ParentChildProgressQuery_parentChildProgress_latestJadidPosition = { surahJuz: SurahJuzRef, fromAyah: number | null, toAyah: number | null };

export type ParentChildProgressQuery_parentChildProgress_latestMadiPosition = { surahJuz: SurahJuzRef, fromAyah: number | null, toAyah: number | null };

export type ParentChildProgressQuery_parentChildProgress = { progressRowCount: number, child: ParentChildProgressQuery_parentChildProgress_child, latestJadidPosition: ParentChildProgressQuery_parentChildProgress_latestJadidPosition | null, latestMadiPosition: ParentChildProgressQuery_parentChildProgress_latestMadiPosition | null };

export type ParentChildProgressQuery = { parentChildProgress: ParentChildProgressQuery_parentChildProgress };


export type ParentChildProgressQueryVariables = Exact<{
  studentId: number;
}>;

export type ParentChildSessionsQuery_parentChildSessions_items = { id: string, status: SessionStatus, startedAt: string | null, endedAt: string | null, createdAt: string };

export type ParentChildSessionsQuery_parentChildSessions = { totalCount: number, page: number, pageSize: number, items: Array<ParentChildSessionsQuery_parentChildSessions_items> };

export type ParentChildSessionsQuery = { parentChildSessions: ParentChildSessionsQuery_parentChildSessions };


export type ParentChildSessionsQueryVariables = Exact<{
  studentId: number;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type ParentChildReportsQuery_parentChildReports_items = { id: string, sessionId: number, sessionStatus: SessionStatus, sessionStartedAt: string | null, teacherNotes: string | null, studentRatingByTeacher: number | null, createdAt: string };

export type ParentChildReportsQuery_parentChildReports = { totalCount: number, page: number, pageSize: number, items: Array<ParentChildReportsQuery_parentChildReports_items> };

export type ParentChildReportsQuery = { parentChildReports: ParentChildReportsQuery_parentChildReports };


export type ParentChildReportsQueryVariables = Exact<{
  studentId: number;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type ParentChildHomeworkQuery_parentChildHomework_items_jadid = { surahJuz: SurahJuzRef | null, fromAyah: number | null, toAyah: number | null, grade: number | null };

export type ParentChildHomeworkQuery_parentChildHomework_items_madi = { surahJuz: SurahJuzRef | null, fromAyah: number | null, toAyah: number | null, grade: number | null };

export type ParentChildHomeworkQuery_parentChildHomework_items = { id: string, sessionId: number, createdAt: string, jadid: ParentChildHomeworkQuery_parentChildHomework_items_jadid | null, madi: ParentChildHomeworkQuery_parentChildHomework_items_madi | null };

export type ParentChildHomeworkQuery_parentChildHomework = { totalCount: number, page: number, pageSize: number, items: Array<ParentChildHomeworkQuery_parentChildHomework_items> };

export type ParentChildHomeworkQuery = { parentChildHomework: ParentChildHomeworkQuery_parentChildHomework };


export type ParentChildHomeworkQueryVariables = Exact<{
  studentId: number;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type ParentSessionTargetQuery_parentSessionTarget = { sessionId: number, studentId: number };

export type ParentSessionTargetQuery = { parentSessionTarget: ParentSessionTargetQuery_parentSessionTarget };


export type ParentSessionTargetQueryVariables = Exact<{
  sessionId: number;
}>;

export type SessionRecitationQuery_sessionRecitation = { id: string, sessionId: string, name: string, description: string | null, createdAt: string, updatedAt: string };

export type SessionRecitationQuery = { sessionRecitation: SessionRecitationQuery_sessionRecitation | null };


export type SessionRecitationQueryVariables = Exact<{
  sessionId: string | number;
}>;

export type SetSessionRecitationMutation_setSessionRecitation = { id: string, sessionId: string, name: string, description: string | null, createdAt: string, updatedAt: string };

export type SetSessionRecitationMutation = { setSessionRecitation: SetSessionRecitationMutation_setSessionRecitation };


export type SetSessionRecitationMutationVariables = Exact<{
  sessionId: string | number;
  input: SessionRecitationInput;
}>;

export type AdminDisputeCaseQuery_adminDisputeCase_session = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type AdminDisputeCaseQuery_adminDisputeCase_report = { id: string, sessionId: number, teacherNotes: string, studentRatingByTeacher: number, createdAt: string, updatedAt: string };

export type AdminDisputeCaseQuery_adminDisputeCase_homework = { id: string, sessionId: number, currentFromAyah: number | null, currentToAyah: number | null, currentGrade: number | null, currentSurahJuz: SurahJuzRef | null, revisionFromAyah: number | null, revisionToAyah: number | null, revisionGrade: number | null, revisionSurahJuz: SurahJuzRef | null, createdAt: string, updatedAt: string };

export type AdminDisputeCaseQuery_adminDisputeCase_recitation = { id: string, sessionId: string, name: string, description: string | null, createdAt: string, updatedAt: string };

export type AdminDisputeCaseQuery_adminDisputeCase_auditTrail = { id: string, actionType: AuditActionType, actorId: number, actorName: string, createdAt: string, details: string | null, entityId: number | null, entityType: string };

export type AdminDisputeCaseQuery_adminDisputeCase = { studentName: string | null, teacherName: string | null, session: AdminDisputeCaseQuery_adminDisputeCase_session, report: AdminDisputeCaseQuery_adminDisputeCase_report | null, homework: AdminDisputeCaseQuery_adminDisputeCase_homework | null, recitation: AdminDisputeCaseQuery_adminDisputeCase_recitation | null, auditTrail: Array<AdminDisputeCaseQuery_adminDisputeCase_auditTrail> };

export type AdminDisputeCaseQuery = { adminDisputeCase: AdminDisputeCaseQuery_adminDisputeCase };


export type AdminDisputeCaseQueryVariables = Exact<{
  id: string | number;
}>;

export type AdminDisputeAnalyticsQuery_adminDisputeAnalytics = { openDisputes: number, resolvedDisputes: number, cancelCount: number, completeCount: number, refundCount: number, partialRefundCount: number, upholdCount: number };

export type AdminDisputeAnalyticsQuery = { adminDisputeAnalytics: AdminDisputeAnalyticsQuery_adminDisputeAnalytics };


export type AdminDisputeAnalyticsQueryVariables = Exact<{ [key: string]: never; }>;

export type TeacherDisputeCaseQuery_teacherDisputeCase_session = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type TeacherDisputeCaseQuery_teacherDisputeCase_report = { id: string, sessionId: number, teacherNotes: string, studentRatingByTeacher: number, createdAt: string, updatedAt: string };

export type TeacherDisputeCaseQuery_teacherDisputeCase_homework = { id: string, sessionId: number, currentFromAyah: number | null, currentToAyah: number | null, currentGrade: number | null, currentSurahJuz: SurahJuzRef | null, revisionFromAyah: number | null, revisionToAyah: number | null, revisionGrade: number | null, revisionSurahJuz: SurahJuzRef | null, createdAt: string, updatedAt: string };

export type TeacherDisputeCaseQuery_teacherDisputeCase_recitation = { id: string, sessionId: string, name: string, description: string | null, createdAt: string, updatedAt: string };

export type TeacherDisputeCaseQuery_teacherDisputeCase = { studentName: string | null, session: TeacherDisputeCaseQuery_teacherDisputeCase_session, report: TeacherDisputeCaseQuery_teacherDisputeCase_report | null, homework: TeacherDisputeCaseQuery_teacherDisputeCase_homework | null, recitation: TeacherDisputeCaseQuery_teacherDisputeCase_recitation | null };

export type TeacherDisputeCaseQuery = { teacherDisputeCase: TeacherDisputeCaseQuery_teacherDisputeCase };


export type TeacherDisputeCaseQueryVariables = Exact<{
  id: string | number;
}>;

export type StudentDisputeCaseQuery_studentDisputeCase_session = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type StudentDisputeCaseQuery_studentDisputeCase_report = { id: string, sessionId: number, teacherNotes: string, studentRatingByTeacher: number, createdAt: string, updatedAt: string };

export type StudentDisputeCaseQuery_studentDisputeCase_homework = { id: string, sessionId: number, currentFromAyah: number | null, currentToAyah: number | null, currentGrade: number | null, currentSurahJuz: SurahJuzRef | null, revisionFromAyah: number | null, revisionToAyah: number | null, revisionGrade: number | null, revisionSurahJuz: SurahJuzRef | null, createdAt: string, updatedAt: string };

export type StudentDisputeCaseQuery_studentDisputeCase_recitation = { id: string, sessionId: string, name: string, description: string | null, createdAt: string, updatedAt: string };

export type StudentDisputeCaseQuery_studentDisputeCase = { teacherName: string | null, session: StudentDisputeCaseQuery_studentDisputeCase_session, report: StudentDisputeCaseQuery_studentDisputeCase_report | null, homework: StudentDisputeCaseQuery_studentDisputeCase_homework | null, recitation: StudentDisputeCaseQuery_studentDisputeCase_recitation | null };

export type StudentDisputeCaseQuery = { studentDisputeCase: StudentDisputeCaseQuery_studentDisputeCase };


export type StudentDisputeCaseQueryVariables = Exact<{
  id: string | number;
}>;

export type OpenSessionDisputeMutation_openSessionDispute = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type OpenSessionDisputeMutation = { openSessionDispute: OpenSessionDisputeMutation_openSessionDispute };


export type OpenSessionDisputeMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;

export type OpenPostConfirmationDisputeMutation_openPostConfirmationDispute = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type OpenPostConfirmationDisputeMutation = { openPostConfirmationDispute: OpenPostConfirmationDisputeMutation_openPostConfirmationDispute };


export type OpenPostConfirmationDisputeMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;

export type ResolveSessionDisputeMutation_resolveSessionDispute = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type ResolveSessionDisputeMutation = { resolveSessionDispute: ResolveSessionDisputeMutation_resolveSessionDispute };


export type ResolveSessionDisputeMutationVariables = Exact<{
  id: string | number;
  resolution: DisputeResolution;
  note: string | null | undefined;
  partialAmount: string | null | undefined;
}>;

export type AdminDisputedSessionsQuery_adminDisputedSessions_items_session = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type AdminDisputedSessionsQuery_adminDisputedSessions_items = { studentName: string | null, teacherName: string | null, session: AdminDisputedSessionsQuery_adminDisputedSessions_items_session };

export type AdminDisputedSessionsQuery_adminDisputedSessions = { page: number, pageSize: number, totalCount: number, items: Array<AdminDisputedSessionsQuery_adminDisputedSessions_items> };

export type AdminDisputedSessionsQuery = { adminDisputedSessions: AdminDisputedSessionsQuery_adminDisputedSessions };


export type AdminDisputedSessionsQueryVariables = Exact<{
  filter: SessionListFilterInput | null | undefined;
  limit: number | null | undefined;
  offset: number | null | undefined;
}>;

export type CreateSessionMutation_createSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type CreateSessionMutation = { createSession: CreateSessionMutation_createSession };


export type CreateSessionMutationVariables = Exact<{
  input: CreateSessionInput;
}>;

export type StartSessionMutation_startSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type StartSessionMutation = { startSession: StartSessionMutation_startSession };


export type StartSessionMutationVariables = Exact<{
  id: string | number;
}>;

export type CompleteSessionMutation_completeSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type CompleteSessionMutation = { completeSession: CompleteSessionMutation_completeSession };


export type CompleteSessionMutationVariables = Exact<{
  id: string | number;
}>;

export type CancelSessionMutation_cancelSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type CancelSessionMutation = { cancelSession: CancelSessionMutation_cancelSession };


export type CancelSessionMutationVariables = Exact<{
  id: string | number;
  reason: string | null | undefined;
}>;

export type ConfirmSessionCompletionMutation_confirmSessionCompletion = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type ConfirmSessionCompletionMutation = { confirmSessionCompletion: ConfirmSessionCompletionMutation_confirmSessionCompletion };


export type ConfirmSessionCompletionMutationVariables = Exact<{
  id: string | number;
}>;

export type SessionByIdQuery_sessionById = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null };

export type SessionByIdQuery = { sessionById: SessionByIdQuery_sessionById | null };


export type SessionByIdQueryVariables = Exact<{
  id: string | number;
}>;

export type MyStudentSessionsQuery_myStudentSessions_items_student = { id: string, fullName: string };

export type MyStudentSessionsQuery_myStudentSessions_items_teacher = { id: string, fullName: string };

export type MyStudentSessionsQuery_myStudentSessions_items = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null, student: MyStudentSessionsQuery_myStudentSessions_items_student | null, teacher: MyStudentSessionsQuery_myStudentSessions_items_teacher | null };

export type MyStudentSessionsQuery_myStudentSessions = { page: number, pageSize: number, totalCount: number, items: Array<MyStudentSessionsQuery_myStudentSessions_items> };

export type MyStudentSessionsQuery = { myStudentSessions: MyStudentSessionsQuery_myStudentSessions };


export type MyStudentSessionsQueryVariables = Exact<{
  filter: SessionListFilterInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type MyTeacherSessionsQuery_myTeacherSessions_items_student = { id: string, fullName: string };

export type MyTeacherSessionsQuery_myTeacherSessions_items_teacher = { id: string, fullName: string };

export type MyTeacherSessionsQuery_myTeacherSessions_items = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolutionOutcome: DisputeResolution | null, resolvedAt: string | null, student: MyTeacherSessionsQuery_myTeacherSessions_items_student | null, teacher: MyTeacherSessionsQuery_myTeacherSessions_items_teacher | null };

export type MyTeacherSessionsQuery_myTeacherSessions = { page: number, pageSize: number, totalCount: number, items: Array<MyTeacherSessionsQuery_myTeacherSessions_items> };

export type MyTeacherSessionsQuery = { myTeacherSessions: MyTeacherSessionsQuery_myTeacherSessions };


export type MyTeacherSessionsQueryVariables = Exact<{
  filter: SessionListFilterInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type SubmitSessionReportMutation_submitSessionReport = { id: string, sessionId: number, teacherNotes: string, studentRatingByTeacher: number, createdAt: string, updatedAt: string };

export type SubmitSessionReportMutation = { submitSessionReport: SubmitSessionReportMutation_submitSessionReport };


export type SubmitSessionReportMutationVariables = Exact<{
  id: string | number;
  input: SubmitSessionReportInput;
}>;

export type SessionReportQuery_sessionReport = { id: string, sessionId: number, teacherNotes: string, studentRatingByTeacher: number, createdAt: string, updatedAt: string };

export type SessionReportQuery = { sessionReport: SessionReportQuery_sessionReport | null };


export type SessionReportQueryVariables = Exact<{
  sessionId: string | number;
}>;

export type SessionHomeWorkQuery_sessionHomework = { id: string, sessionId: number, currentFromAyah: number | null, currentToAyah: number | null, currentGrade: number | null, currentSurahJuz: SurahJuzRef | null, revisionFromAyah: number | null, revisionToAyah: number | null, revisionGrade: number | null, revisionSurahJuz: SurahJuzRef | null, createdAt: string, updatedAt: string };

export type SessionHomeWorkQuery = { sessionHomework: SessionHomeWorkQuery_sessionHomework | null };


export type SessionHomeWorkQueryVariables = Exact<{
  sessionId: string | number;
}>;

export type StudentHomeworkHistoryQuery_studentHomeworkHistory_items = { id: string, sessionId: number, currentFromAyah: number | null, currentToAyah: number | null, currentGrade: number | null, currentSurahJuz: SurahJuzRef | null, revisionFromAyah: number | null, revisionToAyah: number | null, revisionGrade: number | null, revisionSurahJuz: SurahJuzRef | null, createdAt: string, updatedAt: string };

export type StudentHomeworkHistoryQuery_studentHomeworkHistory = { totalCount: number, page: number, pageSize: number, items: Array<StudentHomeworkHistoryQuery_studentHomeworkHistory_items> };

export type StudentHomeworkHistoryQuery = { studentHomeworkHistory: StudentHomeworkHistoryQuery_studentHomeworkHistory };


export type StudentHomeworkHistoryQueryVariables = Exact<{
  studentId: string | number;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type StudentProgressQuery_studentProgress = { hasProgress: boolean, studentId: number, planId: number | null, planTitle: string | null, totalLessons: number, currentLessonId: number | null, currentLessonTitle: string | null, currentLessonPosition: number | null, lessonsCompleted: number, completionPercent: number, isOnFinalLesson: boolean };

export type StudentProgressQuery = { studentProgress: StudentProgressQuery_studentProgress };


export type StudentProgressQueryVariables = Exact<{
  studentId: number;
}>;

export type MyHandshakeCodeQuery = { myHandshakeCode: string };


export type MyHandshakeCodeQueryVariables = Exact<{ [key: string]: never; }>;

export type FindStudentByHandshakeCodeQuery_findStudentByHandshakeCode = { maskedName: string, linkable: boolean };

export type FindStudentByHandshakeCodeQuery = { findStudentByHandshakeCode: FindStudentByHandshakeCodeQuery_findStudentByHandshakeCode | null };


export type FindStudentByHandshakeCodeQueryVariables = Exact<{
  code: string;
}>;

export type MyHomeworkQuery_myHomework_items_jadid = { surahJuz: SurahJuzRef | null, fromAyah: number | null, toAyah: number | null, grade: number | null };

export type MyHomeworkQuery_myHomework_items_madi = { surahJuz: SurahJuzRef | null, fromAyah: number | null, toAyah: number | null, grade: number | null };

export type MyHomeworkQuery_myHomework_items = { id: string, sessionId: number, createdAt: string, jadid: MyHomeworkQuery_myHomework_items_jadid | null, madi: MyHomeworkQuery_myHomework_items_madi | null };

export type MyHomeworkQuery_myHomework = { totalCount: number, page: number, pageSize: number, items: Array<MyHomeworkQuery_myHomework_items> };

export type MyHomeworkQuery = { myHomework: MyHomeworkQuery_myHomework };


export type MyHomeworkQueryVariables = Exact<{
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type MySessionBalanceQuery_mySessionBalance = { balanceHifz: number | null, balanceReviews: number | null, balanceTajweed: number | null, balanceTrial: number };

export type MySessionBalanceQuery = { mySessionBalance: MySessionBalanceQuery_mySessionBalance };


export type MySessionBalanceQueryVariables = Exact<{ [key: string]: never; }>;

export type MyApplicantProfileQuery_myApplicantProfile = { id: number, status: ApplicantStatus, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, cooldownActive: boolean, canPurchaseVerification: boolean };

export type MyApplicantProfileQuery = { myApplicantProfile: MyApplicantProfileQuery_myApplicantProfile | null };


export type MyApplicantProfileQueryVariables = Exact<{ [key: string]: never; }>;

export type BookEvaluationSessionMutation_bookEvaluationSession = { id: string, status: SessionStatus, sessionType: SessionType, intent: SessionIntent | null, teacherId: string, studentId: string, confirmationDeadline: string | null, createdAt: string };

export type BookEvaluationSessionMutation = { bookEvaluationSession: BookEvaluationSessionMutation_bookEvaluationSession };


export type BookEvaluationSessionMutationVariables = Exact<{
  input: BookEvaluationSessionInput;
}>;

export type MyEvaluationLoopStatusQuery_myEvaluationLoopStatus = { bookedCount: number, completedCount: number, remainingCredits: number, cycleStartDate: string | null };

export type MyEvaluationLoopStatusQuery = { myEvaluationLoopStatus: MyEvaluationLoopStatusQuery_myEvaluationLoopStatus | null };


export type MyEvaluationLoopStatusQueryVariables = Exact<{ [key: string]: never; }>;

export type AvailableEvaluatorsQuery_availableEvaluators_items = { id: string, fullName: string, isOnline: boolean, averageRating: string | null, subjects: string | null };

export type AvailableEvaluatorsQuery_availableEvaluators = { totalCount: number, page: number, pageSize: number, items: Array<AvailableEvaluatorsQuery_availableEvaluators_items> };

export type AvailableEvaluatorsQuery = { availableEvaluators: AvailableEvaluatorsQuery_availableEvaluators };


export type AvailableEvaluatorsQueryVariables = Exact<{
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type MyEvaluationSessionsQuery_myEvaluationSessions_items = { id: string, status: SessionStatus, sessionType: SessionType, intent: SessionIntent | null, teacherId: string, studentId: string, confirmationDeadline: string | null, createdAt: string };

export type MyEvaluationSessionsQuery_myEvaluationSessions = { totalCount: number, page: number, pageSize: number, items: Array<MyEvaluationSessionsQuery_myEvaluationSessions_items> };

export type MyEvaluationSessionsQuery = { myEvaluationSessions: MyEvaluationSessionsQuery_myEvaluationSessions };


export type MyEvaluationSessionsQueryVariables = Exact<{
  filter: SessionListFilterInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type SubmitRubricEvaluationMutation_submitRubricEvaluation = { id: string, sessionId: string | null, evaluatorId: string, evaluatedId: string, score: number | null, weaknessArea: RubricWeaknessArea | null, createdAt: string, applicantStatus: ApplicantStatus };

export type SubmitRubricEvaluationMutation = { submitRubricEvaluation: SubmitRubricEvaluationMutation_submitRubricEvaluation };


export type SubmitRubricEvaluationMutationVariables = Exact<{
  sessionId: string | number;
  input: RubricEvaluationSubmitInput;
}>;

export type MyRubricPendingSessionsQuery_myRubricPendingSessions_items = { id: string, status: SessionStatus, sessionType: SessionType, intent: SessionIntent | null, teacherId: string, studentId: string, confirmationDeadline: string | null, createdAt: string };

export type MyRubricPendingSessionsQuery_myRubricPendingSessions = { totalCount: number, page: number, pageSize: number, items: Array<MyRubricPendingSessionsQuery_myRubricPendingSessions_items> };

export type MyRubricPendingSessionsQuery = { myRubricPendingSessions: MyRubricPendingSessionsQuery_myRubricPendingSessions };


export type MyRubricPendingSessionsQueryVariables = Exact<{
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type MyRubricEvaluationQuery_myRubricEvaluation = { id: string, sessionId: string | null, evaluatorId: string, evaluatedId: string, score: number | null, weaknessArea: RubricWeaknessArea | null, createdAt: string, applicantStatus: ApplicantStatus };

export type MyRubricEvaluationQuery = { myRubricEvaluation: MyRubricEvaluationQuery_myRubricEvaluation | null };


export type MyRubricEvaluationQueryVariables = Exact<{
  sessionId: string | number;
}>;

export type SubmitTeacherEvaluationMutation_submitTeacherEvaluation = { id: string, evaluatedId: number, evaluatorId: number, sessionId: number | null, score: number | null, createdAt: string };

export type SubmitTeacherEvaluationMutation = { submitTeacherEvaluation: SubmitTeacherEvaluationMutation_submitTeacherEvaluation };


export type SubmitTeacherEvaluationMutationVariables = Exact<{
  input: SubmitTeacherEvaluationInput;
  sessionId: string | number;
}>;

export type MyTeacherEvaluationsQuery_myTeacherEvaluations = { id: string, evaluatedId: number, evaluatorId: number, sessionId: number | null, score: number | null, createdAt: string };

export type MyTeacherEvaluationsQuery = { myTeacherEvaluations: Array<MyTeacherEvaluationsQuery_myTeacherEvaluations> };


export type MyTeacherEvaluationsQueryVariables = Exact<{ [key: string]: never; }>;

export type MyTeacherAvailabilityQuery_myTeacherAvailability = { id: number, isOnline: boolean, isApproved: boolean };

export type MyTeacherAvailabilityQuery = { myTeacherAvailability: MyTeacherAvailabilityQuery_myTeacherAvailability };


export type MyTeacherAvailabilityQueryVariables = Exact<{ [key: string]: never; }>;

export type SetTeacherAvailabilityMutation_setTeacherAvailability = { id: number, isOnline: boolean, isApproved: boolean };

export type SetTeacherAvailabilityMutation = { setTeacherAvailability: SetTeacherAvailabilityMutation_setTeacherAvailability };


export type SetTeacherAvailabilityMutationVariables = Exact<{
  isOnline: boolean;
}>;

export type BrowseAvailableTeachersQuery_browseAvailableTeachers_items = { id: number, fullName: string, country: string | null, countryCode: string | null, subjects: Array<string>, recitations: Array<RecitationReading>, languages: Array<string>, averageRating: number | null, isOnline: boolean };

export type BrowseAvailableTeachersQuery_browseAvailableTeachers = { total: number, page: number, pageSize: number, pageCount: number, items: Array<BrowseAvailableTeachersQuery_browseAvailableTeachers_items> };

export type BrowseAvailableTeachersQuery = { browseAvailableTeachers: BrowseAvailableTeachersQuery_browseAvailableTeachers };


export type BrowseAvailableTeachersQueryVariables = Exact<{
  intent: SessionIntent;
  minRating: number | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
  recitation: RecitationReading;
  search: string | null | undefined;
  sort: TeacherMatchingSort | null | undefined;
}>;

export const AdminStudentListItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminStudentListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminStudentItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParent"}},{"kind":"Field","name":{"kind":"Name","value":"parentName"}},{"kind":"Field","name":{"kind":"Name","value":"parentEmail"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminStudentListItemFieldsFragment, unknown>;
export const AdminSubscriptionRowFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminSubscriptionRowFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StudentSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"auditEntriesCount"}},{"kind":"Field","name":{"kind":"Name","value":"auditTrailPeek"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"at"}}]}},{"kind":"Field","name":{"kind":"Name","value":"plan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<AdminSubscriptionRowFieldsFragment, unknown>;
export const AdminApplicantListItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminApplicantListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminApplicantItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminApplicantListItemFieldsFragment, unknown>;
export const AdminTeacherListItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminTeacherListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminTeacherItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"subjects"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminTeacherListItemFieldsFragment, unknown>;
export const AdminUserListItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserListItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicantStatus"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"teacherIsApproved"}},{"kind":"Field","name":{"kind":"Name","value":"teacherIsEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"studentHasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"studentHasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"parentLinkedChildrenCount"}}]}}]} as unknown as DocumentNode<AdminUserListItemFieldsFragment, unknown>;
export const AdminUserDetailFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminUserDetailFieldsFragment, unknown>;
export const AdminApplicantProfileFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminApplicantProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApplicantProfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}}]} as unknown as DocumentNode<AdminApplicantProfileFieldsFragment, unknown>;
export const AdminBroadcastEntryFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminBroadcastEntryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminBroadcastEntry"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"audienceType"}},{"kind":"Field","name":{"kind":"Name","value":"audienceRole"}},{"kind":"Field","name":{"kind":"Name","value":"audienceCountry"}},{"kind":"Field","name":{"kind":"Name","value":"audiencePlanId"}},{"kind":"Field","name":{"kind":"Name","value":"recipientCount"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}},{"kind":"Field","name":{"kind":"Name","value":"sentById"}},{"kind":"Field","name":{"kind":"Name","value":"sentByName"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedAt"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedById"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedByName"}}]}}]} as unknown as DocumentNode<AdminBroadcastEntryFieldsFragment, unknown>;
export const AdminAcademicDashboardDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminAcademicDashboard"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"search"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminAcademicDashboard"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}},{"kind":"Argument","name":{"kind":"Name","value":"search"},"value":{"kind":"Variable","name":{"kind":"Name","value":"search"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"latestJadidPosition"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestMadiPosition"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}}]}},{"kind":"Field","name":{"kind":"Name","value":"jadidGradeSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"gradedCount"}},{"kind":"Field","name":{"kind":"Name","value":"averageGrade"}}]}},{"kind":"Field","name":{"kind":"Name","value":"madiGradeSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"gradedCount"}},{"kind":"Field","name":{"kind":"Name","value":"averageGrade"}}]}},{"kind":"Field","name":{"kind":"Name","value":"progressRowCount"}},{"kind":"Field","name":{"kind":"Name","value":"lastGradedHomeworkAt"}},{"kind":"Field","name":{"kind":"Name","value":"needsAttention"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reasons"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"pageCount"}},{"kind":"Field","name":{"kind":"Name","value":"stats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"trackedStudentCount"}},{"kind":"Field","name":{"kind":"Name","value":"studentsWithGradedHomeworkCount"}},{"kind":"Field","name":{"kind":"Name","value":"averageJadidGrade"}},{"kind":"Field","name":{"kind":"Name","value":"averageMadiGrade"}},{"kind":"Field","name":{"kind":"Name","value":"needingAttentionCount"}}]}}]}}]}}]} as unknown as DocumentNode<AdminAcademicDashboardQuery, AdminAcademicDashboardQueryVariables>;
export const AdminStudentAcademicDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminStudentAcademicDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminStudentAcademicDetail"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"studentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}}]}},{"kind":"Field","name":{"kind":"Name","value":"homeworkPage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionStartedAt"}},{"kind":"Field","name":{"kind":"Name","value":"teacherName"}},{"kind":"Field","name":{"kind":"Name","value":"jadid"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}},{"kind":"Field","name":{"kind":"Name","value":"grade"}}]}},{"kind":"Field","name":{"kind":"Name","value":"madi"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}},{"kind":"Field","name":{"kind":"Name","value":"grade"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"pageCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reportPage"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionStartedAt"}},{"kind":"Field","name":{"kind":"Name","value":"teacherName"}},{"kind":"Field","name":{"kind":"Name","value":"teacherNotes"}},{"kind":"Field","name":{"kind":"Name","value":"studentRatingByTeacher"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"pageCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"progressRowCount"}},{"kind":"Field","name":{"kind":"Name","value":"needsAttention"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reasons"}}]}}]}}]}}]} as unknown as DocumentNode<AdminStudentAcademicDetailQuery, AdminStudentAcademicDetailQueryVariables>;
export const AdminStudentPaymentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminStudentPayments"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminStudentPaymentsFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminStudentPayments"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"studentName"}},{"kind":"Field","name":{"kind":"Name","value":"subscriptionId"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"paymentGateway"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<AdminStudentPaymentsQuery, AdminStudentPaymentsQueryVariables>;
export const AdminTeacherWalletDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminTeacherWallet"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teacherId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminWalletTransactionFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminTeacherWallet"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teacherId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teacherId"}}},{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"balance"}},{"kind":"Field","name":{"kind":"Name","value":"totalEarning"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherName"}},{"kind":"Field","name":{"kind":"Name","value":"transactions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<AdminTeacherWalletQuery, AdminTeacherWalletQueryVariables>;
export const AdminPendingWithdrawalsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminPendingWithdrawals"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminPendingWithdrawals"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"transaction"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacherName"}},{"kind":"Field","name":{"kind":"Name","value":"walletBalance"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"totalAmount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<AdminPendingWithdrawalsQuery, AdminPendingWithdrawalsQueryVariables>;
export const ApproveWithdrawalDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ApproveWithdrawal"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"approveWithdrawal"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"transactionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"walletId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<ApproveWithdrawalMutation, ApproveWithdrawalMutationVariables>;
export const RejectWithdrawalDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RejectWithdrawal"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rejectWithdrawal"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"transactionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"transactionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"walletId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<RejectWithdrawalMutation, RejectWithdrawalMutationVariables>;
export const AdjustTeacherWalletDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdjustTeacherWallet"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdjustTeacherWalletInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adjustTeacherWallet"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"walletId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<AdjustTeacherWalletMutation, AdjustTeacherWalletMutationVariables>;
export const AdminOrderTeacherReEvaluationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminOrderTeacherReEvaluation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"teacherId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminOrderTeacherReEvaluation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"teacherId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"teacherId"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"amountCharged"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"walletBalance"}},{"kind":"Field","name":{"kind":"Name","value":"reEvaluationStartedAt"}}]}}]}}]} as unknown as DocumentNode<AdminOrderTeacherReEvaluationMutation, AdminOrderTeacherReEvaluationMutationVariables>;
export const AdminSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminSessionListFilterInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"needsAttention"}}]}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<AdminSessionsQuery, AdminSessionsQueryVariables>;
export const AdminSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"needsAttention"}}]}}]}}]} as unknown as DocumentNode<AdminSessionQuery, AdminSessionQueryVariables>;
export const AdminSessionRescheduleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSessionReschedule"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminSessionRescheduleInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminRescheduleSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"needsAttention"}}]}}]}}]} as unknown as DocumentNode<AdminSessionRescheduleMutation, AdminSessionRescheduleMutationVariables>;
export const AdminSessionCancelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSessionCancel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminSessionCancelInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminCancelSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"needsAttention"}}]}}]}}]} as unknown as DocumentNode<AdminSessionCancelMutation, AdminSessionCancelMutationVariables>;
export const AdminSessionReassignDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSessionReassign"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminSessionReassignInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminReassignTeacher"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"needsAttention"}}]}}]}}]} as unknown as DocumentNode<AdminSessionReassignMutation, AdminSessionReassignMutationVariables>;
export const AdminSessionJoinDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSessionJoin"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminSessionJoinInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminJoinSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}},{"kind":"Field","name":{"kind":"Name","value":"needsAttention"}}]}}]}}]} as unknown as DocumentNode<AdminSessionJoinMutation, AdminSessionJoinMutationVariables>;
export const AdminOnboardStudentWithOfflinePaymentDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminOnboardStudentWithOfflinePayment"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminOnboardStudentOfflineInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminOnboardStudentWithOfflinePayment"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"subscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"paymentMethod"}},{"kind":"Field","name":{"kind":"Name","value":"paymentReference"}},{"kind":"Field","name":{"kind":"Name","value":"paymentVerifiedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"creditedLane"}},{"kind":"Field","name":{"kind":"Name","value":"creditedSessions"}},{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}}]}}]}}]} as unknown as DocumentNode<AdminOnboardStudentWithOfflinePaymentMutation, AdminOnboardStudentWithOfflinePaymentMutationVariables>;
export const AdminStudentsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminStudents"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminStudentFiltersInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminStudents"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminStudentListItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"pageCount"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminStudentListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminStudentItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParent"}},{"kind":"Field","name":{"kind":"Name","value":"parentName"}},{"kind":"Field","name":{"kind":"Name","value":"parentEmail"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminStudentsQuery, AdminStudentsQueryVariables>;
export const AdminStudentsExportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminStudentsExport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminStudentFiltersInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminStudentsExport"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rows"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminStudentListItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"truncated"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminStudentListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminStudentItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParent"}},{"kind":"Field","name":{"kind":"Name","value":"parentName"}},{"kind":"Field","name":{"kind":"Name","value":"parentEmail"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminStudentsExportQuery, AdminStudentsExportQueryVariables>;
export const AdminStudentSubscriptionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminStudentSubscriptions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminStudentSubscriptions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminSubscriptionRowFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminSubscriptionRowFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StudentSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"auditEntriesCount"}},{"kind":"Field","name":{"kind":"Name","value":"auditTrailPeek"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"at"}}]}},{"kind":"Field","name":{"kind":"Name","value":"plan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<AdminStudentSubscriptionsQuery, AdminStudentSubscriptionsQueryVariables>;
export const AdminSubscriptionExtendDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSubscriptionExtend"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ExtendSubscriptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminExtendSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminSubscriptionRowFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminSubscriptionRowFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StudentSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"auditEntriesCount"}},{"kind":"Field","name":{"kind":"Name","value":"auditTrailPeek"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"at"}}]}},{"kind":"Field","name":{"kind":"Name","value":"plan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<AdminSubscriptionExtendMutation, AdminSubscriptionExtendMutationVariables>;
export const AdminSubscriptionRenewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSubscriptionRenew"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RenewSubscriptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminRenewSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminSubscriptionRowFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminSubscriptionRowFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StudentSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"auditEntriesCount"}},{"kind":"Field","name":{"kind":"Name","value":"auditTrailPeek"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"at"}}]}},{"kind":"Field","name":{"kind":"Name","value":"plan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<AdminSubscriptionRenewMutation, AdminSubscriptionRenewMutationVariables>;
export const AdminSubscriptionCancelDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSubscriptionCancel"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CancelSubscriptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminCancelSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminSubscriptionRowFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminSubscriptionRowFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StudentSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"auditEntriesCount"}},{"kind":"Field","name":{"kind":"Name","value":"auditTrailPeek"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"at"}}]}},{"kind":"Field","name":{"kind":"Name","value":"plan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<AdminSubscriptionCancelMutation, AdminSubscriptionCancelMutationVariables>;
export const AdminSubscriptionPlanChangeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSubscriptionPlanChange"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeSubscriptionPlanInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminChangeSubscriptionPlan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"subscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminSubscriptionRowFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"direction"}},{"kind":"Field","name":{"kind":"Name","value":"carrySessions"}},{"kind":"Field","name":{"kind":"Name","value":"forfeitedSessions"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminSubscriptionRowFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"StudentSubscription"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"auditEntriesCount"}},{"kind":"Field","name":{"kind":"Name","value":"auditTrailPeek"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"at"}}]}},{"kind":"Field","name":{"kind":"Name","value":"plan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<AdminSubscriptionPlanChangeMutation, AdminSubscriptionPlanChangeMutationVariables>;
export const AdminTeacherApplicantsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminTeacherApplicants"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminApplicantFiltersInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminTeacherApplicants"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminApplicantListItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"pageCount"}},{"kind":"Field","name":{"kind":"Name","value":"statusCounts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pending"}},{"kind":"Field","name":{"kind":"Name","value":"inEvaluation"}},{"kind":"Field","name":{"kind":"Name","value":"failed"}},{"kind":"Field","name":{"kind":"Name","value":"passed"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminApplicantListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminApplicantItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminTeacherApplicantsQuery, AdminTeacherApplicantsQueryVariables>;
export const AdminTeacherApplicantsExportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminTeacherApplicantsExport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminApplicantFiltersInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminTeacherApplicantsExport"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rows"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminApplicantListItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"truncated"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminApplicantListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminApplicantItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminTeacherApplicantsExportQuery, AdminTeacherApplicantsExportQueryVariables>;
export const AdminTeachersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminTeachers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminTeacherFiltersInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminTeachers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminTeacherListItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"pageCount"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminTeacherListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminTeacherItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"subjects"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminTeachersQuery, AdminTeachersQueryVariables>;
export const AdminTeachersExportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminTeachersExport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminTeacherFiltersInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminTeachersExport"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rows"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminTeacherListItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"truncated"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminTeacherListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminTeacherItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"subjects"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]} as unknown as DocumentNode<AdminTeachersExportQuery, AdminTeachersExportQueryVariables>;
export const AdminUsersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUsers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserFiltersInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUsers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserListItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserListItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicantStatus"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"teacherIsApproved"}},{"kind":"Field","name":{"kind":"Name","value":"teacherIsEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"studentHasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"studentHasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"parentLinkedChildrenCount"}}]}}]} as unknown as DocumentNode<AdminUsersQuery, AdminUsersQueryVariables>;
export const AdminUserStatsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUserStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUserStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"activeCount"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedCount"}},{"kind":"Field","name":{"kind":"Name","value":"blockedCount"}},{"kind":"Field","name":{"kind":"Name","value":"deletedCount"}},{"kind":"Field","name":{"kind":"Name","value":"adminsCount"}},{"kind":"Field","name":{"kind":"Name","value":"teachersCount"}},{"kind":"Field","name":{"kind":"Name","value":"studentsCount"}},{"kind":"Field","name":{"kind":"Name","value":"parentsCount"}},{"kind":"Field","name":{"kind":"Name","value":"newThisWeekCount"}}]}}]}}]} as unknown as DocumentNode<AdminUserStatsQuery, AdminUserStatsQueryVariables>;
export const AdminApplicantCooldownStatsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminApplicantCooldownStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminApplicantCooldownStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activeCount"}},{"kind":"Field","name":{"kind":"Name","value":"expiringSoonCount"}},{"kind":"Field","name":{"kind":"Name","value":"expiredCount"}},{"kind":"Field","name":{"kind":"Name","value":"expiringSoonWindowDays"}}]}}]}}]} as unknown as DocumentNode<AdminApplicantCooldownStatsQuery, AdminApplicantCooldownStatsQueryVariables>;
export const AdminUserCountryBreakdownDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUserCountryBreakdown"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUserCountryBreakdown"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"buckets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"flag"}},{"kind":"Field","name":{"kind":"Name","value":"count"}}]}},{"kind":"Field","name":{"kind":"Name","value":"unresolvedCount"}}]}}]}}]} as unknown as DocumentNode<AdminUserCountryBreakdownQuery, AdminUserCountryBreakdownQueryVariables>;
export const AdminUserDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUserDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUserDetail"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminUserDetailQuery, AdminUserDetailQueryVariables>;
export const AdminUserActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUserActivity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUserActivity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"caption"}},{"kind":"Field","name":{"kind":"Name","value":"actorName"}},{"kind":"Field","name":{"kind":"Name","value":"changedFields"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<AdminUserActivityQuery, AdminUserActivityQueryVariables>;
export const AdminCreateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminCreateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminCreateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminCreateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminCreateUserMutation, AdminCreateUserMutationVariables>;
export const AdminUpdateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminUpdateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUpdateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUpdateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminUpdateUserMutation, AdminUpdateUserMutationVariables>;
export const AdminSetUserPasswordDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSetUserPassword"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminSetUserPasswordInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminSetUserPassword"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminSetUserPasswordMutation, AdminSetUserPasswordMutationVariables>;
export const AdminSetUserDeletedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSetUserDeleted"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"deleted"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminSetUserDeleted"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"deleted"},"value":{"kind":"Variable","name":{"kind":"Name","value":"deleted"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminSetUserDeletedMutation, AdminSetUserDeletedMutationVariables>;
export const AdminSetUserSuspendedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSetUserSuspended"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"suspended"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"periodDays"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminSetUserSuspended"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"suspended"},"value":{"kind":"Variable","name":{"kind":"Name","value":"suspended"}}},{"kind":"Argument","name":{"kind":"Name","value":"periodDays"},"value":{"kind":"Variable","name":{"kind":"Name","value":"periodDays"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminSetUserSuspendedMutation, AdminSetUserSuspendedMutationVariables>;
export const AdminExtendApplicantCooldownDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminExtendApplicantCooldown"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"applicantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"additionalDays"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminExtendApplicantCooldown"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"applicantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"applicantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"additionalDays"},"value":{"kind":"Variable","name":{"kind":"Name","value":"additionalDays"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminApplicantProfileFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminApplicantProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApplicantProfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}}]} as unknown as DocumentNode<AdminExtendApplicantCooldownMutation, AdminExtendApplicantCooldownMutationVariables>;
export const AdminOverrideApplicantEvaluationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminOverrideApplicantEvaluation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"applicantId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"action"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminApplicantOverrideAction"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"cooldownDays"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminOverrideApplicantEvaluation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"applicantId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"applicantId"}}},{"kind":"Argument","name":{"kind":"Name","value":"action"},"value":{"kind":"Variable","name":{"kind":"Name","value":"action"}}},{"kind":"Argument","name":{"kind":"Name","value":"cooldownDays"},"value":{"kind":"Variable","name":{"kind":"Name","value":"cooldownDays"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminApplicantProfileFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminApplicantProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ApplicantProfile"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}}]} as unknown as DocumentNode<AdminOverrideApplicantEvaluationMutation, AdminOverrideApplicantEvaluationMutationVariables>;
export const AdminSetUserBlockedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSetUserBlocked"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"blocked"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminSetUserBlocked"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"blocked"},"value":{"kind":"Variable","name":{"kind":"Name","value":"blocked"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownState"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminSetUserBlockedMutation, AdminSetUserBlockedMutationVariables>;
export const AdminAuditLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminAuditLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminAuditLogFiltersInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminAuditLogs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"actorName"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"details"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<AdminAuditLogsQuery, AdminAuditLogsQueryVariables>;
export const AdminPlatformAnalyticsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminPlatformAnalytics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminPlatformAnalytics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"users"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"activeCount"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedCount"}},{"kind":"Field","name":{"kind":"Name","value":"blockedCount"}},{"kind":"Field","name":{"kind":"Name","value":"deletedCount"}},{"kind":"Field","name":{"kind":"Name","value":"adminsCount"}},{"kind":"Field","name":{"kind":"Name","value":"teachersCount"}},{"kind":"Field","name":{"kind":"Name","value":"studentsCount"}},{"kind":"Field","name":{"kind":"Name","value":"parentsCount"}},{"kind":"Field","name":{"kind":"Name","value":"newThisWeekCount"}},{"kind":"Field","name":{"kind":"Name","value":"recentlyActive24h"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sessions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"today"}},{"kind":"Field","name":{"kind":"Name","value":"thisWeek"}},{"kind":"Field","name":{"kind":"Name","value":"thisMonth"}},{"kind":"Field","name":{"kind":"Name","value":"scheduled"}},{"kind":"Field","name":{"kind":"Name","value":"started"}},{"kind":"Field","name":{"kind":"Name","value":"completed"}},{"kind":"Field","name":{"kind":"Name","value":"cancelled"}},{"kind":"Field","name":{"kind":"Name","value":"disputed"}},{"kind":"Field","name":{"kind":"Name","value":"awaitingConfirmation"}}]}},{"kind":"Field","name":{"kind":"Name","value":"revenue"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"offlineActivationsCount"}},{"kind":"Field","name":{"kind":"Name","value":"gatewayRevenueByCurrency"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"totalAmount"}},{"kind":"Field","name":{"kind":"Name","value":"last30DaysAmount"}},{"kind":"Field","name":{"kind":"Name","value":"paidPaymentsCount"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"subscriptions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"active"}},{"kind":"Field","name":{"kind":"Name","value":"pending"}},{"kind":"Field","name":{"kind":"Name","value":"expired"}},{"kind":"Field","name":{"kind":"Name","value":"cancelled"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"activeInWindowNow"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teachers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"certifiedCount"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatorCount"}},{"kind":"Field","name":{"kind":"Name","value":"onlineNowCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"ratings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"averageSessionRating"}},{"kind":"Field","name":{"kind":"Name","value":"sessionRatingsCount"}},{"kind":"Field","name":{"kind":"Name","value":"averageEvaluationScore"}},{"kind":"Field","name":{"kind":"Name","value":"evaluationScoresCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"health"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pendingDisputes"}},{"kind":"Field","name":{"kind":"Name","value":"pendingWithdrawals"}}]}},{"kind":"Field","name":{"kind":"Name","value":"sessionTrendDaily"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bucketStart"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"revenueTrendDaily"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bucketStart"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}}]}}]}}]}}]} as unknown as DocumentNode<AdminPlatformAnalyticsQuery, AdminPlatformAnalyticsQueryVariables>;
export const AdminCertifyTeacherColdStartDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminCertifyTeacherColdStart"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"makeEvaluator"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}},"defaultValue":{"kind":"BooleanValue","value":true}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminCertifyTeacherColdStart"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}},{"kind":"Argument","name":{"kind":"Name","value":"makeEvaluator"},"value":{"kind":"Variable","name":{"kind":"Name","value":"makeEvaluator"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}}]}}]}}]} as unknown as DocumentNode<AdminCertifyTeacherColdStartMutation, AdminCertifyTeacherColdStartMutationVariables>;
export const RegisterUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegisterUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registerUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}}]}}]} as unknown as DocumentNode<RegisterUserMutation, RegisterUserMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"locale"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"preferredRecitation"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const LoginDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Login"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"email"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"password"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"login"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"email"},"value":{"kind":"Variable","name":{"kind":"Name","value":"email"}}},{"kind":"Argument","name":{"kind":"Name","value":"password"},"value":{"kind":"Variable","name":{"kind":"Name","value":"password"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"locale"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"preferredRecitation"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}}]}},{"kind":"Field","name":{"kind":"Name","value":"accessToken"}},{"kind":"Field","name":{"kind":"Name","value":"refreshToken"}}]}}]}}]} as unknown as DocumentNode<LoginMutation, LoginMutationVariables>;
export const UpdateMyLocaleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateMyLocale"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"locale"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AppLocale"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMyLocale"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"locale"},"value":{"kind":"Variable","name":{"kind":"Name","value":"locale"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"locale"}}]}}]}}]} as unknown as DocumentNode<UpdateMyLocaleMutation, UpdateMyLocaleMutationVariables>;
export const ChangeMyPasswordDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ChangeMyPassword"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChangeMyPasswordInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"changeMyPassword"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}}]}}]}}]} as unknown as DocumentNode<ChangeMyPasswordMutation, ChangeMyPasswordMutationVariables>;
export const RefreshTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RefreshToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"refreshToken"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"refreshToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"refreshToken"},"value":{"kind":"Variable","name":{"kind":"Name","value":"refreshToken"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accessToken"}},{"kind":"Field","name":{"kind":"Name","value":"refreshToken"}}]}}]}}]} as unknown as DocumentNode<RefreshTokenMutation, RefreshTokenMutationVariables>;
export const LogoutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Logout"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logout"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]} as unknown as DocumentNode<LogoutMutation, LogoutMutationVariables>;
export const RecordMyActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RecordMyActivity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"recordMyActivity"}}]}}]} as unknown as DocumentNode<RecordMyActivityMutation, RecordMyActivityMutationVariables>;
export const RecitationReadingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RecitationReadings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"recitationReadings"}}]}}]} as unknown as DocumentNode<RecitationReadingsQuery, RecitationReadingsQueryVariables>;
export const PlanCatalogDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PlanCatalog"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"planCatalog"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<PlanCatalogQuery, PlanCatalogQueryVariables>;
export const AdminPlansDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminPlans"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"includeInactive"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminPlans"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"includeInactive"},"value":{"kind":"Variable","name":{"kind":"Name","value":"includeInactive"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<AdminPlansQuery, AdminPlansQueryVariables>;
export const CreatePlanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreatePlan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreatePlanInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createPlan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<CreatePlanMutation, CreatePlanMutationVariables>;
export const UpdatePlanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdatePlan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdatePlanInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updatePlan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"balanceLane"}}]}}]}}]} as unknown as DocumentNode<UpdatePlanMutation, UpdatePlanMutationVariables>;
export const SetPlanActiveStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetPlanActiveStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"isActive"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setPlanActiveStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"isActive"},"value":{"kind":"Variable","name":{"kind":"Name","value":"isActive"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SetPlanActiveStatusMutation, SetPlanActiveStatusMutationVariables>;
export const PurchaseSubscriptionPlanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PurchaseSubscriptionPlan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PurchaseSubscriptionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"purchaseSubscription"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"subscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"plan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"paymentMethod"}},{"kind":"Field","name":{"kind":"Name","value":"paymentReference"}},{"kind":"Field","name":{"kind":"Name","value":"paymentVerifiedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"payment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"subscriptionId"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"paymentGateway"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"checkout"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"providerReference"}},{"kind":"Field","name":{"kind":"Name","value":"checkoutUrl"}}]}}]}}]}}]} as unknown as DocumentNode<PurchaseSubscriptionPlanMutation, PurchaseSubscriptionPlanMutationVariables>;
export const MySubscriptionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MySubscriptions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mySubscriptions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"plan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"paymentMethod"}},{"kind":"Field","name":{"kind":"Name","value":"paymentReference"}},{"kind":"Field","name":{"kind":"Name","value":"paymentVerifiedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<MySubscriptionsQuery, MySubscriptionsQueryVariables>;
export const PurchaseVerificationPlanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"PurchaseVerificationPlan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"purchaseVerificationPlan"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"subscription"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"payment"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"checkout"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"provider"}},{"kind":"Field","name":{"kind":"Name","value":"providerReference"}},{"kind":"Field","name":{"kind":"Name","value":"checkoutUrl"}}]}}]}}]}}]} as unknown as DocumentNode<PurchaseVerificationPlanMutation, PurchaseVerificationPlanMutationVariables>;
export const MyWalletDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyWallet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myWallet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"balance"}},{"kind":"Field","name":{"kind":"Name","value":"totalEarning"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"transactions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"walletId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<MyWalletQuery, MyWalletQueryVariables>;
export const MyWalletLedgerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyWalletLedger"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myWalletLedger"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rows"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"walletId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"hasMore"}}]}}]}}]} as unknown as DocumentNode<MyWalletLedgerQuery, MyWalletLedgerQueryVariables>;
export const RequestWithdrawalDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RequestWithdrawal"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RequestWithdrawalInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"requestWithdrawal"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"balance"}},{"kind":"Field","name":{"kind":"Name","value":"totalEarning"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"transactions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"walletId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<RequestWithdrawalMutation, RequestWithdrawalMutationVariables>;
export const PlanLessonsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PlanLessons"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"planId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"planLessons"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"planId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"planId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<PlanLessonsQuery, PlanLessonsQueryVariables>;
export const CreateLessonDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateLesson"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateLessonInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createLesson"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]} as unknown as DocumentNode<CreateLessonMutation, CreateLessonMutationVariables>;
export const UpdateLessonDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateLesson"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateLessonInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateLesson"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]} as unknown as DocumentNode<UpdateLessonMutation, UpdateLessonMutationVariables>;
export const DeleteLessonDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteLesson"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteLesson"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}}]}}]} as unknown as DocumentNode<DeleteLessonMutation, DeleteLessonMutationVariables>;
export const AdminBroadcastNotificationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminBroadcastNotification"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminBroadcastNotificationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminBroadcastNotification"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<AdminBroadcastNotificationMutation, AdminBroadcastNotificationMutationVariables>;
export const AdminBroadcastsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminBroadcasts"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminBroadcastFiltersInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminBroadcasts"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminBroadcastEntryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminBroadcastEntryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminBroadcastEntry"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"audienceType"}},{"kind":"Field","name":{"kind":"Name","value":"audienceRole"}},{"kind":"Field","name":{"kind":"Name","value":"audienceCountry"}},{"kind":"Field","name":{"kind":"Name","value":"audiencePlanId"}},{"kind":"Field","name":{"kind":"Name","value":"recipientCount"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}},{"kind":"Field","name":{"kind":"Name","value":"sentById"}},{"kind":"Field","name":{"kind":"Name","value":"sentByName"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedAt"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedById"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedByName"}}]}}]} as unknown as DocumentNode<AdminBroadcastsQuery, AdminBroadcastsQueryVariables>;
export const AdminBroadcastDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminBroadcastDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"broadcastId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminBroadcastDetail"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"broadcastId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"broadcastId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"entry"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminBroadcastEntryFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"liveDeliveredCount"}},{"kind":"Field","name":{"kind":"Name","value":"liveReadCount"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminBroadcastEntryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminBroadcastEntry"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"audienceType"}},{"kind":"Field","name":{"kind":"Name","value":"audienceRole"}},{"kind":"Field","name":{"kind":"Name","value":"audienceCountry"}},{"kind":"Field","name":{"kind":"Name","value":"audiencePlanId"}},{"kind":"Field","name":{"kind":"Name","value":"recipientCount"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}},{"kind":"Field","name":{"kind":"Name","value":"sentById"}},{"kind":"Field","name":{"kind":"Name","value":"sentByName"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedAt"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedById"}},{"kind":"Field","name":{"kind":"Name","value":"stoppedByName"}}]}}]} as unknown as DocumentNode<AdminBroadcastDetailQuery, AdminBroadcastDetailQueryVariables>;
export const AdminStopBroadcastDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminStopBroadcast"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"broadcastId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminStopBroadcast"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"broadcastId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"broadcastId"}}}]}]}}]} as unknown as DocumentNode<AdminStopBroadcastMutation, AdminStopBroadcastMutationVariables>;
export const MyNotificationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyNotifications"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MyNotificationsFilterInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myNotifications"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"relatedEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"relatedEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"hasMore"}}]}}]}}]} as unknown as DocumentNode<MyNotificationsQuery, MyNotificationsQueryVariables>;
export const MyUnreadNotificationCountDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyUnreadNotificationCount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myUnreadNotificationCount"}}]}}]} as unknown as DocumentNode<MyUnreadNotificationCountQuery, MyUnreadNotificationCountQueryVariables>;
export const MarkNotificationReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkNotificationRead"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markNotificationRead"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"relatedEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"relatedEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<MarkNotificationReadMutation, MarkNotificationReadMutationVariables>;
export const MarkAllNotificationsReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkAllNotificationsRead"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"type"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"NotificationType"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markAllNotificationsRead"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"Variable","name":{"kind":"Name","value":"type"}}}]}]}}]} as unknown as DocumentNode<MarkAllNotificationsReadMutation, MarkAllNotificationsReadMutationVariables>;
export const MyOutgoingParentLinkRequestsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyOutgoingParentLinkRequests"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myOutgoingParentLinkRequests"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"studentMaskedName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"respondedAt"}}]}}]}}]} as unknown as DocumentNode<MyOutgoingParentLinkRequestsQuery, MyOutgoingParentLinkRequestsQueryVariables>;
export const MyIncomingParentLinkRequestsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyIncomingParentLinkRequests"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myIncomingParentLinkRequests"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"parentFullName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"respondedAt"}}]}}]}}]} as unknown as DocumentNode<MyIncomingParentLinkRequestsQuery, MyIncomingParentLinkRequestsQueryVariables>;
export const RequestParentChildLinkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RequestParentChildLink"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"code"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"requestParentChildLink"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"code"},"value":{"kind":"Variable","name":{"kind":"Name","value":"code"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"studentMaskedName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"respondedAt"}}]}}]}}]} as unknown as DocumentNode<RequestParentChildLinkMutation, RequestParentChildLinkMutationVariables>;
export const RespondToParentLinkRequestDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RespondToParentLinkRequest"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"requestId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"accept"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"respondToParentLinkRequest"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"requestId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"requestId"}}},{"kind":"Argument","name":{"kind":"Name","value":"accept"},"value":{"kind":"Variable","name":{"kind":"Name","value":"accept"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"parentFullName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"respondedAt"}}]}}]}}]} as unknown as DocumentNode<RespondToParentLinkRequestMutation, RespondToParentLinkRequestMutationVariables>;
export const CancelParentLinkRequestDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelParentLinkRequest"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"requestId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelParentLinkRequest"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"requestId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"requestId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"studentMaskedName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}},{"kind":"Field","name":{"kind":"Name","value":"respondedAt"}}]}}]}}]} as unknown as DocumentNode<CancelParentLinkRequestMutation, CancelParentLinkRequestMutationVariables>;
export const MyLinkedChildrenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyLinkedChildren"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myLinkedChildren"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<MyLinkedChildrenQuery, MyLinkedChildrenQueryVariables>;
export const MyChildrenUpcomingSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyChildrenUpcomingSessions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myChildrenUpcomingSessions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"child"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"upcomingSessions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"scheduledTotalCount"}}]}}]}}]} as unknown as DocumentNode<MyChildrenUpcomingSessionsQuery, MyChildrenUpcomingSessionsQueryVariables>;
export const ParentChildProgressDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ParentChildProgress"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parentChildProgress"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"studentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"child"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"progressRowCount"}},{"kind":"Field","name":{"kind":"Name","value":"latestJadidPosition"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}}]}},{"kind":"Field","name":{"kind":"Name","value":"latestMadiPosition"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}}]}}]}}]}}]} as unknown as DocumentNode<ParentChildProgressQuery, ParentChildProgressQueryVariables>;
export const ParentChildSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ParentChildSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parentChildSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"studentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<ParentChildSessionsQuery, ParentChildSessionsQueryVariables>;
export const ParentChildReportsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ParentChildReports"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parentChildReports"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"studentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionStatus"}},{"kind":"Field","name":{"kind":"Name","value":"sessionStartedAt"}},{"kind":"Field","name":{"kind":"Name","value":"teacherNotes"}},{"kind":"Field","name":{"kind":"Name","value":"studentRatingByTeacher"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<ParentChildReportsQuery, ParentChildReportsQueryVariables>;
export const ParentChildHomeworkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ParentChildHomework"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parentChildHomework"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"studentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"jadid"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}},{"kind":"Field","name":{"kind":"Name","value":"grade"}}]}},{"kind":"Field","name":{"kind":"Name","value":"madi"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}},{"kind":"Field","name":{"kind":"Name","value":"grade"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<ParentChildHomeworkQuery, ParentChildHomeworkQueryVariables>;
export const ParentSessionTargetDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ParentSessionTarget"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parentSessionTarget"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}}]}}]}}]} as unknown as DocumentNode<ParentSessionTargetQuery, ParentSessionTargetQueryVariables>;
export const SessionRecitationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionRecitation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionRecitation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SessionRecitationQuery, SessionRecitationQueryVariables>;
export const SetSessionRecitationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetSessionRecitation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionRecitationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setSessionRecitation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SetSessionRecitationMutation, SetSessionRecitationMutationVariables>;
export const AdminDisputeCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminDisputeCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminDisputeCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"session"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"report"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherNotes"}},{"kind":"Field","name":{"kind":"Name","value":"studentRatingByTeacher"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"homework"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"currentFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentGrade"}},{"kind":"Field","name":{"kind":"Name","value":"currentSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"revisionFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionGrade"}},{"kind":"Field","name":{"kind":"Name","value":"revisionSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"recitation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"auditTrail"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"actorName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"details"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}}]}},{"kind":"Field","name":{"kind":"Name","value":"studentName"}},{"kind":"Field","name":{"kind":"Name","value":"teacherName"}}]}}]}}]} as unknown as DocumentNode<AdminDisputeCaseQuery, AdminDisputeCaseQueryVariables>;
export const AdminDisputeAnalyticsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminDisputeAnalytics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminDisputeAnalytics"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"openDisputes"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedDisputes"}},{"kind":"Field","name":{"kind":"Name","value":"cancelCount"}},{"kind":"Field","name":{"kind":"Name","value":"completeCount"}},{"kind":"Field","name":{"kind":"Name","value":"refundCount"}},{"kind":"Field","name":{"kind":"Name","value":"partialRefundCount"}},{"kind":"Field","name":{"kind":"Name","value":"upholdCount"}}]}}]}}]} as unknown as DocumentNode<AdminDisputeAnalyticsQuery, AdminDisputeAnalyticsQueryVariables>;
export const TeacherDisputeCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TeacherDisputeCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"teacherDisputeCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"session"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"report"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherNotes"}},{"kind":"Field","name":{"kind":"Name","value":"studentRatingByTeacher"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"homework"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"currentFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentGrade"}},{"kind":"Field","name":{"kind":"Name","value":"currentSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"revisionFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionGrade"}},{"kind":"Field","name":{"kind":"Name","value":"revisionSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"recitation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"studentName"}}]}}]}}]} as unknown as DocumentNode<TeacherDisputeCaseQuery, TeacherDisputeCaseQueryVariables>;
export const StudentDisputeCaseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"StudentDisputeCase"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"studentDisputeCase"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"session"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"report"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherNotes"}},{"kind":"Field","name":{"kind":"Name","value":"studentRatingByTeacher"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"homework"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"currentFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentGrade"}},{"kind":"Field","name":{"kind":"Name","value":"currentSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"revisionFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionGrade"}},{"kind":"Field","name":{"kind":"Name","value":"revisionSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"recitation"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacherName"}}]}}]}}]} as unknown as DocumentNode<StudentDisputeCaseQuery, StudentDisputeCaseQueryVariables>;
export const OpenSessionDisputeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"OpenSessionDispute"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"openSessionDispute"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<OpenSessionDisputeMutation, OpenSessionDisputeMutationVariables>;
export const OpenPostConfirmationDisputeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"OpenPostConfirmationDispute"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"openPostConfirmationDispute"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<OpenPostConfirmationDisputeMutation, OpenPostConfirmationDisputeMutationVariables>;
export const ResolveSessionDisputeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResolveSessionDispute"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"resolution"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DisputeResolution"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"note"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"partialAmount"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resolveSessionDispute"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"resolution"},"value":{"kind":"Variable","name":{"kind":"Name","value":"resolution"}}},{"kind":"Argument","name":{"kind":"Name","value":"note"},"value":{"kind":"Variable","name":{"kind":"Name","value":"note"}}},{"kind":"Argument","name":{"kind":"Name","value":"partialAmount"},"value":{"kind":"Variable","name":{"kind":"Name","value":"partialAmount"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<ResolveSessionDisputeMutation, ResolveSessionDisputeMutationVariables>;
export const AdminDisputedSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminDisputedSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionListFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminDisputedSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"session"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"studentName"}},{"kind":"Field","name":{"kind":"Name","value":"teacherName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<AdminDisputedSessionsQuery, AdminDisputedSessionsQueryVariables>;
export const CreateSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateSessionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<CreateSessionMutation, CreateSessionMutationVariables>;
export const StartSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StartSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<StartSessionMutation, StartSessionMutationVariables>;
export const CompleteSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CompleteSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"completeSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<CompleteSessionMutation, CompleteSessionMutationVariables>;
export const CancelSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<CancelSessionMutation, CancelSessionMutationVariables>;
export const ConfirmSessionCompletionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ConfirmSessionCompletion"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"confirmSessionCompletion"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<ConfirmSessionCompletionMutation, ConfirmSessionCompletionMutationVariables>;
export const SessionByIdDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionById"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionById"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<SessionByIdQuery, SessionByIdQueryVariables>;
export const MyStudentSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyStudentSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionListFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myStudentSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<MyStudentSessionsQuery, MyStudentSessionsQueryVariables>;
export const MyTeacherSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyTeacherSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionListFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myTeacherSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionOutcome"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<MyTeacherSessionsQuery, MyTeacherSessionsQueryVariables>;
export const SubmitSessionReportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SubmitSessionReport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SubmitSessionReportInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"submitSessionReport"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherNotes"}},{"kind":"Field","name":{"kind":"Name","value":"studentRatingByTeacher"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SubmitSessionReportMutation, SubmitSessionReportMutationVariables>;
export const SessionReportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionReport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionReport"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherNotes"}},{"kind":"Field","name":{"kind":"Name","value":"studentRatingByTeacher"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SessionReportQuery, SessionReportQueryVariables>;
export const SessionHomeWorkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionHomeWork"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionHomework"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"currentFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentGrade"}},{"kind":"Field","name":{"kind":"Name","value":"currentSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"revisionFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionGrade"}},{"kind":"Field","name":{"kind":"Name","value":"revisionSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SessionHomeWorkQuery, SessionHomeWorkQueryVariables>;
export const StudentHomeworkHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"StudentHomeworkHistory"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"studentHomeworkHistory"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"studentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"currentFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"currentGrade"}},{"kind":"Field","name":{"kind":"Name","value":"currentSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"revisionFromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionToAyah"}},{"kind":"Field","name":{"kind":"Name","value":"revisionGrade"}},{"kind":"Field","name":{"kind":"Name","value":"revisionSurahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<StudentHomeworkHistoryQuery, StudentHomeworkHistoryQueryVariables>;
export const StudentProgressDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"StudentProgress"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"studentProgress"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"studentId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"studentId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasProgress"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"planId"}},{"kind":"Field","name":{"kind":"Name","value":"planTitle"}},{"kind":"Field","name":{"kind":"Name","value":"totalLessons"}},{"kind":"Field","name":{"kind":"Name","value":"currentLessonId"}},{"kind":"Field","name":{"kind":"Name","value":"currentLessonTitle"}},{"kind":"Field","name":{"kind":"Name","value":"currentLessonPosition"}},{"kind":"Field","name":{"kind":"Name","value":"lessonsCompleted"}},{"kind":"Field","name":{"kind":"Name","value":"completionPercent"}},{"kind":"Field","name":{"kind":"Name","value":"isOnFinalLesson"}}]}}]}}]} as unknown as DocumentNode<StudentProgressQuery, StudentProgressQueryVariables>;
export const MyHandshakeCodeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyHandshakeCode"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myHandshakeCode"}}]}}]} as unknown as DocumentNode<MyHandshakeCodeQuery, MyHandshakeCodeQueryVariables>;
export const FindStudentByHandshakeCodeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindStudentByHandshakeCode"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"code"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"findStudentByHandshakeCode"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"code"},"value":{"kind":"Variable","name":{"kind":"Name","value":"code"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"maskedName"}},{"kind":"Field","name":{"kind":"Name","value":"linkable"}}]}}]}}]} as unknown as DocumentNode<FindStudentByHandshakeCodeQuery, FindStudentByHandshakeCodeQueryVariables>;
export const MyHomeworkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyHomework"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myHomework"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"jadid"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}},{"kind":"Field","name":{"kind":"Name","value":"grade"}}]}},{"kind":"Field","name":{"kind":"Name","value":"madi"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"surahJuz"}},{"kind":"Field","name":{"kind":"Name","value":"fromAyah"}},{"kind":"Field","name":{"kind":"Name","value":"toAyah"}},{"kind":"Field","name":{"kind":"Name","value":"grade"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<MyHomeworkQuery, MyHomeworkQueryVariables>;
export const MySessionBalanceDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MySessionBalance"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mySessionBalance"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}}]}}]}}]} as unknown as DocumentNode<MySessionBalanceQuery, MySessionBalanceQueryVariables>;
export const MyApplicantProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyApplicantProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myApplicantProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}}]}}]} as unknown as DocumentNode<MyApplicantProfileQuery, MyApplicantProfileQueryVariables>;
export const BookEvaluationSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"BookEvaluationSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BookEvaluationSessionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bookEvaluationSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<BookEvaluationSessionMutation, BookEvaluationSessionMutationVariables>;
export const MyEvaluationLoopStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyEvaluationLoopStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myEvaluationLoopStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bookedCount"}},{"kind":"Field","name":{"kind":"Name","value":"completedCount"}},{"kind":"Field","name":{"kind":"Name","value":"remainingCredits"}},{"kind":"Field","name":{"kind":"Name","value":"cycleStartDate"}}]}}]}}]} as unknown as DocumentNode<MyEvaluationLoopStatusQuery, MyEvaluationLoopStatusQueryVariables>;
export const AvailableEvaluatorsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AvailableEvaluators"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"availableEvaluators"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"subjects"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<AvailableEvaluatorsQuery, AvailableEvaluatorsQueryVariables>;
export const MyEvaluationSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyEvaluationSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionListFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myEvaluationSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<MyEvaluationSessionsQuery, MyEvaluationSessionsQueryVariables>;
export const SubmitRubricEvaluationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SubmitRubricEvaluation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RubricEvaluationSubmitInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"submitRubricEvaluation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatorId"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatedId"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"weaknessArea"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicantStatus"}}]}}]}}]} as unknown as DocumentNode<SubmitRubricEvaluationMutation, SubmitRubricEvaluationMutationVariables>;
export const MyRubricPendingSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyRubricPendingSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myRubricPendingSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<MyRubricPendingSessionsQuery, MyRubricPendingSessionsQueryVariables>;
export const MyRubricEvaluationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyRubricEvaluation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myRubricEvaluation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatorId"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatedId"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"weaknessArea"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicantStatus"}}]}}]}}]} as unknown as DocumentNode<MyRubricEvaluationQuery, MyRubricEvaluationQueryVariables>;
export const SubmitTeacherEvaluationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SubmitTeacherEvaluation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SubmitTeacherEvaluationInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"submitTeacherEvaluation"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}},{"kind":"Argument","name":{"kind":"Name","value":"sessionId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sessionId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatedId"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<SubmitTeacherEvaluationMutation, SubmitTeacherEvaluationMutationVariables>;
export const MyTeacherEvaluationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyTeacherEvaluations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myTeacherEvaluations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatedId"}},{"kind":"Field","name":{"kind":"Name","value":"evaluatorId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<MyTeacherEvaluationsQuery, MyTeacherEvaluationsQueryVariables>;
export const MyTeacherAvailabilityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyTeacherAvailability"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myTeacherAvailability"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"isApproved"}}]}}]}}]} as unknown as DocumentNode<MyTeacherAvailabilityQuery, MyTeacherAvailabilityQueryVariables>;
export const SetTeacherAvailabilityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetTeacherAvailability"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"isOnline"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setTeacherAvailability"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"isOnline"},"value":{"kind":"Variable","name":{"kind":"Name","value":"isOnline"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"isApproved"}}]}}]}}]} as unknown as DocumentNode<SetTeacherAvailabilityMutation, SetTeacherAvailabilityMutationVariables>;
export const BrowseAvailableTeachersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BrowseAvailableTeachers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"intent"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionIntent"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"minRating"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Float"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"recitation"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RecitationReading"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"search"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sort"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"TeacherMatchingSort"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"browseAvailableTeachers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"intent"},"value":{"kind":"Variable","name":{"kind":"Name","value":"intent"}}},{"kind":"Argument","name":{"kind":"Name","value":"minRating"},"value":{"kind":"Variable","name":{"kind":"Name","value":"minRating"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}},{"kind":"Argument","name":{"kind":"Name","value":"recitation"},"value":{"kind":"Variable","name":{"kind":"Name","value":"recitation"}}},{"kind":"Argument","name":{"kind":"Name","value":"search"},"value":{"kind":"Variable","name":{"kind":"Name","value":"search"}}},{"kind":"Argument","name":{"kind":"Name","value":"sort"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sort"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"countryCode"}},{"kind":"Field","name":{"kind":"Name","value":"subjects"}},{"kind":"Field","name":{"kind":"Name","value":"recitations"}},{"kind":"Field","name":{"kind":"Name","value":"languages"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}}]}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"pageCount"}}]}}]}}]} as unknown as DocumentNode<BrowseAvailableTeachersQuery, BrowseAvailableTeachersQueryVariables>;