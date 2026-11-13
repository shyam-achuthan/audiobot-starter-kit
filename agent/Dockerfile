FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 PIP_RETRIES=10
WORKDIR /app
RUN useradd --create-home --uid 10001 agent
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
USER agent
# AgentServer serves a health check on :8081 in production mode ("start").
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/', timeout=2)"
CMD ["python", "main.py", "start"]
