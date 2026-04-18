*Read this in other languages: [English](README.md), [Русский](README-ru.md).*

# Continuum 🔄

### AI agents write code that works today and breaks tomorrow. Continuum fixes it forever.

[![npm](https://img.shields.io/npm/v/continuum-runtime)](https://www.npmjs.com/package/continuum-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

**Continuum** is a deterministic runtime for AI-generated code. It captures what the AI decided to do, executes it in a sandbox, and **proves** the result is reproducible — or **heals it** when reality drifts.

Think of it as **CI/CD for the AI era**: not just "did the tests pass?" but "can we reproduce exactly what the AI built, and fix it when the world changes?"

```bash
npm install -g continuum-runtime
```


https://github.com/user-attachments/assets/fc314d49-c190-4bba-b9bc-025d9a0fd4c9


## The Problem

Every day, millions of developers use AI to generate code. Every week, that code breaks:

- `express` patches from `4.21.2` to `4.21.3`
- Node updates from `20.11` to `20.12`
- A lockfile drifts
- The AI model changes behavior

The industry's answer: *"Just run the AI again."*
That costs money, takes time, and produces different results.

**Continuum's answer:** Run once. Cache the plan. Replay forever. Heal when needed.

## 30-Second Demo

```bash
# 1. AI writes code (the only time you pay for LLM)
$ continuum run "Express API: GET /health, POST /echo, jest tests, pinned deps"
  ✓ Planned 6 steps via Claude
  ✓ Executed in sandbox
  ✓ Assertions: 3/3 passed
  → Run ID: abc-123

# 2. Same prompt, zero AI cost
$ continuum run "Express API: GET /health, POST /echo, jest tests, pinned deps"
  ✓ Plan cache hit — skipping LLM
  ✓ Executed in 12s
  → Run ID: def-456

# 3. Prove it's identical
$ continuum replay abc-123
  ✓ 6/6 artifact hashes match
  ✓ 3/3 assertions passed
  → REPLAY VERIFIED

# 4. A month later — dependencies drifted
$ continuum replay abc-123
  ✗ Drift detected: express 4.21.2 → 4.21.3
  ✗ Assertion failed: GET /health → 500

# 5. One command to fix everything
$ continuum replay abc-123 --heal
  ⚙ Level 1: Retrying flaky assertions... skipped
  ⚙ Level 2: npm ci (deterministic repair)... applied
  ⚙ Re-verifying... 3/3 assertions passed
  ✓ HEALED — generation 1 saved (zero LLM cost)
```

No AI was called during healing. The fix was mechanical.
The LLM is only invoked as a **last resort** — when deterministic repairs fail.

## How It Works

```
You: "build Express API with auth"
         │
         ▼
    ┌─────────┐     cache hit?     ┌──────────┐
    │ Planner │────── yes ────────▶│  Cached   │
    │ (LLM)   │                    │   Plan    │
    └────┬────┘                    └─────┬─────┘
         │ no                            │
         ▼                               ▼
    ┌─────────┐                    ┌───────────┐
    │ New Plan│───────────────────▶│  Execute  │
    │ (JSON)  │                    │ (sandbox) │
    └─────────┘                    └─────┬─────┘
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │   Verify     │
                                  │ hash + assert│
                                  └──────┬───────┘
                                         │
                              ┌──────────┴──────────┐
                              │                     │
                         ✓ Verified            ✗ Drifted
                              │                     │
                         Save & done          Repair Cascade
                                                    │
                                          L1: Retry (flaky)
                                          L2: Deterministic fix
                                          L3: LLM repair (1 shot)
                                          L4: Manual (with diagnostics)
```

Every file gets a `sha256` hash. Every command's exit code is recorded. The plan itself is hashed. **Replay compares artifacts, not stdout** — so npm warnings don't break your builds.

## Verification: Two Independent Layers

| | Hashes match | Hashes differ |
|---|---|---|
| **Assertions pass** | `identical` ✓ | `benign_drift` — accept new reality |
| **Assertions fail** | `regression` — bug in plan | `drifted` — trigger Repair Cascade |

**Benign drift** is the key insight: if `package-lock.json` changed but all tests still pass, that's not a failure — it's the world moving forward. Continuum accepts it and creates a new verified generation. No LLM needed.

## The Repair Cascade

When assertions fail, Continuum doesn't immediately call an LLM. It tries the cheapest fix first:

| Level | What | Cost | Example |
|-------|------|------|---------|
| **1** | Retry | $0 | Flaky HTTP assertion → wait and retry |
| **2** | Deterministic fix | $0 | Dep drift → `npm ci` from lockfile |
| **3** | LLM repair | ~$0.03 | Broken import → AI patches one file |
| **4** | Unrecoverable | $0 | Major Node version → tells you exactly what to do |

**LLM is invoked in ~1 out of 10 failures.** Everything else is mechanical.

## CLI Reference

| Command | What | LLM? |
|---------|------|------|
| `continuum run <prompt>` | Plan + execute + verify | Yes (or cache) |
| `continuum execute <plan.json>` | Run any plan without LLM | **No** |
| `continuum replay <run_id>` | Re-execute + verify hashes | **No** |
| `continuum replay <id> --heal` | Detect drift + Repair Cascade | Rarely |
| `continuum explain <run_id>` | Human-readable step-by-step | **No** |
| `continuum inspect <run_id>` | Full run data (`--json`) | **No** |
| `continuum diff <id1> <id2>` | Compare artifact hashes | **No** |
| `continuum history <plan_hash>` | Show generation lineage | **No** |
| `continuum list` | List all runs | **No** |
| `continuum freeze` | Snapshot environment versions | **No** |

**8 out of 10 commands never touch an LLM.** The runtime is the product, not the AI.

## Plan = Executable Artifact

Plans are JSON. They can be written by AI, written by hand, or exported from any run:

```bash
# Export a plan from a previous run
continuum inspect abc-123 --json | jq '.plan' > my-api.plan.json

# Anyone can execute it — no API key needed
continuum execute my-api.plan.json

# Same result. Every time.
```

Plans track their **lineage** — every repair creates a new generation with full ancestry:

```bash
$ continuum history sha256:aaa
  gen 0: sha256:aaa (original, claude-sonnet, Jan 15)
    └─ gen 1: sha256:bbb (deterministic: npm-ci, Feb 25)
        └─ gen 2: sha256:ccc (llm-repair: 1 mutation, Mar 15)
```

## When to Use Continuum

| Scenario | Without Continuum | With Continuum |
|----------|-------------------|----------------|
| AI-generated project breaks after a month | Re-run AI ($), hope for the same result | `replay --heal`, fixed in seconds |
| Team member needs the same setup | "Ask the AI again" | `continuum execute plan.json` |
| CI for AI-produced code | Tests pass today, mystery tomorrow | Deterministic replay + assertions |
| Audit trail for AI decisions | Chat logs (useless) | Hashed plan + lineage chain |
| Reproducible experiments | "It worked on my machine" | Replay with environment fingerprint |

## Requirements

- **Node.js** ≥ 20
- **Docker** (for sandbox isolation)
- **Anthropic API key** (only for `continuum run` — everything else is local)

## Philosophy (for the curious)

<details>
<summary>Why "runtime" and not "agent framework"?</summary>

Every AI tool today focuses on making agents smarter. Continuum focuses on making **results stable**.

The LLM is a **compiler** — invoked once to produce a plan, then never needed again. Execution is deterministic. Verification is cryptographic. Repair is mechanical first, intelligent last.

This is the missing layer between "AI wrote code" and "code is in production":

```
Git    → tracks what changed
Docker → tracks where it runs
CI/CD  → tracks when it runs
Continuum → tracks WHY it was built and PROVES it still works
```

</details>

## Contributing

We're building developer infrastructure, not an AI product. PRs welcome.

```bash
git clone https://github.com/Asouei/continuum-runtime
cd continuum-runtime
npm install
npm test
```

🍜 Support the Developer

I built Continuum over a single weekend from a café in Vietnam — juggling two jobs, freelancing to stay afloat, and trying not to burn out.
The reason was blunt: I was tired of AI-generated code “working” today and exploding tomorrow because the world drifted (deps, environment, CI, everything).

If Continuum saves you or your team hours of CI/CD debugging or real money on API tokens, consider buying me a bowl of Pho. It genuinely helps keep the project alive and moving.

🪙 USDT (TRC20): TXKc7fCQicpcNV2UrthWbAYNz46xs47rmx
🏦 Bybit UID: 122577535

## License

MIT
