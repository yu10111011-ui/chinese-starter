"""Generate same-origin Chinese MP3s for Brave-safe playback."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "audio" / "zh"
MANIFEST = ROOT / "data" / "audio-manifest.js"
VOICE = "zh-CN-XiaoxiaoNeural"


def collect_texts() -> list[str]:
    texts: set[str] = set()
    course = (ROOT / "data" / "course.js").read_text(encoding="utf-8")
    for m in re.finditer(r'zh:\s*"([^"]+)"', course):
        texts.add(m.group(1).strip())
    # Tone practice + common extras already covered by course.
    greetings = ROOT / "data" / "greetings.js"
    if greetings.exists():
        g = greetings.read_text(encoding="utf-8")
        # Only Chinese block phrases: rough extract near id: "zh"
        zh_block = re.search(r'id:\s*"zh"[\s\S]*?phrases:\s*\[([\s\S]*?)\]', g)
        if zh_block:
            for m in re.finditer(r'text:\s*"([^"]+)"', zh_block.group(1)):
                texts.add(m.group(1).strip())
    return sorted(t for t in texts if t)


def key_for(text: str) -> str:
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
    return digest


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    texts = collect_texts()
    mapping: dict[str, str] = {}
    for text in texts:
        key = key_for(text)
        rel = f"assets/audio/zh/{key}.mp3"
        path = ROOT / rel
        if not path.exists() or path.stat().st_size < 200:
            print("generate", text)
            communicate = edge_tts.Communicate(text, VOICE)
            await communicate.save(str(path))
        else:
            print("skip", text)
        mapping[text] = rel.replace("\\", "/")

    js = (
        "window.AUDIO_MANIFEST = "
        + json.dumps({"zh": mapping}, ensure_ascii=False, indent=2)
        + ";\n"
    )
    MANIFEST.write_text(js, encoding="utf-8")
    print("wrote", MANIFEST, "count", len(mapping))


if __name__ == "__main__":
    asyncio.run(main())
