# Fashion Monitor

Fashion Monitor is a personal resale monitoring tool. It watches multiple secondhand clothing platforms for listings that match a defined aesthetic, scores each result with an LLM, and alerts the owner through ntfy (a push-notification service).

## Language

This section is the repo's controlled vocabulary: the one word to use for each concept, its exact meaning, and the words to avoid because they're used loosely elsewhere or mean something different in this codebase.

**Monitor**:
A saved search configuration that watches one or more resale platforms for listings matching a query. Each pipeline run, one Monitor turns into a separate scrape per platform it covers.
_Avoid_: Search Group, Search Query, Saved Search

**Taste**:
The aesthetic half of a profile's configuration — aesthetic prompt, hard-no rules, positive signals, price ceilings, and measurements. Distinct from system config (platforms, LLM, alerting).
_Avoid_: Aesthetic, Profile, Preferences

**User**:
An authenticated account that can log into the web app. A User holds a Role on one or more Profiles (many-to-many, tracked in a memberships table). A User invited via an Invite gets their own newly-created Profile and is its Owner.
_Avoid_: Account, Person

**Invite**:
A one-time token (delivered as a link) the system Owner generates to onboard a new User. Redeeming it creates the User, creates a fresh Profile, and makes that User the Profile's Owner. There is no public self-registration; an Invite is the only way in.
_Avoid_: Signup, Registration, Token

**Profile**:
The owner of a Taste, a set of Monitors, and an alert destination (ntfy topic). Scopes all DB rows via profile_id. Can exist without a web User (e.g. CLI-only).
_Avoid_: User, Account

**Role**:
A named set of capabilities assigned to a User. Five roles exist: Owner (full access), Admin (full except ownership transfer), Curator (Taste + Monitors), Operator (system config + pipeline triggers), Viewer (read-only).
_Avoid_: Permission, Access Level

**Score**:
The LLM verdict for a listing: YES, MAYBE, or NO. Text batch scoring runs first; MAYBE listings with an image get a second vision pass that may replace the verdict. Both YES and MAYBE are alertable — post-vision MAYBE still alerts, signaling lower confidence.
_Avoid_: Rating, Verdict, Grade

**Interface hierarchy**:
Audience-dependent. For the system Owner / power user, the MCP server is primary — adding Monitors, querying results, and tuning Taste happen in conversation with an LLM client. For invited end users (who may never touch an LLM client), the web app is primary and self-sufficient: onboarding, Taste, Monitors, Connections, alerts, and health all live there. The CLI is for pipeline execution and local debugging only.
_Avoid_: (not a noun term — captured here as a design axiom)

**Query Override**:
A per-platform replacement query on a Monitor. When set, the override is sent to that platform instead of the Monitor's primary query text. Used when platform search engines produce different quality results for the same natural language query.
_Avoid_: Platform Override, Custom Query

**Secret**:
A per-profile credential (ntfy token, platform API key, etc.) stored encrypted at rest in the DB. Plaintext never persists; only callers with secrets:write capability can write, only the pipeline decrypts at runtime. The encryption key itself lives only in .env and is the single root secret.
_Avoid_: Token, Credential, API Key

**Connection**:
A per-profile, per-platform link a User sets up so the pipeline can reach a platform on that profile's behalf. It holds the platform's credentials (stored as `Secret`s), a test/health status, and — for login-based platforms — an explicit per-platform risk acknowledgment. There are three kinds: API-key (eBay's official developer keys — sanctioned by eBay), none (Grailed — public search, no account needed), and login (Poshmark, Depop, Vestiaire — stores the user's own logged-in session; this violates those platforms' Terms of Service and risks a ban, so it's off by default and the user bears the risk). When a platform has no Connection, the pipeline falls back to anonymous public scraping. A Connection is not the same thing as a `Secret` — it adds test status and ToS acceptance on top of one.
_Avoid_: Account, Integration, Indexer, Link

**Pipeline**:
The background process that runs on a schedule with no human involvement: it scrapes platforms, removes duplicate listings, filters out obvious non-matches, scores what's left, and sends alerts. PENDING is an internal score state used only when the LLM can't be reached — those listings are scored again on the next successful run. Users only ever see the final outcome as YES, MAYBE, or NO.
_Avoid_: Runner, Job, Cron

**Scoring Dimensions**:
The three axes the LLM reasons across when producing a Score: aesthetic (does it match the Taste), quality (is the condition trustworthy), and value (is the price reasonable for what it is). All three are exposed in alerts so the user can decide whether to click through without opening the listing.
_Avoid_: Sub-scores, Factors, Criteria

**Feedback**:
Positive or negative signals recorded from the web dashboard's alert history, injected as few-shot examples into the LLM prompt. Seed entries are permanent anchors that encode the core aesthetic and never rotate out. Dashboard-sourced entries rotate to most recent 30 after saturation. Seed entries are the aesthetic constitution; dashboard feedback is the legislature.
_Avoid_: Training Data, Examples, Signals

**Default Searches**:
Hardcoded bootstrap queries that run before any Monitors are configured. Intended to be disabled once real Monitors exist — they are not a permanent fallback. The target end state is zero Default Searches with all queries owned by explicit Monitors.
_Avoid_: Fallback Queries, Built-in Searches
