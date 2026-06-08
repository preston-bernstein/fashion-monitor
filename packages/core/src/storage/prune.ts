import type { Db } from "./db.js";

export function pruneOlderThan(
  db: Db,
  sql: string,
  params: (string | number)[],
  days: number,
  now: Date,
): number {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const result = db.prepare(sql).run(cutoff.toISOString(), ...params);
  return result.changes;
}
