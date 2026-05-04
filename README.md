# Agent Repo Index

Agent Repo Index is an Agent Skills-compatible repository indexing skill for AI coding agents. It generates stable markdown maps that help an agent understand a codebase before doing broad search or opening large numbers of files.

The current implementation is optimized for JavaScript/TypeScript, .NET, and SQL-heavy application repos, especially NestJS, Angular, TypeORM, ASP.NET Core APIs, database script repositories, localization-heavy projects, env/config-heavy projects, and testable monorepos.

## Quick Start

From this skill directory:

```bash
node scripts/generate-agent-repo-index.mjs --root /path/to/repo --output .agent-index
```

Then read:

```bash
/path/to/repo/.agent-index/START_HERE.md
```

`START_HERE.md` routes the agent to the smallest useful generated map for the current task.

## Agent Integration

After index generation, the CLI always prints the recommended agent-instruction line.

If `AGENTS.md` or `CLAUDE.md` exists at repo root and the terminal is interactive, the CLI also offers to append that line for you.

For non-interactive or scripted usage, you can choose explicit behavior:

- Auto-append when possible: `--update-agent-instructions`
- Suppress interactive prompt: `--no-agent-instruction-offer`

The generator only targets `AGENTS.md` and `CLAUDE.md` at repo root; it does not modify other instruction files.

Recommended routing line:

```md
If `.agent-index/START_HERE.md` exists, read it first and follow its routing before broad repo search.
```

This keeps behavior explicit and portable across agent ecosystems.

## Outputs

The generator writes deterministic markdown files under `.agent-index/` by default:

- `START_HERE.md`: task router and index inventory.
- `routes.md`: NestJS controller routes when detected.
- `pages.md`: Angular route map when detected.
- `schema.md`: TypeORM entities, .NET entities, and SQL object summaries when detected.
- `components.md`: Angular component index when detected.
- `lib.md`: exported classes, functions, interfaces, types, enums, and constants.
- `feature-map.md`: inferred feature-to-first-read map plus configured hints.
- `api-client-map.md`: frontend HTTP calls mapped to backend routes where possible.
- `test-map.md`: source files mapped to direct or nearby tests.
- `large-files.md`: large files with landmarks.
- `i18n-map.md`: RESX summary and localization hot spots when detected.
- `env-config.md`: env/config variables from example files and source references.
- `staleness.md`: indexed file count and source digest.

Dates are omitted from generated files by default so repeated runs stay stable. Pass `--include-generated-date` only when volatile timestamps are acceptable.

## Configuration

The generator works with auto-discovery by default. Add `agent-index.config.json` or `.agent-index.config.json` at the repo root when a repo needs explicit roots, adapter choices, or feature hints.

Use `--config path/to/config.json` to select a specific config file.

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

Supported adapter IDs:

- `nestjs`
- `angular`
- `typeorm`
- `dotnet`
- `sql`
- `resx`
- `env`
- `tests`
- `large-files`
- `exports`
- `api-client`

`apiClient`, `largeFiles`, `csharp`, and `aspnet` are accepted as compatibility aliases.

## Validation

Run the full validation suite:

```bash
npm run validate
```

Run syntax checks directly:

```bash
node --check scripts/generate-agent-repo-index.mjs
node --check scripts/verify-index-completeness.mjs
node --check scripts/self-test.mjs
node --check src/core.mjs
node --check src/adapters.mjs
node --check src/writers.mjs
```

Run the built-in smoke test:

```bash
node scripts/self-test.mjs
```

Run an index completeness audit (count match + digest match + deterministic rerun):

```bash
npm run check:index-completeness
```

The smoke test covers adapter alias normalization, explicit missing-config failures, service-root discovery, and env/config supplemental scanning.

GitHub Actions runs `npm run validate` on pushes to `main` and on pull requests.

## Project Layout

- `SKILL.md`: Agent Skills entrypoint and usage workflow.
- `package.json`: local validation and generator scripts.
- `CONTRIBUTING.md`: contribution and validation guidance.
- `scripts/generate-agent-repo-index.mjs`: CLI entrypoint and orchestration.
- `scripts/self-test.mjs`: local smoke tests.
- `src/core.mjs`: config loading, discovery context, filesystem walking, shared helpers, and stable output writing.
- `src/adapters.mjs`: repository parsers that build the intermediate index model.
- `src/writers.mjs`: markdown renderers that turn the model into `.agent-index/*.md`.
- `examples/guesttexting.agent-index.config.json`: example config for a split NestJS/Angular/TypeORM repo.

## Relationship To ai-codex

This project started from local experimentation with a modified copy of [`skibidiskib/ai-codex`](https://github.com/skibidiskib/ai-codex), which is MIT licensed. It is now maintained as a standalone project rather than a fork because the scope, output set, configuration model, Agent Skills packaging, and target frameworks have diverged substantially.

The original `ai-codex` project focused on generating compact codebase context for AI coding assistants. Agent Repo Index keeps that general goal but rewrites the implementation around generic repo discovery, deterministic output, optional per-repo config, and expanded maps for larger application repos.

## License

MIT. See [LICENSE](LICENSE).
