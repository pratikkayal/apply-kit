import readline from "node:readline";

/**
 * Prompter interface used by onboarding. Two implementations share the same
 * surface so intake logic is identical whether driven by a human at a terminal
 * or by a script/test.
 *
 *   ask(question, { default }) -> Promise<string>
 *   confirm(question, { default }) -> Promise<boolean>
 *   select(question, choices, { default }) -> Promise<string>
 *   note(text) -> void   (informational output)
 */

export class ReadlinePrompter {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    this.rl = readline.createInterface({ input, output });
    this.output = output;
  }

  async ask(question, { default: def = "" } = {}) {
    const suffix = def ? ` [${def}]` : "";
    const answer = await this._question(`${question}${suffix}: `);
    return answer.trim() || def;
  }

  async confirm(question, { default: def = false } = {}) {
    const hint = def ? "[Y/n]" : "[y/N]";
    const answer = (await this._question(`${question} ${hint}: `)).trim().toLowerCase();
    if (!answer) return def;
    return answer === "y" || answer === "yes";
  }

  async select(question, choices, { default: def } = {}) {
    this.output.write(`${question}\n`);
    choices.forEach((c, i) => this.output.write(`  ${i + 1}) ${c}\n`));
    const def1 = def ? choices.indexOf(def) + 1 : 1;
    const raw = (await this._question(`Choose 1-${choices.length} [${def1}]: `)).trim();
    const idx = raw ? Number(raw) - 1 : def1 - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < choices.length) return choices[idx];
    return choices[def1 - 1];
  }

  note(text) {
    this.output.write(`${text}\n`);
  }

  close() {
    this.rl.close();
  }

  _question(prompt) {
    return new Promise((resolve) => this.rl.question(prompt, resolve));
  }
}

/**
 * Scripted prompter for tests/automation. Answers are looked up by question id
 * (preferred) or consumed in order from a queue. `confirm` accepts boolean or
 * yes/no strings; `select` accepts the choice value or a 1-based index.
 */
export class ScriptedPrompter {
  /**
   * @param {object} [opts]
   * @param {Record<string,*>} [opts.answers] - keyed by question id
   * @param {Array} [opts.queue] - fallback ordered answers
   * @param {Function} [opts.onNote] - receives note() text
   * @param {boolean} [opts.failOnExhaustion] - when true, throw instead of
   *   returning a default once both the answers map and queue are exhausted.
   *   Used for piped/non-interactive CLI input so missing answers fail fast
   *   rather than looping a required-field re-prompt forever.
   */
  constructor({ answers = {}, queue = [], onNote = () => {}, failOnExhaustion = false } = {}) {
    this.answers = answers;
    this.queue = [...queue];
    this.onNote = onNote;
    this.failOnExhaustion = failOnExhaustion;
    this._currentId = null;
  }

  /** Set the question id the next ask/confirm/select should resolve against. */
  _for(id) {
    this._currentId = id;
    return this;
  }

  _next(fallback) {
    const id = this._currentId;
    this._currentId = null;
    if (id != null && Object.prototype.hasOwnProperty.call(this.answers, id)) {
      const v = this.answers[id];
      // An array answer is a sequential queue for a repeatable prompt: each
      // visit consumes the next element; once drained we fall through so loop
      // gates naturally terminate.
      if (Array.isArray(v)) {
        if (v.length) return v.shift();
      } else {
        return v;
      }
    }
    if (this.queue.length) return this.queue.shift();
    if (this.failOnExhaustion) {
      throw new Error("onboarding input exhausted: not enough answers provided for all prompts");
    }
    return fallback;
  }

  async ask(_question, { default: def = "" } = {}) {
    const v = this._next(def);
    return v === undefined || v === null ? def : String(v);
  }

  async confirm(_question, { default: def = false } = {}) {
    const v = this._next(def);
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase();
    return s === "y" || s === "yes" || s === "true";
  }

  async select(_question, choices, { default: def } = {}) {
    const v = this._next(def);
    if (typeof v === "number" && v >= 1 && v <= choices.length) return choices[v - 1];
    // Accept a numeric *string* (e.g. piped "3") as a 1-based index.
    if (typeof v === "string" && /^\d+$/.test(v.trim())) {
      const idx = Number(v.trim()) - 1;
      if (idx >= 0 && idx < choices.length) return choices[idx];
    }
    if (choices.includes(v)) return v;
    return def ?? choices[0];
  }

  note(text) {
    this.onNote(text);
  }

  close() {}
}
