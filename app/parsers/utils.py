from __future__ import annotations


def decode_project_path(encoded: str) -> str:
    """Decode project directory name to actual path.
    e.g. 'D--session-manager' -> 'D:\\session_manager'
    """
    if "--" in encoded:
        parts = encoded.split("--", 1)
        drive = parts[0]
        rest = parts[1].replace("-", "_")
        return f"{drive}:\\{rest}"
    return encoded
