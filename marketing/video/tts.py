# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["mlx-audio", "soundfile==0.13.1"]
# ///
"""Voiceover for record.ts, all local on Apple Silicon through MLX (nothing leaves the machine).

  echo '[{"out": "a.wav", "text": "spoken text", "check": "caption text"}, ...]' | uv run marketing/video/tts.py <voice>

The whole script is spoken in one continuous take by Qwen3-TTS (Apache-2.0), cloned from voices/<voice>.wav and
its transcript voices/<voice>.txt, so the accent and energy hold from the first line to the last. Whisper then
transcribes the take with word timings; the take that best matches the script wins, it is cut back into one file
per line at the quietest moment between lines (untrimmed, so the lines laid end to end are the take as spoken),
and a short breath is added after every sentence inside a line.
Models download to the Hugging Face cache on first use.
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
BREATH = 0.35  # seconds added after a sentence ends inside a line
voices = Path(__file__).parent / "voices"
ref_audio, ref_text = str(voices / f"{sys.argv[1]}.wav"), (voices / f"{sys.argv[1]}.txt").read_text()
lines = json.load(sys.stdin)
tts = load_tts("mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16")
stt = load_stt("mlx-community/whisper-large-v3-turbo-asr-fp16")
sr = tts.sample_rate
hop = int(sr * 0.01)


ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def spell(n: int) -> str:
    # Whisper writes numbers as digits; the script spells them out, so compare them spelt out.
    if n >= 1000:
        return f"{spell(n // 1000)} thousand {spell(n % 1000) if n % 1000 else ''}"
    if n >= 100:
        return f"{ONES[n // 100] if n >= 200 else ''} hundred {spell(n % 100) if n % 100 else ''}"  # "a hundred and"
    return ONES[n] if n < 20 else f"{TENS[n // 10]} {ONES[n % 10] if n % 10 else ''}"


def words(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower().replace(",", "")
    text = re.sub(r"\d+", lambda m: f" {spell(int(m.group()))} " if len(m.group()) < 5 else m.group(), text)
    return [w for w in re.findall(r"[a-z0-9]+", text) if w not in ("a", "and")]


def quietest(a, lo: float, hi: float) -> int:
    # The quietest 10 ms between two moments (Whisper's word timings are only roughly right), as a sample index.
    lo, hi = int(sr * max(lo, 0)), int(sr * min(hi, len(a) / sr))
    frames = [(np.abs(a[i : i + hop]).mean(), i) for i in range(lo, max(lo + hop, hi - hop), hop)]
    return min(frames)[1] + hop // 2


best = (-1.0, None, None)
script = [w for line in lines for w in words(line["text"])]
for take in range(TAKES):
    parts = tts.generate(text=" ".join(line["text"] for line in lines), ref_audio=ref_audio, ref_text=ref_text)
    audio = np.concatenate([np.array(p.audio) for p in parts])
    sf.write(lines[0]["out"], audio, sr)
    heard = [w for seg in stt.generate(lines[0]["out"], word_timestamps=True).segments for w in seg.get("words", [])]
    score = difflib.SequenceMatcher(None, script, [t for w in heard for t in words(w["word"])]).ratio()
    print(f"  take {take + 1}: {score:.2f}", file=sys.stderr)
    if score > best[0]:
        best = (score, audio, heard)
    if score >= 0.97:
        break
_, audio, heard = best

# Map every script word to the heard word it matched, so each line's last word can be found in the take.
tokens = [(i, t) for i, w in enumerate(heard) for t in words(w["word"])]
match = difflib.SequenceMatcher(None, script, [t for _, t in tokens], autojunk=False)
heard_at = {}
for a, b, n in match.get_matching_blocks():
    for k in range(n):
        heard_at[a + k] = tokens[b + k][0]

cuts, said = [0], 0
for line in lines[:-1]:
    said += len(words(line["text"]))
    i = max((heard_at[k] for k in range(said) if k in heard_at), default=0)
    end, nxt = heard[i]["end"], heard[i + 1]["start"] if i + 1 < len(heard) else heard[i]["end"] + 0.3
    cuts.append(max(cuts[-1] + hop, quietest(audio, end - 0.05, nxt + 0.1)))
cuts.append(len(audio))

for line, a, b in zip(lines, cuts, cuts[1:]):
    seg, start, out = audio[a:b], 0, []
    t0 = a / sr
    for w, nxt in zip(heard, heard[1:]):
        if not (t0 < w["end"] < b / sr - 0.2) or w["word"].strip()[-1:] not in ".!?":
            continue
        cut = quietest(audio, w["end"] - 0.05, nxt["start"] + 0.1) - a
        if start < cut < len(seg):
            out += [seg[start:cut], np.zeros(int(sr * BREATH))]
            start = cut
    out.append(seg[start:])
    # Untrimmed: laid end to end, the lines are the take exactly as it was spoken, natural gaps and all.
    sf.write(line["out"], np.concatenate(out), sr)
