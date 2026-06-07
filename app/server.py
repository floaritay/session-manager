from __future__ import annotations

import asyncio
import io
import json
import zipfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.services.config_service import ConfigService
from app.services.session_service import SessionService
from app import storage


class BatchDeleteRequest(BaseModel):
    sessions: list[dict]  # [{"source": "claude", "id": "..."}, ...]


class NoteRequest(BaseModel):
    note: str = ""


class ContentRequest(BaseModel):
    content: str = ""


app = FastAPI(title="Session Manager")
service = SessionService()
config_service = ConfigService()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ── SSE Background Task ──

_sse_subscribers: list[asyncio.Queue] = []
_last_session_count: int | None = None


async def _session_watcher():
    """Background task that checks for new sessions and notifies SSE subscribers."""
    global _last_session_count
    await asyncio.sleep(2)  # wait for initial load
    try:
        _last_session_count = service.get_stats().get("total_sessions", 0)
    except Exception:
        _last_session_count = 0
    while True:
        try:
            await asyncio.sleep(15)
            # Use stats cache (60s TTL) to avoid full re-parse
            current = service.get_stats().get("total_sessions", 0)
            if _last_session_count is not None and current != _last_session_count:
                msg = json.dumps({"type": "sessions_changed", "count": current})
                for q in list(_sse_subscribers):
                    try:
                        q.put_nowait(msg)
                    except asyncio.QueueFull:
                        pass
            _last_session_count = current
        except asyncio.CancelledError:
            break
        except Exception:
            pass


@app.on_event("startup")
async def start_watcher():
    app.state.watcher_task = asyncio.create_task(_session_watcher())


# ── Routes ──


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/stats")
async def get_stats():
    return service.get_stats()


@app.get("/api/sessions")
async def list_sessions(
    source: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    favorites: bool = False,
):
    if q:
        sessions = service.search_sessions(q, source)
    else:
        sessions = service.list_sessions(source)

    # Server-side favorites filter
    if favorites:
        fav_set = set(storage.get_favorites())
        sessions = [s for s in sessions if f"{s.source}:{s.id}" in fav_set]

    # Server-side note search: also match note content when searching
    if q:
        q_lower = q.lower()
        note_data = storage.get_all_notes()
        note_match_keys = {k for k, v in note_data.items() if q_lower in v.lower()}
        if note_match_keys:
            existing_ids = {f"{s.source}:{s.id}" for s in sessions}
            all_sessions = service.list_sessions(source)
            for s in all_sessions:
                key = f"{s.source}:{s.id}"
                if key in note_match_keys and key not in existing_ids:
                    sessions.append(s)
                    existing_ids.add(key)

    total = len(sessions)
    start = (page - 1) * per_page
    end = start + per_page
    return {
        "sessions": [s.model_dump(mode="json") for s in sessions[start:end]],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


@app.get("/api/sessions/{source}/{session_id}")
async def get_session(source: str, session_id: str):
    if source not in ("claude", "codex"):
        raise HTTPException(400, "source must be 'claude' or 'codex'")
    messages = service.get_messages(session_id, source)
    return [m.model_dump(mode="json") for m in messages]


@app.get("/api/sessions/{source}/{session_id}/subagents")
async def list_subagents(source: str, session_id: str):
    if source not in ("claude", "codex"):
        raise HTTPException(400, "source must be 'claude' or 'codex'")
    return service.list_subagents(session_id, source)


@app.get("/api/sessions/{source}/{session_id}/export")
async def export_session(source: str, session_id: str, format: str = "markdown"):
    if source not in ("claude", "codex"):
        raise HTTPException(400, "source must be 'claude' or 'codex'")
    if format not in ("markdown", "json"):
        raise HTTPException(400, "format must be 'markdown' or 'json'")
    content = service.export_session(session_id, source, format)
    if not content:
        raise HTTPException(404, "Session not found")
    if format == "json":
        return PlainTextResponse(content, media_type="application/json")
    return PlainTextResponse(content, media_type="text/markdown")


@app.post("/api/sessions/delete-batch")
async def delete_sessions_batch(body: BatchDeleteRequest):
    results = []
    for s in body.sessions:
        src = s.get("source", "")
        sid = s.get("id", "")
        if src in ("claude", "codex") and sid:
            ok = service.delete_session(sid, src)
            results.append({"id": sid, "source": src, "ok": ok})
    return {"deleted": results}


@app.delete("/api/sessions/{source}/{session_id}")
async def delete_session(source: str, session_id: str):
    if source not in ("claude", "codex"):
        raise HTTPException(400, "source must be 'claude' or 'codex'")
    ok = service.delete_session(session_id, source)
    if not ok:
        raise HTTPException(404, "Session not found or delete failed")
    return {"ok": True}


# ── Config Management Routes ──

@app.get("/api/config/stats")
async def get_config_stats():
    return config_service.get_config_stats()


@app.get("/api/skills")
async def list_skills(q: str | None = None):
    skills = config_service.list_skills(q)
    return [s.model_dump(mode="json") for s in skills]


@app.get("/api/skills/{skill_id:path}/body")
async def get_skill_body(skill_id: str):
    body = config_service.get_skill_body(skill_id)
    if not body:
        raise HTTPException(404, "Skill not found")
    return PlainTextResponse(body, media_type="text/markdown")


@app.get("/api/mcp")
async def list_mcp_servers(q: str | None = None):
    servers = config_service.list_servers(q)
    return [s.model_dump(mode="json") for s in servers]


@app.get("/api/rules")
async def list_rules(scope: str | None = None, q: str | None = None):
    rules = config_service.list_rules(scope, q)
    return [r.model_dump(mode="json") for r in rules]


@app.get("/api/rules/{rule_id:path}/content")
async def get_rule_content(rule_id: str):
    content = config_service.get_rule_content(rule_id)
    if not content:
        raise HTTPException(404, "Rule not found")
    return PlainTextResponse(content, media_type="text/plain")


@app.get("/api/plugins")
async def list_plugins(q: str | None = None):
    plugins = config_service.list_plugins(q)
    return [p.model_dump(mode="json") for p in plugins]


# ── Favorites ──

@app.get("/api/favorites")
async def get_favorites():
    return {"favorites": storage.get_favorites()}


@app.post("/api/favorites/{source}/{session_id}")
async def toggle_favorite(source: str, session_id: str):
    key = f"{source}:{session_id}"
    favs = storage.toggle_favorite(key)
    return {"favorites": favs}


# ── Notes ──

@app.get("/api/notes")
async def get_all_notes():
    return {"notes": storage.get_all_notes()}


@app.get("/api/sessions/{source}/{session_id}/note")
async def get_note(source: str, session_id: str):
    key = f"{source}:{session_id}"
    return {"note": storage.get_note(key)}


@app.put("/api/sessions/{source}/{session_id}/note")
async def save_note(source: str, session_id: str, body: NoteRequest):
    key = f"{source}:{session_id}"
    storage.save_note(key, body.note)
    return {"ok": True}


# ── Rule Editing ──

@app.put("/api/rules/{rule_id:path}/content")
async def update_rule_content(rule_id: str, body: ContentRequest):
    rules = config_service.list_rules()
    rule = next((r for r in rules if r.id == rule_id), None)
    if not rule:
        raise HTTPException(404, "Rule not found")
    try:
        Path(rule.file_path).write_text(body.content, encoding="utf-8")
        config_service.invalidate_cache()
        return {"ok": True}
    except OSError as e:
        raise HTTPException(500, f"Failed to write: {e}")


# ── Full Backup Export ──

@app.get("/api/sessions/export-all")
async def export_all_sessions(format: str = "json", ids: str | None = None):
    if format not in ("markdown", "json"):
        raise HTTPException(400, "format must be 'markdown' or 'json'")
    all_sessions = service.list_sessions()
    if ids:
        id_set = set(ids.split(","))
        sessions = [s for s in all_sessions if f"{s.source}:{s.id}" in id_set]
    else:
        sessions = all_sessions
    if format == "json":
        def generate_json():
            yield "[\n"
            for i, s in enumerate(sessions):
                msgs = service.get_messages(s.id, s.source)
                entry = {
                    "session": s.model_dump(mode="json"),
                    "messages": [m.model_dump(mode="json") for m in msgs],
                }
                if i > 0:
                    yield ",\n"
                yield json.dumps(entry, ensure_ascii=False, indent=2)
            yield "\n]"
        return StreamingResponse(generate_json(), media_type="application/json",
                                 headers={"Content-Disposition": "attachment; filename=sessions_export.json"})
    # Markdown: zip with one file per session
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for s in sessions:
            md = service.export_session(s.id, s.source, "markdown")
            if md:
                safe_name = f"{s.source}_{s.id[:8]}.md"
                zf.writestr(safe_name, md)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=sessions_export.zip"})


# ── SSE Real-time Updates ──

@app.get("/api/events")
async def sse_events():
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _sse_subscribers.append(queue)

    async def event_generator():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            if queue in _sse_subscribers:
                _sse_subscribers.remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
