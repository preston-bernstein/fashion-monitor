import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/lib/api";
import type { Capability, Me } from "@fm/shared/dto.js";

export const ME_QUERY_KEY = ["me"] as const;

/** The app's auth gate: resolves the current user + capabilities from the API. */
export function useMe() {
  return useQuery<Me, ApiError>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiGet<Me>("/api/me"),
    retry: (_count, error) => !(error instanceof ApiError && error.status === 401),
    staleTime: 30_000,
  });
}

/** Resolved capability set for the current user (empty until `useMe` loads). */
function useCapabilities(): Set<Capability> {
  const { data } = useMe();
  return useMemo(() => new Set(data?.capabilities ?? []), [data]);
}

/** Capability-aware UI helper. The server still enforces every capability. */
export function useCan(): (cap: Capability) => boolean {
  const caps = useCapabilities();
  return useMemo(() => (cap: Capability) => caps.has(cap), [caps]);
}
