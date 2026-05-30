#!/usr/bin/env node
/**
 * applykit-onboard — interview a new person and save their profile.
 *
 * Usage:
 *   node bin/onboard.mjs [--user <id>] [--demo]
 *
 *   --user <id>   explicit user id (otherwise derived from the entered name)
 *   --demo        run non-interactively with a synthetic answer set (no PII)
 */
import { ReadlinePrompter, ScriptedPrompter } from "../src/onboarding/prompter.mjs";
import { runIntake } from "../src/onboarding/intake.mjs";
import { demoAnswers } from "../src/onboarding/questions.mjs";
import { ProfileStore } from "../src/profile/store.mjs";

function parseArgs(argv) {
  const args = { demo: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--user") args.user = argv[++i];
    else if (argv[i] === "--demo") args.demo = true;
  }
  return args;
}

/** Read all of stdin (used for piped, non-interactive onboarding). */
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

const args = parseArgs(process.argv.slice(2));
const store = new ProfileStore();

let prompter;
if (args.demo) {
  // Non-interactive synthetic run.
  prompter = new ScriptedPrompter({ answers: demoAnswers(), onNote: (t) => process.stdout.write(`${t}\n`) });
} else if (process.stdin.isTTY) {
  // Real terminal: interactive prompts.
  prompter = new ReadlinePrompter();
} else {
  // Piped/non-interactive: consume one line per prompt, in order. This is the
  // robust, scriptable path (readline-over-pipe is unreliable).
  const lines = (await readStdin()).split(/\r?\n/);
  // Drop a single trailing empty line introduced by a final newline.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  prompter = new ScriptedPrompter({
    queue: lines,
    failOnExhaustion: true,
    onNote: (t) => process.stdout.write(`${t}\n`),
  });
}

try {
  const { userId, profilePath } = await runIntake({ prompter, store, userId: args.user });
  process.stdout.write(`\nProfile written: ${profilePath}\n`);
  process.stdout.write(`Tracker:         ${store.trackerPath(userId)}\n`);
  process.stdout.write(`Workspace:       ${store.userDir(userId)}\n`);
} catch (error) {
  process.stderr.write(`Onboarding failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  prompter.close?.();
}
