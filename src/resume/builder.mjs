/**
 * Grounded resume builder (Markdown output).
 *
 * Preserves the source project's integrity guarantee — every resume bullet
 * cites evidence in the profile — but is fully person-agnostic and requires no
 * PDF toolchain. The pipeline is:
 *
 *   profile (+ optional job context)
 *     -> fact cards (stable ids + sourcePath evidence refs)
 *     -> ResumeSpec (selected, keyword-aware, every bullet has evidenceRefs)
 *     -> validateResumeSpec (identity-parameterized; rejects placeholders,
 *        unsupported skills, ungrounded bullets)
 *     -> renderMarkdown
 */

const PLACEHOLDER_RE = /\b(lorem ipsum|placeholder)\b/i;
const MAX_BULLET_LENGTH = 280;

/**
 * Build evidence "fact cards" from a profile. Each card has a stable id and a
 * `sourcePath` pointing back into the profile (e.g. experience[0].bullets[1]).
 * @param {object} profile
 * @returns {Array<object>}
 */
export function buildFactCards(profile) {
  const cards = [];
  for (const [ri, role] of (profile.experience || []).entries()) {
    const prefix = cardPrefix(role.company);
    let seq = 1;
    if (role.context) {
      cards.push(card(`${prefix}-${ri}-${pad(seq++)}`, role.context, `experience[${ri}].context`, role));
    }
    for (const [bi, bullet] of (role.bullets || []).entries()) {
      cards.push(card(`${prefix}-${ri}-${pad(seq++)}`, bullet, `experience[${ri}].bullets[${bi}]`, role));
    }
  }
  for (const [pi, pub] of (profile.publications || []).entries()) {
    const claim = [pub.title, pub.venue, pub.summary].filter(Boolean).join(" ");
    cards.push(card(`PUB-${pad(pi + 1)}`, claim, `publications[${pi}]`, { role: "Publication", company: pub.venue || "Publication" }));
  }
  return cards;
}

/**
 * Build a grounded ResumeSpec from a profile and optional job context.
 * @param {object} profile
 * @param {object} [jobContext] - { company, title, text }
 * @param {object} [options] - { maxRoles, maxBulletsPerRole }
 * @returns {object} spec
 */
export function buildResumeSpec(profile, jobContext = {}, options = {}) {
  const maxRoles = options.maxRoles ?? 4;
  const maxBullets = options.maxBulletsPerRole ?? 4;
  const factCards = buildFactCards(profile);
  const cardByPath = new Map(factCards.map((c) => [c.sourcePath, c]));
  const keywords = extractKeywords(jobContext.text || "", profile);

  const experience = (profile.experience || []).slice(0, maxRoles).map((role, ri) => {
    const bullets = (role.bullets || []).slice(0, maxBullets).map((text, bi) => {
      const path = `experience[${ri}].bullets[${bi}]`;
      const ref = cardByPath.get(path);
      return { text, evidenceRefs: ref ? [ref.id] : [] };
    });
    return {
      role: role.role || "",
      company: role.company || "",
      location: role.location || "",
      period: role.period || "",
      context: role.context || "",
      bullets,
    };
  });

  const skillsGrid = rankSkills(profile.skills || [], keywords);

  return {
    identity: profile.identity,
    links: profile.links || {},
    title: jobContext.title || (profile.targetRoles || [])[0] || "",
    company: jobContext.company || "",
    summary: profile.summary || "",
    summaryEvidenceRefs: deriveSummaryRefs(factCards),
    experience,
    skillsGrid,
    supportedSkills: profile.skills || [],
    education: profile.education || [],
    publications: (profile.publications || []).map((p, pi) => ({
      ...p,
      evidenceRefs: [`PUB-${pad(pi + 1)}`].filter((id) => factCards.some((c) => c.id === id)),
    })),
    keywords,
    factCards,
  };
}

/**
 * Validate a ResumeSpec. Throws on the first problem. All identity checks are
 * parameterized by `spec.identity` — there are no hard-coded names.
 *
 * Grounding has real teeth: every experience bullet must (a) reference an
 * existing fact card and (b) have text that exactly matches that card's claim.
 * Because ApplyKit transcribes profile bullets deterministically, this holds
 * for builder output — but it *rejects* any externally-authored or mutated
 * bullet (e.g. a future LLM-authored or hand-edited bullet) that drifts from
 * its cited evidence. That is the anti-fabrication guarantee.
 *
 * Education and publications are optional. Experience is optional too, as long
 * as the spec carries at least one content section (experience, education, or
 * publications), so early-career / career-changer users are supported.
 *
 * @param {object} spec
 * @returns {true}
 */
export function validateResumeSpec(spec) {
  if (!spec || typeof spec !== "object") throw new Error("resume spec must be an object");
  // Always-required, non-empty essentials.
  for (const field of ["identity", "summary", "skillsGrid"]) {
    const v = spec[field];
    if (!v || (Array.isArray(v) && v.length === 0)) throw new Error(`resume spec missing ${field}`);
  }
  if (!spec.identity.name) throw new Error("resume spec identity missing name");
  if (!spec.identity.email) throw new Error("resume spec identity missing email");

  // At least one substantive content section must be present.
  const hasContent =
    (spec.experience || []).length > 0 ||
    (spec.education || []).length > 0 ||
    (spec.publications || []).length > 0;
  if (!hasContent) {
    throw new Error("resume spec needs at least one of experience, education, or publications");
  }

  if (PLACEHOLDER_RE.test(JSON.stringify(spec))) {
    throw new Error("resume spec contains placeholder text (lorem ipsum / PLACEHOLDER)");
  }

  const cardById = new Map((spec.factCards || []).map((c) => [c.id, c]));

  // Summary grounding is required only when evidence exists to ground it
  // (i.e. there are fact cards). A skills/education-only profile has none.
  if ((spec.factCards || []).length > 0) {
    if (!Array.isArray(spec.summaryEvidenceRefs) || spec.summaryEvidenceRefs.length === 0) {
      throw new Error("resume summary missing evidence refs");
    }
    for (const ref of spec.summaryEvidenceRefs) {
      if (!cardById.has(ref)) throw new Error(`resume summary references unknown evidence card: ${ref}`);
    }
  }

  for (const role of spec.experience || []) {
    for (const bullet of role.bullets || []) {
      const text = String(bullet.text || "");
      if (text.length > MAX_BULLET_LENGTH) throw new Error(`resume bullet too long: ${text.slice(0, 60)}...`);
      if (!Array.isArray(bullet.evidenceRefs) || bullet.evidenceRefs.length === 0) {
        throw new Error(`resume bullet missing evidence refs: ${text.slice(0, 60)}...`);
      }
      let grounded = false;
      for (const ref of bullet.evidenceRefs) {
        const refCard = cardById.get(ref);
        if (!refCard) throw new Error(`resume bullet references unknown evidence card: ${ref}`);
        if (String(refCard.claim).trim() === text.trim()) grounded = true;
      }
      // Teeth: the bullet must match the claim of one of its cited cards.
      if (!grounded) {
        throw new Error(`resume bullet is not grounded in its cited evidence: ${text.slice(0, 60)}...`);
      }
    }
  }

  if (Array.isArray(spec.supportedSkills) && spec.supportedSkills.length > 0) {
    const supported = new Set(spec.supportedSkills.map((s) => String(s).toLowerCase()));
    for (const skill of spec.skillsGrid || []) {
      if (!supported.has(String(skill).toLowerCase())) {
        throw new Error(`resume spec contains unsupported skill: ${skill}`);
      }
    }
  }
  return true;
}

/**
 * Render a ResumeSpec to ATS-friendly Markdown.
 * @param {object} spec
 * @returns {string}
 */
export function renderMarkdown(spec) {
  validateResumeSpec(spec);
  const id = spec.identity;
  const contactBits = [id.location, id.email, id.phone, ...linkValues(spec.links)].filter(Boolean);
  const lines = [];

  lines.push(`# ${id.name}`);
  if (spec.title) lines.push(`**${spec.title}**`);
  lines.push("");
  lines.push(contactBits.join(" | "));
  lines.push("");

  lines.push("## Profile");
  lines.push(spec.summary);
  lines.push("");

  if ((spec.experience || []).length) {
    lines.push("## Work Experience");
    for (const role of spec.experience) {
      const header = [role.role, role.company, role.location].filter(Boolean).join(", ");
      lines.push(`### ${header}`);
      if (role.period) lines.push(`*${role.period}*`);
      if (role.context) lines.push(role.context);
      for (const bullet of role.bullets || []) lines.push(`- ${bullet.text}`);
      lines.push("");
    }
  }

  lines.push("## Core Skills");
  lines.push((spec.skillsGrid || []).map((s) => `- ${s}`).join("\n"));
  lines.push("");

  if ((spec.education || []).length) {
    lines.push("## Education");
    for (const edu of spec.education) {
      lines.push(`- **${edu.institution}** — ${[edu.degree, edu.field, edu.period].filter(Boolean).join(", ")}`);
    }
    lines.push("");
  }

  if ((spec.publications || []).length) {
    lines.push("## Selected Publications");
    for (const pub of spec.publications.slice(0, 3)) {
      lines.push(`- **${pub.title}** — ${[pub.venue, pub.summary].filter(Boolean).join(". ")}`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Convenience: build + validate + render in one call.
 * @param {object} args - { profile, job }
 * @returns {{ spec: object, markdown: string }}
 */
export function generateResume({ profile, job = {} } = {}) {
  const jobContext = {
    company: job.company || "",
    title: job.title || "",
    text: job.description || job.text || "",
  };
  const spec = buildResumeSpec(profile, jobContext);
  validateResumeSpec(spec);
  return { spec, markdown: renderMarkdown(spec) };
}

// ---- helpers ---------------------------------------------------------------

function card(id, claim, sourcePath, role) {
  return {
    id,
    claim: String(claim || ""),
    sourcePath,
    role: role.role || "",
    company: role.company || "",
  };
}

function deriveSummaryRefs(factCards) {
  // Ground the summary in the most recent role's first card, if any.
  return factCards.length ? [factCards[0].id] : [];
}

function rankSkills(skills, keywords) {
  const kw = new Set(keywords.map((k) => k.toLowerCase()));
  return [...skills].sort((a, b) => {
    const aw = kw.has(String(a).toLowerCase()) ? 1 : 0;
    const bw = kw.has(String(b).toLowerCase()) ? 1 : 0;
    return bw - aw;
  });
}

function extractKeywords(jobText, profile) {
  const haystack = String(jobText || "").toLowerCase();
  const ranked = [];
  for (const skill of profile.skills || []) {
    if (haystack.includes(String(skill).toLowerCase())) ranked.push(skill);
  }
  return [...new Set(ranked)].slice(0, 16);
}

function linkValues(links = {}) {
  const out = [];
  for (const key of ["linkedin", "github", "website", "twitter"]) {
    if (links[key]) out.push(links[key]);
  }
  for (const extra of links.other || []) {
    if (extra?.url) out.push(extra.url);
  }
  return out;
}

function cardPrefix(company) {
  return String(company || "ROLE").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 12) || "ROLE";
}

function pad(n) {
  return String(n).padStart(3, "0");
}
