"""Tool registry and dispatch (build plan §8, §13).

The registry is keyed by the same `toolName` strings the console defines in
lib/assistant/tools.ts. If a name here and a name there ever drift apart, jobs
fail with "Unknown tool" -- keep them in lockstep.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from config import AgentConfig
from safety import SafetyError

from .actions import (
    close_window,
    focus_window,
    kill_process,
    lock_workstation,
    minimize_window,
    open_path,
    set_volume,
)
from .files import get_download_status, list_folder
from .processes import list_processes
from .system import get_system_stats
from .windows import list_windows, read_window_text

log = logging.getLogger(__name__)

ToolFn = Callable[[dict[str, Any], AgentConfig], Any]

REGISTRY: dict[str, ToolFn] = {
    # Read tools (§8.1)
    "list_processes": list_processes,
    "list_windows": list_windows,
    "read_window_text": read_window_text,
    "list_folder": list_folder,
    "get_system_stats": get_system_stats,
    "get_download_status": get_download_status,
    # Action tools (§8.2)
    "focus_window": focus_window,
    "minimize_window": minimize_window,
    "open_path": open_path,
    "set_volume": set_volume,
    "close_window": close_window,
    "kill_process": kill_process,
    "lock_workstation": lock_workstation,
}


class ToolError(Exception):
    """A tool failed in a way worth reporting back to the assistant verbatim."""


async def dispatch(
    tool_name: str, args: dict[str, Any], config: AgentConfig
) -> Any:
    """Run one tool off the event loop.

    Every tool is synchronous and several deliberately block (a 250ms CPU
    sample, a 2s download sample). Running them in the default executor keeps
    the poll loop and any live WebRTC session responsive.
    """
    fn = REGISTRY.get(tool_name)
    if fn is None:
        raise ToolError(f"Unknown tool '{tool_name}'.")

    if not isinstance(args, dict):
        raise ToolError("Tool arguments must be an object.")

    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, fn, args, config)
    except SafetyError as exc:
        # Expected, user-meaningful refusals: allowlist violations, missing
        # windows, protected processes.
        raise ToolError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Tool %s failed", tool_name)
        raise ToolError(f"{type(exc).__name__}: {exc}") from exc
