"""Fetch food images from Wikimedia Commons (curated filenames + slow search fallback)."""
from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOOD_JS = ROOT / "data" / "food.js"
OUT_DIR = ROOT / "assets" / "images" / "food"
MANIFEST = ROOT / "data" / "image-manifest.js"
UA = "chinese-starter/1.1 (educational offline cache; contact via github.com/yu10111011-ui/chinese-starter)"

# Direct Commons filenames (stable). Values are File: names without "File:".
COMMONS_FILES = {
    "饺子": "Jiaozi_by_stuboy.jpg",
    "米饭": "White_rice_in_black_bowl.jpg",
    "面条": "Zhajiangmian.jpg",
    "茶": "Longjing_tea.jpg",
    "火锅": "Chongqing_hotpot.jpg",
    "김치": "Kimchi_2.jpg",
    "비빔밥": "Dolsot-bibimbap.jpg",
    "불고기": "Bulgogi_3.jpg",
    "라면": "Ramyeon.jpg",
    "소주": "Chamisul.jpg",
    "寿司": "Sushi_platter.jpg",
    "ラーメン": "Shoyu_Ramen.jpg",
    "天ぷら": "Tempura_udon_by_yajico_in_Osaka.jpg",
    "味噌": "Miso_paste.jpg",
    "お茶": "Green_tea_from_Japan.jpg",
    "ผัดไทย": "Pad_Thai_as_usual.jpg",
    "ต้มยำกุ้ง": "Tom_yum_kung_maenam.jpg",
    "ข้าว": "Thai_jasmine_rice.jpg",
    "ส้มตำ": "Som_tam_thai.jpg",
    "ชาเย็น": "Cha_yen.jpg",
    "phở": "Pho-Beef-Noodles-2008.jpg",
    "bánh mì": "Banh_Mi_Tai_Xuân.jpg",
    "gỏi cuốn": "Goi_Cuon.jpg",
    "cà phê": "Egg_coffee_in_Hanoi.jpg",
    "cơm": "Com_tam.jpg",
    "nasi goreng": "Nasi_Goreng_1.jpg",
    "satay": "Sate_Ponorogo.jpg",
    "rendang": "Beef_rendang.jpg",
    "tempe": "Tempeh_tempe.jpg",
    "kopi": "Kopi_tubruk.jpg",
    "करी": "Chicken_Curry_with_Rice.jpg",
    "नान": "Naan_bread.jpg",
    "बिरयानी": "Hyderabadi_Chicken_Biryani.jpg",
    "समोसा": "Samosachutney.jpg",
    "चाय": "Masala_Chai.JPG",
    "burger": "Hamburger_(black_bg).jpg",
    "pizza": "Eq_it-na_pizza-margherita_sep2005_sml.jpg",
    "salad": "Greek_salad_with_organic_vegetables_and_feta.jpg",
    "bread": "Home_made_bread_(1).jpg",
    "coffee": "A_small_cup_of_coffee.JPG",
    "pain": "Baguette_de_pain.jpg",
    "fromage": "Cheese_platter.jpg",
    "croissant": "Croissant,_Luxembourg.jpg",
    "vin": "Red_Wine_Glass.jpg",
    "soupe": "Soupe_a_l'oignon.jpg",
    "pasta": "Pasta_with_tomato_sauce.jpg",
    "gelato": "Gelato_in_Rome.jpg",
    "espresso": "Espresso_macchiato.jpg",
    "olio": "Olio_di_oliva.jpg",
    "paella": "Paella_de_marisco_01.jpg",
    "taco": "Tacos_de_carnitas.jpg",
    "tortilla": "Corn_tortillas.jpg",
    "salsa": "Salsa_roja.jpg",
    "café": "Cafe_con_leche.jpg",
    "Brot": "Brot.jpg",
    "Wurst": "Bratwurst.jpg",
    "Käse": "Emmentaler.jpg",
    "Bier": "Weissbier.jpg",
    "Schnitzel": "Wiener_Schnitzel_in_Vienna.jpg",
    "feijoada": "Feijoada_01.jpg",
    "pão": "Pao_frances.jpg",
    "carne": "Picanha.jpg",
    "suco": "Fresh_orange_juice.jpg",
    "churrasco": "Churrasco_brasileiro.jpg",
    "борщ": "Borscht_with_bread.jpg",
    "пельмени": "Pelmeni_Russian.jpg",
    "хлеб": "Borodinsky_bread.jpg",
    "чай": "Russian_tea.jpg",
    "икра": "Caviar_and_butter.jpg",
    "kebab": "Adana_kebab.jpg",
    "baklava": "Baklava_1.jpg",
    "ekmek": "Turkish_bread.jpg",
    "çay": "Turkish_tea.jpg",
    "yoğurt": "Turkish_yogurt.jpg",
    "hummus": "Hummus_from_The_Nile.jpg",
    "falafel": "Falafel_balls.jpg",
    "خبز": "Pita_bread.jpg",
    "قهوة": "Arabic_coffee.jpg",
    "تمر": "Dates_Medjool.jpg",
    "ugali": "Ugali_and_cabbage.jpg",
    "nyama": "Nyama_choma.jpg",
    "samaki": "Grilled_fish.jpg",
    "chai": "Kenyan_tea.jpg",
    "pilau": "Pilau_rice.jpg",
    "poke": "Ahi_poke.jpg",
    "poi": "Poi_(food).jpg",
    "kalua pig": "Kalua_pig.jpg",
    "haupia": "Haupia.jpg",
    "coconut": "Coconut_macrocouture_01.jpg",
}


def load_food_entries() -> list[tuple[str, str]]:
    raw = FOOD_JS.read_text(encoding="utf-8")
    entries: list[tuple[str, str]] = []
    for block in re.finditer(
        r'lang:\s*"([^"]+)"[\s\S]*?words:\s*\[([\s\S]*?)\]',
        raw,
    ):
        lang = block.group(1)
        pack = lang.replace("_", "-").split("-")[0].lower()
        if lang.lower() in {"haw", "mi"}:
            pack = lang.lower()
        for m in re.finditer(r'text:\s*"([^"]+)"', block.group(2)):
            entries.append((pack, m.group(1).strip()))
    return entries


def key_for(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def file_url(filename: str, width: int = 640) -> str:
    return (
        "https://commons.wikimedia.org/wiki/Special:FilePath/"
        + urllib.parse.quote(filename)
        + f"?width={width}"
    )


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
        ctype = (resp.headers.get("Content-Type") or "").lower()
        if "html" in ctype or len(data) < 1500:
            raise RuntimeError(f"not an image ({ctype}, {len(data)} bytes)")
        dest.write_bytes(data)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mapping: dict[str, dict[str, str]] = {}
    ok = 0
    missing = []

    for pack, text in load_food_entries():
        digest = key_for(text)
        # Keep extension flexible; normalize to .jpg name in manifest even if png bytes.
        rel = f"assets/images/food/{digest}.jpg"
        path = ROOT / rel
        mapping.setdefault(pack, {})[text] = rel.replace("\\", "/")

        if path.exists() and path.stat().st_size > 2000:
            print("skip", text)
            ok += 1
            continue

        filename = COMMONS_FILES.get(text)
        if not filename:
            print("NO_MAP", text)
            mapping[pack].pop(text, None)
            missing.append(text)
            continue

        url = file_url(filename)
        try:
            download(url, path)
            print("ok", text)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print("fail", text, filename, exc)
            mapping[pack].pop(text, None)
            missing.append(text)
            if path.exists():
                path.unlink()
        time.sleep(1.2)

    payload = {
        "food": mapping,
        "attribution": "Food photos cached from Wikimedia Commons for local study use.",
    }
    MANIFEST.write_text(
        "window.IMAGE_MANIFEST = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print("ok", ok, "missing", len(missing), missing)


if __name__ == "__main__":
    main()
