"use client";

import { Link as MuiLink } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";

/** A single footer link - subtle hover lift with slight translateX + copper color on hover. */
export function FooterLink({ href, children }: Readonly<{ href: string; children: ReactNode }>): ReactNode {
  return (
    <MuiLink
      component={Link}
      href={href}
      underline="none"
      sx={{
        fontSize: 13,
        // Explicit onPrimary — MuiLink's default primary.main color measured
        // ~1.6:1 against the primary-dark footer in dark scheme.
        color: "var(--mui-palette-onPrimary)",
        opacity: 0.85,
        transition: "opacity 0.15s ease, color 0.15s ease, transform 0.15s ease",
        // Block-level + flex centering so the link occupies a 44px-tall touch
        // target (WCAG AAA 2.5.5) without changing the visible text size.
        display: "flex",
        alignItems: "center",
        minHeight: 44,
        boxSizing: "border-box",
        "&:hover": {
          opacity: 1,
          color: "var(--mui-palette-secondary-light)",
          transform: "translateX(3px)",
        },
        // Keyboard users get the same copper cue as the hover state.
        "&:focus-visible": {
          outline: "2px solid var(--mui-palette-secondary-main)",
          outlineOffset: 2,
          borderRadius: 0.5,
        },
      }}
    >
      {children}
    </MuiLink>
  );
}
