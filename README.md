# Recipe Video Assistant

Paste a YouTube cooking video. The app writes out the recipe (ingredients with amounts, steps tied to the moments in the video), walks you through it in cook mode, and answers questions about the dish in English or Hebrew.

## Features

- **Recipe card**: Claude extracts ingredients, quantities, steps with video timestamps, timers, tips and what the video leaves unclear, from the captions, the description and the top comments (the creator's comment often holds the written recipe). The recipe is written in the language the video is spoken in. Ingredients seen but never measured are flagged with "?".
- **Servings scaling**: quantities like `1 1/2`, `½` and `2-3` scale as you change servings.
- **Cook mode**: one big step at a time, the video loops that step's clip, built-in timers with a beep, and the screen stays awake.
- **Chat**: ask about ingredients, swaps, timing or the video itself. Answers come in the language you write in, timestamps like `[4:05]` are buttons that seek the video, and "show me how she folds it" jumps the player there.
- **Hebrew**: text in Hebrew is laid out right to left automatically; captions in the spoken language are preferred.
- **No captions?** Paste the transcript from YouTube's "Show transcript" panel.

## Stack

- `client/`: Vite + React + TypeScript
- `server/`: Express + TypeScript. Fetches metadata, chapters and captions from YouTube and calls the Claude API (`@anthropic-ai/sdk`, model `claude-haiku-5-5`, the cheapest current Claude model; override with `CLAUDE_MODEL`).
- `api/index.ts`: the same Express app as a Vercel serverless function. The API keeps no state: the browser sends the video context and recipe back with each request.

## Run locally

Requires Node 20+ and an Anthropic API key.

```bash
npm install
cp .env.example server/.env   # then put your key in server/.env
npm run dev                   # server on :3001, client on http://localhost:5173
```

Production build: `npm run build && npm start`, then open http://localhost:3001.

Tests: `npm test`.

## Deploy to Vercel

1. Import the GitHub repo in Vercel. `vercel.json` sets the build (`client/dist` as static output, `api/index.ts` as the function), so leave the framework preset as "Other".
2. Add environment variables: `ANTHROPIC_API_KEY` (required), `YOUTUBE_API_KEY` (optional, for comments).
3. Deploy.

## API

- `POST /api/video` `{url}` loads metadata, chapters, comments and captions.
- `POST /api/transcript` `{text}` parses a pasted transcript.
- `POST /api/recipe` `{video}` extracts the recipe card (schema in `server/src/recipe.ts`).
- `POST /api/chat` `{video, recipe, messages, currentTime, cook}` streams the answer as plain text. A first line of `[[seek m:ss]]` tells the client to move the player.

## Known limits

- Captions come from YouTube's unofficial endpoints. YouTube sometimes blocks these from cloud servers (including Vercel); when it does, the app shows the title, description and comments only and offers the paste box.
- YouTube only for now. TikTok and Instagram need the audio transcribed, planned via a video upload.
