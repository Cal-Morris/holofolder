# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["mlx-audio", "soundfile==0.13.1"]
# ///
"""Voiceover for record.ts, all local on Apple Silicon through MLX (Apache-2.0 models, nothing leaves the machine).

  echo '[{"out": "a.wav", "text": "spoken text", "check": "caption text"}]' | uv run marketing/video/tts.py <voice>

Every line is cloned with Qwen3-TTS 1.7B Base from voices/<voice>.wav (a take of the designed British voice, with
its transcript in voices/<voice>.txt), so the voice stays the same across lines and videos. Each line gets a few
takes; Whisper transcribes them and the take that best matches the caption wins, which weeds out mumbled words.
Models (about 6 GB together) download to the Hugging Face cache on first use.
"""
import difflib
import json
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf
from mlx_audio.stt.utils import load_model as load_stt
from mlx_audio.tts.utils import load_model as load_tts

TAKES = 3
voices = Path(__file__).parent / "voices"
voice = sys.argv[1]
ref_audio = str(voices / f"{voice}.wav")
ref_text = (voices / f"{voice}.txt").read_text().strip()
tts = load_tts("mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")
stt = load_stt("mlx-community/whisper-large-v3-turbo-asr-fp16")


def words(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", text)


for line in json.load(sys.stdin):
    best = (-1.0, None)
    for take in range(TAKES):
        parts = tts.generate(text=line["text"], ref_audio=ref_audio, ref_text=ref_text)
        audio = np.concatenate([np.array(p.audio) for p in parts])
        sf.write(line["out"], audio, tts.sample_rate)
        heard = stt.generate(line["out"]).text
        score = difflib.SequenceMatcher(None, words(line["check"]), words(heard)).ratio()
        print(f"  take {take + 1}: {score:.2f} {heard.strip()}", file=sys.stderr)
        if score > best[0]:
            best = (score, audio)
        if score >= 0.97:
            break
    sf.write(line["out"], best[1], tts.sample_rate)
