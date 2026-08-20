"""Filesystem allowlist and argument re-validation (build plan §8.3, §11).

This module is the AUTHORITATIVE filesystem gate. The console performs a coarse
screen before dispatching a job, but only the agent knows the configured roots,
so every path-taking tool must clear `resolve_allowed_path` here before touching
the disk.
"""

from __future__ import annotations

import os
from pathlib import Path, PurePath

from config import AgentConfig


class SafetyError(Exception):
    """Raised when a request violates the allowlist or an argument is invalid."""


# Denied unconditionally, even if a user somehow adds them as roots.
_DENIED_PREFIXES = [
    r"C:\Windows",
    r"C:\Program Files",
    r"C:\Program Files (x86)",
    r"C:\ProgramData",
    r"C:\$Recycle.Bin",
    r"C:\System Volume Information",
]


def _is_within(candidate: Path, parent: Path) -> bool:
    """True when `candidate` is `parent` or sits beneath it.

    Compared case-insensitively because Windows paths are case-insensitive and
    a case-varied prefix would otherwise slip past the check.
    """
    try:
        candidate_parts = [p.lower() for p in candidate.parts]
        parent_parts = [p.lower() for p in parent.parts]
    except AttributeError:
        return False
    if len(candidate_parts) < len(parent_parts):
        return False
    return candidate_parts[: len(parent_parts)] == parent_parts


def _is_denied(path: Path) -> bool:
    for prefix in _DENIED_PREFIXES:
        try:
            if _is_within(path, Path(prefix)):
                return True
        except (OSError, ValueError):
            continue
    return False


def resolve_allowed_path(raw: str, config: AgentConfig) -> Path:
    """Canonicalise `raw` and assert it lives inside an allowlisted root.

    Resolution happens BEFORE the allowlist comparison so that `..` traversal
    and symlinks that escape a root are both caught: a symlink inside Downloads
    pointing at C:\\Windows resolves to C:\\Windows and is then rejected.
    """
    if not raw or not raw.strip():
        raise SafetyError("No path was given.")
    if "\0" in raw:
        raise SafetyError("That path is not valid.")

    expanded = os.path.expandvars(raw.strip())

    # UNC and device paths are out of scope entirely.
    if expanded.startswith("\\\\") or expanded.startswith("//"):
        raise SafetyError("Network paths are not allowed.")

    try:
        # strict=False so a not-yet-existing file still canonicalises; symlinks
        # in the existing prefix are followed.
        resolved = Path(expanded).resolve(strict=False)
    except (OSError, ValueError) as exc:
        raise SafetyError(f"That path could not be resolved: {exc}") from exc

    if not resolved.is_absolute():
        raise SafetyError("Only absolute paths are allowed.")

    if _is_denied(resolved):
        raise SafetyError(
            "That location is a protected system directory and is never accessible."
        )

    roots = config.resolved_roots()
    if not roots:
        raise SafetyError(
            "No accessible folders are configured on this PC."
        )

    for root in roots:
        if _is_within(resolved, root):
            return resolved

    allowed = ", ".join(root.name for root in roots)
    raise SafetyError(
        f"Access to that folder is not allowed. Permitted folders: {allowed}."
    )


# ---------- argument re-validation ----------
#
# The console validates with Zod before creating a Job. These re-check the same
# constraints agent-side, so a forged or replayed job cannot bypass them.


def require_int(args: dict, key: str, *, minimum: int | None = None,
                maximum: int | None = None) -> int:
    value = args.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SafetyError(f"`{key}` must be a number.")
    as_int = int(value)
    if minimum is not None and as_int < minimum:
        raise SafetyError(f"`{key}` must be at least {minimum}.")
    if maximum is not None and as_int > maximum:
        raise SafetyError(f"`{key}` must be at most {maximum}.")
    return as_int


def require_bool(args: dict, key: str) -> bool:
    """Strict boolean: 0/1 and "true" are rejected.

    Coercing here would let a malformed job flip a toggle the user never asked
    for, so the argument must already be a real boolean.
    """
    value = args.get(key)
    if not isinstance(value, bool):
        raise SafetyError(f"`{key}` must be true or false.")
    return value


def optional_int(args: dict, key: str, default: int, *, minimum: int,
                 maximum: int) -> int:
    if args.get(key) is None:
        return default
    return require_int(args, key, minimum=minimum, maximum=maximum)


def require_str(args: dict, key: str, *, max_length: int = 400) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SafetyError(f"`{key}` must be a non-empty string.")
    if len(value) > max_length:
        raise SafetyError(f"`{key}` is too long.")
    return value


def optional_str(args: dict, key: str, *, max_length: int = 400) -> str | None:
    value = args.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise SafetyError(f"`{key}` must be a string.")
    if len(value) > max_length:
        raise SafetyError(f"`{key}` is too long.")
    return value or None


def matches_pattern(name: str, pattern: str | None) -> bool:
    if not pattern:
        return True
    return PurePath(name.lower()).match(pattern.lower())
