# Work Optimizer

A task dashboard that runs on your own computer. Add work, arrange your queue,
track time, and see completed tasks. Optional AI refresh can gather work from
Blackboard and connected email accounts.

**Start with manual tasks.** You only need Node.js. AI, a Blackboard account, and
email connections are optional. Each person runs their own copy with their own
data; this is not a shared online task database.

## Start in three steps

1. Install [Node.js](https://nodejs.org/) **22.13 or newer** (Node 24 is also
   supported). Close and reopen your terminal after installation.
2. Download the project and extract it into a normal, writable folder. If you
   downloaded a ZIP, extract it before continuing.
3. On **Windows**, double-click **`start.cmd`**. Leave its terminal window open.
   On **macOS/Linux**, open a terminal in the extracted folder and run:

   ```sh
   npm start
   ```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) if your browser does not open.
You do **not** need to run `npm install` for the dashboard. Press **Ctrl+C** in
the terminal when you want to stop it.

Select **+ Add task** to create your first task. The initial example tasks are
fictional and disappear when you add real work. Select a task to see its details
or log time, such as `30 min` or `1.5 h`. Completed tasks appear under **Completed**.
Right-click a task for priority and hide controls. Hidden tasks return to the queue
10 days before their due date.

Need help from your GPT? Copy the [setup prompt](docs/setup-prompt.md), and give
it access to this project folder if your assistant supports local files.
For AI setup, follow [Connect your accounts](docs/connections.md): it explains
exactly what to connect, where to find each value, and how to test each source.

## Where your work is saved

The app creates a private `data/` folder on first start. It contains task JSON
files, a SQLite database, and recovery backups. Stop the app before copying the
**whole `data/` folder** somewhere safe. Never share it with another user as part
of the app. See [editing and recovery](docs/tasks.md) for details.

Your optional `config/settings.json` is also private. Git ignores both it and
`data/`. Keep a backup before replacing or upgrading a working copy.

## Optional: connect AI refresh

**Use the [step-by-step connection guide](docs/connections.md)** if this is your
first setup. It includes copyable prompts for each connection. You do not need
GitHub, an API key, or a separate Blackboard plugin to use manual tasks.

This requires your own Codex access, an available model, and any source accounts
you choose to connect. Usage can consume your plan allowance or incur provider
charges. The **Refresh** button runs a review only when you press it.

1. Install and sign in to [Codex CLI](https://developers.openai.com/codex/cli/)
   following the official instructions. Verify in a new terminal:

   ```sh
   codex --version
   codex exec --help
   ```

   The CLI must support `exec`, `--json`, `--output-schema` and `--ephemeral`.
   On Windows the app launches a native executable, such as `codex.exe`. If your
   installation only exposes an npm `.cmd` shim, locate its native executable
   and set `WORK_OPTIMIZER_CODEX` or `codexExecutable` to that executable's path.

2. In this project folder, install and build the optional Blackboard integration:

   ```sh
   npm run setup:mcp
   ```

3. Copy `config/settings.example.json` to `config/settings.json`. On PowerShell:

   ```powershell
   Copy-Item config/settings.example.json config/settings.json
   ```

   On macOS/Linux use `cp config/settings.example.json config/settings.json`.
   Set `bbBaseUrl` and `bbSsoEntryUrl` to your institution's HTTPS Blackboard
   and sign-in URLs. Set `model` to one available to your Codex account. The
   example's model name is a default, not a promise of access for every account.
   Keep `allowedDomains` empty unless your task sources require additional hosts.

4. Restart the dashboard and use the **Blackboard sign-in** control. Chrome or
   Edge must be installed. Complete sign-in and MFA yourself in the browser.
   Never paste passwords, cookies, or MFA codes into an assistant.

5. For email, enable your preferred mail tools in the **Codex CLI environment**.
   Connections in a separate app or chat may not be available to the CLI. With
   those tools enabled, select **Refresh** and inspect each source's status.

The integration originated with Syracuse Blackboard. Other institutions may need
changes to the integration; they have not been live-verified. If your school's
time zone differs, set the `BB_TIME_ZONE` environment variable to its IANA time
zone before launching. See the [integration guide](blackboard-mcp/README.md).

Refresh sends task and connected-source content to the configured AI provider.
Failed sources retain prior tasks; unchecked sources are not proof that work is
complete. Confirmed unsubmitted Blackboard work can return after completion,
with logged time retained. Deleted tasks stay deleted. Review AI results yourself.

Environment overrides: `BB_BASE_URL`, `BB_SSO_ENTRY_URL`,
`WORK_OPTIMIZER_CODEX`, `WORK_OPTIMIZER_MODEL`, and
`WORK_OPTIMIZER_REASONING_EFFORT`.

## Troubleshooting

| What happens | What to do |
| --- | --- |
| `node` or `npm` is not recognized | Install Node.js 22.13+ and reopen the terminal. Run `node --version`. |
| PowerShell blocks `npm.ps1` | Use `npm.cmd` instead of `npm`, or use `start.cmd`. |
| `node:sqlite` is missing | Your Node.js is too old; update it. |
| The dashboard will not start | Read the terminal error. Stop another copy, or another program using port 4173, and retry. |
| "Workspace already open" | Stop the other Work Optimizer server before restarting. |
| Refresh fails | Check Codex login, the configured model, source connections, and the source statuses. Manual tasks still work. |
| Blackboard sign-in fails | Run `npm run setup:mcp`, check your URLs, and install Chrome or Edge. |
| A task file is invalid | Stop the app and follow [validation and recovery](docs/tasks.md); keep a backup before editing. |

## Sharing and GitHub

Share the clean source ZIP or a fresh GitHub checkout. Once you have used the app,
do not ZIP your working folder: it will contain your private `data/` and possibly
settings or browser state. See [the sharing checklist](docs/sharing.md).

GitHub hosts the source. Each person starts the app locally. GitHub Pages cannot
run its Node.js/SQLite backend. Keep the server on localhost; it has no multi-user
login and is not designed for public web hosting. See [security](SECURITY.md).

## Development

```sh
npm test
npm run setup:mcp
npm --prefix blackboard-mcp run typecheck
npm --prefix blackboard-mcp test
npm --prefix blackboard-mcp audit --omit=dev
```

`npm run test:browser` additionally checks desktop/mobile behavior and recovery
from lost responses using Playwright and Microsoft Edge on Windows. Tests use
temporary or in-memory stores and do not sign in to real accounts. GitHub Actions
runs automated checks on Windows and Linux with Node 22 and 24.

`public/` contains the interface; `src/` the server, storage and worker;
`scripts/` launch and maintenance tools; `refresh/` AI instructions and schema;
`tests/` automated tests; `blackboard-mcp/` the optional integration.
The [ingestion guide](docs/ingestion.md) covers advanced imports.

Upgrading an older layout? With the app stopped and a backup made, move
`tasks.json` and `old-tasks.json` into `data/`, renaming them `active-tasks.json`
and `completed-tasks.json`. Move `config.json` to `config/settings.json` and keep
the existing database.

## License and credit

[MIT](LICENSE). The bundled Blackboard integration is adapted from
[alanwtom/blackboard-mcp](https://github.com/alanwtom/blackboard-mcp) and retains
[its original MIT license](blackboard-mcp/LICENSE). Work Optimizer is not
affiliated with Blackboard, Anthology, Syracuse University, or OpenAI.
