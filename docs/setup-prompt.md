# Ask your GPT to help set up Work Optimizer

Copy the prompt below. A coding assistant with access to the extracted project
folder can run local checks. A normal chat can explain the steps if you provide
the README and any error text. Redact personal information from errors first.

```text
Help me set up this copy of Work Optimizer on my computer.

Read README.md first. Tell me which folder to open a terminal in. Check my
operating system and Node.js version; this app requires Node 22.13 or newer.
Start with the manual dashboard, which needs no npm install, AI account, or
Blackboard login. On Windows use start.cmd; otherwise use npm start. Help me
open http://127.0.0.1:4173, add a test task, log time, and confirm it survives a
restart. Keep the server bound to localhost.

If you have terminal access, run npm test and report failures accurately. If
you cannot access my files or run commands, give me one small step at a time
and wait for the result instead of claiming you performed checks.

Once manual tasks work, ask whether I want optional AI refresh. If I do:
- Follow the optional setup in README.md and official Codex CLI documentation.
- Check for a working native Codex executable and a model my account can use.
- Build the integration using npm run setup:mcp.
- Create config/settings.json from the example only if it does not exist;
  preserve any existing settings. Ask for my school's public Blackboard and
  sign-in URLs if needed. Do not guess that the example URLs are real.
- Check whether my school needs a different BB_TIME_ZONE. The integration
  originated with Syracuse and may need changes for other schools.
- Let me complete browser sign-in and MFA myself. Never ask for passwords,
  MFA codes, cookies, tokens, or credential files in this chat.
- Check mail tools in the actual CLI environment before promising email
  access. Only read sources; never send, mark read, delete, or modify mail
  or coursework.
- Explain that AI refresh sends source content to my configured AI provider.

Do not delete my data, replace existing task files, expose the app publicly,
publish a repository, or change unrelated code. Back up data before repairs.
Finish by telling me how to start/stop the app and what you actually verified.
```
