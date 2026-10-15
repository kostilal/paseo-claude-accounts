Claude Accounts lets you run Paseo chats on more than one Claude subscription and move a chat from one account to another while it is open. When a chat hits its usage limit, pick another account from the pill above the composer: the session restarts on that account and the conversation continues where it was.

## What you get

- **A pill above every Claude chat** showing which account the chat runs on and how much of its tighter usage window is used. Pressing it lists every account with its 5-hour and weekly allowance, and switches the chat with one more press.
- **An Accounts screen** in the sidebar listing every login found on the machine, grouped by subscription, with usage bars, a login button for accounts that are signed out, and a button to add a new account.

## How switching works

Each account you want to switch to needs a long-lived token, created once with `claude setup-token`. The Accounts screen and the pill open a terminal that runs it; you approve in the browser and the token is saved to the macOS Keychain. When you switch a chat, the plugin restarts that session with the token in `CLAUDE_CODE_OAUTH_TOKEN`. The session keeps its own config directory, so its transcript, settings and MCP servers stay where they are. A switch applies to that one chat only. Switching while a turn is running interrupts the turn; the pill asks for a second press first.

## Setup

- macOS. Tokens and usage credentials are read from the login Keychain.
- Claude Code installed and logged in at least once.
- Accounts are config directories: `~/.claude`, any `~/.claude-*` directory you use with `CLAUDE_CONFIG_DIR`, and per-project `.claude-data` directories. "Add account" creates a new one and opens `claude auth login` for it.
- Usage is read from Claude Code's Keychain item for each account. Until macOS allows that, background reads give up after three seconds and the account shows "Show usage". Press it once and choose "Always Allow" in the macOS dialog.

## What it reads and stores

- Account list and chat bindings: `~/.paseo-claude-accounts/accounts.json`. No secrets.
- Tokens: the Keychain, service `paseo-claude-accounts`, one item per login. Tokens are never written to the state file, logs or the app.
- Usage: Anthropic's usage endpoint, called with each config directory's own Claude Code credentials, at most every ten minutes per account. When those credentials have expired, the plugin runs `claude -p /usage` in that directory so Claude Code refreshes them itself; this makes no model call.

## Limits

- A token from `setup-token` cannot read usage, so meters come from a config directory signed in to the same account. An account with a token but no signed-in directory switches fine but shows no meter.
- If `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or a cloud provider variable is set in Paseo's environment, Claude Code uses it instead of the account token. The plugin warns when it can see one.
- Codex accounts (`~/.codex*`) can be switched too, by pointing the chat at another `CODEX_HOME`. Codex has no readable usage meter.
