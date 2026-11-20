#!/usr/bin/env node
// Prints the format problems of <task-dir>/.agent-output/verdict.json, or nothing when it is well formed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verdictProblems } from "./gate.mjs";
const out = join(process.argv[2], ".agent-output");
let task = {}, verdict = null;
try { task = JSON.parse(readFileSync(join(out, "task.json"), "utf8")); } catch {}
try { verdict = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8")); } catch {}
process.stdout.write(verdictProblems(verdict, task).join("; "));
