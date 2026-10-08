import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractChaptersFromInitialData,
  extractJsonAfter,
  formatTimestamp,
  parseCaptionXml,
  parseChaptersFromDescription,
  parsePastedTranscript,
  parseVideoId,
} from "./youtube.js";
import { buildSystemPrompt, chunkTranscript } from "./assistant.js";

test("parseVideoId handles common link shapes", () => {
  const id = "dQw4w9WgXcQ";
  for (const url of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `youtu.be/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
  ]) {
    assert.equal(parseVideoId(url), id, url);
  }
  assert.equal(parseVideoId("https://vimeo.com/123"), null);
  assert.equal(parseVideoId("not a url"), null);
});

test("formatTimestamp", () => {
  assert.equal(formatTimestamp(5), "0:05");
  assert.equal(formatTimestamp(754), "12:34");
  assert.equal(formatTimestamp(3723), "1:02:03");
});

test("parseChaptersFromDescription", () => {
  const desc = `Learn React hooks!\n\n0:00 Intro\n1:30 - useState\n(5:02) useEffect\n1:02:03 Wrap up\n\nFollow me at 12:00 tomorrow`;
  assert.deepEqual(parseChaptersFromDescription(desc), [
    { start: 0, title: "Intro" },
    { start: 90, title: "useState" },
    { start: 302, title: "useEffect" },
    { start: 3723, title: "Wrap up" },
  ]);
  assert.deepEqual(parseChaptersFromDescription("1:00 not starting at zero\n2:00 x\n3:00 y"), []);
});

test("parseCaptionXml handles legacy and srv3 formats", () => {
  const legacy = `<transcript><text start="0.5" dur="2.1">Hello &amp;amp; welcome</text><text start="2.6" dur="1">it&#39;s <b>hooks</b></text></transcript>`;
  assert.deepEqual(parseCaptionXml(legacy), [
    { start: 0.5, duration: 2.1, text: "Hello & welcome" },
    { start: 2.6, duration: 1, text: "it's hooks" },
  ]);
  const srv3 = `<timedtext format="3"><body><p t="1000" d="2500"><s>Hi</s><s> there</s></p><p t="4000" d="0"></p></body></timedtext>`;
  assert.deepEqual(parseCaptionXml(srv3), [{ start: 1, duration: 2.5, text: "Hi there" }]);
});

test("extractJsonAfter copes with braces inside strings", () => {
  const html = `<script>var ytInitialPlayerResponse = {"a":"}{\\"","b":{"c":1}};var x = 1;</script>`;
  assert.deepEqual(extractJsonAfter(html, "ytInitialPlayerResponse"), { a: '}{"', b: { c: 1 } });
  assert.equal(extractJsonAfter(html, "missing"), null);
});

test("extractChaptersFromInitialData", () => {
  const data = {
    x: [
      { chapterRenderer: { title: { simpleText: "Intro" }, timeRangeStartMillis: 0 } },
      { chapterRenderer: { title: { simpleText: "Say \"hi\"" }, timeRangeStartMillis: 65000 } },
      { chapterRenderer: { title: { simpleText: "Intro" }, timeRangeStartMillis: 0 } },
    ],
  };
  assert.deepEqual(extractChaptersFromInitialData(data), [
    { start: 0, title: "Intro" },
    { start: 65, title: 'Say "hi"' },
  ]);
});

test("parsePastedTranscript accepts YouTube panel format", () => {
  const pasted = `0:00\nWelcome to the course\n0:07\ntoday we build an app\nthat talks\n1:02:03 the end`;
  assert.deepEqual(parsePastedTranscript(pasted), [
    { start: 0, duration: 7, text: "Welcome to the course" },
    { start: 7, duration: 3716, text: "today we build an app that talks" },
    { start: 3723, duration: 0, text: "the end" },
  ]);
});

test("chunkTranscript groups into blocks and the prompt includes everything", () => {
  const segs = Array.from({ length: 10 }, (_, i) => ({ start: i * 5, duration: 5, text: `line${i}` }));
  assert.equal(chunkTranscript(segs), "[0:00] line0 line1 line2 line3\n[0:20] line4 line5 line6 line7\n[0:40] line8 line9");
  const prompt = buildSystemPrompt({
    videoId: "dQw4w9WgXcQ",
    metadata: { title: "T", author: "A", description: "D", lengthSeconds: 60, keywords: ["k"] },
    chapters: [{ start: 0, title: "Intro" }],
    transcript: segs,
    transcriptSource: "captions",
  });
  for (const s of ["Title: T", "Channel: A", "[0:00] Intro", "[0:40] line8 line9", "[[seek"]) assert.ok(prompt.includes(s), s);
});
