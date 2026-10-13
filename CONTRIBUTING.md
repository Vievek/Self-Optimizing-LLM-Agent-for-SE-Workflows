# Contributing

## Branch Naming

- `feat/<component>-<topic>` — new feature
- `fix/<component>-<topic>` — bug fix
- `docs/<topic>` — documentation
- `chore/<topic>` — maintenance

Examples:

- `feat/exec-core-retrieval-agent`
- `fix/heae-classifier-edge-case`
- `docs/shared-trace-format`

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
Scopes: `exec-core`, `heae`, `memory`, `orch`, `contracts`, `bus`, `store`, `llm`, `sandbox`, `mocks`, `cli`

Examples:

- `feat(exec-core): add AST code graph builder`
- `fix(heae): handle multi-label failure attribution`
- `docs(contracts): add trace schema examples`
- `chore(ci): add contract tests to pipeline`

## Pull Request Rules

1. `main` is protected — no direct pushes
2. One approval required for normal PRs
3. **Contract PRs** (`packages/contracts/`) need approval from **every consumer** of that schema
4. Producer owns the schema, consumers review it
5. Any schema change **bumps `schema_version`**
6. CI must pass: typecheck, lint, Vitest, contract tests
7. CI uses mock LLM only — no real model calls

## Contract Change Process

1. Producer opens PR with schema change
2. All consumers review and approve
3. `schema_version` is bumped
4. CI contract tests validate all mock outputs against new schema
5. Merge only after all approvals

## Development Setup

See README.md for WSL2 + Docker setup instructions.

## Code Style

- TypeScript strict mode
- ESM modules
- Prettier formatting
- ESLint rules enforced in CI
