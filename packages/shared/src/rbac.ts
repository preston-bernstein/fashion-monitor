export const CAPABILITIES = [
  "monitors:read",
  "monitors:write",
  "taste:read",
  "taste:write",
  "system:read",
  "system:write",
  "secrets:read",
  "secrets:write",
  "analytics:read",
  "pipeline:trigger",
  "users:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROLES = ["owner", "admin", "curator", "operator", "viewer"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  curator: "Curator",
  operator: "Operator",
  viewer: "Viewer",
};
