# syntax=docker/dockerfile:1
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 PIP_RETRIES=10
WORKDIR /app
RUN useradd --create-home --uid 10001 agent

# Layer 1: core framework (large, rarely changes — keep this step byte-identical
# so Docker reuses it from cache).
COPY requirements.txt .
RUN pip install -r requirements.txt

# Layer 2: provider plugins. Uses a persistent BuildKit pip cache so adding a
# plugin later only downloads the new packages (PyPI is slow on this network).
COPY requirements-plugins.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    env -u PIP_NO_CACHE_DIR pip install -r requirements-plugins.txt

COPY . .
USER agent
# AgentServer serves a health check on :8081 in production mode ("start").
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/', timeout=2)"
CMD ["python", "main.py", "start"]
