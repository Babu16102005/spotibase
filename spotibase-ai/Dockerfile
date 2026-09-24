FROM python:3.11-slim

WORKDIR /app

# System deps for audio / torch.
# ffmpeg is REQUIRED for faster-whisper (STT_MODE=faster-whisper) and already
# installed here — no change needed to enable real STT, only pip + env (see below).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# To bake real STT into the image, uncomment the next line (adds ~500MB):
# RUN pip install --no-cache-dir faster-whisper==1.0.1

COPY app ./app

# Defaults: mock (no heavy models). Override at run time — never hardcode secrets.
#   Real STT: -e STT_MODE=faster-whisper -e STT_MODEL=small  (+ faster-whisper installed)
#   Real LLM: -e AI_MODE=transformers  OR  -e AI_MODE=hf_api -e HF_TOKEN=...
#   Workers AI: -e AI_MODE=cf_workers -e CF_ACCOUNT_ID=... -e CF_AI_TOKEN=... [-e CF_MODEL=... -e CF_TIMEOUT_S=2.5]
ENV AI_MODE=mock
ENV STT_MODE=mock
ENV STT_MODEL=small
ENV QWEN_MODEL=Qwen/Qwen2.5-3B-Instruct
ENV AI_PORT=7860
# Optional shared cache with Spring Boot (degrades to uncached if unreachable):
# ENV REDIS_URL=redis://redis:6379/0
# ENV AI_CACHE_UNDERSTAND_TTL=300
# ENV AI_CACHE_STT_TTL=600

EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
