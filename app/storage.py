from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path.home() / ".claude" / "session_manager_data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

_favorites_path = DATA_DIR / "favorites.json"
_notes_path = DATA_DIR / "notes.json"


def _read_json(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            logger.debug("Failed to read %s: %s", path, e)
    return {}


def _write_json(path: Path, data: dict):
    try:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        logger.warning("Failed to write %s: %s", path, e)


def get_favorites() -> list[str]:
    return _read_json(_favorites_path).get("favorites", [])


def toggle_favorite(key: str) -> list[str]:
    data = _read_json(_favorites_path)
    favs: list[str] = data.get("favorites", [])
    if key in favs:
        favs.remove(key)
    else:
        favs.append(key)
    data["favorites"] = favs
    _write_json(_favorites_path, data)
    return favs


def get_all_notes() -> dict[str, str]:
    return _read_json(_notes_path)


def get_note(key: str) -> str:
    return _read_json(_notes_path).get(key, "")


def save_note(key: str, note: str):
    data = _read_json(_notes_path)
    if note:
        data[key] = note
    else:
        data.pop(key, None)
    _write_json(_notes_path, data)
