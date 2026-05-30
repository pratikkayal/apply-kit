import { LLMProvider, fetchJson, parseJsonResponse, NotImplementedError } from "./base.mjs";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic Messages API provider. No embeddings endpoint (advertised via
 * describe()).
 */
export class AnthropicProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.model = options.model || process.env.LLM_MODEL || DEFAULT_MODEL;
    this.baseUrl = options.baseUrl || process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL;
    this.version = options.version || ANTHROPIC_VERSION;
  }

  get name() {
    return "anthropic";
  }

  describe() {
    return {
      name: this.name,
      model: this.model,
      capabilities: { complete: true, embed: false, structured: true },
    };
  }

  _headers() {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is not configured. Set ANTHROPIC_API_KEY or pass { apiKey }.");
    }
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": this.version,
    };
  }

  async complete(prompt, options = {}) {
    const data = await fetchJson(
      `${this.baseUrl}/messages`,
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          model: options.model || this.model,
          messages: [{ role: "user", content: prompt }],
          temperature: options.temperature ?? this.temperature,
          max_tokens: options.maxTokens ?? this.maxTokens,
        }),
      },
      this.name,
    );
    return data.content?.find((b) => b.type === "text")?.text || "";
  }

  async embed() {
    throw new NotImplementedError(this, "embed");
  }

  async structured(prompt, schema, options = {}) {
    const data = await fetchJson(
      `${this.baseUrl}/messages`,
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          model: options.model || this.model,
          system: `You must respond with valid JSON matching this schema. No other text.\n${JSON.stringify(schema)}`,
          messages: [{ role: "user", content: prompt }],
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? this.maxTokens,
        }),
      },
      this.name,
    );
    return parseJsonResponse(data.content?.find((b) => b.type === "text")?.text || "{}", this.name);
  }
}
