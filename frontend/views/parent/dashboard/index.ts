/**
 * Parent dashboard view — public component surface.
 *
 * The parent dashboard's "What's next" glance card composes the shared
 * Up Next primitives (`frontend/views/dashboard/home/`) over the
 * identity-scoped `myChildrenUpcomingSessions` read; the route shell
 * mounts it through `RoleDashboardPage`'s parent status slot.
 */

export * from "./ParentUpNextCard";
