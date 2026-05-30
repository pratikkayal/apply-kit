/**
 * Abstract LLM provider interface.
 *
 * All providers extend this class. Methods that a provider does not support
 * (e.g. embeddings on a chat-only API) throw a clear, typed error and report
 * `false` in `describe().capabilities`.
 */
export class LLMProvider {
  constructor(options = {}) {
    this.model = options.model || null;
    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens ?? 2048;
  }

  /** @returns {string} short provider id, e.g. "openai" */
  get name() {
    return "base";
  }

  /**
   * Generate a text completion.
   * @param {string} prompt
   * @param {object} [options] - { model, temperature, maxTokens }
   * @returns {Promise<string>}
   */
  async complete(prompt, options = {}) {
    throw new NotImplementedError(this, "complete");
  }

  /**
   * Generate an embedding vector for a text.
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embed(text) {
    throw new NotImplementedError(this, "embed");
  }

  /**
   * Generate a structured (JSON) response matching `schema`.
   * @param {string} prompt
   * @param {object} schema - JSON schema describing the expected output
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async structured(prompt, schema, options = {}) {
    throw new NotImplementedError(this, "structured");
  }

  /**
   * Describe the provider and its capabilities. Callers can use this to
   * degrade gracefully (e.g. skip embeddings on Anthropic/Bedrock).
   * @returns {{ name: string, model: string|null, capabilities: object }}
   */
  describe() {
    return {
      name: this.name,
      model: this.model,
      capabilities: { complete: true, embed: true, structured: true },
    };
  }
}

export class NotImplementedError extends Error {
  constructor(instance, method) {
    super(`${instance.constructor.name}.${method}() is not supported by this provider`);
    this.name = "NotImplementedError";
    this.method = method;
  }
}

/**
 * Shared helper: parse JSON that an LLM returned, tolerating code fences and
 * leading/trailing prose. Throws a descriptive error (with a snippet) on
 * failure so callers can surface useful diagnostics.
 *
 * @param {string} content
 * @param {string} providerName
 * @returns {object}
 */
export function parseJsonResponse(content, providerName) {
  const raw = String(content ?? "").trim();
  const candidates = [raw];

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `${providerName} structured response is not valid JSON. Raw content: ${raw.slice(0, 500)}`,
  );
}

/**
 * Shared helper: perform a JSON fetch and throw a uniform error on non-2xx.
 * Uses the global `fetch`, which makes every provider trivially mockable in
 * tests by stubbing `global.fetch`.
 *
 * Applies a request timeout (default 60s, override via APPLYKIT_HTTP_TIMEOUT_MS)
 * so a hung endpoint can never block a CLI indefinitely. A caller-supplied
 * `init.signal` is respected as-is (no timeout imposed).
 *
 * @param {string} url
 * @param {object} init - fetch init
 * @param {string} providerName - for error messages
 * @returns {Promise<object>} parsed JSON body
 */
export async function fetchJson(url, init, providerName) {
  const timeoutMs = Number(process.env.APPLYKIT_HTTP_TIMEOUT_MS) || 60000;
  const opts = { ...init };
  // Only impose a timeout when the caller hasn't supplied their own signal.
  if (!opts.signal && typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    opts.signal = AbortSignal.timeout(timeoutMs);
  }

  let response;
  try {
    response = await fetch(url, opts);
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(`${providerName} API request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`${providerName} API request failed: ${err.message}`);
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // ignore
    }
    throw new Error(`${providerName} API error ${response.status}: ${body}`);
  }
  return response.json();
}
