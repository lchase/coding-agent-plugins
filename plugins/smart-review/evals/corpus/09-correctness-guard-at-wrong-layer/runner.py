# Unchanged by the PR: the orchestrator that drives the simulation.
import asyncio
from dataclasses import dataclass, field


@dataclass
class Conversation:
    messages: list | None = None
    records: list = field(default_factory=list)
    exit_reason: str | None = None


async def run_scenarios(scenarios, on_conversation_end, max_attempts=2):
    """Run each scenario and return one Conversation per scenario, in order.

    A scenario that fails is retried. Each attempt reports its conversation to
    on_conversation_end; only the last attempt's conversation is returned.
    """
    results = []
    for index, scenario in enumerate(scenarios):
        conv = None
        for _attempt in range(max_attempts):
            conv = await scenario.run()
            await on_conversation_end(index, conv)
            if conv.exit_reason != "retry":
                break
        results.append(conv)
        await scenario.emit_ended(turn_count=len(conv.messages or []))
    return results
