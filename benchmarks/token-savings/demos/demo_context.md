# Where the tokens sit before you type

Live, about two minutes, in a normal Claude Code session. This is a talk note, not a script.

1. Start `claude` in a repo with your usual plugins. Run `/context` and read the category breakdown: system prompt, tools, MCP tools, memory, skills, messages.
2. Run `claude plugin details caveman` and `claude plugin details ponytail`. Note the always-on token cost versus the per-component cost.
3. Run `/usage` and read the `Prompt cache (main)` line: hit ratio, misses, warm or cold.
4. Optional: a statusline that prints `prompt_cache.expires_at` and `last_miss_cause`. Claude Code computes the TTL. A plugin that guesses it from a setting is behind that.
