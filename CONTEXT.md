# Fashion Monitor

A personal resale monitoring tool that watches multiple secondhand platforms for clothing matching a defined aesthetic, scores results with an LLM, and alerts the owner via ntfy.

## Language

**Monitor**:
A saved search configuration that watches one or more resale platforms for listings matching a query. A single Monitor fans out into per-platform scrape executions each pipeline run.
_Avoid_: Search Group, Search Query, Saved Search

**Taste**:
The aesthetic half of a profile's configuration — aesthetic prompt, hard-no rules, positive signals, price ceilings, and measurements. Distinct from system config (platforms, LLM, alerting).
_Avoid_: Aesthetic, Profile, Preferences

**User**:
An authenticated account that can log into the web app and holds a Role on one or more Profiles (M:N via memberships). A User invited via an Invite gets their own newly-created Profile and is its Owner.
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
A per-profile, per-platform link a User establishes so the pipeline can reach a platform on that profile's behalf. Holds the platform's credentials (stored as `Secret`s), a test/health status, and — for login-based platforms — an explicit per-platform risk acknowledgment. Three kinds: API-key (eBay developer keys, sanctioned), none (Grailed — public search, no account to connect), and login (Poshmark/Depop/Vestiaire — stores the user's session, violates ToS, ban risk borne by the user; off by default). When a platform is not connected, the pipeline falls back to anonymous public scraping. A Connection layers test + status + ToS acceptance on top of `Secret`; it is not the same thing.
_Avoid_: Account, Integration, Indexer, Link

**Pipeline**:
The autonomous background process that scrapes platforms, deduplicates, prefilters, scores, and dispatches alerts on a schedule. PENDING is a pipeline-internal score state used when the LLM is unreachable — listings are replayed on the next healthy run. Users only ever see YES, MAYBE, or NO as outcomes.
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
