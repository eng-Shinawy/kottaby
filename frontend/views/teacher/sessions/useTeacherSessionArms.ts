"use client";

/**
 * The teacher sessions surface's mutation/dialog arms — one wiring hook
 * (split out of `TeacherSessionsContainer.tsx` for the lint caps) binding
 * the in-flight slots and the lifecycle/cancel/dispute arms to the
 * surface's shared notice + row-alert lanes.
 */

import type { ContainerNotice } from "@/frontend/views/teacher/sessions/teacherSessionSlots";
import { useTeacherCancelDialogArms } from "@/frontend/views/teacher/sessions/useTeacherCancelDialogArms";
import { useTeacherDisputeDialogArms } from "@/frontend/views/teacher/sessions/useTeacherDisputeDialogArms";
import { useTeacherInFlightSlots } from "@/frontend/views/teacher/sessions/useTeacherInFlightSlots";
import { useTeacherLifecycleMutations } from "@/frontend/views/teacher/sessions/useTeacherLifecycleMutations";

interface TeacherSessionArmsArgs {
  readonly setRowAlerts: React.Dispatch<React.SetStateAction<Readonly<Record<string, string>>>>;
  readonly setNotice: React.Dispatch<React.SetStateAction<ContainerNotice | null>>;
}

/** The wired arms bundle the container's body and overlays consume. */
export function useTeacherSessionArms({ setRowAlerts, setNotice }: Readonly<TeacherSessionArmsArgs>): {
  slots: ReturnType<typeof useTeacherInFlightSlots>;
  cancelArms: ReturnType<typeof useTeacherCancelDialogArms>;
  disputeArms: ReturnType<typeof useTeacherDisputeDialogArms>;
  mutations: ReturnType<typeof useTeacherLifecycleMutations>;
} {
  const slots = useTeacherInFlightSlots();

  const cancelArms = useTeacherCancelDialogArms({ setRowAlerts, setNotice });

  const disputeArms = useTeacherDisputeDialogArms({
    claimDispute: sessionId => slots.claimSlot(sessionId, "dispute"),
    releaseDispute: sessionId => slots.releaseSlot(sessionId, "dispute"),
    setRowAlerts,
    setNotice,
  });

  const mutations = useTeacherLifecycleMutations({
    setRowAlerts,
    setNotice,
    claimSlot: slots.claimSlot,
    clearStart: slots.clearStart,
    clearComplete: slots.clearComplete,
  });

  return { slots, cancelArms, disputeArms, mutations };
}
