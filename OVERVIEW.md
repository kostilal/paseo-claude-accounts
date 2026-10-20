Claude Accounts lets you run Paseo chats on more than one Claude subscription and move a chat from one account to another while it is open. When a chat hits its usage limit, pick another account from the pill above the composer: the session restarts on that account and the conversation continues where it was.

## What you get

- **A pill above every Claude chat** showing which account the chat runs on and how much of its tighter usage window is used. Pressing it lists every account with its 5-hour and weekly allowance, and switches the chat with one more press.
- **An Accounts screen** in the sidebar listing every login found on the machine, grouped by subscription, with usage bars, a login button for accounts that are signed out, and a button to add a new account.
- **The right account from the start.** New chats open on the account you choose, so they need no switch later: a default account, or **Auto**, which picks by the 5-hour and weekly allowance left (the account whose week resets soonest, while it has room). Every chat of one workspace runs on one account; the **Users** button in the workspace header changes it, and on the new-workspace screen **+** → **Claude account** picks it for the first chat. Scripts can set `PASEO_CLAUDE_ACCOUNT`.
- **Move all chats here**, on any account in that screen, moves every chat in every workspace onto it. Idle chats restart on it, closed ones switch when they next open, and chats in the middle of a turn are left alone.

## How switching works

Each account is a config directory with its own Claude login — the same login its usage is read from. When you switch a chat, the plugin restarts that session and points it at the account's directory through `CLAUDE_SECURESTORAGE_CONFIG_DIR`, so Claude Code reads that account's login from the Keychain while the session keeps its own config directory — transcript, settings and MCP servers stay where they are. One login per account, nothing to set up a second time. A switch applies to that one chat only. Switching while a turn is running interrupts the turn; the pill asks for a second press first.

## Setup

- macOS. Logins and usage are read from the login Keychain.
- Claude Code installed and logged in at least once.
- Accounts are config directories: `~/.claude`, any `~/.claude-*` directory you use with `CLAUDE_CONFIG_DIR`, and per-project `.claude-data` directories. "Add account" creates a new one and opens `claude auth login` for it.
- Usage is read from Claude Code's Keychain item for each account. Until macOS allows that, background reads give up after three seconds and the account shows "Show usage". Press it once and choose "Always Allow" in the macOS dialog.

## What it reads and stores

- Account list and chat bindings: `~/.paseo-claude-accounts/accounts.json`. No secrets.
- Logins: Claude Code's own Keychain items, one per config directory. The plugin reads them to measure usage and never writes them; it stores no token of its own.
- Who each account is: Anthropic's profile endpoint, called with the account's own login, and asked again only when that login's token changes. Claude Code rewrites the account cached in a project's `.claude.json` to the login its chats run on, so that cache is only the fallback.
- Usage: Anthropic's usage endpoint, called with each config directory's own Claude Code credentials, at most every ten minutes per account. When those credentials have expired, the plugin runs `claude -p /usage` in that directory so Claude Code refreshes them itself; this makes no model call.

## Limits

- A switched chat shares the account's rotating login, refreshed in place, so chats never fight over a copied token — but logging an account out, or renaming its folder, logs out every chat on it until it logs in again.
- If `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or a cloud provider variable is set in Paseo's environment, Claude Code uses it instead of the account login. The plugin warns when it can see one.
- Codex accounts (`~/.codex*`) can be switched too, by pointing the chat at another `CODEX_HOME`. Codex has no readable usage meter.
- Upgrading from 0.1.x removes the old per-account switching keys from the Keychain automatically; each account now runs on its directory's own login.
