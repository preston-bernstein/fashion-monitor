/**
 * Static per-platform Connection metadata (ADR-0004). Shared by the web API
 * (derives live status) and the SPA (renders cards) so the tier/label/type
 * assignment lives in exactly one place.
 *
 * Known discrepancy, not resolved here: ADR-0004 categorizes Vestiaire as a
 * "login" (session-based) connection, but the current scraper
 * (packages/core/src/platforms/vestiaire) authenticates via a ScrapFly API
 * key, not a stored user session — it works anonymously today. Vestiaire is
 * listed as "login"/dormant here to match the ADR's tier list; revisit when
 * ADR-0004's login tier is actually implemented.
 */
export type ConnectionType = "api-key" | "none" | "login";

export interface ConnectionMeta {
  platform: string;
  label: string;
  type: ConnectionType;
  /** Login connections ship off; see ADR-0004's ToS/measurement gate. */
  dormant: boolean;
  /** profile_secrets keys (KNOWN_SECRETS) required for this connection. */
  requiredSecrets: string[];
  /** integration_events `integration` value — shared with the pipeline's own health rows. */
  integration: string;
}

export const CONNECTIONS: ConnectionMeta[] = [
  {
    platform: "ebay",
    label: "eBay",
    type: "api-key",
    dormant: false,
    requiredSecrets: ["ebay_client_id", "ebay_client_secret"],
    integration: "scraper:ebay",
  },
  {
    platform: "grailed",
    label: "Grailed",
    type: "none",
    dormant: false,
    requiredSecrets: [],
    integration: "scraper:grailed",
  },
  {
    platform: "ntfy",
    label: "ntfy (alert destination)",
    type: "api-key",
    dormant: false,
    // ntfy_token is optional (only needed if the topic requires auth) — a
    // ntfy connection is "configured" out of the box via alert.ntfy_url/topic
    // defaults, so it has no hard-required secret.
    requiredSecrets: [],
    integration: "alerts:ntfy",
  },
  {
    platform: "vestiaire",
    label: "Vestiaire",
    type: "login",
    dormant: true,
    requiredSecrets: ["scrapfly_api_key"],
    integration: "scraper:vestiaire",
  },
  {
    platform: "poshmark",
    label: "Poshmark",
    type: "login",
    dormant: true,
    requiredSecrets: [],
    integration: "scraper:poshmark",
  },
  {
    platform: "depop",
    label: "Depop",
    type: "login",
    dormant: true,
    requiredSecrets: [],
    integration: "scraper:depop",
  },
];

export function findConnection(platform: string): ConnectionMeta | undefined {
  return CONNECTIONS.find((c) => c.platform === platform);
}
