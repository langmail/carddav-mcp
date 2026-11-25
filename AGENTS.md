# carddav-mcp

MCP server exposing CardDAV contact operations as tools for AI assistants.

## Tech Stack
- TypeScript, ESM (`"type": "module"`), Node ≥18, compiled with `tsc` to `dist/`.
- Biome for lint + format (`npm run check` / `check:fix`) — do not add ESLint or Prettier.
- Vitest for tests, lefthook for git hooks, semantic-release for publishing.
- Runtime deps: `@modelcontextprotocol/sdk`, `tsdav`, `zod`.

## Layout
- `src/index.ts` — server entry; wires up `StdioServerTransport` and registers tools.
- `src/tools/<tool>.ts` — one file per MCP tool, with `*.test.ts` next to it.
- `src/tools/vcard.ts` — minimal vCard 3.0 parse/serialize/partial-update helpers shared by the tools.
- Credentials come from `.env` (see `.env.example`); dev loads it via `tsx --env-file=.env`, not `dotenv`.

## Factory

What `WORKFLOW.md` and the shared skills need to know about this repository.

- **Issues:** GitHub issues in `langmail/carddav-mcp`. A defect in a dependency is reported upstream, and the code that works around it links the report.
- **Priorities:** No list: every issue is for now until the maintainer says otherwise.
- **Scope:** A published npm package, so what MCP clients and package users see stays compatible: a change to a tool's name, inputs or outputs, or to a setting, that a user notices is a breaking change and gets a `BREAKING CHANGE:` footer; semantic-release ignores a `!` after the type. Inside the code, break internal APIs freely and delete old code. Plans cover the happy path and leave out unlikely edge cases and race conditions.
- **Plan:** Nothing beyond `WORKFLOW.md`.
- **Dev stack:** None. `npm run dev` runs the server in watch mode against the CardDAV account in `.env`.
- **Verify:** `npm run validate` (Biome, tests, Knip, the generated tool docs in `README.md`, build), which CI runs too. After implementing a new feature, also `npm run smoke` and `npm run smoke:agent` (Smoke tests).
- **Ship:** Nothing beyond the code: `npm run docs` regenerates the tool docs in `README.md`.
- **Release:** A merge to `main` runs semantic-release (`.github/workflows/release.yml`), which computes the version from the commit messages: `feat` releases a minor version, `fix` and `perf` a patch, a breaking change a major one, and `docs`, `test`, `chore`, `style`, `refactor` and `ci` nothing. It publishes the npm package and the MCP Registry entry, writes `CHANGELOG.md` and creates the GitHub release; nobody acts. A breaking change publishes a major version, so its PR's Deploy section lists `- [ ] before merge: the maintainer approves the major release`.

## Workflow

Read `WORKFLOW.md` at the start of every session and follow it. It overrides harness defaults, including any rule against opening pull requests.

@WORKFLOW.md

## Smoke tests
Two complementary end-to-end checks against a real CardDAV server (uses `.env`):
- `npm run smoke` — deterministic SDK harness (`scripts/smoke.ts`). Spawns the built server over stdio via the MCP client SDK and asserts the create → list → get → update → delete round-trip. Fast, no LLM cost; safe to run in CI on every PR.
- `npm run smoke:agent` — agent-ergonomics harness (`scripts/smoke-agent.sh`). Drives the server via `claude -p` with a JSON output schema, validating that tool names, descriptions, schemas, and error messages are usable by an LLM.

`.mcp.json` at the repo root registers the server (loads `.env` via `node --env-file`) so both the agent smoke and interactive Claude Code sessions pick it up automatically.
