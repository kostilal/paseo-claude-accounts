# Claude Accounts for Paseo

Run [Paseo](https://paseo.sh) chats on several Claude subscriptions, and move a chat to another
account while it is open. When one account hits its limit, pick another from the pill above the
composer: the session restarts on that account and the conversation carries on.

- **Composer pill.** Shows which account the chat runs on and how full its tighter usage window
  is. Press it to see every account's 5-hour and weekly allowance and switch the chat.
- **Accounts screen.** Every Claude login on the machine, grouped by subscription, with usage bars,
  login buttons and "Add account".
- **Per chat.** A switch moves one chat. Other chats, even in the same project, stay where they are.
- **All chats at once.** "Move all chats here" on an account, pressed twice, moves every chat in
  every workspace onto it and makes it the default: chats opened later start on it too. Idle chats restart on it now, closed ones when they next open; a chat in the middle of
  a turn is left alone rather than cut off.
- **Default for new chats.** Settings → Plugins → Claude Accounts picks the account every new chat
  starts on, or **Auto**, which picks one by its allowance as each chat opens (see below);
  existing chats keep theirs. A new chat is not started when the default account cannot be used
  (removed, or its folder is gone), or when no default is set and the chat's own folder has no
  login: Paseo shows what to choose instead of an auth error.
- **Per workspace.** The **Users** button in a workspace's header chooses the account its new
  chats open on, so every chat of one task runs on one account. Under Auto, the first chat in a
  workspace chooses it for the rest. A workspace account that cannot be used (folder gone,
  logged out) is passed over. "Move all chats here" clears every workspace's account.
- **On the new-workspace screen**, where there is no workspace header yet: **+** in the composer →
  **Claude account** starts the first chat on the account you pick (or on Auto's pick), and the
  new workspace keeps it.

<p>
  <img src="assets/pill.png" alt="The account pill and its popover above a chat composer" width="400">
  <img src="assets/accounts-screen.png" alt="The Accounts screen with usage bars for each login" width="400">
</p>

## Requirements

- macOS (logins live in the login Keychain)
- Paseo 0.11 or newer, with plugins enabled (Settings → Plugins)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed

## Install

```sh
paseo plugin add git:kostilal/paseo-claude-accounts
```

Or paste `git:kostilal/paseo-claude-accounts` into **Settings → Plugins → Plugin source**.
**Accounts** then appears in the sidebar.

If `paseo` is not on your PATH, it is at `/Applications/Paseo.app/Contents/Resources/bin/paseo`.

## Getting started

1. **Add your accounts.** Open **Accounts**. Config directories that are already logged in show up
   under *Found on this machine*; press **Add** on each one you want. To add a subscription you
   have not used from this Mac yet, press **Add account**: a terminal opens `claude auth login`
   in a new `~/.claude-account-N` directory. Log in there and the account appears by itself.
2. **Switch.** In any Claude chat, press the pill and pick an account. If the agent is in the
   middle of a turn, the first press warns that the turn will be interrupted and the second press
   switches.

That is all: one login per account, the same login the account's usage is read from. There is no
second step and no separate switching key.

## How it works

**Accounts are config directories.** Claude Code keeps a login per `CLAUDE_CONFIG_DIR`. The plugin
finds:

- `~/.claude`, the default
- every `~/.claude-*`, `~/.claude_*` or `~/.claude.*` directory that contains a `.claude.json`
  (for example the directories you point `CLAUDE_CONFIG_DIR` at for work and personal use)
- `.claude-data` directories inside your Paseo projects, for setups that keep one config directory
  per project

Several directories signed in to the same login (same email and organisation) are shown as one
row, because they share one allowance. Who each directory is logged in as is asked of Anthropic
(`/api/oauth/profile`) with that directory's own login, not read from the account cached in its
`.claude.json`: Claude Code rewrites that cache to whatever login a chat in the folder runs on, so a
project whose chats were moved to another account would otherwise read as that account.

**A switch points the session at the account's login, not its directory.** Switching a chat records
the choice for that chat and restarts its session with `paseo agent reload`. When the session
reopens, the plugin's `agent.session_open` hook sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` to the
account's directory, so Claude Code reads that account's login from the Keychain while the session
keeps its own config directory — the transcript is where `--resume` looks for it, and the project's
settings, permissions and MCP servers stay in place. The same login is what the account's usage is
read from, so the meter and the chat can never drift onto different accounts. Chats you never
switched are left alone.

If the restart fails, the choice is rolled back, so the pill never shows an account the chat is not
actually running on.

**Which account a new chat opens on.** A new chat is placed once, before Claude Code starts, so
it never has to be switched (and restarted) on its first turn. In order:

1. `PASEO_CLAUDE_ACCOUNT` in the chat's environment: an account id (its folder name, `work` for
   `~/.claude-work`), e.g. `paseo run --env PASEO_CLAUDE_ACCOUNT=work …`. An id that cannot be
   used refuses the chat. Codex chats ignore it.
2. The workspace's account, from its header button, from a **Claude account** attachment on a new
   workspace's first chat (which the plugin turns into `PASEO_CLAUDE_ACCOUNT`), or from the first
   automatic pick in it.
   `PASEO_CLAUDE_ACCOUNT=@auto` asks for an automatic pick, which also follows this.
3. The default: an account, or Auto.
4. The chat's own folder's login.

**Auto** reads each logged-in account's 5-hour and weekly allowance (the cached reading, or a new
one; an account that takes more than three seconds to check counts as unknown) and picks, among
accounts with less than 95% used in both windows, the one whose week resets soonest: what is left
of it is lost at the reset. Equal resets go to the emptier 5-hour window. Accounts whose allowance
could not be read come next, then accounts whose 5-hour window is 90% used or more (they would stop
the task within minutes), then full ones, the one that has room again soonest first, so a chat
still opens when every account is full. Chats started together in one workspace land on one
account. From 90% used in either window, the pill's popover warns; whether to move the chat is up
to you.

Paseo does not hand a plugin an agent's labels before its session starts, so a label cannot
choose the account; the environment variable can.

**Usage meters** come from the same endpoint Claude Code uses, called with each config directory's
own Claude Code credentials from the Keychain. Claude Code only refreshes those credentials while
it runs in that directory, so for a directory nobody uses they expire within hours; when that
happens the plugin runs `claude -p /usage` there (a local command: no model call, no hooks, no
saved session), which makes Claude Code refresh its own token, at most every 15 minutes per
directory. The screen and the pill try to read every logged-in account in the background, at
most every ten minutes. If macOS has not yet allowed Keychain access, a background read gives up
after three seconds and the row shows **Show usage** instead; a dialog may flash briefly. Press
**Show usage** once and choose "Always Allow" so later reads go through without asking.
The endpoint rate-limits aggressively; on a 429 the last reading is kept until the wait is over.

## Files and secrets

| What | Where |
|---|---|
| Accounts, per-chat choices, hidden directories | `~/.paseo-claude-accounts/accounts.json` |
| Each account's login | Claude Code's own Keychain item for that config directory; the plugin reads it, never writes it |

The plugin keeps no secret of its own: it stores no tokens, and the state file holds only account
labels, directories and chat choices. A switched session names the account's directory in its
process environment; Claude Code reads the login from the Keychain itself.

**Delete** on the Accounts screen only forgets an account: its directory and login stay.
**Show hidden** brings it back.

## Settings

In Paseo's settings, under **Accounts**:

- **Language**: English, Русский, Українська, or the same as Paseo
- **Pill above chats**: turn the composer pill off everywhere
- **Default account for new chats**: an account, **Auto**, or not set

## From ChatGPT

With [Paseo God Mode](https://github.com/devXpro/paseo-god-mode-plugin) 0.10 or newer, ChatGPT can
read the accounts and their usage, have usage measured now, and move one chat or every chat to an
account. The plugin describes this itself through `meta.describe` (`paseo.capabilities/1`). Both
moves are read back to you before they run, naming the chat from Paseo's own data, and a refused
switch is reported as not done. Adding, deleting and logging in are not offered.

## Limitations

- **macOS only.** A session reads its login from the Keychain by directory, which the
  `CLAUDE_SECURESTORAGE_CONFIG_DIR` variable redirects; the switch is built on that.
- **A switch restarts the session**, which ends a turn in progress.
- **A switched chat shares the account's rotating login.** It is the same login the directory uses,
  refreshed in place, so chats never fight over a copied token — but logging that account out (or
  renaming its folder) logs out every chat on it until it logs in again.
- **API keys win.** If `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK` or
  `CLAUDE_CODE_USE_VERTEX` is set in the environment Paseo starts Claude Code with, Claude Code
  ignores the account login. The plugin shows a warning when it finds one in the daemon's
  environment or in Paseo's Claude provider settings; a key exported by a custom launch command
  cannot be detected.
- **Codex** (`~/.codex`, `~/.codex-*`) is supported by pointing the chat at another `CODEX_HOME`.
  Codex has no readable usage endpoint, so its rows have no meter. Paseo has to be restarted after
  installing the Codex CLI before it offers Codex chats.

## Troubleshooting

**Every account shows "Not logged in".** The daemon could not run `claude`. The plugin looks in
`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.claude/local` and `~/.npm-global/bin`,
then PATH. A daemon started from the Dock does not get your shell's PATH.

**A switch did nothing.** Check `paseo plugin logs claude-accounts`. The hook logs one line when it
leaves a session alone, for example when the account's directory is gone.

**Upgrading from 0.1.x.** The old per-account switching keys are no longer used; the plugin deletes
them from the Keychain and drops them from the state file on its first run. Each account now runs on
its directory's own login, so no action is needed — if an account was only ever switchable through a
key and its directory was never logged in, log in to it once on the Accounts screen.

**Every plugin fails with `Module "@getpaseo/plugin/client" is not available`.** The app (often the
phone) is older than the daemon. Update it.

## Development

```sh
git clone https://github.com/kostilal/paseo-claude-accounts
cd paseo-claude-accounts
npm install
npm run typecheck
npm test
paseo plugin install "$(pwd)"       # once
paseo plugin reload claude-accounts # after each change
```

`index.server.ts` and `server/` run in the daemon, `index.client.tsx` and `client/` in the app,
`shared/` in both. Tests run with Node's built-in TypeScript support (Node 22.18 or newer).

## License

MIT
