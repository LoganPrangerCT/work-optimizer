# Bundled Blackboard MCP server

Read-only Blackboard tools used by Work Optimizer. Adapted from
[alanwtom/blackboard-mcp](https://github.com/alanwtom/blackboard-mcp), under the
[MIT license](LICENSE). See the [project setup instructions](../README.md) first.

## Build and test

Node.js 22.13 or newer is required. From this directory:

```sh
npm ci --ignore-scripts
npm run build
npm test
```

In Windows PowerShell, use `npm.cmd` if its execution policy blocks `npm.ps1`.
`dist/` is generated locally and is not committed. Development dependencies are
required for the build. `npm run typecheck` checks source types without emitting files.

## Sign in

Set `BB_BASE_URL` and `BB_SSO_ENTRY_URL` to your institution's HTTPS URLs in the
shell before starting the login CLI. These environment variables are separate from
Work Optimizer's `config/settings.json`; the refresh worker passes that configuration itself.
Then run:

```sh
node dist/cli/login.js
node dist/cli/status.js
```

Chrome or Edge must be installed. Complete authentication in the controlled browser
window. Never paste passwords, MFA codes, session cookies or tokens into prompts.
The standalone MCP server retains its upstream Syracuse defaults when environment
variables are absent. Configure your own institution explicitly.
Set `BB_TIME_ZONE` to your institution's IANA time zone if it differs from
`America/New_York`. Other institutions may require integration changes; live
compatibility outside the upstream Syracuse deployment has not been verified.

## Run

`node dist/index.js` starts the stdio MCP server. Other CLI commands include
`npm run courses`, `npm run discover`, `npm run logout`, and `npm run connect`.
Authentication/browser profiles and caches are stored in the user profile by default
(see `src/storage/session-store.ts`), outside this repository; do not publish them.
Source content returned to an AI client may be sent to that client's model provider.

`npm run bundle` optionally builds an upstream-compatible Claude Desktop extension
into ignored `build/` and `release/` directories; it is not needed for Work Optimizer.
