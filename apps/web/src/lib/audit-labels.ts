const ACTION_LABELS: Record<string, string> = {
  "login.failed": "Login failed",
  "login.success": "Login succeeded",
  "logout": "Logout",
  "auth.forbidden": "Access forbidden",
  "auth.csrf.failed": "CSRF check failed",
  "system.bootstrap.admin": "Bootstrap admin created",
  "user.create": "User created",
  "user.role": "User role changed",
  "user.status": "User status changed",
  "secret.upsert": "Secret updated",
  "pipeline.trigger": "Pipeline run requested",
  "taste.update": "Taste settings updated",
  "system.update": "System settings updated",
  "monitor.create": "Monitor created",
  "monitor.update": "Monitor updated",
  "monitor.delete": "Monitor deleted",
};

const SEVERITY_ACTIONS = new Set(["login.failed", "auth.forbidden", "auth.csrf.failed"]);

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll(".", " · ");
}

export function auditActionSeverity(action: string): "danger" | "default" {
  return SEVERITY_ACTIONS.has(action) ? "danger" : "default";
}

export function isMonitorTarget(action: string, target: string | null): boolean {
  return Boolean(target && action.startsWith("monitor."));
}

export function isUserTarget(action: string, target: string | null): boolean {
  return Boolean(target && action.startsWith("user.") && target.includes("@"));
}
