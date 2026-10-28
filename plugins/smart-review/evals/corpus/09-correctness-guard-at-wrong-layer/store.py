import asyncio
import json
import logging

from runner import Conversation, run_scenarios

logger = logging.getLogger(__name__)


def _release_payload(conv: Conversation) -> None:
    # Free the transcript once it is safely in the object store.
    conv.messages = None
    conv.records = []


async def _write_artifact(s3, index: int, conv: Conversation, released: set[int]) -> str:
    key = f"scenario-{index}.json"
    body = json.dumps({"messages": conv.messages, "records": conv.records})
    await s3.put(key, body)
    _release_payload(conv)
    released.add(id(conv))
    return key


async def _drain_writes(queue: asyncio.Queue, s3, released: set[int], keys: dict) -> None:
    """Drain finished conversations and write them.

    on_conversation_end is called from an inner event loop via asyncio.to_thread,
    so the drain never touches a conversation the runner is still using.
    """
    while True:
        batch = [await queue.get()]
        while not queue.empty():
            batch.append(queue.get_nowait())
        if None in batch:
            batch.remove(None)
            done = True
        else:
            done = False
        written = await asyncio.gather(*[_write_artifact(s3, i, c, released) for i, c in batch])
        for (i, _), key in zip(batch, written):
            keys[i] = key
        if done:
            return


async def _fill_gaps(s3, conversations, keys: dict, released: set[int]) -> None:
    for index, conv in enumerate(conversations):
        if index in keys:
            continue
        if id(conv) in released:
            raise RuntimeError(f"released conversation at unwritten position {index}")
        keys[index] = await _write_artifact(s3, index, conv, released)


async def simulate(scenarios, s3) -> dict:
    queue: asyncio.Queue = asyncio.Queue()
    released: set[int] = set()
    keys: dict[int, str] = {}

    async def on_end(index, conv):
        await queue.put((index, conv))

    drain = asyncio.create_task(_drain_writes(queue, s3, released, keys))
    conversations = await run_scenarios(scenarios, on_end)
    await queue.put(None)
    await drain
    await _fill_gaps(s3, conversations, keys, released)
    return keys
