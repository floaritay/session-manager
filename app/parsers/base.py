from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import Message, SessionSummary


class SessionParser(ABC):
    @abstractmethod
    def list_sessions(self) -> list[SessionSummary]:
        ...

    @abstractmethod
    def get_messages(self, session_id: str) -> list[Message]:
        ...

    @abstractmethod
    def delete_session(self, session_id: str) -> bool:
        ...
