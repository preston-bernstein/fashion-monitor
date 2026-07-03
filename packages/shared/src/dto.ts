import type { Capability, Role } from "./rbac.js";
import type { LlmConfig, Measurements } from "./schemas/config.js";
import type { MonitorStatus, Platform } from "./platforms.js";
import type { SearchGroupDto } from "./schemas/search-groups.js";
import type {
  ListingImageDto,
  ListingImagesResponse,
  SearchGroupImageDto,
  SearchGroupImagesResponse,
} from "./schemas/images.js";

export type { Capability, Role, Platform, MonitorStatus, LlmConfig, Measurements };
export type { SearchGroupDto, ExecutionDto } from "./schemas/search-groups.js";
export type {
  ListingImageDto,
  ListingImagesResponse,
  SearchGroupImageDto,
  SearchGroupImagesResponse,
};

export type SearchGroup = SearchGroupDto;

export interface Me {
  user: { id: number; email: string; role: Role };
  capabilities: Capability[];
}

export interface MonitorsResponse {
  groups: SearchGroupDto[];
  platforms: Platform[];
  statuses: MonitorStatus[];
  canWrite: boolean;
}

export interface Taste {
  aesthetic_prompt: string;
  hard_no: string[];
  positive_signals: { strong: string[]; weak: string[] };
  price_ceiling: { tops?: number; pants?: number; outerwear?: number; default: number };
  measurements: Measurements & Record<string, unknown>;
}

export interface TasteResponse {
  taste: Taste;
  canWrite: boolean;
}

export interface SystemSettings {
  platforms: Record<string, boolean>;
  llm: LlmConfig;
  alert_options: { mode: "immediate" | "digest"; notify_empty: boolean };
  scraper: { poshmark_profile_path: string };
}

export interface SystemResponse {
  system: SystemSettings;
  options: {
    platforms: Platform[];
    providers: LlmConfig["provider"][];
    visionBackends: LlmConfig["vision_backend"][];
    alertModes: SystemSettings["alert_options"]["mode"][];
  };
  canWrite: boolean;
}

export interface IntegrationUptime {
  integration: string;
  ok_count: number;
  degraded_count: number;
  fail_count: number;
  uptime_pct: number | null;
  last_problem_at: string | null;
}

export interface IntegrationFailure {
  id: number;
  integration: string;
  operation: string;
  status: string;
  error: string | null;
  recorded_at: string;
}

export interface SecretsResponse {
  storeEnabled: boolean;
  secrets: { key: string; updated_at: string }[];
  knownSecrets: string[];
  uptime: IntegrationUptime[];
  failures: IntegrationFailure[];
  runRequestedAt: string | null;
  canWrite: boolean;
  canTrigger: boolean;
}

export type ConnectionStatus = "ok" | "degraded" | "failed" | "untested" | "not_connected";

export interface ConnectionDto {
  platform: string;
  label: string;
  type: "api-key" | "none" | "login";
  dormant: boolean;
  automatic: boolean;
  configured: boolean;
  status: ConnectionStatus;
  lastTestedAt: string | null;
  lastError: string | null;
}

export interface ConnectionsResponse {
  connections: ConnectionDto[];
}

export interface ConnectionTestResponse {
  ok: boolean;
  status: "ok" | "failed";
  error: string | null;
  testedAt: string;
}

export interface RunFunnelDto {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number | null;
  scraped: number;
  new: number;
  prefiltered: number;
  scoredYes: number;
  scoredMaybe: number;
  scoredNo: number;
  alerted: number;
  hadError: boolean;
}

export interface HealthResponse {
  runs: RunFunnelDto[];
  lastAlertedAt: string | null;
}

export interface UserRow {
  id: number;
  email: string;
  status: string;
  role: Role;
}

export interface UsersResponse {
  users: UserRow[];
  roles: { value: Role; label: string }[];
}

export interface AuditRow {
  id: number;
  profile_id: string;
  user_id: number | null;
  actor_email: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  recorded_at: string;
}

export type AuditCategory = "auth" | "monitors" | "settings" | "secrets" | "users" | "system";

export interface AuditQueryParams {
  limit?: number;
  offset?: number;
  action?: string;
  actor?: string;
  since?: string;
  category?: AuditCategory;
}

export interface AuditResponse {
  entries: AuditRow[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface SearchGroupScorecardRow {
  group_id: string;
  query_text: string;
  platforms: string;
  status: string;
  note: string | null;
  total_runs: number;
  listings_found: number;
  listings_new: number;
  scored_yes: number;
  alerts_sent: number;
  alert_rate: number | null;
  yes_rate: number | null;
  feedback_positive: number;
  feedback_negative: number;
  feedback_ratio: number | null;
  last_alert_at: string | null;
  last_good_signal_at: string | null;
}

export interface QueryScorecardRow {
  query_id: string;
  group_id: string;
  platform: string;
  query_text: string;
  status: string;
  note: string | null;
  total_runs: number;
  listings_found: number;
  listings_new: number;
  scored_yes: number;
  alerts_sent: number;
  alert_rate: number | null;
  yes_rate: number | null;
  feedback_positive: number;
  feedback_negative: number;
  feedback_ratio: number | null;
  last_alert_at: string | null;
  last_good_signal_at: string | null;
}

export interface QueryRunHistoryRow {
  run_started_at: string;
  platform: string;
  query_id: string;
  query_text: string;
  listings_found: number;
  listings_new: number;
  alerts_sent: number;
  error: string | null;
}

export interface DashboardPayload {
  overview: {
    totalRuns: number;
    totalListingsSeen: number;
    totalAlerts: number;
    totalYes: number;
    totalMaybe: number;
    totalNo: number;
    totalPending: number;
    positiveFeedback: number;
    negativeFeedback: number;
    lastRunAt: string | null;
    lastAlertAt: string | null;
  };
  runs: {
    id: number;
    started_at: string;
    listings_found: number;
    listings_new: number;
    scored_yes: number;
    alerts_sent: number;
    error: string | null;
  }[];
  alerts: {
    id: number;
    platform: string;
    listing_id: string;
    title: string | null;
    price: number | null;
    score: string | null;
    alerted_at: string;
    url: string | null;
    image_url: string | null;
    source_query_id: string | null;
  }[];
  scoresByPlatform: { platform: string; score: string; listing_count: number }[];
  dailyRuns: {
    run_date: string;
    run_count: number;
    total_found: number;
    total_new: number;
    total_yes: number;
    total_alerts: number;
  }[];
  platformAlerts: { platform: string; alerts_sent: number; avg_alert_price: number | null }[];
  groupScorecard: SearchGroupScorecardRow[];
  queryScorecard: QueryScorecardRow[];
  queryRunHistory: QueryRunHistoryRow[];
  integrationUptime: IntegrationUptime[];
  integrationFailures: IntegrationFailure[];
  configRevisions: { id: number; recorded_at: string; content_hash: string; run_id: number | null }[];
  promptDiet: {
    aesthetic_prompt: string;
    hard_no: string[];
    positive_signals: { strong: string[]; weak: string[] };
    positive_examples: { listing_id: string; title: string | null; source_query_id?: string | null }[];
    negative_examples: { listing_id: string; title: string | null; source_query_id?: string | null }[];
  };
  generatedAt: string;
}
