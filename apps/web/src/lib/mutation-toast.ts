import { toast } from "sonner";
import type { ApiError } from "@/lib/api";

export function toastApiError(error: ApiError, prefix?: string): void {
  const msg = error.issues?.[0]?.message ?? error.message;
  toast.error(prefix ? `${prefix}: ${msg}` : msg);
}
