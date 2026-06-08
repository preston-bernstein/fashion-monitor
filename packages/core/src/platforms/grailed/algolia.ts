import { fetchWithTimeout } from "../../lib/http.js";

export interface GrailedAlgoliaResponse {
  hits?: Record<string, unknown>[];
}

export function grailedAlgoliaHeaders(appId: string, apiKey: string): Record<string, string> {
  return {
    "x-algolia-agent": "Algolia for JavaScript (4.13.1); Browser (lite)",
    "x-algolia-api-key": apiKey,
    "x-algolia-application-id": appId,
    "Content-Type": "application/json",
  };
}

export function grailedAlgoliaUrl(appId: string): string {
  return `https://${appId}-dsn.algolia.net/1/indexes/Post_production/query`;
}

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function queryGrailedAlgolia(
  body: Record<string, unknown>,
  credentials: { appId: string; apiKey: string },
  fetchFn: FetchLike = fetchWithTimeout,
): Promise<GrailedAlgoliaResponse> {
  const { appId, apiKey } = credentials;
  const response = await fetchFn(grailedAlgoliaUrl(appId), {
    method: "POST",
    headers: grailedAlgoliaHeaders(appId, apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Grailed Algolia failed: ${response.status}`);
  }

  return (await response.json()) as GrailedAlgoliaResponse;
}
