"""
Fotoğraftan görsel öznitelik çıkarımı.
Bu modül SADECE görüntüyü sayısal özelliklere indirger;
müzikal yoruma dönüştürme işi music_theory.py'de yapılır.
"""

import cv2
import numpy as np


def _dominant_colors(img_bgr: np.ndarray, k: int = 5) -> list[list[int]]:
    """K-means ile baskın k rengi bulur, [R,G,B] listesi olarak döner."""
    small = cv2.resize(img_bgr, (100, 100))
    pixels = small.reshape(-1, 3).astype(np.float32)

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, labels, centers = cv2.kmeans(
        pixels, k, None, criteria, 5, cv2.KMEANS_RANDOM_CENTERS
    )

    # küme büyüklüğüne göre sırala (en baskın renk önce)
    counts = np.bincount(labels.flatten())
    order = np.argsort(-counts)
    centers = centers[order].astype(int)

    # BGR -> RGB
    return [[int(c[2]), int(c[1]), int(c[0])] for c in centers]


def analyze_image(path: str) -> dict:
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Görüntü okunamadı: {path}")

    # analiz öncesi küçült -> performans
    img = cv2.resize(img, (256, 256))

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    edges = cv2.Canny(img, 100, 200)

    features = {
        "brightness": float(np.mean(gray)),           # 0-255
        "contrast": float(np.std(gray)),               # 0-255 aralığında yaklaşık
        "dominant_hue": float(np.mean(hsv[:, :, 0])),  # 0-179 (OpenCV hue aralığı)
        "saturation": float(np.mean(hsv[:, :, 1])),    # 0-255
        "edge_density": float(np.sum(edges > 0) / edges.size),  # 0-1
        "dominant_colors": _dominant_colors(img, k=5),
    }
    return features


if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) < 2:
        print("Kullanım: python image_analysis.py <resim_yolu>")
        sys.exit(1)

    result = analyze_image(sys.argv[1])
    print(json.dumps(result, indent=2, ensure_ascii=False))
