#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Builds a local speech-to-text engine for Study Mode's fallback path.
#
# Study Mode prefers the media's own caption track. When a video has none, the
# server transcribes the audio itself with whisper.cpp — no API key, nothing
# leaves the machine. This script produces the two things that path needs:
#
#   bin/whisper-cli        statically linked, so it runs without the build tree
#   models/ggml-<m>.bin    the multilingual Whisper weights (default: base)
#   models/ggml-silero-*.bin  voice-activity detection, so music and silence
#                          are skipped instead of "transcribed" into garbage
#
# Usage: npm run setup:whisper            (base model, ~142 MB)
#        WHISPER_MODEL=small npm run setup:whisper   (~466 MB, better accuracy
#                                                     for Azerbaijani/Turkish)
# ---------------------------------------------------------------------------
set -euo pipefail

TAG="${WHISPER_TAG:-v1.9.4}"
MODEL="${WHISPER_MODEL:-base}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/vendor/whisper.cpp"

for tool in git cmake make c++ curl; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

if [ ! -d "$SRC/.git" ]; then
  echo "==> cloning whisper.cpp $TAG"
  git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$SRC"
fi

echo "==> building whisper-cli (static)"
cmake -S "$SRC" -B "$SRC/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DGGML_OPENMP=OFF >/dev/null
cmake --build "$SRC/build" --config Release --target whisper-cli -j "$(nproc 2>/dev/null || echo 4)"

mkdir -p "$ROOT/bin" "$ROOT/models"
cp "$SRC/build/bin/whisper-cli" "$ROOT/bin/whisper-cli"
chmod +x "$ROOT/bin/whisper-cli"

MODEL_FILE="$ROOT/models/ggml-$MODEL.bin"
if [ ! -s "$MODEL_FILE" ]; then
  echo "==> downloading ggml-$MODEL.bin"
  curl -L --fail --progress-bar -o "$MODEL_FILE.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
  mv "$MODEL_FILE.part" "$MODEL_FILE"
fi

VAD_FILE="$ROOT/models/ggml-silero-${WHISPER_VAD:-v5.1.2}.bin"
if [ ! -s "$VAD_FILE" ]; then
  echo "==> downloading $(basename "$VAD_FILE")"
  curl -L --fail --progress-bar -o "$VAD_FILE.part" \
    "https://huggingface.co/ggml-org/whisper-vad/resolve/main/$(basename "$VAD_FILE")"
  mv "$VAD_FILE.part" "$VAD_FILE"
fi

echo "==> done"
ls -lh "$ROOT/bin/whisper-cli" "$MODEL_FILE" "$VAD_FILE"
