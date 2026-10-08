import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { fallbackParams, MODEL, getClient } from "./claude.js";
import { buildSourceMaterial } from "./sources.js";
import type { VideoContext } from "./youtube.js";

const SourceEnum = z.enum(["spoken", "description", "comment", "inferred"]);

export const RecipeSchema = z.object({
  isRecipe: z.boolean().describe("False if the video is not a cooking or recipe video"),
  title: z.string(),
  servings: z.number().nullable().describe("Number of servings the quantities are for, if stated or clearly implied"),
  totalTime: z.string().nullable().describe('Human readable, e.g. "45 min"'),
  ingredients: z.array(
    z.object({
      group: z.string().nullable().describe('Sub-recipe heading such as "Sauce", or null'),
      name: z.string(),
      quantity: z.string().nullable().describe('Amount as written, e.g. "1 1/2", "200", "2-3"; null if unspecified'),
      unit: z.string().nullable().describe('e.g. "g", "cup", "tbsp", "cloves"; null if none'),
      note: z.string().nullable().describe('e.g. "finely chopped", "room temperature"'),
      source: SourceEnum,
    }),
  ),
  steps: z.array(
    z.object({
      text: z.string().describe("One clear instruction in the imperative, including amounts, heat level and time"),
      start: z.number().nullable().describe("Second in the video where this step begins, from the transcript timestamps"),
      end: z.number().nullable().describe("Second where the step's footage ends"),
      timerSeconds: z.number().nullable().describe("Duration if the step involves waiting, e.g. bake 25 min = 1500"),
    }),
  ),
  tips: z.array(z.string()).describe("Useful tips, warnings or substitutions mentioned in the video or comments"),
  gaps: z.array(z.string()).describe("Things the video leaves unclear, such as unstated quantities, oven temperature or timing"),
});

export type Recipe = z.infer<typeof RecipeSchema>;

const INSTRUCTIONS = `Extract the recipe from this cooking video so a home cook can follow it without rewatching.

- Combine every source: what is said in the transcript, the description, and the comments (the creator's comment often has the written recipe). When sources disagree on an amount, prefer the written recipe and mention the difference in gaps.
- Mark each ingredient's source. Use "inferred" only for things clearly used on screen or implied by the steps but never stated, and leave their quantity null rather than guessing.
- Steps follow the order of the video. Give each step the transcript timestamp where it starts and where its footage ends, so the app can loop that clip. Split long stretches into steps a cook can do one at a time; merge trivial ones.
- Keep the creator's units. Don't convert.
- If this isn't a cooking video, set isRecipe to false and leave the lists empty.`;

export async function extractRecipe(ctx: VideoContext): Promise<Recipe> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...fallbackParams(),
    output_config: { effort: "medium", format: betaZodOutputFormat(RecipeSchema) },
    messages: [{ role: "user", content: `${buildSourceMaterial(ctx)}\n\n${INSTRUCTIONS}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to extract a recipe from this video.");
  if (!response.parsed_output) throw new Error("Couldn't read the recipe Claude returned.");
  return response.parsed_output;
}
