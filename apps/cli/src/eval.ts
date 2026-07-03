#!/usr/bin/env node
import { openDatabase } from "@fm/core/storage/db.js";
import { createProviderFromConfig } from "@fm/core/llm/factory.js";
import { runEvalHarness, type EvalReport } from "@fm/core/eval/harness.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { loadCliConfig } from "./config.js";
import { parseEvalArgs } from "./args.js";

const log = createLogger("cli.eval");

function formatReport(report: EvalReport): string {
  const { confusion } = report;
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

  const lines = [
    `Taste revision: id=${report.revisionId} recorded_at=${report.revisionRecordedAt}`,
    `Provider: ${report.provider}`,
    `Items evaluated: ${report.itemsEvaluated} (skipped: ${report.itemsSkipped})`,
    "",
    `Confusion matrix (verdict=YES vs feedback=positive):`,
    `  TP=${confusion.truePositive}  FP=${confusion.falsePositive}  FN=${confusion.falseNegative}  TN=${confusion.trueNegative}  N=${confusion.n}`,
    `  precision=${pct(confusion.precision)}  recall=${pct(confusion.recall)}`,
    "",
    "Items:",
    ...report.items.map(
      (item) =>
        `  [${item.correct ? "ok" : "MISS"}] ${item.verdict.padEnd(5)} vs ${item.signal.padEnd(8)} ` +
        `${item.listingId}  "${item.title}"  (query=${item.sourceQueryId ?? "-"})`,
    ),
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "eval" });
  const { configPath, revisionId, provider: providerOverride, limit } = parseEvalArgs(
    process.argv.slice(2),
  );
  const config = loadCliConfig(configPath);
  const db = openDatabase(config.database.path);

  try {
    const llmConfig = providerOverride
      ? { ...config.llm, provider: providerOverride as typeof config.llm.provider }
      : config.llm;
    const provider = createProviderFromConfig(llmConfig);

    const report = await runEvalHarness({
      db,
      config,
      profileId: config.profile_id,
      provider,
      revisionId,
      limit,
    });

    console.log(formatReport(report));
    log.info(LogEvents.CliEvalComplete, {
      profileId: config.profile_id,
      revisionId: report.revisionId,
      itemsEvaluated: report.itemsEvaluated,
      provider: report.provider,
    });
  } finally {
    db.close();
  }
}

main().catch((err) => {
  log.error(LogEvents.CliEvalFailed, {
    error: err instanceof Error ? err.message : "unknown",
  });
  process.exit(1);
});
