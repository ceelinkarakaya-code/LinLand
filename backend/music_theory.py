"""
Görsel özellikleri "kontrollü rastgele" (constrained random) müzikal
parametrelere çevirir. Rastgelelik her zaman bir kural kümesi
(gam, öklid ritmi, ilerleme havuzu) içinde kalır; bu yüzden çıktı
her seferinde farklı ama her zaman kulağa "doğru" gelir.
"""

import hashlib
import random

SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "pentatonic_major": [0, 2, 4, 7, 9],
    "pentatonic_minor": [0, 3, 5, 7, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
}

PROGRESSION_POOLS = {
    "major": [
        ["I", "IV", "V", "I"],
        ["I", "vi", "IV", "V"],
        ["I", "V", "vi", "IV"],
        ["ii", "V", "I", "vi"],
    ],
    "minor": [
        ["i", "VI", "III", "VII"],
        ["i", "iv", "v", "i"],
        ["i", "VII", "VI", "V"],
    ],
}

# roma rakamı -> gam derecesi (0-indeksli) ve akor niteliği
ROMAN_MAP = {
    "I": (0, "major"), "i": (0, "minor"),
    "ii": (1, "minor"), "iii": (2, "minor"),
    "IV": (3, "major"), "iv": (3, "minor"),
    "V": (4, "major"), "v": (4, "minor"),
    "vi": (5, "minor"), "VI": (5, "major"),
    "VII": (6, "major"),
}


def _seed_from(*parts) -> int:
    """Girdi parçalarından deterministik bir seed üretir."""
    h = hashlib.md5("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(h[:8], 16)


def pick_scale(features: dict) -> str:
    hue = features["dominant_hue"]  # 0-179
    sat = features["saturation"]
    if sat < 60:
        return "dorian"  # düşük doygunluk -> daha "nötr" mod
    if 0 <= hue < 30 or hue >= 150:
        return "major"          # sıcak renkler (kırmızı/turuncu) -> majör
    if 30 <= hue < 90:
        return "lydian"          # yeşil/sarı -> parlak/rüya gibi
    return "minor"                # mavi/mor -> minör


def get_scale_notes(root_midi: int, scale_name: str, octave_range: int = 2) -> list[int]:
    intervals = SCALES[scale_name]
    notes = []
    for octave in range(octave_range):
        notes += [root_midi + i + (octave * 12) for i in intervals]
    return sorted(notes)


def generate_melody(scale_notes: list[int], length: int = 16,
                     step_bias: float = 0.7, seed: int | None = None) -> list[int]:
    """Adım-öncelikli rastgele yürüyüş: komşu notaya gitme ihtimali
    sıçramadan yüksek tutulur -> kulağa amaçlı bir melodi gibi gelir."""
    rng = random.Random(seed)
    melody = []
    idx = len(scale_notes) // 2

    for _ in range(length):
        if rng.random() < step_bias:
            step = rng.choice([-1, 1])
        else:
            step = rng.choice([-3, -2, 2, 3])
        idx = max(0, min(len(scale_notes) - 1, idx + step))
        melody.append(scale_notes[idx])

    return melody


def euclidean_rhythm(pulses: int, steps: int) -> list[int]:
    """Bjorklund algoritmasının basit hali: N vuruşu M adıma eşit dağıtır."""
    pattern = []
    bucket = 0
    for _ in range(steps):
        bucket += pulses
        if bucket >= steps:
            bucket -= steps
            pattern.append(1)
        else:
            pattern.append(0)
    return pattern


def generate_rhythm(edge_density: float, seed: int | None = None, steps: int = 16) -> list[int]:
    rng = random.Random(seed)
    pulses = max(2, min(steps - 1, round(edge_density * steps * 1.5)))
    base = euclidean_rhythm(pulses, steps)
    # %15 ihtimalle bir adımı çevir -> hafif "insan" varyasyonu
    return [b if rng.random() > 0.15 else 1 - b for b in base]


def pick_progression(scale_name: str, seed: int | None = None) -> list[str]:
    rng = random.Random(seed)
    family = "major" if scale_name in ("major", "lydian") else "minor"
    pool = PROGRESSION_POOLS[family]
    return rng.choice(pool)


def roman_to_chord(roman: str, root_midi: int, scale_notes: list[int]) -> list[int]:
    """Roma rakamını, gam derecelerinden bir üçlü (triad) akora çevirir."""
    degree, quality = ROMAN_MAP[roman]
    base_octave_notes = scale_notes[: len(scale_notes) // 2]  # ilk oktav
    root = base_octave_notes[degree % len(base_octave_notes)]

    third = 4 if quality == "major" else 3
    fifth = 7
    return [root, root + third, root + fifth]


def generate_music(features: dict, regenerate: bool = True) -> dict:
    """Ana giriş noktası: görsel özellikleri tam bir müzik JSON'una çevirir.

    - mood_seed: fotoğrafın kendisinden türetilir -> her zaman aynı "ruh hali"
    - variation_seed: regenerate=True ise her çağrıda değişir -> melodi/ritim detayı farklılaşır
    """
    mood_seed = _seed_from(
        round(features["dominant_hue"]),
        round(features["brightness"]),
        round(features["saturation"]),
    )
    variation_seed = random.randint(0, 999_999) if regenerate else mood_seed

    scale_name = pick_scale(features)
    root_midi = 60 + int((features["dominant_hue"] / 179) * 12)  # C4 civarı, hue'ya göre kaydır
    scale_notes = get_scale_notes(root_midi, scale_name, octave_range=2)

    melody = generate_melody(scale_notes, length=16, step_bias=0.7, seed=variation_seed)
    rhythm = generate_rhythm(features["edge_density"], seed=variation_seed)
    progression_roman = pick_progression(scale_name, seed=mood_seed)
    progression_midi = [
        roman_to_chord(r, root_midi, scale_notes) for r in progression_roman
    ]

    tempo = int(70 + (features["brightness"] / 255) * 90)  # 70-160 BPM
    filter_cutoff = int(200 + features["saturation"] * 8)   # ~200-2240 Hz

    return {
        "tempo": tempo,
        "scale": scale_name,
        "rootMidi": root_midi,
        "filterCutoff": filter_cutoff,
        "melody": melody,
        "rhythm": rhythm,
        "progression": progression_midi,
        "moodSeed": mood_seed,
        "variationSeed": variation_seed,
        "dominantColors": features["dominant_colors"],
    }
