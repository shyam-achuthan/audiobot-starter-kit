# LiteLLM secrets (gitignored)

Put the Google Cloud service-account key for Vertex AI here as `vertex-sa.json`.
It is mounted read-only into the litellm container at `/secrets/vertex-sa.json`.
Never commit key files; everything in this folder except this README is ignored.
