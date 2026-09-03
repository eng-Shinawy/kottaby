/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type AdminAuditLogFiltersInput = {
  actionType: AuditActionType | null | undefined;
  actorId: number | null | undefined;
  entityId: number | null | undefined;
  entityType: string | null | undefined;
  from: string | null | undefined;
  to: string | null | undefined;
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

export type AdminUpdateUserInput = {
  country: string | null | undefined;
  dateOfBirth: string | null | undefined;
  fullName: string | null | undefined;
  gender: Gender | null | undefined;
  phone: string | null | undefined;
};

export type AdminUserFiltersInput = {
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

export enum AppLocale {
  Ar = 'Ar',
  En = 'En'
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

/** Input fields required to create a new subscription plan. */
export type CreatePlanInput = {
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
  Complete = 'Complete'
}

export enum Gender {
  Female = 'Female',
  Male = 'Male',
  Other = 'Other'
}

export type MyNotificationsFilterInput = {
  isRead: boolean | null | undefined;
  limit: number | null | undefined;
  offset: number | null | undefined;
  type: NotificationType | null | undefined;
};

export enum NotificationType {
  EvaluationResult = 'EvaluationResult',
  ParentLinkRequest = 'ParentLinkRequest',
  PaymentConfirmation = 'PaymentConfirmation',
  SessionCancellation = 'SessionCancellation',
  SessionCompletion = 'SessionCompletion',
  SessionRequest = 'SessionRequest',
  SystemBroadcast = 'SystemBroadcast'
}

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

export type RequestWithdrawalInput = {
  /** The payout amount as a decimal string (e.g. "125.00"). */
  amount: string;
};

export enum SessionIntent {
  Evaluation = 'Evaluation',
  Hifz = 'Hifz',
  Tajweed = 'Tajweed'
}

export type SessionListFilterInput = {
  status: SessionStatus | null | undefined;
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

export enum TransactionStatus {
  Completed = 'Completed',
  Failed = 'Failed',
  Pending = 'Pending'
}

export enum TransactionType {
  Bonus = 'Bonus',
  Earning = 'Earning',
  Withdrawal = 'Withdrawal'
}

/** Mutable fields for updating an existing subscription plan. */
export type UpdatePlanInput = {
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

export type AdminUserListItemFieldsFragment = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, gender: Gender | null, dateOfBirth: string | null, country: string | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, lastActiveAt: string | null, createdAt: string, applicantStatus: ApplicantStatus | null, teacherIsApproved: boolean | null, teacherIsEvaluator: boolean | null, studentHasParentLink: boolean | null, studentHasActiveSubscription: boolean | null, parentLinkedChildrenCount: number | null };

export type AdminUserDetailFieldsFragment_applicant = { id: number, status: ApplicantStatus, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, cooldownActive: boolean, canPurchaseVerification: boolean };

export type AdminUserDetailFieldsFragment_teacher = { isApproved: boolean, isEvaluator: boolean, isOnline: boolean, averageRating: string | null };

export type AdminUserDetailFieldsFragment_student = { handshakeCode: string, parentId: number | null, primaryLanguage: string | null, anotherLanguage: string | null, hasParentLink: boolean, hasActiveSubscription: boolean, balanceHifz: number | null, balanceTajweed: number | null, balanceReviews: number | null, balanceTrial: number | null, trialGrantedAt: string | null };

export type AdminUserDetailFieldsFragment_parent = { linkedChildrenCount: number };

export type AdminUserDetailFieldsFragment = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminUsersQuery_adminUsers_items = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, gender: Gender | null, dateOfBirth: string | null, country: string | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean, lastActiveAt: string | null, createdAt: string, applicantStatus: ApplicantStatus | null, teacherIsApproved: boolean | null, teacherIsEvaluator: boolean | null, studentHasParentLink: boolean | null, studentHasActiveSubscription: boolean | null, parentLinkedChildrenCount: number | null };

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

export type AdminUserDetailQuery_adminUserDetail = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminUserDetailQuery = { adminUserDetail: AdminUserDetailQuery_adminUserDetail };


export type AdminUserDetailQueryVariables = Exact<{
  id: number;
}>;

export type AdminUserActivityQuery_adminUserActivity = { id: number, actionType: AuditActionType, actorName: string, changedFields: Array<string> | null, createdAt: string };

export type AdminUserActivityQuery = { adminUserActivity: Array<AdminUserActivityQuery_adminUserActivity> };


export type AdminUserActivityQueryVariables = Exact<{
  id: number;
  limit: number | null | undefined;
}>;

export type AdminCreateUserMutation_adminCreateUser = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminCreateUserMutation = { adminCreateUser: AdminCreateUserMutation_adminCreateUser };


export type AdminCreateUserMutationVariables = Exact<{
  input: AdminCreateUserInput;
}>;

export type AdminUpdateUserMutation_adminUpdateUser = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminUpdateUserMutation = { adminUpdateUser: AdminUpdateUserMutation_adminUpdateUser };


export type AdminUpdateUserMutationVariables = Exact<{
  id: number;
  input: AdminUpdateUserInput;
}>;

export type AdminSetUserDeletedMutation_adminSetUserDeleted = { id: number, fullName: string, email: string, phone: string | null, role: UserRole, dateOfBirth: string | null, gender: Gender | null, country: string | null, isDeleted: boolean | null, deletedAt: string | null, suspended: boolean | null, suspendedAt: string | null, suspendedPeriodDays: number | null, isBlocked: boolean | null, blockedAt: string | null, lastActiveAt: string | null, createdAt: string, updatedAt: string, applicant: AdminUserDetailFieldsFragment_applicant | null, teacher: AdminUserDetailFieldsFragment_teacher | null, student: AdminUserDetailFieldsFragment_student | null, parent: AdminUserDetailFieldsFragment_parent | null };

export type AdminSetUserDeletedMutation = { adminSetUserDeleted: AdminSetUserDeletedMutation_adminSetUserDeleted };


export type AdminSetUserDeletedMutationVariables = Exact<{
  id: number;
  deleted: boolean;
}>;

export type AdminAuditLogsQuery_adminAuditLogs_items = { id: string, actionType: AuditActionType, actorId: number, actorName: string, entityType: string, entityId: number | null, details: string | null, createdAt: string };

export type AdminAuditLogsQuery_adminAuditLogs = { totalCount: number, page: number, pageSize: number, items: Array<AdminAuditLogsQuery_adminAuditLogs_items> };

export type AdminAuditLogsQuery = { adminAuditLogs: AdminAuditLogsQuery_adminAuditLogs };


export type AdminAuditLogsQueryVariables = Exact<{
  filters: AdminAuditLogFiltersInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type RegisterUserMutation_registerUser = { id: number, email: string, fullName: string, role: UserRole };

export type RegisterUserMutation = { registerUser: RegisterUserMutation_registerUser };


export type RegisterUserMutationVariables = Exact<{
  input: RegisterUserInput;
}>;

export type MeQuery_me = { id: number, email: string, fullName: string, phone: string | null, country: string | null, gender: Gender | null, locale: AppLocale | null, role: UserRole, preferredRecitation: RecitationReading | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean };

export type MeQuery = { me: MeQuery_me | null };


export type MeQueryVariables = Exact<{ [key: string]: never; }>;

export type LoginMutation_login_user = { id: number, email: string, fullName: string, phone: string | null, country: string | null, gender: Gender | null, locale: AppLocale | null, role: UserRole, preferredRecitation: RecitationReading | null, isDeleted: boolean, suspended: boolean, isBlocked: boolean };

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

export type RefreshTokenMutation_refreshToken = { accessToken: string, refreshToken: string };

export type RefreshTokenMutation = { refreshToken: RefreshTokenMutation_refreshToken };


export type RefreshTokenMutationVariables = Exact<{
  refreshToken: string;
}>;

export type LogoutMutation_logout = { success: boolean };

export type LogoutMutation = { logout: LogoutMutation_logout };


export type LogoutMutationVariables = Exact<{ [key: string]: never; }>;

export type RecitationReadingsQuery = { recitationReadings: Array<RecitationReading> };


export type RecitationReadingsQueryVariables = Exact<{ [key: string]: never; }>;

export type PlanCatalogQuery_planCatalog = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string };

export type PlanCatalogQuery = { planCatalog: Array<PlanCatalogQuery_planCatalog> };


export type PlanCatalogQueryVariables = Exact<{ [key: string]: never; }>;

export type AdminPlansQuery_adminPlans = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string };

export type AdminPlansQuery = { adminPlans: Array<AdminPlansQuery_adminPlans> };


export type AdminPlansQueryVariables = Exact<{
  includeInactive: boolean | null | undefined;
}>;

export type CreatePlanMutation_createPlan = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string };

export type CreatePlanMutation = { createPlan: CreatePlanMutation_createPlan };


export type CreatePlanMutationVariables = Exact<{
  input: CreatePlanInput;
}>;

export type UpdatePlanMutation_updatePlan = { id: string, title: string, sessionCount: number, price: string, currency: string, intervalDays: number, isActive: boolean, deactivatedAt: string | null, createdAt: string, updatedAt: string };

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

export type MyWalletQuery_myWallet_transactions = { id: string, walletId: string, sessionId: string | null, amount: string, description: string | null, type: TransactionType, status: TransactionStatus, createdAt: string, updatedAt: string };

export type MyWalletQuery_myWallet = { id: string, balance: string, totalEarning: string, currency: string, createdAt: string, updatedAt: string, transactions: Array<MyWalletQuery_myWallet_transactions> };

export type MyWalletQuery = { myWallet: MyWalletQuery_myWallet };


export type MyWalletQueryVariables = Exact<{ [key: string]: never; }>;

export type RequestWithdrawalMutation_requestWithdrawal_transactions = { id: string, walletId: string, sessionId: string | null, amount: string, description: string | null, type: TransactionType, status: TransactionStatus, createdAt: string, updatedAt: string };

export type RequestWithdrawalMutation_requestWithdrawal = { id: string, balance: string, totalEarning: string, currency: string, createdAt: string, updatedAt: string, transactions: Array<RequestWithdrawalMutation_requestWithdrawal_transactions> };

export type RequestWithdrawalMutation = { requestWithdrawal: RequestWithdrawalMutation_requestWithdrawal };


export type RequestWithdrawalMutationVariables = Exact<{
  input: RequestWithdrawalInput;
}>;

export type AdminBroadcastNotificationMutation = { adminBroadcastNotification: number };


export type AdminBroadcastNotificationMutationVariables = Exact<{
  input: AdminBroadcastNotificationInput;
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

export type OpenSessionDisputeMutation_openSessionDispute = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type OpenSessionDisputeMutation = { openSessionDispute: OpenSessionDisputeMutation_openSessionDispute };


export type OpenSessionDisputeMutationVariables = Exact<{
  id: string | number;
  reason: string;
}>;

export type ResolveSessionDisputeMutation_resolveSessionDispute = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type ResolveSessionDisputeMutation = { resolveSessionDispute: ResolveSessionDisputeMutation_resolveSessionDispute };


export type ResolveSessionDisputeMutationVariables = Exact<{
  id: string | number;
  resolution: DisputeResolution;
  note: string | null | undefined;
}>;

export type AdminDisputedSessionsQuery_adminDisputedSessions_items = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type AdminDisputedSessionsQuery_adminDisputedSessions = { page: number, pageSize: number, totalCount: number, items: Array<AdminDisputedSessionsQuery_adminDisputedSessions_items> };

export type AdminDisputedSessionsQuery = { adminDisputedSessions: AdminDisputedSessionsQuery_adminDisputedSessions };


export type AdminDisputedSessionsQueryVariables = Exact<{
  filter: SessionListFilterInput | null | undefined;
  limit: number | null | undefined;
  offset: number | null | undefined;
}>;

export type CreateSessionMutation_createSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type CreateSessionMutation = { createSession: CreateSessionMutation_createSession };


export type CreateSessionMutationVariables = Exact<{
  input: CreateSessionInput;
}>;

export type StartSessionMutation_startSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type StartSessionMutation = { startSession: StartSessionMutation_startSession };


export type StartSessionMutationVariables = Exact<{
  id: string | number;
}>;

export type CompleteSessionMutation_completeSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type CompleteSessionMutation = { completeSession: CompleteSessionMutation_completeSession };


export type CompleteSessionMutationVariables = Exact<{
  id: string | number;
}>;

export type CancelSessionMutation_cancelSession = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type CancelSessionMutation = { cancelSession: CancelSessionMutation_cancelSession };


export type CancelSessionMutationVariables = Exact<{
  id: string | number;
  reason: string | null | undefined;
}>;

export type ConfirmSessionCompletionMutation_confirmSessionCompletion = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type ConfirmSessionCompletionMutation = { confirmSessionCompletion: ConfirmSessionCompletionMutation_confirmSessionCompletion };


export type ConfirmSessionCompletionMutationVariables = Exact<{
  id: string | number;
}>;

export type SessionByIdQuery_sessionById = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type SessionByIdQuery = { sessionById: SessionByIdQuery_sessionById | null };


export type SessionByIdQueryVariables = Exact<{
  id: string | number;
}>;

export type MyStudentSessionsQuery_myStudentSessions_items = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type MyStudentSessionsQuery_myStudentSessions = { page: number, pageSize: number, totalCount: number, items: Array<MyStudentSessionsQuery_myStudentSessions_items> };

export type MyStudentSessionsQuery = { myStudentSessions: MyStudentSessionsQuery_myStudentSessions };


export type MyStudentSessionsQueryVariables = Exact<{
  filter: SessionListFilterInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type MyTeacherSessionsQuery_myTeacherSessions_items = { id: string, status: SessionStatus, intent: SessionIntent | null, sessionType: SessionType, fee: string | null, feeHeld: boolean, studentId: string, teacherId: string, startedAt: string | null, endedAt: string | null, confirmationDeadline: string | null, confirmedByStudentAt: string | null, confirmedByTeacherAt: string | null, createdAt: string, updatedAt: string, cancelReason: string | null, disputeReason: string | null, disputedAt: string | null, resolutionNote: string | null, resolvedAt: string | null };

export type MyTeacherSessionsQuery_myTeacherSessions = { page: number, pageSize: number, totalCount: number, items: Array<MyTeacherSessionsQuery_myTeacherSessions_items> };

export type MyTeacherSessionsQuery = { myTeacherSessions: MyTeacherSessionsQuery_myTeacherSessions };


export type MyTeacherSessionsQueryVariables = Exact<{
  filter: SessionListFilterInput | null | undefined;
  page: number | null | undefined;
  pageSize: number | null | undefined;
}>;

export type MyHandshakeCodeQuery = { myHandshakeCode: string };


export type MyHandshakeCodeQueryVariables = Exact<{ [key: string]: never; }>;

export type FindStudentByHandshakeCodeQuery_findStudentByHandshakeCode = { maskedName: string, linkable: boolean };

export type FindStudentByHandshakeCodeQuery = { findStudentByHandshakeCode: FindStudentByHandshakeCodeQuery_findStudentByHandshakeCode | null };


export type FindStudentByHandshakeCodeQueryVariables = Exact<{
  code: string;
}>;

export type MyApplicantProfileQuery_myApplicantProfile = { id: number, status: ApplicantStatus, verificationAttempts: number, lastAttemptAt: string | null, cooldownUntil: string | null, cooldownActive: boolean, canPurchaseVerification: boolean };

export type MyApplicantProfileQuery = { myApplicantProfile: MyApplicantProfileQuery_myApplicantProfile | null };


export type MyApplicantProfileQueryVariables = Exact<{ [key: string]: never; }>;

export const AdminUserListItemFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserListItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicantStatus"}},{"kind":"Field","name":{"kind":"Name","value":"teacherIsApproved"}},{"kind":"Field","name":{"kind":"Name","value":"teacherIsEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"studentHasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"studentHasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"parentLinkedChildrenCount"}}]}}]} as unknown as DocumentNode<AdminUserListItemFieldsFragment, unknown>;
export const AdminUserDetailFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminUserDetailFieldsFragment, unknown>;
export const AdminUsersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUsers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserFiltersInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUsers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserListItemFields"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserListItemFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserListItem"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicantStatus"}},{"kind":"Field","name":{"kind":"Name","value":"teacherIsApproved"}},{"kind":"Field","name":{"kind":"Name","value":"teacherIsEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"studentHasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"studentHasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"parentLinkedChildrenCount"}}]}}]} as unknown as DocumentNode<AdminUsersQuery, AdminUsersQueryVariables>;
export const AdminUserStatsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUserStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUserStats"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"activeCount"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedCount"}},{"kind":"Field","name":{"kind":"Name","value":"blockedCount"}},{"kind":"Field","name":{"kind":"Name","value":"deletedCount"}},{"kind":"Field","name":{"kind":"Name","value":"adminsCount"}},{"kind":"Field","name":{"kind":"Name","value":"teachersCount"}},{"kind":"Field","name":{"kind":"Name","value":"studentsCount"}},{"kind":"Field","name":{"kind":"Name","value":"parentsCount"}},{"kind":"Field","name":{"kind":"Name","value":"newThisWeekCount"}}]}}]}}]} as unknown as DocumentNode<AdminUserStatsQuery, AdminUserStatsQueryVariables>;
export const AdminUserDetailDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUserDetail"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUserDetail"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminUserDetailQuery, AdminUserDetailQueryVariables>;
export const AdminUserActivityDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminUserActivity"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUserActivity"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"actorName"}},{"kind":"Field","name":{"kind":"Name","value":"changedFields"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<AdminUserActivityQuery, AdminUserActivityQueryVariables>;
export const AdminCreateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminCreateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminCreateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminCreateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminCreateUserMutation, AdminCreateUserMutationVariables>;
export const AdminUpdateUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminUpdateUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUpdateUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminUpdateUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminUpdateUserMutation, AdminUpdateUserMutationVariables>;
export const AdminSetUserDeletedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminSetUserDeleted"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"deleted"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminSetUserDeleted"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"deleted"},"value":{"kind":"Variable","name":{"kind":"Name","value":"deleted"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"AdminUserDetailFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"AdminUserDetailFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"AdminUserDetail"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"dateOfBirth"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"deletedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedAt"}},{"kind":"Field","name":{"kind":"Name","value":"suspendedPeriodDays"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}},{"kind":"Field","name":{"kind":"Name","value":"blockedAt"}},{"kind":"Field","name":{"kind":"Name","value":"lastActiveAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"applicant"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}},{"kind":"Field","name":{"kind":"Name","value":"teacher"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"isApproved"}},{"kind":"Field","name":{"kind":"Name","value":"isEvaluator"}},{"kind":"Field","name":{"kind":"Name","value":"isOnline"}},{"kind":"Field","name":{"kind":"Name","value":"averageRating"}}]}},{"kind":"Field","name":{"kind":"Name","value":"student"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"handshakeCode"}},{"kind":"Field","name":{"kind":"Name","value":"parentId"}},{"kind":"Field","name":{"kind":"Name","value":"primaryLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"anotherLanguage"}},{"kind":"Field","name":{"kind":"Name","value":"hasParentLink"}},{"kind":"Field","name":{"kind":"Name","value":"hasActiveSubscription"}},{"kind":"Field","name":{"kind":"Name","value":"balanceHifz"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTajweed"}},{"kind":"Field","name":{"kind":"Name","value":"balanceReviews"}},{"kind":"Field","name":{"kind":"Name","value":"balanceTrial"}},{"kind":"Field","name":{"kind":"Name","value":"trialGrantedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parent"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"linkedChildrenCount"}}]}}]}}]} as unknown as DocumentNode<AdminSetUserDeletedMutation, AdminSetUserDeletedMutationVariables>;
export const AdminAuditLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminAuditLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminAuditLogFiltersInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminAuditLogs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"actionType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"actorName"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"details"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}}]}}]}}]} as unknown as DocumentNode<AdminAuditLogsQuery, AdminAuditLogsQueryVariables>;
export const RegisterUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RegisterUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RegisterUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registerUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"role"}}]}}]}}]} as unknown as DocumentNode<RegisterUserMutation, RegisterUserMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"locale"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"preferredRecitation"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const LoginDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Login"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"email"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"password"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"login"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"email"},"value":{"kind":"Variable","name":{"kind":"Name","value":"email"}}},{"kind":"Argument","name":{"kind":"Name","value":"password"},"value":{"kind":"Variable","name":{"kind":"Name","value":"password"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"country"}},{"kind":"Field","name":{"kind":"Name","value":"gender"}},{"kind":"Field","name":{"kind":"Name","value":"locale"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"preferredRecitation"}},{"kind":"Field","name":{"kind":"Name","value":"isDeleted"}},{"kind":"Field","name":{"kind":"Name","value":"suspended"}},{"kind":"Field","name":{"kind":"Name","value":"isBlocked"}}]}},{"kind":"Field","name":{"kind":"Name","value":"accessToken"}},{"kind":"Field","name":{"kind":"Name","value":"refreshToken"}}]}}]}}]} as unknown as DocumentNode<LoginMutation, LoginMutationVariables>;
export const UpdateMyLocaleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateMyLocale"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"locale"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AppLocale"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateMyLocale"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"locale"},"value":{"kind":"Variable","name":{"kind":"Name","value":"locale"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"locale"}}]}}]}}]} as unknown as DocumentNode<UpdateMyLocaleMutation, UpdateMyLocaleMutationVariables>;
export const RefreshTokenDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RefreshToken"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"refreshToken"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"refreshToken"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"refreshToken"},"value":{"kind":"Variable","name":{"kind":"Name","value":"refreshToken"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accessToken"}},{"kind":"Field","name":{"kind":"Name","value":"refreshToken"}}]}}]}}]} as unknown as DocumentNode<RefreshTokenMutation, RefreshTokenMutationVariables>;
export const LogoutDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"Logout"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logout"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"success"}}]}}]}}]} as unknown as DocumentNode<LogoutMutation, LogoutMutationVariables>;
export const RecitationReadingsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"RecitationReadings"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"recitationReadings"}}]}}]} as unknown as DocumentNode<RecitationReadingsQuery, RecitationReadingsQueryVariables>;
export const PlanCatalogDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PlanCatalog"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"planCatalog"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<PlanCatalogQuery, PlanCatalogQueryVariables>;
export const AdminPlansDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminPlans"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"includeInactive"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminPlans"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"includeInactive"},"value":{"kind":"Variable","name":{"kind":"Name","value":"includeInactive"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<AdminPlansQuery, AdminPlansQueryVariables>;
export const CreatePlanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreatePlan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreatePlanInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createPlan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<CreatePlanMutation, CreatePlanMutationVariables>;
export const UpdatePlanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdatePlan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdatePlanInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updatePlan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<UpdatePlanMutation, UpdatePlanMutationVariables>;
export const SetPlanActiveStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"SetPlanActiveStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"isActive"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"setPlanActiveStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"isActive"},"value":{"kind":"Variable","name":{"kind":"Name","value":"isActive"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"sessionCount"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"intervalDays"}},{"kind":"Field","name":{"kind":"Name","value":"isActive"}},{"kind":"Field","name":{"kind":"Name","value":"deactivatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]} as unknown as DocumentNode<SetPlanActiveStatusMutation, SetPlanActiveStatusMutationVariables>;
export const MyWalletDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyWallet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myWallet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"balance"}},{"kind":"Field","name":{"kind":"Name","value":"totalEarning"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"transactions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"walletId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<MyWalletQuery, MyWalletQueryVariables>;
export const RequestWithdrawalDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RequestWithdrawal"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RequestWithdrawalInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"requestWithdrawal"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"balance"}},{"kind":"Field","name":{"kind":"Name","value":"totalEarning"}},{"kind":"Field","name":{"kind":"Name","value":"currency"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"transactions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"walletId"}},{"kind":"Field","name":{"kind":"Name","value":"sessionId"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]}}]}}]} as unknown as DocumentNode<RequestWithdrawalMutation, RequestWithdrawalMutationVariables>;
export const AdminBroadcastNotificationDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AdminBroadcastNotification"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AdminBroadcastNotificationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminBroadcastNotification"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}]}]}}]} as unknown as DocumentNode<AdminBroadcastNotificationMutation, AdminBroadcastNotificationMutationVariables>;
export const MyNotificationsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyNotifications"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"MyNotificationsFilterInput"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myNotifications"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"relatedEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"relatedEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"hasMore"}}]}}]}}]} as unknown as DocumentNode<MyNotificationsQuery, MyNotificationsQueryVariables>;
export const MyUnreadNotificationCountDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyUnreadNotificationCount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myUnreadNotificationCount"}}]}}]} as unknown as DocumentNode<MyUnreadNotificationCountQuery, MyUnreadNotificationCountQueryVariables>;
export const MarkNotificationReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkNotificationRead"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markNotificationRead"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"isRead"}},{"kind":"Field","name":{"kind":"Name","value":"relatedEntityType"}},{"kind":"Field","name":{"kind":"Name","value":"relatedEntityId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<MarkNotificationReadMutation, MarkNotificationReadMutationVariables>;
export const MarkAllNotificationsReadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MarkAllNotificationsRead"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"type"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"NotificationType"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"markAllNotificationsRead"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"Variable","name":{"kind":"Name","value":"type"}}}]}]}}]} as unknown as DocumentNode<MarkAllNotificationsReadMutation, MarkAllNotificationsReadMutationVariables>;
export const OpenSessionDisputeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"OpenSessionDispute"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"openSessionDispute"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<OpenSessionDisputeMutation, OpenSessionDisputeMutationVariables>;
export const ResolveSessionDisputeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ResolveSessionDispute"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"resolution"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DisputeResolution"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"note"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resolveSessionDispute"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"resolution"},"value":{"kind":"Variable","name":{"kind":"Name","value":"resolution"}}},{"kind":"Argument","name":{"kind":"Name","value":"note"},"value":{"kind":"Variable","name":{"kind":"Name","value":"note"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<ResolveSessionDisputeMutation, ResolveSessionDisputeMutationVariables>;
export const AdminDisputedSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AdminDisputedSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionListFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"offset"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"adminDisputedSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"offset"},"value":{"kind":"Variable","name":{"kind":"Name","value":"offset"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<AdminDisputedSessionsQuery, AdminDisputedSessionsQueryVariables>;
export const CreateSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateSessionInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<CreateSessionMutation, CreateSessionMutationVariables>;
export const StartSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"StartSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"startSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<StartSessionMutation, StartSessionMutationVariables>;
export const CompleteSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CompleteSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"completeSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<CompleteSessionMutation, CompleteSessionMutationVariables>;
export const CancelSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<CancelSessionMutation, CancelSessionMutationVariables>;
export const ConfirmSessionCompletionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ConfirmSessionCompletion"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"confirmSessionCompletion"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<ConfirmSessionCompletionMutation, ConfirmSessionCompletionMutationVariables>;
export const SessionByIdDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SessionById"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sessionById"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}}]}}]} as unknown as DocumentNode<SessionByIdQuery, SessionByIdQueryVariables>;
export const MyStudentSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyStudentSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionListFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myStudentSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<MyStudentSessionsQuery, MyStudentSessionsQueryVariables>;
export const MyTeacherSessionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyTeacherSessions"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"SessionListFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"page"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myTeacherSessions"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"page"},"value":{"kind":"Variable","name":{"kind":"Name","value":"page"}}},{"kind":"Argument","name":{"kind":"Name","value":"pageSize"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pageSize"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"intent"}},{"kind":"Field","name":{"kind":"Name","value":"sessionType"}},{"kind":"Field","name":{"kind":"Name","value":"fee"}},{"kind":"Field","name":{"kind":"Name","value":"feeHeld"}},{"kind":"Field","name":{"kind":"Name","value":"studentId"}},{"kind":"Field","name":{"kind":"Name","value":"teacherId"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"endedAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmationDeadline"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByStudentAt"}},{"kind":"Field","name":{"kind":"Name","value":"confirmedByTeacherAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputeReason"}},{"kind":"Field","name":{"kind":"Name","value":"disputedAt"}},{"kind":"Field","name":{"kind":"Name","value":"resolutionNote"}},{"kind":"Field","name":{"kind":"Name","value":"resolvedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"page"}},{"kind":"Field","name":{"kind":"Name","value":"pageSize"}},{"kind":"Field","name":{"kind":"Name","value":"totalCount"}}]}}]}}]} as unknown as DocumentNode<MyTeacherSessionsQuery, MyTeacherSessionsQueryVariables>;
export const MyHandshakeCodeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyHandshakeCode"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myHandshakeCode"}}]}}]} as unknown as DocumentNode<MyHandshakeCodeQuery, MyHandshakeCodeQueryVariables>;
export const FindStudentByHandshakeCodeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindStudentByHandshakeCode"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"code"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"findStudentByHandshakeCode"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"code"},"value":{"kind":"Variable","name":{"kind":"Name","value":"code"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"maskedName"}},{"kind":"Field","name":{"kind":"Name","value":"linkable"}}]}}]}}]} as unknown as DocumentNode<FindStudentByHandshakeCodeQuery, FindStudentByHandshakeCodeQueryVariables>;
export const MyApplicantProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MyApplicantProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"myApplicantProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"verificationAttempts"}},{"kind":"Field","name":{"kind":"Name","value":"lastAttemptAt"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownUntil"}},{"kind":"Field","name":{"kind":"Name","value":"cooldownActive"}},{"kind":"Field","name":{"kind":"Name","value":"canPurchaseVerification"}}]}}]}}]} as unknown as DocumentNode<MyApplicantProfileQuery, MyApplicantProfileQueryVariables>;