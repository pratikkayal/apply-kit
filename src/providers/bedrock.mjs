import { LLMProvider, fetchJson, parseJsonResponse } from "./base.mjs";

/**
 * Amazon Bedrock provider.
 *
 * Uses the modern Bedrock **API key (bearer token)** flow against the Bedrock
 * Runtime REST endpoint, so there is no AWS SDK or SigV4 signing dependency:
 *
 *   POST https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/invoke
 *   Authorization: Bearer <AWS_BEARER_TOKEN_BEDROCK>
 *
 * Request/response bodies follow the Anthropic-on-Bedrock "messages" schema
 * (the most common Bedrock text model family). Embeddings use Amazon Titan.
 * The region, chat model, and embed model are all configurable.
 */

const DEFAULT_MODEL = "anthropic.claude-3-5-sonnet-20240620-v1:0";
const DEFAULT_EMBED_MODEL = "amazon.titan-embed-text-v2:0";
const DEFAULT_REGION = "us-east-1";
const BEDROCK_ANTHROPIC_VERSION = "bedrock-2023-05-31";

export class BedrockProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey || process.env.AWS_BEARER_TOKEN_BEDROCK || "";
    this.region = options.region || process.env.AWS_REGION || DEFAULT_REGION;
    this.model = options.model || process.env.BEDROCK_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL;
    this.embedModel = options.embedModel || process.env.BEDROCK_EMBED_MODEL || DEFAULT_EMBED_MODEL;
    this.baseUrl =
      options.baseUrl ||
      process.env.BEDROCK_BASE_URL ||
      `https://bedrock-runtime.${this.region}.amazonaws.com`;
  }

  get name() {
    return "bedrock";
  }

  _headers() {
    if (!this.apiKey) {
      throw new Error(
        "Bedrock API key is not configured. Set AWS_BEARER_TOKEN_BEDROCK (a Bedrock API key) or pass { apiKey }.",
      );
    }
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  _invokeUrl(modelId) {
    return `${this.baseUrl}/model/${encodeURIComponent(modelId)}/invoke`;
  }

  async complete(prompt, options = {}) {
    const modelId = options.model || this.model;
    const data = await fetchJson(
      this._invokeUrl(modelId),
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          anthropic_version: BEDROCK_ANTHROPIC_VERSION,
          messages: [{ role: "user", content: prompt }],
          temperature: options.temperature ?? this.temperature,
          max_tokens: options.maxTokens ?? this.maxTokens,
        }),
      },
      this.name,
    );
    return data.content?.find((b) => b.type === "text")?.text || "";
  }

  async embed(text) {
    const data = await fetchJson(
      this._invokeUrl(this.embedModel),
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ inputText: text }),
      },
      this.name,
    );
    return data.embedding || [];
  }

  async structured(prompt, schema, options = {}) {
    const modelId = options.model || this.model;
    const data = await fetchJson(
      this._invokeUrl(modelId),
      {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          anthropic_version: BEDROCK_ANTHROPIC_VERSION,
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
