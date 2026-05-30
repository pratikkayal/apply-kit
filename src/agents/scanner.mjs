import { BaseAgent } from "./base.mjs";

/**
 * Scanner agent: discovers postings from standard ATS JSON APIs
 * (Greenhouse, Ashby, Lever) listed in a user's targets config.
 *
 * Offline-first: defaults to offline (no network) so dev, CI, and tests are
 * deterministic. Set `offline: false` (or APPLYKIT_SCANNER_OFFLINE=0) to enable
 * live fetches. There is intentionally no headless-browser scraping in this
 * generalized build.
 */
export class ScannerAgent extends BaseAgent {
  constructor(options = {}) {
    super({ name: "scanner", description: "Discovers postings from configured ATS portals" });
    const envOffline = process.env.APPLYKIT_SCANNER_OFFLINE;
    this.offline = options.offline ?? (envOffline === undefined ? true : envOffline !== "0");
    // Injectable fetcher for tests; defaults to global fetch.
    this._fetch = options.fetch || ((...args) => fetch(...args));
  }

  /**
   * @param {object} context - { targets: { companies: [{name, ats, org|apiUrl, enabled}] }, filters }
   */
  async execute(context = {}) {
    this._setRunning();
    try {
      if (this.offline) {
        this._setComplete();
        return { discovered: [], count: 0, offline: true };
      }

      const companies = context.targets?.companies || [];
      const discovered = [];
      for (const company of companies) {
        if (company.enabled === false) continue;
        try {
          const jobs = await this._fetchCompany(company);
          for (const job of jobs) {
            discovered.push({ company: company.name, source: "scanner", ...job });
          }
        } catch (error) {
          discovered.push({ company: company.name, error: error.message, source: "scanner" });
        }
      }
      this._setComplete();
      return { discovered, count: discovered.filter((d) => !d.error).length };
    } catch (error) {
      this._setError(error);
      throw error;
    }
  }

  async _fetchCompany(company) {
    switch ((company.ats || "").toLowerCase()) {
      case "greenhouse":
        return this._greenhouse(company.apiUrl || `https://boards-api.greenhouse.io/v1/boards/${company.org}/jobs`);
      case "ashby":
        return this._ashby(company.org);
      case "lever":
        return this._lever(company.org);
      default:
        throw new Error(`unsupported ats "${company.ats}" for ${company.name}`);
    }
  }

  async _json(url) {
    const res = await this._fetch(url, { headers: { "User-Agent": "applykit-scanner/1.0" } });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    return res.json();
  }

  async _greenhouse(apiUrl) {
    const data = await this._json(apiUrl);
    return (data.jobs || []).map((j) => ({
      title: j.title,
      url: j.absolute_url,
      location: j.location?.name || "",
      department: (j.departments || []).map((d) => d.name).join(", "),
    }));
  }

  async _ashby(org) {
    const data = await this._json(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`);
    return (data.jobs || []).map((j) => ({
      title: j.title,
      url: j.jobUrl || `https://jobs.ashbyhq.com/${org}/${j.id}`,
      location: j.location || "",
      department: j.department || j.team || "",
    }));
  }

  async _lever(org) {
    const jobs = await this._json(`https://api.lever.co/v0/postings/${org}`);
    return (jobs || []).map((j) => ({
      title: j.text,
      url: j.hostedUrl,
      location: j.categories?.location || "",
      department: j.categories?.team || "",
    }));
  }
}
