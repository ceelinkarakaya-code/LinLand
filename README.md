# Karanlık Oda — Fotoğraftan Müzik

Bir fotoğraf yükleyin; renk, parlaklık, doygunluk ve kenar yoğunluğu gibi
görsel özellikler analiz edilip **gam kilitleme, öklid ritmi ve akor
ilerlemesi kurallarına uyan** rastgele bir melodiye dönüştürülür. Aynı
fotoğraf her "yeniden karıştır"da farklı bir melodi üretir, ama tempo/gam/
akor karakteri (mood) hep aynı kalır.

## Mimari

```
[Fotoğraf] --POST /analyze--> [FastAPI backend]
                                  ├─ image_analysis.py  (OpenCV özellik çıkarımı)
                                  └─ music_theory.py     (gam/ritim/akor motoru)
                                        |
                                        v
                                  JSON parametreler
                                        |
                                        v
                        [Statik frontend: Tone.js oynatıcı + canvas dalga formu]
```

- **backend/** — Python / FastAPI. Görüntüyü analiz eder, müzikal parametreleri
  JSON olarak döner. Ses üretmez.
- **frontend/** — düz HTML/CSS/JS + Tone.js (CDN). Build aracı gerekmez,
  doğrudan statik olarak servis edilebilir (GitHub Pages, Vercel, Netlify...).

## Yerel geliştirme

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`http://localhost:8000/health` → `{"status": "ok"}` görmelisiniz.

### Frontend

`frontend/index.html` dosyasını herhangi bir statik sunucu ile açın, örn:

```bash
cd frontend
python -m http.server 5500
```

`http://localhost:5500` adresine gidin. Backend'iniz farklı bir adreste
çalışıyorsa `app.js` içindeki `API_URL` değişkenini güncelleyin, ya da
`index.html`'e `<script>window.API_URL = "https://sizin-backend-adresiniz"</script>`
satırını `app.js`'den önce ekleyin.

## GitHub'a itme

```bash
cd gorsel-muzik
git init
git add .
git commit -m "İlk sürüm: görüntüden müzik motoru"
git branch -M main
git remote add origin https://github.com/<kullanici-adiniz>/<repo-adi>.git
git push -u origin main
```

## Deploy

- **Backend**: Render, Railway veya Fly.io — `backend/` klasörünü kök dizin
  olarak seçin, start komutu: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Frontend**: GitHub Pages (repo ayarlarından `frontend/` klasörünü Pages
  kaynağı yapın) veya Vercel/Netlify ile statik site olarak.
- Deploy sonrası `frontend/app.js`'deki `API_URL`'i canlı backend adresinizle
  güncellemeyi unutmayın, ve backend'deki CORS `allow_origins` listesini
  `*` yerine gerçek frontend domain'inizle sınırlayın.

## Sonraki adımlar

- `music_theory.py` içindeki `step_bias`, `PROGRESSION_POOLS` gibi
  parametreleri değiştirerek "ruh hali" tasarımını genişletebilirsiniz.
- Akor-melodi uyumunu daha da sıkılaştırmak için "chord tone bias" eklenebilir
  (melodi notalarının o anki akorun perdelerine daha sık düşmesi).
- Gerçek zamanlı kamera akışı için backend'e bir WebSocket endpoint'i eklenip
  frontend'de belirli aralıklarla kare gönderilebilir.
