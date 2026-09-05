import {
  GroupsOutlined as GroupsIcon,
  PersonOutlined as PersonIcon,
  SchoolOutlined as SchoolIcon,
} from "@mui/icons-material";
import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { SectionWrapper } from "@/frontend/views/landing/layout";
import { RoleCard } from "@/frontend/views/landing/sections/roles/RoleCard";
import { Landing, useAppTranslation } from "@/shared/locale";

// ─── Roles ───────────────────────────────────────────────────────────

export function RolesSection(): ReactNode {
  const t = useAppTranslation(Landing);
  const roles = [
    {
      icon: <SchoolIcon />,
      title: t.roleStudentTitle,
      body: t.roleStudentBody,
      cta: t.roleStudentCta,
      href: "/register",
    },
    {
      icon: <PersonIcon />,
      title: t.roleTeacherTitle,
      body: t.roleTeacherBody,
      cta: t.roleTeacherCta,
      href: "/register",
    },
    { icon: <GroupsIcon />, title: t.roleParentTitle, body: t.roleParentBody, cta: t.roleParentCta, href: "/register" },
  ];

  return (
    <SectionWrapper badge={t.rolesBadge} title={t.rolesTitle} subtitle={t.rolesSubtitle} bg="paper">
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
          gap: 3,
        }}
      >
        {roles.map(r => (
          <RoleCard key={r.title} icon={r.icon} title={r.title} body={r.body} cta={r.cta} href={r.href} />
        ))}
      </Box>
    </SectionWrapper>
  );
}
