"use client";

/**
 * The audit trail's per-entity-type outline icons — the shared visual
 * vocabulary of BOTH the trail's entity chips (`AuditEntityTypeChip`) and
 * the filter bar's quick-pick chips (`AuditEntityTypeQuickPick`).
 *
 * Extracted from the chip component so the icon lookup is importable
 * without dragging a component module into the import graph (the
 * react-refresh gate requires component files to export components only).
 */

import {
  AccountBalanceWalletOutlined,
  CampaignOutlined,
  CardMembershipOutlined,
  EventOutlined,
  FactCheckOutlined,
  LabelOutlined,
  LinkOutlined,
  ListAltOutlined,
  PersonOutlined,
  SchoolOutlined,
} from "@mui/icons-material";
import type { ReactElement } from "react";

/** Per-entity outline icon keyed by the raw wire value; unknown → generic tag. */
const ENTITY_TYPE_ICON_BY_WIRE: Record<string, ReactElement> = {
  user: <PersonOutlined />,
  teacher: <SchoolOutlined />,
  session: <EventOutlined />,
  subscription: <CardMembershipOutlined />,
  plan: <ListAltOutlined />,
  teacher_transaction: <AccountBalanceWalletOutlined />,
  parent_link_request: <LinkOutlined />,
  parent_link_request_decision: <FactCheckOutlined />,
  parent_link_request_expiry: <FactCheckOutlined />,
  notification_broadcast: <CampaignOutlined />,
};

/**
 * The per-entity outline icon for a raw wire value (generic tag for a value
 * outside the vocabulary) — one icon system across the trail's chips and
 * the filter's quick-pick chips.
 */
export function auditEntityTypeIconOf(entityType: string): ReactElement {
  return ENTITY_TYPE_ICON_BY_WIRE[entityType] ?? <LabelOutlined />;
}
