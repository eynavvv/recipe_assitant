import type Anthropic from "@anthropic-ai/sdk";
import { MODEL, getClient } from "./claude.js";
import { buildSourceMaterial } from "./sources.js";
import type { Recipe } from "./recipe.js";
import { formatTimestamp, type VideoContext } from "./youtube.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CookState {
  stepIndex: number; // zero-based
  servings?: number; // servings the viewer scaled the recipe to
}

export function buildSystemPrompt(ctx: VideoContext, recipe?: Recipe): string {
  const recipeBlock = recipe?.isRecipe
    ? `\n\n<recipe_card>\n${JSON.stringify(recipe, null, 1)}\n</recipe_card>\nThe viewer sees this recipe card in the app, with steps numbered from 1. Use it as the primary reference and the video material for detail.`
    : "";

  return `You are a cooking companion next to a recipe video the viewer is following in the kitchen, so they need quick answers. They may also ask about the video itself (who made it, when, what equipment).

How to answer:
- Reply in the language the viewer writes in (often Hebrew or English), even if the video is in another language.
- Answer from the recipe card and the video material below. If the video doesn't say, say so in a few words, then give your best practical cooking advice and label it as yours.
- Be brief: one to three short sentences, the direct answer first ("Two tablespoons." / "Medium heat, about 5 minutes."). No lists or headings unless asked for the full ingredient list or all steps.
- For quantities, use the viewer's scaled servings when given and say the scaled amount.
- Substitutions, timing, doneness cues and fixes for mistakes are welcome questions. Be concrete.
- Cite where the video shows something with a timestamp in square brackets, like [4:05]. The app turns these into links. Only use timestamps that exist.
- When the viewer asks to see, go, skip, rewind or replay a part ("show me how she folds it", "go back to the sauce"), put a seek command on the very first line: [[seek 12:34]], then one short sentence. Only when they ask to move or see something.${recipeBlock}

${buildSourceMaterial(ctx)}`;
}

function describeState(currentTime: number | undefined, cook: CookState | undefined, recipe?: Recipe): string {
  const parts: string[] = [];
  if (currentTime !== undefined) parts.push(`video position ${formatTimestamp(currentTime)}`);
  if (cook && recipe?.steps[cook.stepIndex]) {
    parts.push(`cooking step ${cook.stepIndex + 1} of ${recipe.steps.length}: "${recipe.steps[cook.stepIndex].text}"`);
  }
  if (cook?.servings && recipe?.servings && cook.servings !== recipe.servings) {
    parts.push(`scaled to ${cook.servings} servings (recipe is for ${recipe.servings})`);
  }
  return parts.length ? `\n\n(Viewer state: ${parts.join("; ")})` : "";
}

export async function streamAnswer(
  ctx: VideoContext,
  recipe: Recipe | undefined,
  history: ChatTurn[],
  currentTime: number | undefined,
  cook: CookState | undefined,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const state = describeState(currentTime, cook, recipe);
  // Viewer state travels with the newest question so the cached system prompt stays stable.
  const messages: Anthropic.MessageParam[] = history.map((turn, i) =>
    i === history.length - 1 && turn.role === "user" ? { role: "user", content: turn.content + state } : turn,
  );

  const stream = getClient().messages.stream(
    {
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low" },
      system: [{ type: "text", text: buildSystemPrompt(ctx, recipe), cache_control: { type: "ephemeral" } }],
      messages,
    },
    { signal },
  );

  stream.on("text", onText);
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") onText("\n\nSorry, I can't help with that one.");
}
