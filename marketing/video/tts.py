# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["mlx-audio", "soundfile==0.13.1"]
# ///
"""Voiceover for record.ts, all local on Apple Silicon through MLX (nothing leaves the machine).

  echo '[{"out": "a.wav", "text": "spoken text", "check": "caption text"}]' | uv run marketing/video/tts.py <voice>

Every line is spoken by Chatterbox (MIT), cloned from voices/<voice>.wav, a synthetic British voice, with its
exaggeration turned up for a lively, slightly over-the-top delivery. Each line gets a few takes; Whisper transcribes
them and the take that best matches the caption wins, which weeds out mumbles and skipped words.
Models download to the Hugging Face cache on first use.
"""
import difflib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf
from mlx_audio.stt.utils import load_model as load_stt
from mlx_audio.tts.utils import load_model as load_tts

TAKES = 3
EXAGGERATION = float(os.environ.get("VO_EXAGGERATION", "0.9"))
CFG = float(os.environ.get("VO_CFG", "0.4"))
ref_audio = str(Path(__file__).parent / "voices" / f"{sys.argv[1]}.wav")
tts = load_tts("mlx-community/Chatterbox-TTS-fp16")
stt = load_stt("mlx-community/whisper-large-v3-turbo-asr-fp16")


def words(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", text)


def shout(word: str):
    # A leading shouted word ("STOP!!!") is voiced on its own, cranked right up, then joined to the rest.
    parts = tts.generate(text=word.capitalize() + "!", ref_audio=ref_audio, exaggeration=1.6, cfg_weight=0.3)
    return np.concatenate([np.array(p.audio) for p in parts])


for line in json.load(sys.stdin):
    lead = None
    m = re.match(r"^([A-Z]{2,})!+\s+(.*)$", line["text"])
    if m:
        lead = shout(m.group(1))
        line = {**line, "text": m.group(2), "check": re.sub(r"^[A-Z]{2,}!+\s+", "", line["check"])}
    best = (-1.0, None)
    for take in range(TAKES):
        parts = tts.generate(text=line["text"], ref_audio=ref_audio, exaggeration=EXAGGERATION, cfg_weight=CFG)
        audio = np.concatenate([np.array(p.audio) for p in parts])
        sf.write(line["out"], audio, tts.sample_rate)
        heard = stt.generate(line["out"]).text
        score = difflib.SequenceMatcher(None, words(line["check"]), words(heard)).ratio()
        print(f"  take {take + 1}: {score:.2f} {heard.strip()}", file=sys.stderr)
        if score > best[0]:
            best = (score, audio)
        if score >= 0.95:
            break
    audio = best[1] if lead is None else np.concatenate([lead, np.zeros(int(tts.sample_rate * 0.18)), best[1]])
    sf.write(line["out"], audio, tts.sample_rate)
