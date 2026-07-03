import { CAPABILITIES, ROLE_LABELS, ROLES, type Capability, type Role } from "@fm/shared/rbac.js";

export { CAPABILITIES, ROLES, ROLE_LABELS, type Capability, type Role };

const ALL: Capability[] = [...CAPABILITIES];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner: ALL,
  admin: ALL,
  curator: ["monitors:read", "monitors:write", "taste:read", "taste:write", "analytics:read"],
  operator: [
    "monitors:read",
    "taste:read",
    "system:read",
    "system:write",
    "secrets:read",
    "secrets:write",
    "pipeline:trigger",
    "analytics:read",
  ],
  viewer: ["analytics:read"],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function capabilitiesForRole(role: Role): Set<Capability> {
  return new Set(ROLE_CAPABILITIES[role] ?? []);
}

export function roleHasCapability(role: Role, cap: Capability): boolean {
  return (ROLE_CAPABILITIES[role] ?? []).includes(cap);
}
