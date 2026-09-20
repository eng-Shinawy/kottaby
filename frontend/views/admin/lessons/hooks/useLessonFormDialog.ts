"use client";

/** useLessonFormDialog — Create/edit dialog orchestration for the admin lessons catalog.
 *
 * Clone of the plans-admin `usePlanFormDialog` lineage, translated to lessons:
 *  - Dialog visibility & edit-target selection
 *  - createLesson / updateLesson Apollo mutations with refetch-after-create
 *  - Server error projection: VALIDATION field codes bound to `title`
 *    (LESSON_TITLE_REQUIRED, LESSON_TITLE_TOO_LONG); everything else —
 *    LESSON_PLAN_NOT_FOUND, LESSON_PATCH_EMPTY, LESSON_NOT_FOUND — surfaces as
 *    the server-localized message on the global error surface
 *  - Success toast hand-off via `onSuccess`
 */

import { useMutation } from "@apollo/client/react";
import { useState } from "react";
import type { CreateLessonInput, PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import {
  createLessonMutationDocument,
  updateLessonMutationDocument,
} from "@/frontend/graphql/sharedDocuments/classes/lesson.documents";
import { logger } from "@/frontend/lib/logger";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

type LessonItem = PlanLessonsQuery["planLessons"][number];

/** The lesson form's ONLY editable field — everything else rides the context. */
export interface LessonFormSubmitInput {
  readonly title: string;
}

/**
 * Post-create view refresh — the mutation has already committed, so the
 * refetch is NEVER a gate on the create's success. A refetch rejection is
 * logged and swallowed; surfacing it as a form error after the success toast
 * would contradict the committed state and invite a duplicate submission.
 */
export async function refetchAfterWrite(refetch: () => Promise<unknown>): Promise<void> {
  try {
    await refetch();
  } catch (refetchError: unknown) {
    logger.error(
      { caller: "useLessonFormDialog.refetchAfterWrite" },
      "[LessonsCatalog] Post-write refetch failed — the mutation IS committed; continuing with the success toast.",
      refetchError
    );
  }
}

interface WireFieldError {
  readonly field: string;
  readonly message: string;
}

function isWireFieldError(value: unknown): value is WireFieldError {
  if (value == null || typeof value !== "object") return false;
  return typeof Reflect.get(value, "field") === "string" && typeof Reflect.get(value, "message") === "string";
}

interface ErrorWithGraphQLErrors {
  readonly graphQLErrors?: readonly unknown[];
}

function isGraphQLErrorCarrier(value: unknown): value is ErrorWithGraphQLErrors {
  if (!(value instanceof Error)) return false;
  const graphQLErrors = Reflect.get(value, "graphQLErrors");
  return graphQLErrors === undefined || Array.isArray(graphQLErrors);
}

interface WireGraphQLError {
  readonly extensions?: Record<string, unknown>;
}

function isWireGraphQLError(value: unknown): value is WireGraphQLError {
  if (value == null || typeof value !== "object") return false;
  const extensions = Reflect.get(value, "extensions");
  return extensions === undefined || (extensions !== null && typeof extensions === "object");
}

/**
 * Project a mutation failure onto the form surfaces:
 *  - `extensions.fields[]` entries for the `title` field become field-level
 *    errors (the message arrives fully localized from the server);
 *  - everything else (LESSON_PLAN_NOT_FOUND on the planId field,
 *    LESSON_PATCH_EMPTY, LESSON_NOT_FOUND) lands on the global error surface
 *    via the server-localized message, with the namespace fallback only when
 *    the error carries no usable message.
 */
function projectMutationError(
  err: unknown,
  fallbackMessage: string
): {
  readonly globalError: string | null;
  readonly serverFieldErrors: Record<string, string>;
} {
  const serverFieldErrors: Record<string, string> = {};
  const graphQLErrors = isGraphQLErrorCarrier(err) ? (err.graphQLErrors ?? []) : [];
  for (const gqlError of graphQLErrors) {
    if (!isWireGraphQLError(gqlError)) continue;
    const fields = gqlError.extensions?.fields;
    if (!Array.isArray(fields)) continue;
    const titleError = fields.find(entry => isWireFieldError(entry) && entry.field === "title");
    if (isWireFieldError(titleError)) serverFieldErrors.title = titleError.message;
  }

  const globalError = err instanceof Error ? err.message : fallbackMessage;
  return { globalError, serverFieldErrors };
}

export interface UseLessonFormDialogOptions {
  /** Numeric id of the plan the new lesson is created under (edit ignores it). */
  readonly planId: number | null;
  readonly refetch: () => Promise<unknown>;
  readonly onSuccess: (message: string) => void;
}

export function useLessonFormDialog({ planId, refetch, onSuccess }: UseLessonFormDialogOptions): {
  readonly formOpen: boolean;
  readonly selectedLessonForEdit: LessonItem | null;
  readonly formGlobalError: string | null;
  readonly serverFieldErrors: Record<string, string>;
  readonly formLoading: boolean;
  readonly handleOpenCreate: () => void;
  readonly handleOpenEdit: (lesson: LessonItem) => void;
  readonly handleCloseForm: () => void;
  readonly handleFormSubmit: (input: LessonFormSubmitInput) => Promise<void>;
} {
  const t = useAppTranslation(Lessons);

  // Mutations
  const [createLesson, { loading: createLoading }] = useMutation(createLessonMutationDocument);
  const [updateLesson, { loading: updateLoading }] = useMutation(updateLessonMutationDocument);

  // Dialog & state management
  const [formOpen, setFormOpen] = useState(false);
  const [selectedLessonForEdit, setSelectedLessonForEdit] = useState<LessonItem | null>(null);
  const [formGlobalError, setFormGlobalError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});

  const handleOpenCreate = () => {
    setSelectedLessonForEdit(null);
    setFormGlobalError(null);
    setServerFieldErrors({});
    setFormOpen(true);
  };

  const handleOpenEdit = (lesson: LessonItem) => {
    setSelectedLessonForEdit(lesson);
    setFormGlobalError(null);
    setServerFieldErrors({});
    setFormOpen(true);
  };

  const handleCloseForm = () => setFormOpen(false);

  const handleFormSubmit = async (input: LessonFormSubmitInput): Promise<void> => {
    setFormGlobalError(null);
    setServerFieldErrors({});
    try {
      if (selectedLessonForEdit) {
        // planId stays untouched on the wire (`undefined` serializes away);
        // the lesson keeps living under the plan the catalog selected.
        await updateLesson({
          variables: {
            id: selectedLessonForEdit.id,
            input: { title: input.title, planId: undefined },
          },
        });
        onSuccess(t.updateSuccessToast);
        setFormOpen(false);
      } else {
        if (planId == null) {
          setFormGlobalError(t.unexpectedErrorMessage);
          return;
        }
        const createInput: CreateLessonInput = { planId, title: input.title };
        await createLesson({
          variables: { input: createInput },
        });
        // View refresh only — a rejection is logged inside and never
        // masquerades as a failed create (the duplicate-submission hazard).
        await refetchAfterWrite(refetch);
        onSuccess(t.createSuccessToast);
        setFormOpen(false);
      }
    } catch (err: unknown) {
      const projection = projectMutationError(err, t.unexpectedErrorMessage);
      setServerFieldErrors(projection.serverFieldErrors);
      setFormGlobalError(projection.serverFieldErrors.title ? null : projection.globalError);
    }
  };

  return {
    formOpen,
    selectedLessonForEdit,
    formGlobalError,
    serverFieldErrors,
    formLoading: createLoading || updateLoading,
    handleOpenCreate,
    handleOpenEdit,
    handleCloseForm,
    handleFormSubmit,
  };
}
