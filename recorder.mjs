#!/usr/bin/env node
// Copilot hook contract recorder.
// Usage (from hooks json): node recorder.mjs <EventName>
// - Appends {ts, event, stdin} as one JSON line to capture.jsonl
// - Looks up response-plan.json for a response to emit for this event:
//     { "<EventName>": { "stdout": <object|null>, "exit": <number> } }
//   Missing entry => print nothing, exit 0 (observe-only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const event = process.argv[2] ?? "UNKNOWN";

let stdin = "";
try {
  stdin = fs.readFileSync(0, "utf-8");
} catch {}

let parsed = null;
try {
  parsed = JSON.parse(stdin);
} catch {}

fs.appendFileSync(
  path.join(dir, "capture.jsonl"),
  JSON.stringify({ ts: new Date().toISOString(), event, payload: parsed ?? stdin }) + "\n",
);

let plan = {};
try {
  plan = JSON.parse(fs.readFileSync(path.join(dir, "response-plan.json"), "utf-8"));
} catch {}

const r = plan[event];
if (r && r.stdout !== undefined && r.stdout !== null) {
  process.stdout.write(JSON.stringify(r.stdout));
}
if (r && r.stderr) {
  process.stderr.write(String(r.stderr));
}
process.exit(r && typeof r.exit === "number" ? r.exit : 0);
