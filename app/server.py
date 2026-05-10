from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.services.session_service import SessionService

class BatchDeleteRequest(BaseModel):
    sessions: list[dict]  # [{"source": "claude", "id": "..."}, ...]

app = FastAPI(title="Session Manager")
service = SessionService()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/stats")
async def get_stats():
    return service.get_stats()


@app.get("/api/sessions")
async def list_sessions(source: str | None = None, q: str | None = None):
    if q:
        sessions = service.search_sessions(q, source)
    else:
        sessions = service.list_sessions(source)
    return [s.model_dump(mode="json") for s in sessions]


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
