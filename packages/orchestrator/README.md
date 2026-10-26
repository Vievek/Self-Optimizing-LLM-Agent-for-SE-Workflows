# @soa/orchestrator

Optimization Orchestrator (Shevoni Rogers). Converts HEAE `OptimizationSignal` records into schema-validated, versioned `FullAgentConfig` updates that Execution Core loads through `ConfigProvider.load()` — no code change inside the other components.

The orchestrator validates and processes queued signals, validates candidates, persists config snapshots and the active version, supports rollback, and records a searchable audit trail. Git-backed commits and the 100-task evaluation remain separate follow-up work.

## Records

| Direction | Schema                             | Store path                                |
| --------- | ---------------------------------- | ----------------------------------------- |
| Read      | `OptimizationSignal` (2.0)         | `store/events/optimization_signals.jsonl` |
| Write     | `FullAgentConfig` / `Config` (1.0) | `store/config/cfg_NNNN.json`              |
| Write     | audit entries                      | `store/logs/orch-audit.jsonl`             |

Parse with the Zod schema before every write and after every read. Do not add private fields; open a contract PR instead.

## Run the TUI

From the monorepo root (after `pnpm install` and `pnpm build`):

```bash
pnpm --filter @soa/cli exec node dist/cli.js orch
```

Or, from `apps/cli` after build: `node dist/cli.js orch`.

`soa orch` reads from the `store/` directory and displays the active config, incoming signal queue, config history, audit log, and schema check. Invalid signals are rejected with an audit reason. Candidate processing prints the proposed before/after values and validation result.

```bash
soa orch queue
soa orch process [signal-id]
soa orch process --all
soa orch history
soa orch deploy <version>
soa orch rollback <version>
soa orch audit [--signal <id>] [--path <config.path>] [--since <date>]
soa orch check
```

`process` handles the first valid queued signal by default. Config versions and the active version pointer are persisted under `store/config/`; audit entries are persisted under `store/logs/` and pruned to 90 days when the command starts. Signals are read from `store/events/optimization_signals.jsonl`.

## Tests

```bash
pnpm --filter @soa/orchestrator test
```

CI must keep using mocks. Do not call a model API from this package.

## Module map (later WBS tasks)

| Module                       | Responsibility                                                                |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `config/config-store.ts`     | `ConfigProvider.load(version?)`, `cfg_NNNN` snapshots                         |
| `config/git-config-store.ts` | Git commits (not implemented); config snapshot activation is in `ConfigStore` |
| `signals/`                   | intake + router by `target.axis`                                              |
| `fix/`                       | LLM-as-judge candidate via `LlmProvider` (stub)                               |
| `validation/`                | `FullAgentConfigSchema` + range checks                                        |
| `optimizers/`                | prompt, tool, planning, workflow, retrieval, routing                          |
| `deploy/`                    | activate a version so the next `load()` returns it                            |
| `audit/`                     | queryable log, 90-day retention                                               |
| `stability/`                 | one change per `group_id`; regression rollback (partial)                      |
| `eval/`                      | 100-task simulated run: convergence, stability, recovery (stub)               |
