# Scripted SIP phone for tests: baresip (Debian package) plays a WAV as the caller's voice
# and records what it hears. Not part of any production profile.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends baresip-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY config accounts /root/.baresip/
ENTRYPOINT ["baresip", "-f", "/root/.baresip"]
