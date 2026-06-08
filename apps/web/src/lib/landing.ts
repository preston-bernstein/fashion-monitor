import type { Role } from "@fm/shared/dto.js";

/** Post-login default route by role. Viewers land on analytics; ops on system. */
export function defaultLandingForRole(role: Role): string {
  switch (role) {
    case "viewer":
      return "/";
    case "operator":
      return "/system";
    case "curator":
      return "/monitors";
    case "admin":
    case "owner":
      return "/monitors";
    default:
      return "/";
  }
}

/** Home link for forbidden-page fallback — matches role landing. */
export function homePathForRole(role: Role): string {
  return defaultLandingForRole(role);
}
