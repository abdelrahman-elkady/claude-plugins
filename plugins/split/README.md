# split

`/split` forks the current Claude Code session into a new terminal split beside it. The main session keeps running; the fork starts with the full conversation so far.

```
/split                  fork into a split on the right
/split down             right | down | left | up
/split -n idea          name the fork yourself
/split --model sonnet   other claude flags pass through
```

- Works in cmux and tmux. Anywhere else it prints the command to run.
- The fork is named `<name>-branch-<n>`: the session's `/rename` name (or its generated title), counted per name.
- Works mid-turn: the fork copies the transcript as saved at that moment.
- Model and permission mode come from your settings, not the parent session. Pass `--model` / `--permission-mode` to override.

Built on Claude Code plugin function hooks (mods); tested on 2.1.289.
