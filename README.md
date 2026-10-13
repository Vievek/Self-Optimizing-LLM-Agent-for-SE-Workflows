# Self-Optimizing LLM Agent for Software Engineering Workflows

Project ID: J26-SE-339

## Components

1. **Execution Core** (Vievegan) — solves SE tasks
2. **HEAE** (Vanayalini) — evaluation & failure attribution
3. **Memory Agent** (Deepatharshan) — long-term memory
4. **Optimization Orchestrator** (Shevoni) — runtime config updates

## Quick Start

### Prerequisites

- Windows with WSL2 (Ubuntu)
- Docker Desktop
- VS Code with Remote-WSL
- Node.js 20 LTS
- pnpm 8+

### Setup (run inside WSL2)

```bash
# Clone into WSL filesystem (NOT /mnt/c)
cd ~
git clone <repo-url>
cd self-optimizing-se-agent

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Typecheck
pnpm typecheck
```

### Store Directory

The `store/` directory is gitignored and created at runtime. It contains:

- `traces/` — execution traces (Exec Core writes)
- `events/` — outcome evidence and optimization signals
- `memory/` — LanceDB memory notes
- `config/` — embedded git repo for config versioning
- `logs/` — component logs

### Architecture

See `docs/architecture.md` for the full system diagram.

### Contracts

All shared schemas live in `packages/contracts/`. See `CONTRIBUTING.md` for the contract change process.

### Windows Notes

- Always work inside WSL2 filesystem (`~/`), not `/mnt/c/`
- `.gitattributes` enforces LF line endings
- Docker runs Linux containers for SWE-bench tasks

## Team

| Component                 | Owner           | Student ID |
| ------------------------- | --------------- | ---------- |
| Execution Core            | T. Vievegan     | IT23259720 |
| HEAE                      | K. Vanayalini   | IT23193840 |
| Memory Agent              | Deepatharshan P | IT23190184 |
| Optimization Orchestrator | Shevoni Rogers  | IT22643254 |
