import { Star } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Teacher card footer stats: sessions count + rating. */
export function TeacherCardStats({ sessions, rating }: Readonly<{ sessions: number; rating: number }>): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ position: "relative", zIndex: 1, pt: 1, borderTop: "1px solid var(--mui-palette-divider)" }}
    >
      <Stack spacing={0} sx={{ alignItems: "center", flex: 1 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 16, color: "var(--mui-palette-secondary-main)", lineHeight: 1 }}>
          {sessions.toLocaleString()}
        </Typography>
        <Typography variant="caption" sx={{ color: "var(--mui-palette-text-secondary)", fontSize: 12 }}>
          {t.teacherSessionsCount}
        </Typography>
      </Stack>
      <Stack spacing={0} sx={{ alignItems: "center", flex: 1 }}>
        <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
          <Star sx={{ fontSize: 14, color: "var(--mui-palette-secondary-main)" }} />
          <Typography sx={{ fontWeight: 800, fontSize: 16, color: "var(--mui-palette-secondary-main)", lineHeight: 1 }}>
            {rating}
          </Typography>
        </Stack>
        <Typography variant="caption" sx={{ color: "var(--mui-palette-text-secondary)", fontSize: 12 }}>
          {t.teacherRating}
        </Typography>
      </Stack>
    </Stack>
  );
}
