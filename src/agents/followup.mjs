import { BaseAgent } from "./base.mjs";

/**
 * Follow-up agent: finds applications that are due a follow-up (status
 * "Applied", older than `followupDays`, under the follow-up cap) and drafts a
 * short, polite email. Human-in-the-loop: drafts only, never sends.
 */
const FOLLOWUP_DAYS = 7;
const MAX_FOLLOWUPS = 3;

export class FollowupAgent extends BaseAgent {
  constructor(options = {}) {
    super({ name: "followup", description: "Drafts follow-up emails for applied roles" });
    this.followupDays = options.followupDays ?? FOLLOWUP_DAYS;
    this.maxFollowups = options.maxFollowups ?? MAX_FOLLOWUPS;
    this.now = options.now || (() => new Date());
  }

  /**
   * @param {object} context - { applications: trackerRows[], provider }
   */
  async execute(context = {}) {
    this._setRunning();
    try {
      const { applications = [], provider = null } = context;
      const today = this.now();
      const results = [];
      for (const app of applications) {
        if (!this._needsFollowup(app, today)) continue;
        try {
          const draft = await this._draft(app, provider);
          results.push({ company: company(app), title: title(app), draft, success: true });
        } catch (error) {
          results.push({ company: company(app), title: title(app), error: error.message, success: false });
        }
      }
      this._setComplete();
      return {
        results,
        draftsCreated: results.filter((r) => r.success).length,
        totalChecked: applications.length,
      };
    } catch (error) {
      this._setError(error);
      throw error;
    }
  }

  _needsFollowup(app, today) {
    if ((app.Status || app.status) !== "Applied") return false;
    const dateApplied = app["Date Applied"] || app.dateApplied;
    if (!dateApplied) return false;
    const days = Math.floor((today - new Date(dateApplied)) / 86400000);
    if (Number.isNaN(days) || days < this.followupDays) return false;
    const notes = app["Follow Up Notes"] || app.followUpNotes || "";
    const count = (notes.match(/follow-up/gi) || []).length;
    return count < this.maxFollowups;
  }

  async _draft(app, provider) {
    const role = title(app);
    const org = company(app);
    if (!provider) {
      return {
        subject: `Following up: ${role} application`,
        body: `Hi,\n\nI wanted to follow up on my application for the ${role} role at ${org}. I remain very interested and would welcome the chance to discuss how my experience fits your needs.\n\nBest regards`,
        note: "Template (no LLM). Customize before sending.",
      };
    }
    const body = await provider.complete(
      `Draft a brief, professional follow-up email (under 150 words) for a job application.
Role: ${role}
Company: ${org}
Applied on: ${app["Date Applied"] || app.dateApplied}
Be polite, express continued interest, and ask about next steps.`,
      { temperature: 0.5, maxTokens: 512 },
    );
    return { subject: `Following up: ${role} application`, body };
  }
}

function company(app) {
  return app.Company || app.company || "";
}
function title(app) {
  return app["Job Title"] || app.title || "";
}
