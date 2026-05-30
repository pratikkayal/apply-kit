import { BaseAgent } from "./base.mjs";

/**
 * Application agent: prepares application *materials* (a tailored cover letter
 * draft, grounded in the user's profile) using the LLM provider.
 *
 * Strictly human-in-the-loop: it never submits anything. There is no browser
 * automation in this generalized build.
 */
export class ApplicationAgent extends BaseAgent {
  constructor() {
    super({ name: "application", description: "Prepares cover letters / materials (no auto-submit)" });
  }

  /**
   * @param {object} context - { jobs, provider, profile }
   */
  async execute(context = {}) {
    this._setRunning();
    try {
      const { jobs = [], provider = null, profile = {} } = context;
      const ready = jobs.filter((job) => job.status === "Ready to Apply" || job.resumePath || job.qualified);
      const results = [];
      for (const job of ready) {
        try {
          const materials = await this._prepare(job, provider, profile);
          results.push({ company: job.company, title: job.title, materials, success: true });
        } catch (error) {
          results.push({ company: job.company, title: job.title, error: error.message, success: false });
        }
      }
      this._setComplete();
      return {
        results,
        prepared: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      };
    } catch (error) {
      this._setError(error);
      throw error;
    }
  }

  async _prepare(job, provider, profile) {
    if (!provider) {
      return { coverLetter: null, note: "No LLM provider configured; skipping cover-letter generation." };
    }
    const name = profile.identity?.name || "Candidate";
    const skills = (profile.skills || []).slice(0, 8).join(", ") || "relevant skills";
    const prompt = `Write a concise, professional cover letter (under 300 words) for this role.
Do NOT invent experience; rely only on the candidate facts provided.

Candidate: ${name}
Key skills: ${skills}
Role: ${job.title} at ${job.company}
Location: ${job.location || "Not specified"}

Job description excerpt:
${(job.description || "").slice(0, 2000)}`;
    const coverLetter = await provider.complete(prompt, { temperature: 0.6, maxTokens: 1024 });
    return { coverLetter };
  }
}
