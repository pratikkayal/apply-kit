#!/usr/bin/env node
/**
 * applykit-apply — run the orchestration pipeline for a user.
 *
 * Usage:
 *   node bin/apply.mjs --user <id> [--provider openai|anthropic|bedrock|kiro|local]
 *
 * Offline-first: the scanner does no network work unless APPLYKIT_SCANNER_OFFLINE=0
 * and targets are configured. With no targets this performs a clean no-op run
 * that still exercises the full state machine — useful as a smoke test.
 */
import { ProfileStore } from "../src/profile/store.mjs";
import { Orchestrator } from "../src/core/orchestrator.mjs";
import { Pipeline } from "../src/core/pipeline.mjs";
import { createProvider } from "../src/providers/index.mjs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--user") args.user = argv[++i];
    else if (argv[i] === "--provider") args.provider = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.user) {
  process.stderr.write("Usage: node bin/apply.mjs --user <id> [--provider <name>]\n");
  process.exit(1);
}

try {
  const store = new ProfileStore();
  const profile = store.loadProfile(args.user);
  const tracker = store.tracker(args.user);

  // Provider is optional; only constructed if requested or configured.
  let provider = null;
  const providerName = args.provider || profile.preferences?.provider || process.env.LLM_PROVIDER;
  if (providerName) {
    try {
      provider = createProvider(providerName);
    } catch (e) {
      process.stderr.write(`(provider "${providerName}" unavailable: ${e.message})\n`);
    }
  }

  const orchestrator = new Orchestrator({
    provider,
    pipeline: new Pipeline({ statePath: path.join(store.userDir(args.user), "pipeline-state.json") }),
  });
  orchestrator
    .on("stage_start", ({ stage }) => process.stdout.write(`[apply] start: ${stage}\n`))
    .on("stage_complete", ({ stage }) => process.stdout.write(`[apply] done:  ${stage}\n`))
    .on("pipeline_error", ({ error }) => process.stderr.write(`[apply] error: ${error}\n`));

  const result = await orchestrator.run({ profile, tracker, targets: {}, provider });
  process.stdout.write(`\nPipeline complete. Stages: ${Object.keys(result.stages).join(", ")}\n`);
} catch (error) {
  process.stderr.write(`Pipeline failed: ${error.message}\n`);
  process.exitCode = 1;
}
