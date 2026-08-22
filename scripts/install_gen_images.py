"""Copy session-generated images into assets and refresh IMAGE_MANIFEST."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "images" / "food"
MANIFEST = ROOT / "data" / "image-manifest.js"
FOOD_JS = ROOT / "data" / "food.js"

# filename in session images/ -> food text key
ASSIGNMENTS = {
    # filled by CLI args or edit below
}


def key_for(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def load_packs() -> dict[str, str]:
    """text -> pack"""
    raw = FOOD_JS.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for block in re.finditer(
        r'lang:\s*"([^"]+)"[\s\S]*?words:\s*\[([\s\S]*?)\]',
        raw,
    ):
        lang = block.group(1)
        pack = lang.replace("_", "-").split("-")[0].lower()
        if lang.lower() in {"haw", "mi"}:
            pack = lang.lower()
        for m in re.finditer(r'text:\s*"([^"]+)"', block.group(2)):
            out[m.group(1)] = pack
    return out


def load_manifest() -> dict:
    if not MANIFEST.exists():
        return {"food": {}, "attribution": "Food photos for local study use."}
    raw = MANIFEST.read_text(encoding="utf-8")
    return json.loads(raw.replace("window.IMAGE_MANIFEST = ", "").rstrip(";\n"))


def install(session_images: Path, assignments: dict[str, str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    packs = load_packs()
    data = load_manifest()
    food = data.setdefault("food", {})
    for fname, text in assignments.items():
        src = session_images / fname
        if not src.exists():
            raise SystemExit(f"missing source {src}")
        pack = packs[text]
        rel = f"assets/images/food/{key_for(text)}.jpg"
        dest = ROOT / rel
        shutil.copyfile(src, dest)
        food.setdefault(pack, {})[text] = rel.replace("\\", "/")
        print("installed", text, "<-", fname)
    data["attribution"] = (
        "Food photos: Wikimedia Commons cache + generated study images, stored locally."
    )
    MANIFEST.write_text(
        "window.IMAGE_MANIFEST = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    count = sum(len(v) for v in food.values())
    print("manifest images", count)


if __name__ == "__main__":
    session = Path(
        r"C:\Users\user\.grok\sessions\C%3A%5CUsers%5Cuser%5CDocuments%5C000yuta%5Cproject%5C01_nikki\01a027e2-acf5-7703-94c3-9025b4878176\images"
    )
    assignments = {
        "1.jpg": "茶",
        "2.jpg": "面条",
        "3.jpg": "ラーメン",
        "4.jpg": "ผัดไทย",
        "5.jpg": "소주",
        "6.jpg": "天ぷら",
        "7.jpg": "라면",
        "8.jpg": "ต้มยำกุ้ง",
    }
    install(session, assignments)
