# Continuum Runtime — MVP Scope (v2.1)

## ✅ IN SCOPE

1. **Runner**: accepts task as text, sends to LLM, receives plan
2. **Planner**: LLM returns execution plan (sequential steps as JSON)
3. **Executor**: executes steps sequentially in Docker sandbox
4. **Logger**: writes append-only JSONL event log
5. **Replayer**: reads event log, repeats execution, compares artifact hashes
6. **CLI**: `continuum run`, `continuum replay`, `continuum diff`, `continuum inspect`, `continuum list`, `continuum freeze`, `continuum explain`, `continuum execute`
7. **Sandbox**: Docker-based isolation
8. **Plan Cache**: `hash(prompt + context)` → reuse existing plan without LLM call
9. **Execute command**: run any ExecutionPlan JSON without LLM involvement

## 🚫 OUT OF SCOPE (MVP)

- Automatic sandbox image building/tagging (warn only on mismatch)
- Step skipping / incremental replay
- `artifact_scope` field (add when partial replay is implemented)
- Plan sharing / cloud cache
- Any scope expansion not listed in this document
- GUI / web dashboard
- Multi-model orchestration
- Parallel step execution
- Remote sandbox execution

## CLI Commands

| Command | What it does | LLM call? |
|---|---|---|
| `continuum run <prompt>` | Plan + execute + log | Yes (or cache hit) |
| `continuum execute <plan.json>` | Execute existing plan + log | No |
| `continuum replay <run_id>` | Re-execute from log, verify artifacts | No |
| `continuum explain <run_id>` | Human-readable run summary | No |
| `continuum inspect <run_id>` | Detailed run data (JSON-capable) | No |
| `continuum diff <id1> <id2>` | Compare artifact hashes | No |
| `continuum list` | List all runs | No |
| `continuum freeze` | Capture environment versions | No |
| `continuum cache clear` | Clear plan cache | No |

## Phases

1. npm init, deps, schemas (including planner_signature), type generation
2. hasher.ts + canonical-json.ts + tests
3. validator.ts + tests
4. logger.ts + storage (events.ts, runs.ts) + tests
5. CLI skeleton + freeze command
6. plan-cache.ts + tests
7. planner.ts + tests (mock LLM, includes planner_signature)
8. sandbox/docker.ts + tools.ts + tests (includes image digest capture)
9. executor.ts + tests
10. runner.ts (full pipeline with cache) + integration tests
11. replayer.ts + tests (THE CORE)
12. CLI commands: run, replay, execute, inspect, explain, diff, list
13. README, demo recording, npm publish
