import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicBeta } from "@anthropic-ai/sdk/resources/beta/beta";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

// Server-side refusal fallback: if the model declines, the API reroutes inside the same call.
export function fallbackParams(): { betas: AnthropicBeta[]; fallbacks: "default" } {
  return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

// Created on first use so the server can start (and tests run) without credentials.
let client: Anthropic | undefined;
export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}
