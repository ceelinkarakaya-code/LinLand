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
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "blues": [0, 3, 5, 6, 7, 10],
}

# Her tarz için: hangi gamlar tercih edilsin, tempo aralığı, ritim karakteri,
# akor yapısı (triad / power / seventh). "soft" mevcut varsayılan davranışı korur.
GENRE_PROFILES = {
    "soft": {
        "scale_pool": None,  # None -> pick_scale'in eski hue-tabanlı mantığı çalışır
        "tempo_range": (70, 160),
        "rhythm_style": "straight",
        "chord_style": "triad",
        "chord_rhythm": "sustained",
    },
    "rock": {
        "scale_pool": ["pentatonic_minor", "minor", "major"],
        "tempo_range": (110, 150),
        "rhythm_style": "backbeat",
        "chord_style": "power",
        "chord_rhythm": "chug",
    },
    "anadolu_rock": {
        "scale_pool": ["dorian", "minor", "phrygian"],
        "tempo_range": (90, 130),
        "rhythm_style": "syncopated",
        "chord_style": "triad",
        "chord_rhythm": "arpeggio",
    },
    "heavy_metal": {
        "scale_pool": ["phrygian", "minor"],
        "tempo_range": (140, 180),
        "rhythm_style": "double_kick",
        "chord_style": "power",
        "chord_rhythm": "chug",
    },
    "jazz": {
        "scale_pool": ["dorian", "lydian", "major"],
        "tempo_range": (90, 140),
        "rhythm_style": "swing",
        "chord_style": "seventh",
        "chord_rhythm": "comp",
    },
    "pop": {
        "scale_pool": ["major", "pentatonic_major"],
        "tempo_range": (100, 128),
        "rhythm_style": "backbeat",
        "chord_style": "triad",
        "chord_rhythm": "pulse",
    },
    "blues": {
        "scale_pool": ["blues", "pentatonic_minor"],
        "tempo_range": (70, 110),
        "rhythm_style": "shuffle",
        "chord_style": "seventh",
        "chord_rhythm": "comp",
    },
    "dj": {
        "scale_pool": ["minor", "pentatonic_minor", "major"],
        "tempo_range": (120, 135),
        "rhythm_style": "four_on_floor",
        "chord_style": "triad",
        "chord_rhythm": "pulse",
    },
}

SWING_BY_STYLE = {
    "straight": 0.0,
    "backbeat": 0.0,
    "four_on_floor": 0.0,
    "double_kick": 0.0,
    "syncopated": 0.12,
    "swing": 0.35,
    "shuffle": 0.3,
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
    "VII": (6, "major"), "III": (2, "major"),
}


def _seed_from(*parts) -> int:
    """Girdi parçalarından deterministik bir seed üretir."""
    h = hashlib.md5("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(h[:8], 16)


def pick_scale(features: dict, genre: str = "soft") -> str:
    profile = GENRE_PROFILES.get(genre, GENRE_PROFILES["soft"])
    pool = profile.get("scale_pool")

    if pool:
        # tarz belirli bir gam havuzuna sahipse, hue bu havuz içinde hangi
        # gamın seçileceğini belirler (yine görsele bağlı, ama tarza uygun)
        hue = features["dominant_hue"]
        idx = int((hue / 179) * len(pool)) % len(pool)
        return pool[idx]

    # "soft" tarzı: eski hue-tabanlı serbest seçim
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


def generate_melody_over_progression(scale_notes: list[int], progression_midi: list[list[int]],
                                      steps_per_measure: int = 16, step_bias: float = 0.7,
                                      seed: int | None = None) -> list[int]:
    """Melodiyi TÜM akor ilerlemesi boyunca (her akor için bir ölçü) üretir —
    kısa bir döngüyü akor değişse de tekrar tekrar çalmak yerine, melodi artık
    akor ilerlemesiyle aynı uzunlukta ve onunla birlikte döngüleniyor.

    Her ölçünün ilk adımında (güçlü vuruş), melodi o anki akorun bir notasına
    "yakınsatılıyor" -> melodi ile akor arasındaki uyumsuzluk/çakışma hissi
    büyük ölçüde azalıyor. Ölçü içindeki diğer adımlarda eski adım-öncelikli
    rastgele yürüyüş devam ediyor.
    """
    rng = random.Random(seed)
    melody: list[int] = []
    idx = len(scale_notes) // 2

    for chord in progression_midi:
        chord_tone_classes = {n % 12 for n in chord}

        for step in range(steps_per_measure):
            if step == 0:
                # güçlü vuruş: gam içinde bu akora ait en yakın notaya geç
                candidates = [i for i, n in enumerate(scale_notes) if n % 12 in chord_tone_classes]
                if candidates:
                    idx = min(candidates, key=lambda i: abs(i - idx))
            else:
                if rng.random() < step_bias:
                    step_move = rng.choice([-1, 1])
                else:
                    step_move = rng.choice([-3, -2, 2, 3])
                idx = max(0, min(len(scale_notes) - 1, idx + step_move))

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


def generate_rhythm(edge_density: float, seed: int | None = None, steps: int = 16,
                     style: str = "straight") -> list[int]:
    rng = random.Random(seed)

    if style == "double_kick":
        density_multiplier = 1.8
    elif style in ("four_on_floor", "backbeat"):
        density_multiplier = 1.3
    else:
        density_multiplier = 1.5

    pulses = max(2, min(steps - 1, round(edge_density * steps * density_multiplier)))
    base = euclidean_rhythm(pulses, steps)
    # %15 ihtimalle bir adımı çevir -> hafif "insan" varyasyonu
    return [b if rng.random() > 0.15 else 1 - b for b in base]


def pick_progression(scale_name: str, seed: int | None = None) -> list[str]:
    rng = random.Random(seed)
    major_family_scales = ("major", "lydian", "pentatonic_major")
    family = "major" if scale_name in major_family_scales else "minor"
    pool = PROGRESSION_POOLS[family]
    return rng.choice(pool)


def roman_to_chord(roman: str, root_midi: int, scale_notes: list[int],
                    chord_style: str = "triad") -> list[int]:
    """Roma rakamını akora çevirir. chord_style: triad / power / seventh."""
    degree, quality = ROMAN_MAP[roman]
    base_octave_notes = scale_notes[: len(scale_notes) // 2]  # ilk oktav
    root = base_octave_notes[degree % len(base_octave_notes)]

    third = 4 if quality == "major" else 3
    fifth = 7

    if chord_style == "power":
        return [root, root + fifth]  # power chord: 3'süz, rock/metal karakteri

    chord = [root, root + third, root + fifth]
    if chord_style == "seventh":
        seventh = 10  # küçük yedili -> jazz/blues'ta yaygın "dominant/min7" hissi
        chord.append(root + seventh)
    return chord


def generate_music(features: dict, regenerate: bool = True, genre: str = "soft") -> dict:
    """Ana giriş noktası: görsel özellikleri tam bir müzik JSON'una çevirir.

    - mood_seed: fotoğraf + tarzdan türetilir -> aynı fotoğraf+tarz kombinasyonu
      her zaman aynı "ruh hali"nde kalır (akor ilerlemesi bu seed'i kullanır)
    - variation_seed: regenerate=True ise her çağrıda değişir -> melodi/ritim
      detayı farklılaşır, ama tempo/gam/akor karakteri (tarz) sabit kalır
    """
    profile = GENRE_PROFILES.get(genre, GENRE_PROFILES["soft"])
    tempo_min, tempo_max = profile["tempo_range"]
    rhythm_style = profile["rhythm_style"]
    chord_style = profile["chord_style"]
    swing = SWING_BY_STYLE.get(rhythm_style, 0.0)

    mood_seed = _seed_from(
        round(features["dominant_hue"]),
        round(features["brightness"]),
        round(features["saturation"]),
        genre,
    )
    variation_seed = random.randint(0, 999_999) if regenerate else mood_seed

    scale_name = pick_scale(features, genre)
    root_midi = 60 + int((features["dominant_hue"] / 179) * 12)  # C4 civarı, hue'ya göre kaydır
    scale_notes = get_scale_notes(root_midi, scale_name, octave_range=2)

    # ÖNCE akor ilerlemesi belirlenir, melodi SONRA bu akorlara göre üretilir
    # -> melodi artık akor değiştikçe ona uyum sağlıyor, kısa bir döngüyü
    # değişen akorların üzerinde körlemesine tekrar etmiyor.
    progression_roman = pick_progression(scale_name, seed=mood_seed)
    progression_midi = [
        roman_to_chord(r, root_midi, scale_notes, chord_style) for r in progression_roman
    ]

    melody = generate_melody_over_progression(
        scale_notes, progression_midi, steps_per_measure=16, step_bias=0.7, seed=variation_seed
    )
    rhythm = generate_rhythm(features["edge_density"], seed=variation_seed,
                              steps=len(melody), style=rhythm_style)

    tempo = int(tempo_min + (features["brightness"] / 255) * (tempo_max - tempo_min))
    filter_cutoff = int(200 + features["saturation"] * 8)   # ~200-2240 Hz

    return {
        "genre": genre,
        "tempo": tempo,
        "scale": scale_name,
        "rootMidi": root_midi,
        "filterCutoff": filter_cutoff,
        "rhythmStyle": rhythm_style,
        "chordStyle": chord_style,
        "chordRhythm": profile.get("chord_rhythm", "sustained"),
        "swing": swing,
        "melody": melody,
        "rhythm": rhythm,
        "progression": progression_midi,
        "moodSeed": mood_seed,
        "variationSeed": variation_seed,
        "dominantColors": features["dominant_colors"],
    }
