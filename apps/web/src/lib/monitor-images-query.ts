import type { SearchGroupImagesResponse } from "@fm/shared/dto.js";
import { apiGet } from "@/lib/api";

export function monitorImagesQueryKey(groupId: string) {
  return ["monitor-images", groupId] as const;
}

export async function fetchMonitorImages(groupId: string): Promise<SearchGroupImagesResponse> {
  return apiGet<SearchGroupImagesResponse>(`/api/monitors/${encodeURIComponent(groupId)}/images`);
}
