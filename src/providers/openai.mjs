import { LLMProvider, fetchJson, parseJsonResponse } from "./base.mjs";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_EMBED_MODEL = "text-embedding-3-small";

/**
 * OpenAI Chat Completions + Embeddings provider.
 */
export class OpenAIProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.model = options.model || process.env.LLM_MODEL || DEFAULT_MODEL;
    this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
    this.embedModel = options.embedModel || DEFAULT_EMBED_MODEL;
  }

  get name() {
    return "openai";
  }

  _headers() {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is not configured. Set OPENAI_API_KEY or pass { apiKey }.");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async complete(prompt, options = {}) {
    const data = await fetchJson(
      `${this.baseUrl}/chat/completions`,
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
    return data.choices?.[0]?.message?.content || "";
  }

  async embed(text) {
    const data = await fetchJson(
      `${this.baseUrl}/embeddings`,
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ model: this.embedModel, input: text }),
      },
      this.name,
    );
    return data.data?.[0]?.embedding || [];
  }

  async structured(prompt, schema, options = {}) {
    const data = await fetchJson(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          model: options.model || this.model,
          messages: [
            { role: "system", content: `Respond with valid JSON matching this schema:\n${JSON.stringify(schema)}` },
            { role: "user", content: prompt },
          ],
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? this.maxTokens,
          response_format: { type: "json_object" },
        }),
      },
      this.name,
    );
    return parseJsonResponse(data.choices?.[0]?.message?.content || "{}", this.name);
  }
}
