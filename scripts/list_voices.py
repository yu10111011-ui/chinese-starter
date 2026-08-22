import asyncio
import edge_tts

WANT = {
    "en", "es", "fr", "de", "it", "pt", "ru", "ar", "hi", "th", "vi", "id",
    "ms", "tr", "nl", "sv", "pl", "uk", "el", "he", "fa", "sw", "am", "mn",
    "ne", "km", "my", "ko", "zh", "fil", "ga", "cy", "is", "fi", "hu", "cs",
    "ro", "mi", "haw",
}


async def main() -> None:
    voices = await edge_tts.list_voices()
    picked: dict[str, tuple[str, str, str]] = {}
    for v in voices:
        short = v["ShortName"]
        locale = v["Locale"]
        gender = v["Gender"]
        pref = locale.split("-")[0].lower()
        if pref not in WANT or "Neural" not in short:
            continue
        # Prefer female Neural when available.
        if pref not in picked or (gender == "Female" and picked[pref][2] != "Female"):
            picked[pref] = (short, locale, gender)
    for key in sorted(picked):
        short, locale, gender = picked[key]
        print(f"{key}\t{short}\t{locale}\t{gender}")
    print("count", len(picked))


if __name__ == "__main__":
    asyncio.run(main())
