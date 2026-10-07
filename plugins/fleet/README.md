# fleet

`/fleet` toggles a pane with the subagent budget you gave Claude and the agents running now.

```
Haiku 5.5   17/30
Opus 5.5    0/2
● Sonnet 5.5  port helpers    2m
done: 17
k: ▲ 0 more
  Haiku 5.5   Random tip: regex
  Haiku 5.5   Random tip: Docker
j: ▼ 13 more
```

- Tell Claude a budget ("use up to 2 opus and 10 sonnet agents", "add 2 more opus") and it calls the plugin's `set_agent_budget` tool, so the pane shows it.
- A new budget restarts the counts; "add" raises the caps and keeps them. With no budget the pane counts spawns without caps.
- Counts every spawn per exact model, nested agents included. A count at its cap turns yellow, past it red.
- Finished agents are listed newest first, failed or killed ones marked `✗`. When the list does not fit, click ▲/▼ or focus the pane and press `k`/`j`.
- It only shows the budget: Claude keeps to it, nothing is blocked.

Built on Claude Code plugin function hooks (mods); tested on 2.1.293.
