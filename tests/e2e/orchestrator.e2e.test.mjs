import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Orchestrator } from "../../src/core/orchestrator.mjs";
import { Pipeline } from "../../src/core/pipeline.mjs";
import { ScannerAgent } from "../../src/agents/scanner.mjs";
import { FollowupAgent } from "../../src/agents/followup.mjs";
import { CsvTracker } from "../../src/tracker/csv.mjs";
import { createEmptyProfile, mergeProfile } from "../../src/profile/schema.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "applykit-orch-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function profile() {
  return mergeProfile(createEmptyProfile(), {
    identity: { name: "Alex Doe", email: "alex@example.com", location: "Remote" },
    summary: "Backend engineer who ships reliable services.",
    targetRoles: ["Backend Engineer"],
    skills: ["Node.js", "PostgreSQL"],
    experience: [
      { company: "Globex", role: "Engineer", period: "2021-Present", context: "Payments", bullets: ["Built API"] },
    ],
    education: [{ institution: "State U", degree: "B.S.", field: "CS", period: "2013-2017" }],
    preferences: { scoring: { positive: { backend: 1.5 } } },
  });
}

/** A scanner stubbed to return canned discoveries (no network). */
function fakeScanner(jobs) {
  const s = new ScannerAgent({ offline: false });
  s._fetchCompany = async () => jobs;
  return s;
}

describe("orchestrator e2e", () => {
  it("runs all five stages, drives the FSM idle->...->idle, and emits events", async () => {
    const events = [];
    const pipeline = new Pipeline({ statePath: path.join(dir, "state.json") });
    const orchestrator = new Orchestrator({ pipeline, scanner: new ScannerAgent({ offline: true }) });
    orchestrator.on("stage_complete", ({ stage }) => events.push(stage));

    const result = await orchestrator.run({ profile: profile(), targets: {} });

    assert.deepEqual(Object.keys(result.stages), [
      "scanning",
      "evaluating",
      "generating_materials",
      "application_prep",
      "followup",
    ]);
    assert.deepEqual(events, ["scanning", "evaluating", "generating_materials", "application_prep", "followup"]);
    assert.equal(pipeline.getState().state, "idle");
    assert.ok(result.completedAt);
  });

  it("discovers, scores, persists fit scores to the tracker, and generates grounded resumes", async () => {
    const trackerPath = path.join(dir, "tracker.csv");
    const tracker = new CsvTracker({ path: trackerPath });
    tracker.bootstrap();
    // Seed a tracker row whose Job URL matches a discovered job.
    tracker.appendRow({ Company: "Globex", "Job URL": "https://globex/jobs/1", Status: "Discovered" });

    const discovered = [
      {
        company: "Globex",
        title: "Senior Backend Engineer",
        url: "https://globex/jobs/1",
        location: "Remote",
        description: "x".repeat(500) + " backend node.js postgresql",
      },
    ];

    const orchestrator = new Orchestrator({
      pipeline: new Pipeline({ statePath: path.join(dir, "state.json") }),
      scanner: fakeScanner(discovered),
    });

    const result = await orchestrator.run({ profile: profile(), targets: { companies: [{ name: "Globex" }] }, tracker });

    // evaluation persisted a fit score back to the matching tracker row
    assert.ok(result.stages.evaluating.scoresPersisted >= 1);
    const row = tracker.readAll().find((r) => r["Job URL"] === "https://globex/jobs/1");
    assert.ok(Number(row["Fit Score"]) > 0, `expected a fit score, got ${row["Fit Score"]}`);
    assert.ok(row.Band);

    // a grounded resume was generated for the qualified job
    const mat = result.stages.generating_materials.materials.find((m) => m.success);
    assert.ok(mat, "expected a successful resume");
    assert.match(mat.resumeMarkdown, /# Alex Doe/);
  });

  it("prepares a cover letter via the provider and drafts follow-ups", async () => {
    const calls = [];
    const provider = {
      async complete(prompt) {
        calls.push(prompt);
        return "Dear hiring team, ...";
      },
    };
    const trackerPath = path.join(dir, "tracker.csv");
    const tracker = new CsvTracker({ path: trackerPath });
    tracker.bootstrap();
    // An old "Applied" row should trigger a follow-up draft.
    tracker.appendRow({
      Company: "Globex",
      "Job Title": "Engineer",
      "Job URL": "https://globex/jobs/9",
      Status: "Applied",
      "Date Applied": "2026-01-01",
    });

    const discovered = [
      { company: "Globex", title: "Backend Engineer", url: "https://globex/jobs/2", location: "Remote", description: "x".repeat(500) + " backend" },
    ];
    const orchestrator = new Orchestrator({
      pipeline: new Pipeline({ statePath: path.join(dir, "state.json") }),
      scanner: fakeScanner(discovered),
      provider,
    });

    const result = await orchestrator.run({ profile: profile(), targets: { companies: [{ name: "Globex" }] }, tracker, provider });

    assert.ok(result.stages.application_prep.prepared >= 1);
    assert.ok(calls.length >= 1, "provider.complete should have been called for the cover letter");
    assert.ok(result.stages.followup.draftsCreated >= 1, "an old applied row should yield a follow-up draft");
  });

  it("transitions to error and rethrows when a stage throws", async () => {
    const boom = new ScannerAgent({ offline: true });
    boom.execute = async () => {
      throw new Error("scan exploded");
    };
    const pipeline = new Pipeline({ statePath: path.join(dir, "state.json") });
    const orchestrator = new Orchestrator({ pipeline, scanner: boom });

    await assert.rejects(() => orchestrator.run({ profile: profile() }), /scan exploded/);
    assert.equal(pipeline.getState().state, "error");
  });

  it("records error in the FSM when a POST-ready stage (followup) throws", async () => {
    // Regression test: application_prep/followup run after the `ready` state.
    // The FSM must be able to record their failure (ready/applying/following_up
    // -> error) instead of leaving a success-shaped `ready` persisted.
    const followup = new FollowupAgent();
    followup.execute = async () => {
      throw new Error("followup exploded");
    };
    const pipeline = new Pipeline({ statePath: path.join(dir, "state.json") });
    const orchestrator = new Orchestrator({
      pipeline,
      scanner: new ScannerAgent({ offline: true }),
      followup,
    });

    await assert.rejects(() => orchestrator.run({ profile: profile() }), /followup exploded/);
    assert.equal(pipeline.getState().state, "error", "a late-stage failure must persist as error, not ready");
  });
});
