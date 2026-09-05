import { LocationOnOutlined as LocationIcon, MosqueOutlined as MosqueIcon } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface TeacherProfile {
  readonly name: string;
  readonly specialty: string;
  readonly location: string;
  readonly initial: string;
}

/** Teacher card head: gradient avatar, name, specialty, location. */
export function TeacherCardHead({ teacher }: Readonly<{ teacher: TeacherProfile }>): ReactNode {
  return (
    <>
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "linear-gradient(135deg, var(--mui-palette-secondary-main), var(--mui-palette-secondary-dark))",
          color: "var(--mui-palette-onSecondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          fontWeight: 800,
          boxShadow: "0 4px 12px rgba(184,115,51,0.3)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {teacher.initial}
      </Box>
      <Box sx={{ position: "relative", zIndex: 1, flex: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>{teacher.name}</Typography>
        <Typography
          variant="caption"
          sx={{
            color: "var(--mui-palette-secondary-main)",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.25,
          }}
        >
          <MosqueIcon sx={{ fontSize: 14 }} />
          {teacher.specialty}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.5 }}>
          <LocationIcon sx={{ fontSize: 14, color: "var(--mui-palette-text-secondary)" }} />
          <Typography variant="caption" sx={{ color: "var(--mui-palette-text-secondary)" }}>
            {teacher.location}
          </Typography>
        </Stack>
      </Box>
    </>
  );
}
