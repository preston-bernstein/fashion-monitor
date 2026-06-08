# Database technology choice (2026)

**Question:** Why SQLite? Surely there is a better option — maybe NoSQL?

**Short answer:** SQLite is the right default for fashion-monitor *today*, but PostgreSQL is the honest upgrade path once you need concurrent multi-writer access, stronger audit durability guarantees, or a managed HA deployment. NoSQL does not fit this workload.

---

## Application profile

| Trait | Implication |
| --- | --- |
| Personal / small team (≤10 users) | Low concurrent write pressure |
| Single instance (one dashboard + cron scrapers) | One writer process is typical |
| Cron-driven scrapers, not real-time streaming | Batch inserts, not firehose |
| SQLite today (`better-sqlite3`, sync API) | Zero ops, file-backed, embedded |
| Internet-exposed web app with RBAC + audit | Needs durability + backup discipline, not necessarily a server DB |
| Relational model: monitors, runs, listings, alerts, audit, integration events | Joins, views, foreign keys — SQL-native |
| Analytics via SQL views + optional Grafana | Read-heavy; SQLite handles this well at this scale |

---

## Option comparison

### SQLite (`better-sqlite3`) — current choice

**When it is right**

- One primary writer (pipeline) + a few concurrent readers (web API, Grafana, CLI report).
- Dataset fits comfortably in memory/disk on a single host (tens of millions of rows is fine with indexes).
- You want zero database ops: no connection strings, no replication config, no billing.
- WAL mode gives reasonable read concurrency while the scraper writes.

**Tradeoffs**

- Single-writer semantics: multiple processes writing heavily will contend (pipeline + web mutations are light, but it is a ceiling).
- No built-in row-level security, replication, or point-in-time recovery — backups are *your* job (file copy while checkpointed, or Litestream).
- Audit log and RBAC are application-enforced; SQLite will not help with compliance attestations.

**Verdict for fashion-monitor today:** Correct for a self-hosted personal tool with one pipeline instance and a small user base. The schema (views, migrations, repos) is already SQLite-shaped and working.

---

### PostgreSQL — when to migrate

**When it becomes better even at modest scale**

- **Multiple app instances** behind a load balancer (horizontal web tier).
- **Concurrent writers** — e.g. several scraper workers, feedback bot + pipeline + admin UI all writing heavily at once.
- **JSONB** for config snapshots / flexible metadata without migration churn.
- **TimescaleDB extension** if integration metrics and run history grow into time-series at volume (continuous aggregates, retention policies).
- **Managed HA** (Neon, Supabase, RDS) when uptime and automated backups matter more than "no ops."

**Tradeoffs**

- Operational cost: connection pooling, migrations in CI, secrets, monitoring.
- Latency: network round-trip vs in-process SQLite (negligible for this UI, noticeable for tight scrape loops if DB is remote).
- Migration effort: schema port is straightforward (SQL is portable); `better-sqlite3` sync calls become `pg` async — moderate refactor.

**Honest take:** For **multi-user RBAC + audit** alone, SQLite is still adequate at this scale. Postgres pulls ahead when you run **more than one writer process** or need **managed backup/HA** for an internet-facing deployment you cannot afford to lose.

---

### Turso / libSQL, DuckDB — variants

| Tech | Role | Fit here |
| --- | --- | --- |
| **Turso (libSQL)** | SQLite-compatible edge/replica | Interesting if you want read replicas close to users while keeping SQLite ergonomics; overkill for single-home-server deploy |
| **DuckDB** | Embedded OLAP | Great for ad-hoc analytics on exports; not a replacement for transactional monitors/runs/audit |
| **LiteFS / Litestream** | SQLite replication | Bridge solution: keep SQLite, add replica/backup without jumping to Postgres |

Use these as **enhancements to SQLite**, not as reasons to abandon the relational model.

---

### NoSQL (MongoDB, Redis, etc.) — usually wrong here

**Why it does not fit**

- Core entities are **relational**: `scrape_queries` → `runs` → `seen_listings` → `alert_log`, plus `audit_log` and `integration_events` with stable schemas.
- Analytics are **SQL views** (`v_query_scorecard`, `v_run_summary`, …) — porting to document stores means reimplementing joins in application code.
- **Audit trail** requires append-only, queryable history with actor/target/detail — document DB adds little; event sourcing without SQL reporting is painful.
- **RBAC** is a handful of users/roles — not a graph or cache problem.

Redis is useful as a **cache or job queue**, not as the system of record. MongoDB would duplicate relational structure in nested documents and make Grafana/SQL reporting harder.

**When NoSQL would never make sense for fashion-monitor:** Replacing the primary store. The workload is OLTP + SQL analytics, not unstructured blobs or sub-millisecond KV lookups at billions of keys.

---

### Event stores / ClickHouse / Loki — metrics at scale

| System | Purpose | When |
| --- | --- | --- |
| **ClickHouse** | Columnar analytics | Millions of integration events/day, sub-second aggregates over months |
| **Loki / ELK** | Log search | Centralized log drain from many services |
| **Kafka + event store** | Event sourcing | Many producers, replay, CQRS |

Fashion-monitor records **hundreds to low thousands** of integration events per month, pruned after 30 days. SQLite views + Grafana suffice. Adopt ClickHouse/Loki when event volume or retention **outgrows** SQLite query time (seconds on dashboard load) — not before.

---

### Embedded vs managed

| Approach | Pros | Cons |
| --- | --- | --- |
| **Embedded SQLite (current)** | Simplest deploy, matches Docker volume model | You own backups and single-writer limits |
| **Managed Postgres (Neon, Supabase, RDS)** | Backups, scaling, connection pooling | Cost, network dependency, migration |
| **PlanetScale (MySQL)** | Serverless scaling | MySQL dialect; no advantage over Postgres for this schema |
| **SQLite + Litestream** | Near-zero change, continuous backup to S3 | Extra process, not multi-writer |

For a NAS/home-server deploy, **embedded SQLite + documented backup** is rational. For a **public SaaS**, plan Postgres from the start.

---

## Recommendation

### Today (2026)

**Stay on SQLite** with these non-negotiables:

1. **WAL mode** enabled (already typical for `better-sqlite3` apps).
2. **Automated backups** of `fashion_monitor.db` (cron + off-site copy; or Litestream).
3. **Do not expose the DB file** — only the API (already the architecture).

SQLite matches the deployment model (single container, cron scrapers, Grafana read-only mount) and keeps the monorepo simple.

### Migration triggers → PostgreSQL

Move when **any** of these become true:

| Trigger | Why Postgres |
| --- | --- |
| Second concurrent **writer** process (multi-worker scrape, active-active web) | SQLite writer lock becomes painful |
| **>3 web instances** or Kubernetes replicas | Shared file SQLite is unsafe; need network DB |
| Audit/compliance requires **PITR, replication, or DBA attestations** | Managed Postgres |
| Integration + run history **>~10M rows** with slow dashboard queries | JSONB + Timescale or partitioning |
| Team wants **remote DB** decoupled from app host | Neon/Supabase |

### Migration triggers → NoSQL

**None** for primary storage. Optional Redis later for rate limiting or job queues — not a replacement for monitors, runs, or audit.

### If you want a middle step before Postgres

- **Litestream** or **LiteFS** for replication/backup without schema migration.
- **DuckDB** for offline analytics exports, not live OLTP.

---

## Summary table

| Technology | fashion-monitor today | Primary store? |
| --- | --- | --- |
| SQLite | **Recommended** | Yes |
| PostgreSQL | Plan at multi-instance / HA | Yes (future) |
| Turso/libSQL | Optional edge replica | Yes (SQLite-compatible) |
| DuckDB | Analytics sidecar only | No |
| MongoDB / Redis | Wrong fit | No |
| ClickHouse / Loki | Overkill until huge telemetry | No (metrics adjunct) |

**Bottom line:** SQLite is not a compromise for this app — it is the appropriate tool. The better option for *your* stated profile is not NoSQL; it is **Postgres when operational requirements outgrow a single file**, plus **backup discipline** while you remain on SQLite.
