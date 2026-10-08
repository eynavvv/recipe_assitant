import Anthropic from "@anthropic-ai/sdk";

// Claude Haiku 5.5 is the cheapest current model; override with CLAUDE_MODEL.
export const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";

// Created on first use so the server can start (and tests run) without credentials.
let client: Anthropic | undefined;
export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}
