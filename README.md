# claude-plugins

Claude Code plugins by Abdelrahman Elkady.

| Plugin | What it does |
| --- | --- |
| [split](plugins/split) | `/split` forks the current session into a terminal split beside it |
| [fleet](plugins/fleet) | `/fleet` toggles a pane with the subagent budget spent per model and the agents running now |

## Install

In Claude Code:

```
/plugin marketplace add abdelrahman-elkady/claude-plugins
/plugin install split@elkady
```

Or declare it in `~/.claude/settings.json` (e.g. in your dotfiles), and Claude Code picks it up on any machine:

```json
{
  "extraKnownMarketplaces": {
    "elkady": { "source": { "source": "github", "repo": "abdelrahman-elkady/claude-plugins" } }
  },
  "enabledPlugins": { "split@elkady": true }
}
```

Update after a push:

```
claude plugin marketplace update elkady && claude plugin update split@elkady
```

then restart Claude Code or run `/reload-plugins`.

## Develop

```
claude --plugin-dir ./plugins/split     # loads this copy; reloads on save
claude plugin validate ./plugins/split
claude plugin test ./plugins/split
```

If the marketplace version is installed too, disable it first (`claude plugin disable split@elkady`) so only one copy loads.
