/**
 * Canonical onboarding question ids.
 *
 * `runIntake` resolves each prompt against these ids when a ScriptedPrompter is
 * used, so automation/tests can supply answers by id. Repeatable loops (links,
 * experience, attachments, freeform) are driven by their `*_confirm`-style
 * gate ids — set them to `false` (or omit) to end a loop.
 */
export const QUESTION_IDS = [
  "name",
  "email",
  "phone",
  "location",
  "linkedin",
  "github",
  "website",
  "twitter",
  "more_links",
  "link_label",
  "link_url",
  "target_roles",
  "skills",
  "summary",
  "add_experience",
  "exp_company",
  "exp_role",
  "exp_period",
  "exp_location",
  "exp_context",
  "exp_add_bullet",
  "exp_bullet",
  "add_education",
  "edu_institution",
  "edu_degree",
  "edu_field",
  "edu_period",
  "add_attachment",
  "attachment_path",
  "attachment_kind",
  "attachment_label",
  "add_freeform",
  "freeform_label",
  "freeform_content",
  "provider",
];

/**
 * A complete, synthetic answer set used by `applykit-onboard --demo` and by the
 * onboarding e2e test. Contains NO real personal data.
 *
 * @param {object} [overrides] - merged over the defaults
 * @returns {Record<string, *>}
 */
export function demoAnswers(overrides = {}) {
  return {
    name: "Alex Doe",
    email: "alex.doe@example.com",
    phone: "+1-555-0100",
    location: "Remote (UTC+0)",
    linkedin: "https://linkedin.com/in/alexdoe-example",
    github: "https://github.com/alexdoe-example",
    website: "https://alexdoe.example",
    twitter: "https://x.com/alexdoe_example",
    more_links: false,
    target_roles: "Senior Software Engineer, Backend Engineer",
    skills: "JavaScript, Node.js, TypeScript, PostgreSQL, AWS, Docker",
    summary: "Backend engineer who ships reliable services and mentors teams.",
    add_experience: false,
    add_education: false,
    add_attachment: false,
    add_freeform: false,
    provider: "openai",
    ...overrides,
  };
}
