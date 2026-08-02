# Database technology choice (2026)

**Question:** Why SQLite? Is there a better option — maybe NoSQL?

**Short answer:** SQLite is the right default for fashion-monitor today. PostgreSQL is the honest upgrade path once the app needs concurrent writes from multiple processes, stronger durability guarantees for its audit trail, or a managed HA deployment. NoSQL does not fit this workload at all.

---

## Application profile

| Trait | Implication |
| --- | --- |
| Personal / small team (≤10 users) | Low concurrent write pressure |
| Single instance (one dashboard + cron scrapers) | One writer process is typical |
| Cron-driven scrapers, not real-time streaming | Batch inserts, not firehose |
| SQLite today (`better-sqlite3`, sync API) | Zero ops, file-backed, embedded |
| Internet-exposed web app with RBAC and an audit log | Needs durability + backup discipline, not necessarily a server DB |
| Relational model: monitors, runs, listings, alerts, audit, integration events | Joins, views, foreign keys — SQL-native |
| Analytics via SQL views + optional Grafana | Read-heavy; SQLite handles this well at this scale |

---

## Option comparison

### SQLite (`better-sqlite3`) — current choice

**When it is right**

- One primary writer (the pipeline) plus a few concurrent readers (the web API, Grafana, the CLI report).
- The dataset fits comfortably in memory and on disk on a single host — tens of millions of rows are fine with indexes.
- You want zero database ops: no connection strings, no replication config, no billing.
- WAL mode gives reasonable read concurrency while the scraper writes.

**Tradeoffs**

- Single-writer semantics: SQLite only lets one process write at a time. Today's writes (the pipeline, plus light web mutations) are small enough that this isn't a problem, but it is a ceiling.
- SQLite has no built-in row-level security, replication, or PITR. Backups are your job: a file copy while checkpointed, or a tool like Litestream (see below).
- The audit log and RBAC are enforced by the application code, not the database. SQLite will not help you pass a compliance audit.

**Verdict for fashion-monitor today:** Correct for a self-hosted personal tool with one pipeline instance and a small user base. The schema (views, migrations, repos) is already built around SQLite and works.

---

### PostgreSQL — when to migrate

**When it becomes better even at modest scale**

- **Multiple app instances** run behind a load balancer (a horizontal web tier).
- **Concurrent writers** — for example, several scraper workers, the feedback bot, the pipeline, and the admin UI all writing heavily at the same time.
- **JSONB** stores config snapshots or flexible metadata without needing a schema migration for every new field.
- The **TimescaleDB** extension (a Postgres add-on for time-series data) helps if integration metrics and run history grow into high-volume time series that need continuous aggregates or retention policies.
- **Managed HA** (Neon, Supabase, RDS) matters once uptime and automated backups matter more than avoiding ops work.

**Tradeoffs**

- Operational cost: connection pooling, migrations running in CI, secrets management, monitoring.
- Latency: a network round-trip instead of in-process SQLite. Negligible for the dashboard UI, but noticeable in a tight scrape loop if the database is remote.
- Migration effort: the schema itself ports easily, since SQL is portable. Converting `better-sqlite3`'s synchronous calls to `pg`'s asynchronous ones is a moderate refactor.

**Honest take:** SQLite is still adequate at this scale for multi-user RBAC and audit logging alone. Postgres pulls ahead once you run more than one writer process, or once you need managed backup and HA for an internet-facing deployment you cannot afford to lose.

---

### Turso / libSQL, DuckDB — variants worth knowing about

| Tech | Role | Fit here |
| --- | --- | --- |
| **Turso (libSQL)** | A SQLite-compatible service that runs read replicas at the network edge, close to users | Interesting if you want replicas close to users while keeping SQLite's simplicity; overkill for a single home-server deploy |
| **DuckDB** | An embedded database built for analytics (OLAP) | Great for ad-hoc analytics on exports; not a replacement for the transactional monitors/runs/audit tables |
| **LiteFS / Litestream** | Tools that replicate or continuously back up a SQLite file | A bridge option: keep SQLite, add replication or backup, without jumping to Postgres |

Treat these as enhancements to SQLite, not as reasons to abandon the relational model.

---

### NoSQL (MongoDB, Redis, etc.) — usually the wrong fit here

**Why it does not fit**

- The core entities are relational: `scrape_queries` → `runs` → `seen_listings` → `alert_log`, plus `audit_log` and `integration_events`, all with stable schemas.
- Analytics run as SQL views (`v_query_scorecard`, `v_run_summary`, and others). Porting these to a document store means reimplementing joins in application code.
- The audit trail needs an append-only, queryable history with actor, target, and detail fields per entry. A document database adds little here, and event sourcing without SQL reporting is painful to query.
- RBAC in this app is a handful of users and roles — not a graph problem, and not a caching problem.

Redis is useful as a cache or job queue, not as the system of record. MongoDB would duplicate the relational structure inside nested documents and make Grafana and SQL reporting harder, not easier.

**When would NoSQL make sense for fashion-monitor?** Never, for the primary store. This workload is OLTP plus SQL analytics. It is not unstructured blobs, and it is not sub-millisecond key lookups across billions of keys.

---

### Event stores, ClickHouse, Loki — tools for metrics at much larger scale

| System | Purpose | When to use it |
| --- | --- | --- |
| **ClickHouse** | A columnar database built for analytics | Millions of integration events per day, needing sub-second aggregates over months of history |
| **Loki / ELK** | Log search systems | Centralizing log output from many separate services |
| **Kafka + an event store** | Event sourcing (recording every state change as an event you can replay) | Many producers, replay needs, or CQRS |

Fashion-monitor records hundreds to low thousands of integration events per month, and prunes them after 30 days. SQLite views plus Grafana are enough for that volume. Adopt ClickHouse or Loki only once event volume or retention outgrows SQLite's query time — currently seconds on dashboard load, not before.

---

### Embedded vs. managed

| Approach | Pros | Cons |
| --- | --- | --- |
| **Embedded SQLite (current)** | Simplest deploy; matches the Docker volume model already in use | You own backups, and you live with the single-writer limit |
| **Managed Postgres (Neon, Supabase, RDS)** | Backups, scaling, and connection pooling come built in | Costs money, adds a network dependency, and requires a migration |
| **PlanetScale (MySQL)** | Serverless scaling | Uses the MySQL dialect, which has no advantage over Postgres for this schema |
| **SQLite + Litestream** | Near-zero change, with continuous backup to S3 | Adds an extra process, and still isn't multi-writer |

For a NAS or home-server deploy, embedded SQLite with documented backups is the rational choice. For a public SaaS product, plan for Postgres from the start.

---

## Recommendation

### Today (2026)

**Stay on SQLite**, with these three items non-negotiable:

1. **WAL mode** enabled (already typical for `better-sqlite3` apps).
2. **Automated backups** of `fashion_monitor.db` — a cron job plus an off-site copy, or Litestream.
3. **Never expose the database file** directly — only the API. This is already how the app is built.

SQLite matches the deployment model here — a single container, cron-driven scrapers, and a read-only Grafana mount — and keeps the monorepo simple.

### Migration triggers → PostgreSQL

Move to Postgres once any of these become true:

| Trigger | Why Postgres |
| --- | --- |
| A second concurrent **writer** process (multi-worker scrape, active-active web) | SQLite's writer lock becomes painful |
| **More than 3 web instances**, or Kubernetes replicas | A shared SQLite file becomes unsafe; you need a networked database |
| Audit or compliance requirements demand **PITR, replication, or DBA attestations** | Managed Postgres provides these |
| Integration and run history pass **roughly 10 million rows**, with dashboard queries slowing down | JSONB plus Timescale, or table partitioning, solve this |
| The team wants a **remote database** decoupled from the app host | Neon or Supabase provide this |

### Migration triggers → NoSQL

**None**, for the primary store. Redis could be added later for rate limiting or job queues — but never as a replacement for the monitors, runs, or audit tables.

### A middle step before Postgres, if you want one

- **Litestream** or **LiteFS** add replication or backup without a schema migration.
- **DuckDB** works for offline analytics exports, not for live transactional workloads.

---

## Summary table

| Technology | fashion-monitor today | Primary store? |
| --- | --- | --- |
| SQLite | **Recommended** | Yes |
| PostgreSQL | Plan for it at multi-instance / HA scale | Yes (future) |
| Turso/libSQL | Optional edge replica | Yes (SQLite-compatible) |
| DuckDB | Analytics sidecar only | No |
| MongoDB / Redis | Wrong fit | No |
| ClickHouse / Loki | Overkill until telemetry volume is huge | No (metrics adjunct) |

**Bottom line:** SQLite is the appropriate tool for this app today. If this app's profile ever needs a better option, that option is Postgres — once operational requirements outgrow a single file — plus backup discipline while you remain on SQLite. NoSQL is not that option.
