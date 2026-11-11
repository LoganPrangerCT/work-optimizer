# Security

Work Optimizer runs on `127.0.0.1` for one local user. Do not expose its port
through a reverse proxy, tunnel, public interface, or shared server. It has no
multi-user authentication. GitHub Pages cannot run its Node.js and SQLite backend.

Task files, databases, backups, local settings, browser profiles and authentication
state are private. Do not attach them to issues or commit them, even for debugging.
The optional AI refresh sends task and connected-source content to your configured
AI provider. Use only accounts and sources you are authorized to access.

For a vulnerability, use the repository's private vulnerability reporting feature
if its owner has enabled it. Otherwise contact the repository owner privately.
Do not post credentials or exploit details in a public issue. If credentials were
published, revoke them before removing files or rewriting history.
