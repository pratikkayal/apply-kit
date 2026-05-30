import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Enforced invariant: no personal data from the source repository may leak into
 * this generalized codebase. This greps all git-tracked files for identifiers
 * tied to the original single-user project and fails on any match.
 *
 * If onboarding ever writes real user data, it lands under the gitignored
 * /data/ directory and is therefore never tracked — so this guard stays green.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Identifiers from the source project that must never appear here.
const FORBIDDEN = [
  "Pratik",
  "Kayal",
  "master-profile.yml",
  "career-ops",
  "+316", // source resume hard-coded a personal phone prefix
];

describe("no personal data leakage", () => {
  it("contains none of the source project's personal identifiers in tracked files", () => {
    const offenders = [];
    for (const term of FORBIDDEN) {
      try {
        // --untracked + --exclude-standard: search tracked AND
        // untracked-but-not-ignored files, so the guard works before the first
        // commit while still excluding node_modules/ and /data/ (gitignored).
        // The pathspec exclusion skips this guard file, which names the tokens.
        const out = execFileSync(
          "git",
          [
            "grep",
            "-l",
            "-F",
            "-i",
            "--untracked",
            "--exclude-standard",
            term,
            "--",
            ".",
            ":!tests/unit/no-personal-data.test.mjs",
          ],
          { cwd: REPO_ROOT, encoding: "utf8" },
        );
        if (out.trim()) offenders.push({ term, files: out.trim().split("\n") });
      } catch (err) {
        // git grep exits 1 when there are no matches — that's the success case.
        if (err.status !== 1) throw err;
      }
    }

    assert.deepEqual(offenders, [], `personal data leaked: ${JSON.stringify(offenders, null, 2)}`);
  });
});
