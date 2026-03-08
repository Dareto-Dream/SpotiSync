FROM python:3.13

# Ensure print() output is flushed immediately in Railway's container
ENV PYTHONUNBUFFERED=1

# Install system dependencies:
# ffmpeg        — required by discord.FFmpegPCMAudio
# libsodium23   — runtime library required by PyNaCl
# libopus0      — required for Discord voice encoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsodium23 \
    libopus0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "main.py"]