import { OpenAIProvider } from "./openai.mjs";
import { AnthropicProvider } from "./anthropic.mjs";
import { BedrockProvider } from "./bedrock.mjs";
import { KiroProvider } from "./kiro.mjs";
import { LocalProvider } from "./local.mjs";

/**
 * Registry of provider constructors keyed by canonical name. Adding a provider
 * is a one-line change here plus the implementation file.
 */
export const PROVIDERS = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  bedrock: BedrockProvider,
  kiro: KiroProvider,
  local: LocalProvider,
  ollama: LocalProvider, // alias
};

export const SUPPORTED_PROVIDERS = ["openai", "anthropic", "bedrock", "kiro", "local"];

/**
 * Create an LLM provider by name (or via the LLM_PROVIDER env var).
 *
 * @param {string} [providerName] - openai | anthropic | bedrock | kiro | local
 * @param {object} [options] - provider-specific options
 * @returns {import('./base.mjs').LLMProvider}
 */
export function createProvider(providerName, options = {}) {
  const name = (providerName || process.env.LLM_PROVIDER || "openai").toLowerCase();
  const ProviderClass = PROVIDERS[name];
  if (!ProviderClass) {
    throw new Error(
      `Unknown LLM provider: ${name}. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
    );
  }
  return new ProviderClass(options);
}

export { LLMProvider, NotImplementedError } from "./base.mjs";
export { OpenAIProvider } from "./openai.mjs";
export { AnthropicProvider } from "./anthropic.mjs";
export { BedrockProvider } from "./bedrock.mjs";
export { KiroProvider } from "./kiro.mjs";
export { LocalProvider } from "./local.mjs";
