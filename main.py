"""Railway/FastAPI entrypoint.

Railway examples commonly start FastAPI apps with ``uvicorn main:app``. The
actual application lives in ``server.py``, so this module keeps that default
entrypoint working while the explicit Railway command uses ``server:app``.
"""

from server import app
