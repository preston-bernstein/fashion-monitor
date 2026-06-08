import type { QueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { MonitorsResponse } from "@fm/shared/dto.js";

export const MONITORS_QUERY_KEY = ["monitors"] as const;

export async function fetchMonitors(): Promise<MonitorsResponse> {
  return apiGet<MonitorsResponse>("/api/monitors");
}

export function prefetchMonitors(queryClient: QueryClient): void {
  void queryClient.prefetchQuery({
    queryKey: MONITORS_QUERY_KEY,
    queryFn: fetchMonitors,
    staleTime: 30_000,
  });
}
