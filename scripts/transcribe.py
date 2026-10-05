"""Local STT worker. Stdout is JSON only; audio never leaves this machine."""
import json
import os
import sys
from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get("WHISPER_MODEL", "base.en"), device="cpu", compute_type="int8")
segments, info = model.transcribe(sys.argv[1], beam_size=5, vad_filter=True, language="en")
text = " ".join(segment.text.strip() for segment in segments).strip()
print(json.dumps({"transcript": text}))
