FROM python:3.11-slim

WORKDIR /app

# System deps for audio / torch
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV AI_MODE=mock
ENV STT_MODE=mock
ENV STT_MODEL=small
ENV QWEN_MODEL=Qwen/Qwen2.5-3B-Instruct
ENV AI_PORT=7860

EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
