# Claude accounts

ATC can run Claude tabs as different accounts: Claude subscriptions and Anthropic API
keys. You add and manage them in ATC. Nothing in `~/.claude` is edited, and history,
settings, skills and `CLAUDE.md` stay shared across accounts.

## Add an account

Open Settings (Ctrl+,) and go to **Claude accounts**.

**Subscription**

1. Click **Add subscription** and type a name, such as `Work`.
2. Click **Get a token**. ATC opens a tab running `claude setup-token`.
3. Sign in to the account in the browser window that opens.
4. When the token appears in the tab, ATC reopens Settings with it filled in. Check it
   against the tab and click **Save**.

If the token does not come back, copy it from the tab (it starts with `sk-ant-oat01-`)
and paste it into the box yourself.

**API key**

1. Click **Add API key** and type a name.
2. Paste a key from the Anthropic Console (it starts with `sk-ant-api03-`).
3. Click **Save**. ATC checks the key with Anthropic first and refuses one it rejects.

## Use an account

- **Default**: the radio button beside an account makes it the default for new Claude
  tabs. **Claude login** is whoever is signed in to Claude Code in `~/.claude`.
- **One tab**: pick an account from the account chip beside the model chip in a chat.
  Switching restarts Claude on the same conversation. Stop the turn first.
- **New tab as an account**: right-click a project and choose **Open in Claude as**.
- **Resuming**: a session resumes as the account it last ran as.

The tab header shows the account a tab runs as. Terminal tabs use it too.

## Manage accounts

Each account has **Show** and **Copy** for its secret, **Edit** to change its name or
secret, and **Remove**. Tabs on a removed account fall back to the default the next time
they start.

## Good to know

- Secrets are kept in `accounts.dat` in ATC's config folder
  (`%APPDATA%\Agent Terminal Control`), encrypted for your Windows user. The file is
  useless on another machine or Windows account.
- The limits meter follows the default account. An API key account has no plan limits.
- Rename with Haiku uses the default account.
- Accounts are Claude only. Codex tabs are not affected.
