# Tutorial Video Assistant

Paste a YouTube tutorial link, watch it in the app, and ask questions about it by text or voice. The assistant answers from the video's transcript and metadata, cites clickable timestamps, and can jump the player to any section ("skip to the deployment part", "go back to where he sets up the router", "next chapter").

## Features

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

Requires Node 20+ and an Anthropic API key.

```bash
npm install
cp .env.example server/.env   # then put your key in server/.env
npm run dev                   # server on :3001, client on http://localhost:5173
```

Production build: `npm run build && npm start`, then open http://localhost:3001.

Tests: `npm test` (link parsing, chapter and caption parsing, prompt building).

## How it works

1. `POST /api/video` parses the link, loads the watch page and the Innertube player response, and extracts metadata, chapters (player chapters, else description timestamps) and the caption track (manual English captions preferred, then auto-generated).
2. `POST /api/chat` sends the conversation to Claude. The system prompt holds the metadata, chapters and transcript (merged into ~20 s blocks) and is prompt-cached, so follow-up questions are cheap. The viewer's current playback position rides along with each question for relative requests.
3. The client streams the answer, seeks the player when it sees `[[seek m:ss]]` on the first line, and renders `[m:ss]` as seek buttons.

Video data is cached in server memory per video id.

## Known limits

- Caption fetching uses YouTube's unofficial endpoints, which YouTube changes from time to time. When it fails, the app falls back to metadata only and offers the paste box.
- Voice input needs a browser with the Web Speech API (not Firefox).
