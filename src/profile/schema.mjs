/**
 * Canonical ApplyKit profile schema.
 *
 * This is the single, person-agnostic shape used across onboarding, the
 * orchestrator, and the resume builder. It contains NO personal data — only
 * structure, defaults, and validation.
 */

export const SCHEMA_VERSION = 1;

export const ATTACHMENT_KINDS = ["resume", "cover-letter", "other"];

export const PROVIDER_NAMES = ["openai", "anthropic", "bedrock", "kiro", "local"];

/**
 * Create an empty, structurally-valid profile object.
 * @returns {object}
 */
export function createEmptyProfile() {
  return {
    schemaVersion: SCHEMA_VERSION,
    identity: { name: "", email: "", phone: "", location: "" },
    links: { linkedin: "", github: "", website: "", twitter: "", other: [] },
    summary: "",
    targetRoles: [],
    skills: [],
    experience: [],
    education: [],
    publications: [],
    preferences: {
      provider: "",
      locations: { allow: [], block: [] },
      scoring: { positive: {}, negative: {}, companyBonus: {} },
    },
    attachments: [],
    freeform: [],
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a profile object. Throws a descriptive Error on the first problem.
 * Designed to be shared by onboarding (fail fast on bad input) and the resume
 * builder (refuse to generate from a malformed profile).
 *
 * @param {object} profile
 * @returns {true}
 */
export function validateProfile(profile) {
  if (!profile || typeof profile !== "object") {
    throw new Error("profile must be an object");
  }
  if (profile.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `unsupported schemaVersion: ${profile.schemaVersion} (expected ${SCHEMA_VERSION})`,
    );
  }

  const identity = profile.identity;
  if (!identity || typeof identity !== "object") {
    throw new Error("profile.identity is required");
  }
  if (!identity.name || typeof identity.name !== "string" || !identity.name.trim()) {
    throw new Error("profile.identity.name is required");
  }
  if (!identity.email || !EMAIL_RE.test(identity.email)) {
    throw new Error("profile.identity.email is required and must be a valid email");
  }

  const arrayFields = ["targetRoles", "skills", "experience", "education", "publications", "attachments", "freeform"];
  for (const field of arrayFields) {
    if (!Array.isArray(profile[field])) {
      throw new Error(`profile.${field} must be an array`);
    }
  }

  for (const [i, role] of profile.experience.entries()) {
    if (!role || typeof role !== "object") throw new Error(`experience[${i}] must be an object`);
    if (!role.company || !String(role.company).trim()) {
      throw new Error(`experience[${i}].company is required`);
    }
    if (!Array.isArray(role.bullets)) {
      throw new Error(`experience[${i}].bullets must be an array`);
    }
  }

  for (const [i, att] of profile.attachments.entries()) {
    if (!att || typeof att !== "object") throw new Error(`attachments[${i}] must be an object`);
    if (!ATTACHMENT_KINDS.includes(att.kind)) {
      throw new Error(`attachments[${i}].kind must be one of: ${ATTACHMENT_KINDS.join(", ")}`);
    }
    if (!att.path || !String(att.path).trim()) {
      throw new Error(`attachments[${i}].path is required`);
    }
  }

  const provider = profile.preferences?.provider;
  if (provider && !PROVIDER_NAMES.includes(provider)) {
    throw new Error(
      `preferences.provider must be one of: ${PROVIDER_NAMES.join(", ")} (got "${provider}")`,
    );
  }

  return true;
}

/**
 * Deep-merge a partial update onto a base profile, returning a NEW object.
 * Arrays are replaced (not concatenated); plain objects merge recursively.
 * Always normalizes `schemaVersion` to the current version.
 *
 * @param {object} base
 * @param {object} patch
 * @returns {object}
 */
export function mergeProfile(base, patch) {
  const merged = deepMerge(base ?? {}, patch ?? {});
  merged.schemaVersion = SCHEMA_VERSION;
  return merged;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(a, b) {
  if (!isPlainObject(a)) return clone(b);
  const out = clone(a);
  for (const [key, value] of Object.entries(b)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = clone(value);
    }
  }
  return out;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  }
  return value;
}

/**
 * Normalize a free-text user id into a filesystem-safe slug.
 * @param {string} input
 * @returns {string}
 */
export function slugifyUserId(input) {
  const slug = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug) throw new Error("could not derive a valid user id from input");
  return slug;
}
