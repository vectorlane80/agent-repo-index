---
name: agent-repo-index
description: Generate and use reusable `.agent-index` repository navigation maps for JavaScript/TypeScript, PHP, .NET, and SQL-heavy projects. Use when an AI coding agent needs to index a repo, refresh navigation files, reduce broad codebase exploration, inspect NestJS routes, Angular pages/components, TypeORM entities, Laravel-style PHP routes/models, ASP.NET routes/entities, SQL objects/scripts, API client/backend mappings, tests, large files, exports, i18n, or env/config references.
compatibility: Requires Node.js 18+ and filesystem access to the repository being indexed. Uses only local file reads/writes and git metadata when available.
---

# Agent Repo Index

## Quick Start

Run the bundled generator from the repository root. Script paths are relative to this skill directory:

```bash
node scripts/generate-agent-repo-index.mjs --root /path/to/repo --output .agent-index
```

Optional behavior flags for agent-instruction integration:

- `--update-agent-instructions`: append the recommended line to repo-root `AGENTS.md` and/or `CLAUDE.md` when present.
- `--no-agent-instruction-offer`: disable interactive prompt.

The default output folder is `.agent-index/`. Treat it as generated output and keep it in `.gitignore` by default unless the target repo intentionally wants to commit it.

Then read `.agent-index/START_HERE.md` before broad repo searches. It routes task types to the smallest useful generated map.

## Configuration

The generator works with auto-discovery by default. Add `agent-index.config.json` or `.agent-index.config.json` at the repo root when a repo needs explicit roots, adapter choices, or feature hints.

Use `--config path/to/config.json` to select a specific config. Useful fields:

```json
{
  "output": ".agent-index",
  "include": ["src", "backend/src", "frontend/src"],
  "exclude": ["node_modules", "dist", "build", ".git", ".angular", ".next", "coverage", "worktrees"],
  "adapters": ["auto"],
  "roots": {
    "backend": "backend/src",
    "frontend": "frontend/src",
    "angularRoutes": "frontend/src/app/app.routes.ts",
    "typeormEntities": "backend/src/database/entities",
    "phpRoutes": "routes",
    "phpModels": "app/Models",
    "i18n": "frontend/src/assets/i18n",
    "frontendServices": "frontend/src/app/services"
  },
  "featureHints": {
    "messaging": {
      "paths": [],
      "services": [],
      "entities": []
    }
  }
}
```

## Outputs

The script writes stable markdown files under `.agent-index/`:

- `START_HERE.md`: task router and inventory counts.
- `routes.md`: NestJS, Laravel-style PHP, and ASP.NET Core routes when detected.
- `pages.md`: Angular route map when detected.
- `schema.md`: TypeORM entities, Eloquent-style PHP models, .NET entities, and SQL object summaries when detected.
- `components.md`: Angular component index when detected.
- `lib.md`: exported classes/functions/interfaces/types/enums/consts.
- `feature-map.md`: inferred feature-to-first-read map plus configured hints.
- `api-client-map.md`: frontend HTTP calls mapped to backend routes where possible.
- `test-map.md`: source files mapped to direct or nearby tests.
- `large-files.md`: files over the configured line threshold with landmarks.
- `i18n-map.md`: RESX summary and localization hot spots when detected.
- `env-config.md`: env/config variables from example files and source references.
- `staleness.md`: indexed file count and source digest.

Pass `--include-generated-date` only when volatile timestamps are acceptable in generated markdown.

## Implementation Layout

- `scripts/generate-agent-repo-index.mjs`: CLI entrypoint and orchestration.
- `src/core.mjs`: config loading, discovery context, filesystem walking, shared helpers, and stable output writing.
- `src/adapters.mjs`: repository parsers that build the intermediate index model.
- `src/writers.mjs`: markdown renderers that turn the model into `.agent-index/*.md`.

## Workflow

0. The CLI prints a recommended routing line after generation and, in interactive terminals, offers to append it to repo-root `AGENTS.md`/`CLAUDE.md` when present.
1. If `.agent-index/START_HERE.md` is missing or stale, regenerate the index.
2. Read `.agent-index/START_HERE.md`.
3. Read only the specific maps it points to for the current task.
4. Fall back to broad repo search only after the maps fail to answer the routing question.

Use `--update-agent-instructions` for non-interactive automation when you want the line appended automatically.

## Validation

Run the built-in smoke test after changes:

```bash
node scripts/self-test.mjs
```

It checks adapter alias normalization, missing config failures, service-root discovery, and env/config supplemental scanning.
