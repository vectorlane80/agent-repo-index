# Contributing

Agent Repo Index is currently a small, dependency-free Node.js skill. Keep changes focused, deterministic, and easy for AI coding agents to validate.

## Local Validation

Run the full local validation suite before committing:

```bash
npm run validate
```

This runs syntax checks for every script/module and then executes the smoke test.

## Development Guidelines

- Keep generated markdown deterministic by default.
- Do not add volatile timestamps outside explicit opt-in behavior.
- Prefer small adapters and writers over hardcoded project-specific paths.
- Add config examples instead of baking private repo assumptions into generator logic.
- Keep missing or partially detected frameworks graceful; empty adapters should not crash generation.
- Never silently modify instruction files. Any `AGENTS.md`/`CLAUDE.md` update behavior must be explicit opt-in (flag or interactive confirmation).
- Update `README.md` and `SKILL.md` when CLI flags, config shape, outputs, or workflow expectations change.

## Testing New Repo Shapes

When expanding framework support, validate against both:

- a small fixture or smoke-test scenario committed to this repo, and
- at least one real application repo when available.

Large-repo support should be designed around bounded scanning, stable output sizes, and clear stale-index behavior.
