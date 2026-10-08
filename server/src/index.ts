// Local server: the API plus the built client. On Vercel, api/index.ts serves the API instead.
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { app } from "./app.js";

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
