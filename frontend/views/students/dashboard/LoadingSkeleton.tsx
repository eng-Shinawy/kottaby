"use client";

import { Skeleton } from "@mui/material";
import type { ReactNode } from "react";
import { CardShell } from "@/frontend/views/students/dashboard/CardShell";

/** Loading skeleton — title line + code chip + copy action. */
export function LoadingSkeleton(): ReactNode {
  return (
    <CardShell testId="handshake-code-card-loading" busy>
      <Skeleton variant="text" sx={{ fontSize: "1.75rem", maxWidth: 280 }} />
      <Skeleton variant="rounded" sx={{ height: 56, width: 220, borderRadius: 2 }} />
      <Skeleton variant="rectangular" sx={{ height: 44, width: 170, borderRadius: 2 }} />
    </CardShell>
  );
}
