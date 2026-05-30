#!/usr/bin/env node
/**
 * applykit-resume — generate a grounded Markdown resume for a user.
 *
 * Usage:
 *   node bin/resume.mjs --user <id> [--company "Acme"] [--title "Role"] \
 *        [--jd <path-to-job-description.txt>] [--out <path.md>]
 *
 * Reads the user's profile, builds a grounded ResumeSpec, validates it, and
 * writes Markdown (to --out or stdout).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { ProfileStore } from "../src/profile/store.mjs";
import { createEmptyProfile, mergeProfile } from "../src/profile/schema.mjs";
import { generateResume } from "../src/resume/builder.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--user") args.user = argv[++i];
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--company") args.company = argv[++i];
    else if (a === "--title") args.title = argv[++i];
    else if (a === "--jd") args.jd = argv[++i];
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.user && !args.profile) {
  process.stderr.write("Usage: node bin/resume.mjs (--user <id> | --profile <path.yml>) [--company X] [--title Y] [--jd path] [--out path.md]\n");
  process.exit(1);
}

try {
  const profile = args.profile
    ? mergeProfile(createEmptyProfile(), YAML.parse(readFileSync(args.profile, "utf8")) || {})
    : new ProfileStore().loadProfile(args.user);
  const description = args.jd ? readFileSync(args.jd, "utf8") : "";
  const { markdown } = generateResume({
    profile,
    job: { company: args.company || "", title: args.title || "", description },
  });

  if (args.out) {
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, markdown, "utf8");
    process.stdout.write(`Resume written: ${args.out}\n`);
  } else {
    process.stdout.write(markdown);
  }
} catch (error) {
  process.stderr.write(`Resume generation failed: ${error.message}\n`);
  process.exitCode = 1;
}
