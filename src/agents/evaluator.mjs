import { BaseAgent } from "./base.mjs";

/**
 * Config-driven evaluator.
 *
 * Unlike the source (which hard-coded one person's location/role weights), all
 * scoring signal here comes from the *user's* profile:
 *   - positive/negative term weights and company bonuses from
 *     `profile.preferences.scoring`
 *   - additional positive terms derived from `profile.targetRoles`
 *   - location allow/block from `profile.preferences.locations`
 *
 * Scores are clamped to 0..5 and mapped to fit bands. An optional LLM pass can
 * refine the score for shortlisted jobs when a provider is supplied.
 */

const BASE_SCORE = 2.0;
const DERIVED_ROLE_WEIGHT = 1.5;

export class EvaluatorAgent extends BaseAgent {
  constructor(options = {}) {
    super({ name: "evaluator", description: "Scores jobs from user-configured signal" });
    this.scoreThreshold = options.scoreThreshold ?? 3.0;
    this.useLLM = options.useLLM ?? false;
  }

  /**
   * @param {object} context - { jobs, profile, provider }
   */
  async execute(context = {}) {
    this._setRunning();
    try {
      const { jobs = [], profile = {}, provider = null } = context;
      const scoring = buildScoringConfig(profile);
      const evaluated = [];

      for (const job of jobs) {
        const result = scoreJob(job, scoring, this.scoreThreshold);
        let llmEvaluation = null;
        if (this.useLLM && provider && result.score >= this.scoreThreshold) {
          try {
            llmEvaluation = await llmEvaluate(job, profile, provider);
          } catch {
            // LLM refinement is best-effort.
          }
        }
        evaluated.push({ ...job, ...result, llmEvaluation });
      }

      evaluated.sort((a, b) => b.score - a.score);
      this._setComplete();
      return {
        evaluated,
        totalCount: evaluated.length,
        qualifiedCount: evaluated.filter((j) => j.score >= this.scoreThreshold).length,
      };
    } catch (error) {
      this._setError(error);
      throw error;
    }
  }
}

/**
 * Build an effective scoring config from a user's profile. Derives positive
 * terms from target roles, then layers explicit preferences on top.
 * @param {object} profile
 * @returns {{ positive: Map, negative: Map, companyBonus: Map, locations: object }}
 */
export function buildScoringConfig(profile = {}) {
  const positive = new Map();
  const negative = new Map();
  const companyBonus = new Map();

  for (const role of profile.targetRoles || []) {
    for (const term of tokenize(role)) {
      // Allow 2-char acronyms (AI, ML, QA, UX); skip 1-char noise.
      if (term.length < 2) continue;
      positive.set(term, Math.max(positive.get(term) || 0, DERIVED_ROLE_WEIGHT));
    }
  }

  const scoring = profile.preferences?.scoring || {};
  for (const [term, weight] of Object.entries(scoring.positive || {})) {
    const n = Number(weight);
    if (Number.isFinite(n)) positive.set(term.toLowerCase(), n);
  }
  for (const [term, weight] of Object.entries(scoring.negative || {})) {
    const n = Number(weight);
    if (Number.isFinite(n)) negative.set(term.toLowerCase(), n);
  }
  for (const [company, weight] of Object.entries(scoring.companyBonus || {})) {
    const n = Number(weight);
    if (Number.isFinite(n)) companyBonus.set(company, n);
  }

  return {
    positive,
    negative,
    companyBonus,
    locations: profile.preferences?.locations || { allow: [], block: [] },
  };
}

/**
 * Score a single job against a scoring config.
 * @param {object} job
 * @param {object} scoring - from buildScoringConfig
 * @param {number} [threshold=3.0] - qualification threshold
 * @returns {{ score:number, band:string, reasons:string[], qualified:boolean }}
 */
export function scoreJob(job, scoring, threshold = 3.0) {
  const haystack = `${job.company || ""} ${job.title || ""} ${job.location || ""} ${job.department || ""} ${job.description || ""}`.toLowerCase();
  let score = BASE_SCORE;
  const reasons = [];

  for (const [term, weight] of scoring.positive) {
    if (haystack.includes(term)) {
      score += weight;
      if (weight >= 0.8) reasons.push(`+${term}`);
    }
  }
  for (const [term, weight] of scoring.negative) {
    if (haystack.includes(term)) {
      score += weight; // weights are negative
      reasons.push(term);
    }
  }
  const bonus = scoring.companyBonus.get(job.company) || 0;
  if (bonus) {
    score += bonus;
    reasons.push(`+company:${job.company}`);
  }

  // Location block is a hard penalty; allow-list is a soft bonus.
  const loc = (job.location || "").toLowerCase();
  if (loc) {
    if ((scoring.locations.block || []).some((t) => loc.includes(String(t).toLowerCase()))) {
      score -= 2.0;
      reasons.push("location-blocked");
    } else if ((scoring.locations.allow || []).some((t) => loc.includes(String(t).toLowerCase()))) {
      score += 0.8;
      reasons.push("+location-allowed");
    }
  }

  if (!job.description || job.description.length < 400) {
    score -= 0.8;
    reasons.push("thin-jd");
  }

  score = Math.max(0, Math.min(5, Math.round(score * 10) / 10));
  return { score, band: fitBand(score), reasons, qualified: score >= threshold };
}

export function fitBand(score) {
  if (score >= 4.5) return "A";
  if (score >= 4.0) return "B";
  if (score >= 3.4) return "C";
  if (score >= 2.8) return "D";
  return "Skip";
}

/**
 * Format a fit score to 1 decimal place, truncating (never rounding up) so a
 * displayed value never overstates fit. A small epsilon absorbs binary
 * floating-point error before truncation.
 * @param {number|string} score
 * @returns {string}
 */
export function format1dp(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "0.0";
  return (Math.floor(n * 10 + 1e-9) / 10).toFixed(1);
}

/**
 * Persist an evaluated job's fit score + band to a tracker, keyed by job URL.
 * Tracker-only update (human-in-the-loop); never submits anything. Returns
 * false when the URL is missing or no row matches.
 * @param {object} evaluatedJob - { url|"Job URL", score, band }
 * @param {{ updateRow: Function }} tracker
 * @returns {boolean}
 */
export function persistScore(evaluatedJob, tracker) {
  if (!evaluatedJob || !tracker || typeof tracker.updateRow !== "function") return false;
  const jobUrl = evaluatedJob.url || evaluatedJob["Job URL"] || "";
  if (!jobUrl) return false;
  return tracker.updateRow(jobUrl, {
    "Fit Score": format1dp(evaluatedJob.score),
    Band: evaluatedJob.band ?? "",
  });
}

async function llmEvaluate(job, profile, provider) {
  const roles = (profile.targetRoles || []).join(", ") || "the candidate's target roles";
  const prompt = `Evaluate this job for a candidate targeting: ${roles}. Score 1-5 and explain fit in 2 sentences.

Company: ${job.company}
Title: ${job.title}
Location: ${job.location || ""}
Description excerpt: ${(job.description || "").slice(0, 1500)}`;
  const schema = {
    type: "object",
    properties: { score: { type: "number" }, reasoning: { type: "string" } },
  };
  return provider.structured(prompt, schema);
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter(Boolean);
}
