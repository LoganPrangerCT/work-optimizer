# Connect your accounts

Start the dashboard using the [README](../README.md) first. Then connect only
the sources you want. You can do one section at a time and return later.
An assistant can help: copy the [whole setup prompt](setup-prompt.md), or use
the shorter prompts in this guide.

## What do I need?

| What you want | What must be connected | Where to find it |
| --- | --- | --- |
| Add tasks yourself | Nothing beyond Node.js | [Node.js download](https://nodejs.org/) |
| Use the Refresh button | Codex CLI, your own login, and an available model | [Official Codex CLI setup](https://developers.openai.com/codex/cli/) |
| Import Blackboard work | The bundled integration, your school's public URLs, and browser sign-in | Your school's Blackboard site and IT help pages; see below |
| Import Gmail work | Gmail plugin connected to your account in Codex CLI | Run `codex`, then enter `/plugins` |
| Import Outlook work | Outlook Email plugin connected to your account in Codex CLI | Run `codex`, then enter `/plugins` |

You do not need a GitHub account to run the app. No Gmail or Blackboard API key,
OAuth client ID, callback URL, or password belongs in `config/settings.json`.
Your assistant should guide you through sign-in rather than request credentials.
School or employer administrators may restrict connections; do not bypass those
restrictions. Teams collection is not implemented.

## 1. Connect Codex

1. Follow the [official installation instructions](https://developers.openai.com/codex/cli/).
   Close and reopen your terminal, then open this project folder in it.
2. Run `codex login` and complete sign-in in the browser yourself. Run
   `codex login status` to check that sign-in succeeded.
3. Run `codex`. In the interactive session, enter `/model` and choose a model
   your account offers. Use its model identifier in the settings file below.
   If unsure of the exact identifier, ask your coding assistant to identify the
   selected model from the CLI; do not guess based on a marketing label.
4. Exit the interactive session with Ctrl+C. Run `codex exec --help` and check
   that it lists `--json`, `--output-schema`, and `--ephemeral`.

**Windows executable check:** run `Get-Command codex -All` in PowerShell.
The worker needs a native executable such as `codex.exe`, rather than just a
`codex.cmd` or `codex.ps1` launcher. If the command shows only a launcher, use
the prompt below to locate the native executable from the official installation.
Save that full path as `codexExecutable`; use forward slashes in JSON paths
(for example `C:/path/to/codex.exe`) or escape each backslash as `\\`.
On macOS/Linux, `command -v codex` shows the installed command's location.

**It works when:** login status reports a signed-in account, the selected model
is available, and the worker can launch the CLI. Model access and tool connections
depend on your account; the example model is not available to everyone.

```text
Help me connect Codex CLI for Work Optimizer. Read README.md and
docs/connections.md. Check Node, codex --version, codex login status, and
codex exec --help. If Codex is missing, use the official installation guide.
Let me complete browser sign-in. Help me find an available model using /model
and its actual identifier. On Windows, locate the native codex.exe from the
official installation; if only an npm launcher is on PATH, inspect that
installation (npm root -g can help) rather than telling me to guess a path.
Save only the needed executable/model settings in config/settings.json,
preserving existing values. Never read or display my credential files.
```

## 2. Find your Blackboard URLs

Skip this section if you do not use Blackboard.

1. Open your school's normal student portal and follow its **Blackboard** link.
   Alternatively, search the web for **your school's name + Blackboard login**.
   Prefer your school's own IT help page over third-party search results.
2. Sign in normally and reach the page listing your courses. In the address
   bar, find the Blackboard site's origin: `https://` plus the hostname, without
   `/ultra/courses` or other paths. That is **`bbBaseUrl`**. A site may use a
   school domain or a hosted Blackboard domain.
3. For **`bbSsoEntryUrl`**, use the public Blackboard sign-in link published by
   your school or the permanent target of its Blackboard **Sign in / SSO** button.
   Do not copy a Microsoft identity-provider page after redirection, a URL with
   a one-time code, or SAML authentication response data. If your normal
   Blackboard landing URL starts the correct sign-in flow itself, it can be
   used for both settings. A school-specific direct SSO link may work better.
4. If the sign-in link is unclear, have your assistant look at the school's
   public IT instructions, or ask the school's help desk:

   > What are the permanent Blackboard site URL and public SSO entry URL?
   > I need the normal login starting page, not a temporary authentication URL.

**Only share public URLs with your assistant.** You type your password and MFA
codes yourself in the browser. An email address or student ID is not a config field.

## 3. Save settings and sign in to Blackboard

1. In the project folder run `npm run setup:mcp` (`npm.cmd run setup:mcp` if
   PowerShell blocks npm). This downloads dependencies and builds the included
   integration; there is no separate Blackboard plugin to find or install.
2. Open `config/`. Copy `settings.example.json`, naming the copy `settings.json`.
   Keep the example unchanged. If `settings.json` already exists, edit it rather
   than overwrite it. Enable file extensions in your file manager so you do
   not accidentally create `settings.json.txt`.
3. Open the copy in a text editor. Replace these example values with your own:

   ```json
   {
     "bbBaseUrl": "https://blackboard.example.edu",
     "bbSsoEntryUrl": "https://blackboard.example.edu",
     "model": "MODEL_IDENTIFIER_FROM_YOUR_CODEX_CLI",
     "modelReasoningEffort": "medium",
     "allowedDomains": []
   }
   ```

   This example is **not ready to run** until those URLs and the model are
   replaced. Use double quotes and no trailing commas. Leave `allowedDomains`
   empty for ordinary setup; the configured Blackboard hostname is included
   automatically. Only add an additional Blackboard content hostname if the
   school's deployment actually needs it. Do not add `*` or unrelated sites.
4. If your institution is outside the `America/New_York` time zone, set
   `BB_TIME_ZONE` before launching. For example, in PowerShell:

   ```powershell
   $env:BB_TIME_ZONE = 'Europe/London'
   npm.cmd start
   ```

   In macOS/Linux: `BB_TIME_ZONE=Europe/London npm start`. Replace the example
   with the school's IANA time zone; your assistant can help find its name.
   These commands affect this launch only; repeat them for later launches or
   ask your assistant to help save a user environment setting.
5. Stop and restart the app after editing settings. Use its **Blackboard
   sign-in** control, then complete sign-in and MFA in the browser it opens.
   It uses a dedicated browser profile, so being signed in in another browser
   window does not guarantee that the integration is signed in.
6. Select **Refresh**. Check the Blackboard source status and compare the
   resulting tasks with your actual Blackboard work. An empty queue does not
   prove the connection works; the source must report a successful review.

This integration originated with Syracuse Blackboard. A different school's
SSO or Blackboard deployment may need code changes. Do not substitute Syracuse
URLs when your school's connection fails. Manual tasks remain usable.

```text
Connect my Blackboard to Work Optimizer. Read docs/connections.md and preserve
existing local settings. Ask my school name if unknown, then find its public
Blackboard/IT login instructions and cite the page. Help me find bbBaseUrl from
the course-list address and a permanent bbSsoEntryUrl from the school's public
login link. Do not ask me to paste redirected SAML/OAuth URLs, passwords,
cookies, or MFA codes. Build the bundled integration and help save the two
URLs and a supported model in config/settings.json. Check the school's time
zone. Restart the app, let me sign in in its controlled browser, then verify
the source's review status. If blocked, distinguish login failure, an unsupported
school deployment, and missing model access; give the exact next action.
```

## 4. Connect Gmail and/or Outlook

Skip any provider you do not want. **Installing a plugin and connecting an
account are separate steps.** Follow the [official plugin guide](https://learn.chatgpt.com/docs/plugins)
if the interface differs from these instructions.

1. Open a terminal in the project folder and run `codex`.
2. Enter `/plugins` in the interactive session (not in PowerShell or bash).
   Search for **Gmail** or **Outlook Email**, select the relevant plugin, and
   install it. Availability depends on your account and configured marketplaces.
3. Follow its **Connect / Sign in** action. Select the account whose inbox you
   want reviewed and read the requested permissions. Work Optimizer only needs
   to read mail; its worker is instructed never to send or modify it. A plugin's
   own authorization screen may offer broader permissions, so review it yourself.
   Keep credentials in the provider's sign-in page, not in this project.
4. Exit and start a **new Codex CLI session** so it can see the installed tools.
   Paste the following test, changing the provider name if needed:

   ```text
   Check whether Gmail read-only mail search is available in this CLI session.
   If it is, search for at most one recent unread message and report only
   whether the search succeeded and how many results it returned. Do not
   print message contents, mark mail read, send, draft, archive, or delete.
   If no tool is available or authorization failed, say exactly which step
   is missing. Do not create a replacement integration or copy credentials.
   ```

5. Repeat for Outlook if wanted. Then restart Work Optimizer, press **Refresh**,
   and check the corresponding source status. A successful search with zero
   results is still a working connection. Unread mail without actionable work
   may produce no tasks. Read mail is not used to create new mail tasks.

If the provider is not listed in `/plugins`, ask your assistant to inspect the
available official marketplaces and your account/workspace restrictions.
Do not download an arbitrary email connector or assume that a connection in
ChatGPT automatically works in this CLI. If unavailable, leave that provider
disconnected and continue with manual tasks or other working sources. The app
may show an unconnected source as unchecked or blocked; that is expected.

```text
Help connect Gmail and/or Outlook Email to Work Optimizer; ask which I want.
Use the actual Codex CLI /plugins browser and official available plugins.
Explain where to find Install and Connect, and let me select my account and
complete provider authorization myself. Start a fresh CLI session and run a
minimal read-only search for each chosen provider, reporting success/count
only. Then help verify its source status after a dashboard Refresh. Do not
assume desktop connections are inherited. Never copy tokens into the repo,
build a custom connector, send mail, mark it read, or change mailbox data.
```

## 5. Final check

- [ ] The dashboard starts, and a manual task survives restarting it.
- [ ] Codex is signed in and can launch the configured model/executable.
- [ ] Each chosen provider passes its own read-only connection check.
- [ ] Refresh reports what it actually reviewed; skipped sources are identified.
- [ ] No passwords, tokens, personal task data, or settings are committed to Git.

If asking for help, include the failing step, operating system, and redacted
error text. Never upload your `data/`, `config/settings.json`, Codex credentials,
or signed-in browser profile to an issue or public chat.
