import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EvaluatorAgent,
  buildScoringConfig,
  scoreJob,
  fitBand,
  format1dp,
  persistScore,
} from "../../src/agents/evaluator.mjs";

const profile = {
  targetRoles: ["Senior Backend Engineer"],
  preferences: {
    locations: { allow: ["remote"], block: ["onsite-only"] },
    scoring: {
      positive: { postgres: 1.0 },
      negative: { intern: -4.0 },
      companyBonus: { Globex: 1.0 },
    },
  },
};

describe("buildScoringConfig", () => {
  it("derives positive terms from target roles and layers preferences", () => {
    const cfg = buildScoringConfig(profile);
    assert.ok(cfg.positive.has("backend")); // derived from target role
    assert.ok(cfg.positive.has("engineer"));
    assert.equal(cfg.positive.get("postgres"), 1.0); // explicit
    assert.equal(cfg.negative.get("intern"), -4.0);
    assert.equal(cfg.companyBonus.get("Globex"), 1.0);
  });

  it("keeps 2-char acronyms from target roles (AI, ML, QA)", () => {
    const cfg = buildScoringConfig({ targetRoles: ["ML Engineer", "AI Researcher"] });
    assert.ok(cfg.positive.has("ml"));
    assert.ok(cfg.positive.has("ai"));
  });

  it("drops non-numeric scoring weights instead of producing NaN", () => {
    const cfg = buildScoringConfig({
      preferences: { scoring: { positive: { good: "not-a-number", solid: 1.2 } } },
    });
    assert.equal(cfg.positive.has("good"), false);
    assert.equal(cfg.positive.get("solid"), 1.2);
    // and a job scored against it never yields NaN
    const r = scoreJob({ title: "solid role", description: "x".repeat(500) }, cfg);
    assert.ok(Number.isFinite(r.score));
  });
});

describe("scoreJob", () => {
  it("scores a strong match highly and a poor match low", () => {
    const cfg = buildScoringConfig(profile);
    const strong = scoreJob(
      {
        company: "Globex",
        title: "Senior Backend Engineer",
        location: "Remote",
        description: "x".repeat(500) + " postgres backend",
      },
      cfg,
    );
    const weak = scoreJob(
      { company: "Other", title: "Marketing Intern", location: "Onsite-only", description: "short" },
      cfg,
    );
    assert.ok(strong.score > weak.score);
    assert.equal(strong.qualified, true);
    assert.equal(weak.qualified, false);
    assert.ok(strong.reasons.includes("+company:Globex"));
  });

  it("applies a hard penalty for blocked locations and clamps to 0..5", () => {
    const cfg = buildScoringConfig(profile);
    const r = scoreJob({ company: "X", title: "Intern", location: "Onsite-only", description: "short" }, cfg);
    assert.ok(r.score >= 0 && r.score <= 5);
    assert.ok(r.reasons.includes("location-blocked"));
  });

  it("honors the qualification threshold", () => {
    const cfg = buildScoringConfig(profile);
    // A modest match (one positive term, no role/company/location bonus) scores
    // ~3.0 — qualifies at 3.0 but not at a stricter 4.9 bar; score is identical.
    const job = { company: "Z", title: "Data Analyst", location: "", description: "x".repeat(500) + " postgres" };
    const lenient = scoreJob(job, cfg, 3.0);
    const strict = scoreJob(job, cfg, 4.9);
    assert.equal(lenient.score, strict.score);
    assert.equal(lenient.qualified, true);
    assert.equal(strict.qualified, false); // same score, stricter bar
  });
});

describe("fitBand / format1dp", () => {
  it("maps scores to bands", () => {
    assert.equal(fitBand(4.6), "A");
    assert.equal(fitBand(4.1), "B");
    assert.equal(fitBand(3.5), "C");
    assert.equal(fitBand(2.9), "D");
    assert.equal(fitBand(1.0), "Skip");
  });

  it("truncates rather than rounds up", () => {
    assert.equal(format1dp(4), "4.0");
    assert.equal(format1dp(4.29), "4.2");
    assert.equal(format1dp("nope"), "0.0");
  });
});

describe("persistScore", () => {
  it("updates a tracker row by job URL", () => {
    const updates = [];
    const tracker = { updateRow: (url, u) => (updates.push([url, u]), true) };
    assert.equal(persistScore({ url: "https://a/1", score: 4.25, band: "B" }, tracker), true);
    assert.deepEqual(updates[0], ["https://a/1", { "Fit Score": "4.2", Band: "B" }]);
  });

  it("returns false without a URL or tracker", () => {
    assert.equal(persistScore({ score: 4 }, { updateRow() {} }), false);
    assert.equal(persistScore({ url: "x", score: 4 }, null), false);
  });
});

describe("EvaluatorAgent.execute", () => {
  it("evaluates, sorts by score, and counts qualified", async () => {
    const agent = new EvaluatorAgent();
    const jobs = [
      { company: "Globex", title: "Senior Backend Engineer", location: "Remote", description: "x".repeat(500) + " postgres" },
      { company: "Z", title: "Unpaid Intern", location: "Onsite-only", description: "short" },
    ];
    const out = await agent.execute({ jobs, profile });
    assert.equal(out.evaluated.length, 2);
    assert.ok(out.evaluated[0].score >= out.evaluated[1].score); // sorted desc
    assert.equal(out.qualifiedCount, 1);
  });

  it("calls the LLM only for shortlisted jobs when useLLM is set", async () => {
    let calls = 0;
    const provider = { async structured() { calls += 1; return { score: 5, reasoning: "great" }; } };
    const agent = new EvaluatorAgent({ useLLM: true, scoreThreshold: 3.0 });
    const jobs = [
      { company: "Globex", title: "Senior Backend Engineer", location: "Remote", description: "x".repeat(500) + " postgres" },
      { company: "Z", title: "Unpaid Intern", location: "Onsite-only", description: "short" },
    ];
    const out = await agent.execute({ jobs, profile, provider });
    assert.equal(calls, 1); // only the qualified job
    assert.ok(out.evaluated.find((j) => j.llmEvaluation)?.llmEvaluation.reasoning);
  });
});
