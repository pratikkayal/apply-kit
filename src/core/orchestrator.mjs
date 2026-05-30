import { ScannerAgent } from "../agents/scanner.mjs";
import { EvaluatorAgent, persistScore } from "../agents/evaluator.mjs";
import { ApplicationAgent } from "../agents/application.mjs";
import { FollowupAgent } from "../agents/followup.mjs";
import { generateResume } from "../resume/builder.mjs";
import { Pipeline } from "./pipeline.mjs";

/**
 * Orchestrator: coordinates the five stages through the pipeline state machine.
 *
 *   scan -> evaluate -> generate_materials -> application_prep -> followup
 *
 * Event-driven (subscribe via `on`). Person-agnostic: all candidate signal
 * comes from the `profile` passed in context; the tracker is per-user.
 */
export class Orchestrator {
  constructor(options = {}) {
    this.agents = {
      scanner: options.scanner || new ScannerAgent(),
      evaluator: options.evaluator || new EvaluatorAgent(),
      application: options.application || new ApplicationAgent(),
      followup: options.followup || new FollowupAgent(),
    };
    this.pipeline = options.pipeline || new Pipeline();
    this.provider = options.provider || null;
    this.generateResume = options.generateResume || generateResume;
    this._listeners = {};
  }

  on(event, cb) {
    (this._listeners[event] ||= []).push(cb);
    return this;
  }

  _emit(event, data) {
    for (const cb of this._listeners[event] || []) {
      try {
        cb(data);
      } catch {
        // listener errors never break the pipeline
      }
    }
  }

  /**
   * Run the full pipeline.
   * @param {object} context - { profile, targets, tracker, provider }
   * @returns {Promise<object>} run result with per-stage output
   */
  async run(context = {}) {
    const { profile = {}, targets = {}, tracker = null } = context;
    const provider = context.provider || this.provider;
    const result = { stages: {}, startedAt: new Date().toISOString() };

    this._emit("pipeline_start", { timestamp: result.startedAt });
    this._ensureIdle();

    try {
      // 1. Scan
      this.pipeline.transition("scanning");
      this._emit("stage_start", { stage: "scanning" });
      const scan = await this.agents.scanner.execute({ targets });
      result.stages.scanning = scan;
      this._emit("stage_complete", { stage: "scanning", result: scan });

      // 2. Evaluate
      this.pipeline.transition("evaluating");
      this._emit("stage_start", { stage: "evaluating" });
      const discovered = (scan.discovered || []).filter((d) => !d.error);
      const evaluation = await this.agents.evaluator.execute({ jobs: discovered, profile, provider });
      if (tracker) {
        let persisted = 0;
        for (const job of evaluation.evaluated || []) {
          if (persistScore(job, tracker)) persisted += 1;
        }
        evaluation.scoresPersisted = persisted;
      }
      result.stages.evaluating = evaluation;
      this._emit("stage_complete", { stage: "evaluating", result: evaluation });

      // 3. Generate materials (grounded resume per qualified job)
      this.pipeline.transition("generating_materials");
      this._emit("stage_start", { stage: "generating_materials" });
      const qualified = (evaluation.evaluated || []).filter((j) => j.qualified !== false);
      const materials = [];
      for (const job of qualified) {
        try {
          const { markdown } = this.generateResume({ profile, job });
          materials.push({ company: job.company, title: job.title, resumeMarkdown: markdown, success: true });
        } catch (error) {
          materials.push({ company: job.company, title: job.title, error: error.message, success: false });
        }
      }
      result.stages.generating_materials = { materials, count: materials.filter((m) => m.success).length };
      this._emit("stage_complete", { stage: "generating_materials", result: result.stages.generating_materials });

      this.pipeline.transition("ready");

      // 4. Application prep (cover letters)
      this.pipeline.transition("applying");
      this._emit("stage_start", { stage: "application_prep" });
      const appPrep = await this.agents.application.execute({ jobs: qualified, provider, profile });
      result.stages.application_prep = appPrep;
      this._emit("stage_complete", { stage: "application_prep", result: appPrep });

      // 5. Follow-up
      this.pipeline.transition("following_up");
      this._emit("stage_start", { stage: "followup" });
      const followup = await this.agents.followup.execute({
        applications: tracker?.readAll?.() || [],
        provider,
      });
      result.stages.followup = followup;
      this._emit("stage_complete", { stage: "followup", result: followup });

      this.pipeline.transition("idle");
      result.completedAt = new Date().toISOString();
      this._emit("pipeline_complete", result);
      return result;
    } catch (error) {
      // Record the failure in the persisted FSM. `error` is a legal transition
      // from every running state (scanning/evaluating/generating_materials/
      // ready/applying/following_up), so this should not throw; if it somehow
      // does, surface it rather than masking the original error silently.
      try {
        if (this.pipeline.canTransition("error")) this.pipeline.transition("error");
      } catch (transitionError) {
        result.transitionError = transitionError.message;
      }
      result.error = error.message;
      result.failedAt = new Date().toISOString();
      this._emit("pipeline_error", { error: error.message, result });
      throw error;
    }
  }

  getStatus() {
    return {
      pipeline: this.pipeline.getState(),
      agents: Object.fromEntries(Object.entries(this.agents).map(([k, a]) => [k, a.getStatus()])),
    };
  }

  _ensureIdle() {
    const state = this.pipeline.getState().state;
    if (state !== "idle" && state !== "ready") this.pipeline.reset();
    if (this.pipeline.getState().state === "ready") this.pipeline.transition("idle");
  }
}
