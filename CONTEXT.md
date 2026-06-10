# Fashion Monitor

A personal resale monitoring tool that watches multiple secondhand platforms for clothing matching a defined aesthetic, scores results with an LLM, and alerts the owner via Telegram.

## Language

**Monitor**:
A saved search configuration that watches one or more resale platforms for listings matching a query. A single Monitor fans out into per-platform scrape executions each pipeline run.
_Avoid_: Search Group, Search Query, Saved Search

**Taste**:
The aesthetic half of a profile's configuration — aesthetic prompt, hard-no rules, positive signals, price ceilings, and measurements. Distinct from system config (platforms, LLM, alerting).
_Avoid_: Aesthetic, Profile, Preferences

**User**:
An authenticated account that can log into the web app and holds a Role. One User maps to one Profile in v1.
_Avoid_: Account, Person

**Profile**:
The owner of a Taste, a set of Monitors, and an alert destination (Telegram chat). Scopes all DB rows via profile_id. Can exist without a web User (e.g. CLI-only).
_Avoid_: User, Account

**Role**:
A named set of capabilities assigned to a User. Five roles exist: Owner (full access), Admin (full except ownership transfer), Curator (Taste + Monitors), Operator (system config + pipeline triggers), Viewer (read-only).
_Avoid_: Permission, Access Level

**Score**:
The LLM verdict for a listing: YES, MAYBE, or NO. Text batch scoring runs first; MAYBE listings with an image get a second vision pass that may replace the verdict. Both YES and MAYBE are alertable — post-vision MAYBE still alerts, signaling lower confidence.
_Avoid_: Rating, Verdict, Grade

**Interface hierarchy**:
MCP server is the primary interface — adding Monitors, querying results, and tuning Taste happen in conversation with an LLM client. The web app is a strong secondary interface for configuration, analytics, and multi-user management. The CLI is for pipeline execution and local debugging only.
_Avoid_: (not a noun term — captured here as a design axiom)

**Query Override**:
A per-platform replacement query on a Monitor. When set, the override is sent to that platform instead of the Monitor's primary query text. Used when platform search engines produce different quality results for the same natural language query.
_Avoid_: Platform Override, Custom Query

**Secret**:
A per-profile credential (Telegram token, platform API key, etc.) stored encrypted at rest in the DB. Plaintext never persists; only callers with secrets:write capability can write, only the pipeline decrypts at runtime. The encryption key itself lives only in .env and is the single root secret.
_Avoid_: Token, Credential, API Key

**Pipeline**:
The autonomous background process that scrapes platforms, deduplicates, prefilters, scores, and dispatches alerts on a schedule. PENDING is a pipeline-internal score state used when the LLM is unreachable — listings are replayed on the next healthy run. Users only ever see YES, MAYBE, or NO as outcomes.
_Avoid_: Runner, Job, Cron

**Scoring Dimensions**:
The three axes the LLM reasons across when producing a Score: aesthetic (does it match the Taste), quality (is the condition trustworthy), and value (is the price reasonable for what it is). All three are exposed in alerts so the user can decide whether to click through without opening the listing.
_Avoid_: Sub-scores, Factors, Criteria

**Feedback**:
Positive or negative signals recorded from Telegram replies, injected as few-shot examples into the LLM prompt. Seed entries are permanent anchors that encode the core aesthetic and never rotate out. Telegram-sourced entries rotate to most recent 30 after saturation. Seed entries are the aesthetic constitution; Telegram feedback is the legislature.
_Avoid_: Training Data, Examples, Signals

**Default Searches**:
Hardcoded bootstrap queries that run before any Monitors are configured. Intended to be disabled once real Monitors exist — they are not a permanent fallback. The target end state is zero Default Searches with all queries owned by explicit Monitors.
_Avoid_: Fallback Queries, Built-in Searches
