import { isNotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ValidationError } from "@/backend/lib/errors";
import { isPositiveSafeInt } from "@/backend/services/notifications/emit-validation";
import type { NotificationListFilterInput } from "@/backend/types";

export const NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT = 20;
export const NOTIFICATION_INBOX_MAX_PAGE_LIMIT = 50;

type InboxWindowView = { readonly limit?: unknown; readonly offset?: unknown };

export function validateInboxUserId(userId: number, validationMessage: string): void {
  if (!isPositiveSafeInt(userId)) {
    throw new ValidationError(validationMessage);
  }
}

export function validateOptionalNotificationType(type: unknown, validationMessage: string): void {
  if (type !== null && type !== undefined && !isNotificationType(type)) {
    throw new ValidationError(validationMessage);
  }
}

export function resolveInboxListRequest(
  filter: NotificationListFilterInput,
  validationMessage: string
): { readonly limit: number; readonly offset: number } {
  validateOptionalNotificationType(filter.type, validationMessage);
  if (filter.isRead !== null && filter.isRead !== undefined && typeof filter.isRead !== "boolean") {
    throw new ValidationError(validationMessage);
  }

  const view: InboxWindowView = filter;
  const limit = view.limit ?? NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > NOTIFICATION_INBOX_MAX_PAGE_LIMIT
  ) {
    throw new ValidationError(validationMessage);
  }
  const offset = view.offset ?? 0;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    throw new ValidationError(validationMessage);
  }
  return { limit, offset };
}
