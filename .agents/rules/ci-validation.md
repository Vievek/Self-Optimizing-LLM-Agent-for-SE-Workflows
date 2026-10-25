# Continuous Integration Validation Rule

Whenever code changes are made to this repository:

1. **Always run the full CI validation pipeline locally** to verify no lint, formatting, or test regressions:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm format:check` (or `pnpm format` if formatting needs to be updated)
   - `pnpm test`
   - `pnpm test:contract`
2. **Ensure contracts integrity**: Never modify schemas in `packages/contracts` unless explicitly instructed, as downstream packages and schemas depend on them.
