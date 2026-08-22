"""Generate same-origin MP3s for world greetings (+ keep Chinese course audio)."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
OUT_ROOT = ROOT / "assets" / "audio"
MANIFEST = ROOT / "data" / "audio-manifest.js"

# Prefer mainland / standard voices where edge-tts offers regional variants.
VOICE_BY_LANG = {
    "zh-CN": "zh-CN-XiaoxiaoNeural",
    "zh": "zh-CN-XiaoxiaoNeural",
    "ja-JP": "ja-JP-NanamiNeural",
    "ja": "ja-JP-NanamiNeural",
    "ko-KR": "ko-KR-SunHiNeural",
    "ko": "ko-KR-SunHiNeural",
    "en-US": "en-US-JennyNeural",
    "en-NZ": "en-NZ-MollyNeural",
    "en": "en-US-JennyNeural",
    "es-ES": "es-ES-ElviraNeural",
    "es": "es-ES-ElviraNeural",
    "fr-FR": "fr-FR-DeniseNeural",
    "fr": "fr-FR-DeniseNeural",
    "de-DE": "de-DE-KatjaNeural",
    "de": "de-DE-KatjaNeural",
    "it-IT": "it-IT-ElsaNeural",
    "it": "it-IT-ElsaNeural",
    "pt-BR": "pt-BR-FranciscaNeural",
    "pt": "pt-BR-FranciscaNeural",
    "ru-RU": "ru-RU-SvetlanaNeural",
    "ru": "ru-RU-SvetlanaNeural",
    "ar-SA": "ar-SA-ZariyahNeural",
    "ar": "ar-SA-ZariyahNeural",
    "hi-IN": "hi-IN-SwaraNeural",
    "hi": "hi-IN-SwaraNeural",
    "th-TH": "th-TH-PremwadeeNeural",
    "th": "th-TH-PremwadeeNeural",
    "vi-VN": "vi-VN-HoaiMyNeural",
    "vi": "vi-VN-HoaiMyNeural",
    "id-ID": "id-ID-GadisNeural",
    "id": "id-ID-GadisNeural",
    "ms-MY": "ms-MY-YasminNeural",
    "ms": "ms-MY-YasminNeural",
    "fil-PH": "fil-PH-BlessicaNeural",
    "fil": "fil-PH-BlessicaNeural",
    "tr-TR": "tr-TR-EmelNeural",
    "tr": "tr-TR-EmelNeural",
    "nl-NL": "nl-NL-FennaNeural",
    "nl": "nl-NL-FennaNeural",
    "sv-SE": "sv-SE-SofieNeural",
    "sv": "sv-SE-SofieNeural",
    "pl-PL": "pl-PL-ZofiaNeural",
    "pl": "pl-PL-ZofiaNeural",
    "uk-UA": "uk-UA-PolinaNeural",
    "uk": "uk-UA-PolinaNeural",
    "el-GR": "el-GR-AthinaNeural",
    "el": "el-GR-AthinaNeural",
    "he-IL": "he-IL-HilaNeural",
    "he": "he-IL-HilaNeural",
    "fa-IR": "fa-IR-DilaraNeural",
    "fa": "fa-IR-DilaraNeural",
    "sw": "sw-KE-ZuriNeural",
    "sw-KE": "sw-KE-ZuriNeural",
    "am-ET": "am-ET-MekdesNeural",
    "am": "am-ET-MekdesNeural",
    "mn-MN": "mn-MN-YesuiNeural",
    "mn": "mn-MN-YesuiNeural",
    "ne-NP": "ne-NP-HemkalaNeural",
    "ne": "ne-NP-HemkalaNeural",
    "km-KH": "km-KH-SreymomNeural",
    "km": "km-KH-SreymomNeural",
    "my-MM": "my-MM-NilarNeural",
    "my": "my-MM-NilarNeural",
    # No dedicated voices: nearest English.
    "haw": "en-US-JennyNeural",
    "mi": "en-NZ-MollyNeural",
}


def key_for(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def pack_key(lang_code: str) -> str:
    # Store under language prefix so app.js localAudioUrl(langPrefix) works.
    # For haw/mi keep full short codes as their own packs.
    code = lang_code.replace("_", "-")
    low = code.lower()
    if low in {"haw", "mi"}:
        return low
    return code.split("-")[0].lower()


def voice_for(lang_code: str) -> str:
    code = lang_code.replace("_", "-")
    if code in VOICE_BY_LANG:
        return VOICE_BY_LANG[code]
    prefix = code.split("-")[0]
    if prefix in VOICE_BY_LANG:
        return VOICE_BY_LANG[prefix]
    return VOICE_BY_LANG["en"]


def collect_jobs() -> list[tuple[str, str, str]]:
    """Return list of (pack, text, voice)."""
    jobs: dict[tuple[str, str], str] = {}

    # Chinese course phrases
    course = (ROOT / "data" / "course.js").read_text(encoding="utf-8")
    for m in re.finditer(r'zh:\s*"([^"]+)"', course):
        text = m.group(1).strip()
        jobs[("zh", text)] = VOICE_BY_LANG["zh-CN"]

    def collect_from_file(path: Path, array_name: str) -> None:
        if not path.exists():
            return
        raw = path.read_text(encoding="utf-8")
        for block in re.finditer(
            rf'id:\s*"([^"]+)"[\s\S]*?lang:\s*"([^"]+)"[\s\S]*?{array_name}:\s*\[([\s\S]*?)\]',
            raw,
        ):
            _item_id, lang, phrases_block = block.group(1), block.group(2), block.group(3)
            pack = pack_key(lang)
            voice = voice_for(lang)
            for m in re.finditer(r'text:\s*"([^"]+)"', phrases_block):
                text = m.group(1).strip()
                jobs[(pack, text)] = voice

    collect_from_file(ROOT / "data" / "greetings.js", "phrases")
    collect_from_file(ROOT / "data" / "food.js", "words")

    return [(pack, text, voice) for (pack, text), voice in sorted(jobs.items())]


async def ensure_mp3(pack: str, text: str, voice: str) -> str:
    out_dir = OUT_ROOT / pack
    out_dir.mkdir(parents=True, exist_ok=True)
    digest = key_for(text)
    rel = f"assets/audio/{pack}/{digest}.mp3"
    path = ROOT / rel
    if path.exists() and path.stat().st_size >= 200:
        print("skip", pack, text)
        return rel.replace("\\", "/")
    print("generate", pack, voice, text)
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(path))
    return rel.replace("\\", "/")


async def main() -> None:
    jobs = collect_jobs()
    mapping: dict[str, dict[str, str]] = {}
    for pack, text, voice in jobs:
        rel = await ensure_mp3(pack, text, voice)
        mapping.setdefault(pack, {})[text] = rel

    js = "window.AUDIO_MANIFEST = " + json.dumps(mapping, ensure_ascii=False, indent=2) + ";\n"
    MANIFEST.write_text(js, encoding="utf-8")
    print("packs", len(mapping), "phrases", sum(len(v) for v in mapping.values()))


if __name__ == "__main__":
    asyncio.run(main())
