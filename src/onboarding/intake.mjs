import { existsSync } from "node:fs";

import { createEmptyProfile, validateProfile, slugifyUserId, PROVIDER_NAMES } from "../profile/schema.mjs";
import { ProfileStore } from "../profile/store.mjs";
import { importAttachment } from "../profile/attachments.mjs";

/**
 * Run the onboarding interview for a NEW person and persist their profile.
 *
 * Captures: identity, socials/links (LinkedIn, GitHub, website, X, plus any
 * number of extra links), target roles, skills, summary, past resumes & cover
 * letters (imported as attachments), freeform additions, and a preferred LLM
 * provider.
 *
 * Driven entirely through the injected `prompter`, so it is identical for an
 * interactive terminal and a scripted test.
 *
 * @param {object} args
 * @param {import('./prompter.mjs').ReadlinePrompter|import('./prompter.mjs').ScriptedPrompter} args.prompter
 * @param {ProfileStore} [args.store]
 * @param {string} [args.userId] - if omitted, derived from the entered name
 * @returns {Promise<{ userId: string, profilePath: string, profile: object }>}
 */
export async function runIntake({ prompter, store = new ProfileStore(), userId } = {}) {
  if (!prompter) throw new Error("runIntake requires a prompter");
  const p = withId(prompter);
  const profile = createEmptyProfile();

  p.note("Welcome to ApplyKit onboarding. Answer a few questions to get set up.\n");

  // --- Identity -------------------------------------------------------------
  profile.identity.name = await p.ask("name", "Your full name", { required: true });
  profile.identity.email = await p.ask("email", "Your email", {
    required: true,
    validate: (v) => (EMAIL_RE.test(v) ? null : "Please enter a valid email address."),
  });
  profile.identity.phone = await p.ask("phone", "Your phone (optional)");
  profile.identity.location = await p.ask("location", "Your location (city, country)");

  // --- Socials / links ------------------------------------------------------
  p.note("\nSocial & professional links (press enter to skip any):");
  profile.links.linkedin = await p.ask("linkedin", "LinkedIn URL");
  profile.links.github = await p.ask("github", "GitHub URL");
  profile.links.website = await p.ask("website", "Personal website / portfolio");
  profile.links.twitter = await p.ask("twitter", "X / Twitter URL");
  while (await p.confirm("more_links", "Add another link?", { default: false })) {
    const label = await p.ask("link_label", "  Link label (e.g. Scholar, Dribbble)");
    const url = await p.ask("link_url", "  Link URL");
    if (label && url) profile.links.other.push({ label, url });
  }

  // --- Target roles & skills ------------------------------------------------
  profile.targetRoles = splitList(await p.ask("target_roles", "\nTarget roles (comma-separated)"));
  profile.skills = splitList(await p.ask("skills", "Key skills (comma-separated)"));
  profile.summary = await p.ask("summary", "One-line professional summary");

  // --- Experience (optional, repeatable) -----------------------------------
  while (await p.confirm("add_experience", "\nAdd a work experience entry?", { default: false })) {
    const company = await p.ask("exp_company", "  Company");
    if (!company) break;
    const role = await p.ask("exp_role", "  Role / title");
    const period = await p.ask("exp_period", "  Period (e.g. 2022 - Present)");
    const location = await p.ask("exp_location", "  Location");
    const context = await p.ask("exp_context", "  One-line context (what the team/role did)");
    const bullets = [];
    while (await p.confirm("exp_add_bullet", "    Add an achievement bullet?", { default: false })) {
      const bullet = await p.ask("exp_bullet", "    Bullet");
      if (bullet) bullets.push(bullet);
    }
    profile.experience.push({ company, role, period, location, context, bullets });
  }

  // --- Education (optional, repeatable) -------------------------------------
  while (await p.confirm("add_education", "Add an education entry?", { default: false })) {
    const institution = await p.ask("edu_institution", "  Institution");
    if (!institution) break;
    const degree = await p.ask("edu_degree", "  Degree");
    const field = await p.ask("edu_field", "  Field of study");
    const period = await p.ask("edu_period", "  Period");
    profile.education.push({ institution, degree, field, period });
  }

  // --- Attachments: past resumes / cover letters ----------------------------
  p.note("\nImport past resumes or cover letters (we copy them; originals are untouched).");
  await collectAttachments(p, profile, store, userId);

  // --- Freeform additions ---------------------------------------------------
  p.note("\nAnything else you want ApplyKit to know? (achievements, preferences, notes)");
  while (await p.confirm("add_freeform", "Add a freeform note?", { default: false })) {
    const label = await p.ask("freeform_label", "  Label");
    const content = await p.ask("freeform_content", "  Content");
    if (content) profile.freeform.push({ label: label || "note", content });
  }

  // --- Provider preference --------------------------------------------------
  profile.preferences.provider = await p.select(
    "provider",
    "\nPreferred LLM provider",
    PROVIDER_NAMES,
    { default: "openai" },
  );

  // --- Persist --------------------------------------------------------------
  const resolvedId = slugifyUserId(userId || profile.identity.name);
  validateProfile(profile);
  const profilePath = store.saveProfile(resolvedId, profile);

  p.note(`\nDone. Profile saved for "${resolvedId}".`);
  return { userId: resolvedId, profilePath, profile };
}

/**
 * Attachment-collection sub-flow. Needs the user id early to know where to
 * copy files; derives it from the name entered so far if not supplied.
 */
async function collectAttachments(p, profile, store, userId) {
  const id = slugifyUserId(userId || profile.identity.name);
  store.ensureWorkspace(id);
  const attachmentsDir = store.attachmentsDir(id);

  while (await p.confirm("add_attachment", "Import a document?", { default: false })) {
    const sourcePath = await p.ask("attachment_path", "  Path to the file");
    if (!sourcePath) break;
    if (!existsSync(sourcePath)) {
      p.note(`  ! File not found: ${sourcePath} — skipping.`);
      continue;
    }
    const kind = await p.select("attachment_kind", "  Document type", ["resume", "cover-letter", "other"], {
      default: "resume",
    });
    const label = await p.ask("attachment_label", "  Label (optional)");
    try {
      const entry = importAttachment({ sourcePath, kind, attachmentsDir, label });
      profile.attachments.push(entry);
      p.note(`  + imported ${entry.originalName} as ${entry.id}`);
    } catch (error) {
      p.note(`  ! could not import: ${error.message}`);
    }
  }
}

/**
 * Wrap a prompter so question ids flow through to ScriptedPrompter while
 * remaining a no-op for ReadlinePrompter. Enforces `required` and an optional
 * `validate(value) -> errorString|null`, re-prompting on failure. A retry cap
 * prevents an unbounded loop if input never satisfies the constraint.
 */
const MAX_ASK_ATTEMPTS = 100;

function withId(prompter) {
  const forId = (id) => (typeof prompter._for === "function" ? prompter._for(id) : prompter);
  return {
    note: (t) => prompter.note(t),
    async ask(id, question, { default: def = "", required = false, validate = null } = {}) {
      for (let attempt = 0; attempt < MAX_ASK_ATTEMPTS; attempt += 1) {
        const value = String((await forId(id).ask(question, { default: def })) ?? "").trim();
        if (required && !value) {
          prompter.note("  This field is required.");
          continue;
        }
        if (validate && value) {
          const err = validate(value);
          if (err) {
            prompter.note(`  ${err}`);
            continue;
          }
        }
        return value;
      }
      throw new Error(`too many invalid attempts for "${id}"`);
    },
    confirm: (id, question, opts) => forId(id).confirm(question, opts),
    select: (id, question, choices, opts) => forId(id).select(question, choices, opts),
  };
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
