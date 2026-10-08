# Recipe Video Assistant

Paste a YouTube cooking video. The app writes out the recipe (ingredients with amounts, steps tied to the moments in the video), walks you through it in a hands-free cook mode, and answers any question about the dish by text or voice.

## Features

- **Recipe card**: Claude extracts ingredients, quantities, steps with video timestamps, timers, tips and what the video leaves unclear, from the captions, description and top comments (the creator's comment often holds the written recipe). Ingredients seen but never measured are flagged with "?".
- **Servings scaling**: quantities like `1 1/2`, `½` and `2-3` scale as you change servings.
- **Cook mode**: one big step at a time, the video loops that step's clip, built-in timers, screen stays awake.
- **Hands-free**: the mic stays on in cook mode. Say "next", "go back", "repeat", "show me again", "start the timer", or ask anything. While the video is playing, start questions with "chef" (e.g. "chef, how much salt?") so the video's own audio isn't mistaken for you.

- Embedded YouTube player (IFrame API) with chapters, a follow-along transcript and video info
- Chat with Claude grounded in the transcript, chapters, description and metadata, streamed as it's written
- Timestamps in answers like `[4:05]` render as buttons that seek the video
- Navigation by request: the assistant emits a seek command and the player jumps there
- Voice: ask with the mic (Web Speech API; Chrome, Edge and Safari), answers to voice questions are read aloud, and "Speak answers" reads every answer. The video pauses while you speak and resumes after the answer.
- If YouTube has no captions for a video, paste the transcript from YouTube's "Show transcript" panel

## Stack

- `client/`: Vite + React + TypeScript
- `server/`: Node + Express + TypeScript. Fetches metadata, chapters and captions from YouTube and calls the Claude API (`@anthropic-ai/sdk`, model `claude-opus-5-5` with server-side refusal fallback).

## Run it

Requires Node 20+ and an Anthropic API key. A YouTube Data API key (free, from Google Cloud) is optional and lets the app read comments.

```bash
npm install
cp .env.example server/.env   # then put your key in server/.env
npm run dev                   # server on :3001, client on http://localhost:5173
```

Production build: `npm run build && npm start`, then open http://localhost:3001.

Tests: `npm test` (link, chapter, caption and comment parsing, recipe schema, prompt building, quantity scaling, voice commands).

## How it works

1. `POST /api/video` parses the link, loads the watch page and the Innertube player response, and extracts metadata, chapters (player chapters, else description timestamps) and the caption track (manual English captions preferred, then auto-generated).
2. `GET /api/video/:id/recipe` asks Claude for a structured recipe (JSON schema in `server/src/recipe.ts`) and caches it.
3. `POST /api/chat` sends the conversation to Claude. The system prompt holds the recipe card, metadata, chapters, comments and transcript (merged into ~20 s blocks) and is prompt-cached, so follow-up questions are cheap. The viewer's playback position, current cook step and scaled servings ride along with each question for relative requests.
4. The client streams the answer, seeks the player when it sees `[[seek m:ss]]` on the first line, and renders `[m:ss]` as seek buttons.

Video data is cached in server memory per video id.

## Known limits

- Caption fetching uses YouTube's unofficial endpoints, which YouTube changes from time to time. When it fails, the app falls back to metadata only and offers the paste box.
- Voice input needs a browser with the Web Speech API (not Firefox).
