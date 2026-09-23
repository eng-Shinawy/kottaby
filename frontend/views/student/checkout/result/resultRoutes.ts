/**
 * Route constants for the payment-result view — ONE definition site for the
 * funnel CTAs this view renders (retry → the plan catalog, view → the
 * my-subscriptions list) so the anchors never drift between render arms.
 *
 * Leaf module: directive-free and framework-free — NO `"use client"`, NO
 * Apollo, NO MUI — so the container and the story harness import the
 * constants without dragging the component graph.
 */

/** The plan catalog — the retry CTA's journey target. */
export const STUDENT_PLANS_ROUTE = "/student/plans";

/** The my-subscriptions list — the view-subscriptions CTA's target. */
export const STUDENT_SUBSCRIPTIONS_ROUTE = "/subscriptions";
