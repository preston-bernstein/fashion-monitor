import type { Capability } from "@fm/shared/dto.js";

export interface NavItem {
  to: string;
  label: string;
  cap: Capability;
  /** Optional search params (e.g. deep-link to a tab). */
  search?: Record<string, string>;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Observe",
    items: [{ to: "/", label: "Analytics", cap: "analytics:read" }],
  },
  {
    label: "Curator",
    items: [
      { to: "/monitors", label: "Monitors", cap: "monitors:read" },
      { to: "/taste", label: "Taste", cap: "taste:read" },
      { to: "/query-performance", label: "Query performance", cap: "analytics:read" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/system", label: "System", cap: "system:read" },
      {
        to: "/system",
        label: "Secrets & health",
        cap: "secrets:read",
        search: { tab: "secrets" },
      },
      { to: "/audit", label: "Audit", cap: "system:read" },
    ],
  },
  {
    label: "Admin",
    items: [{ to: "/users", label: "Users", cap: "users:manage" }],
  },
];

/** Flat list kept for tests or callers that need a simple iteration. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
