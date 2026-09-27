# API Pathfinder

> Bir OpenAPI 3.x JSON dokümanı yükle, hedefini doğal dille yaz (“Satışta olan ürünleri nasıl listelerim?”).
> Pathfinder uygun **GET** işlemini semantik aramayla bulur, Gemini ile inceler, parametreleri dokümana göre doğrular
> ve **yalnızca sen “İsteği dene” dediğinde** izin listesindeki sunucuya gerçek bir GET isteği gönderir.

*English summary: a small, deliberately scoped prototype that indexes the GET operations of an OpenAPI 3.x JSON document
in PostgreSQL/pgvector, finds the operation that matches a natural-language goal (embeddings + RAG + a bounded Gemini
function-calling loop), validates the model's proposal against the document, and sends a real, allowlisted GET request
only after explicit user confirmation.*

![Agent incelemesi, kod doğrulaması ve onaylı gerçek istek](docs/screenshot-agent.png)

Bu “her API'ye bağlanan sihirli ürün” değildir. Kapsam bilinçli olarak küçüktür (bkz. [Bilinen sınırlar](#bilinen-sınırlar)).

## Ne yapar

1. OpenAPI JSON'daki GET işlemlerini çıkarır, yerel `$ref`'leri çözer ve PostgreSQL'e kaydeder.
2. Her işlemin dokümandaki açıklamasından embedding üretir (`gemini-embedding-2`, 768 boyut) ve bunu pgvector'e yazar.
3. Hedefe semantik olarak yakın işlemleri puanlarıyla gösterir. Ham arama görünümünde model yoktur.
4. İki inceleme modu vardır:
   - **RAG (sabit zincir):** ara → getirilen işlemleri modele ver → yapılandırılmış JSON cevap al.
   - **Agent (sınırlı döngü):** model `search_endpoints` / `inspect_endpoint` araçlarından hangisini çağıracağını seçer, aracı sunucu çalıştırır, sonuç modele geri gider. Döngü en fazla 4 araç adımıyla sınırlıdır.
5. Modelin önerisini **kod** doğrular. Dokümanda olmayan işlem atılır, tanımsız parametreler silinir, eksik zorunlu parametre kullanıcıdan istenir.
6. Kullanıcı onaylarsa gerçek GET isteği gönderilir. Arayüz; URL'yi, durum kodunu, boyutu sınırlanmış gerçek yanıtı ve çalıştırılabilir bir TypeScript `fetch` örneğini gösterir.
7. Sonuç ekranında üç kaynak ayrı kutularda durur: **Dokümandan** (mavi), **Model yorumu — doğrulanmamış** (mor), **Canlı istekte gözlenen** (yeşil/kırmızı).

## Mimari ve veri akışı

```
Tarayıcı (Next.js App Router, React)
  │
  ├─ POST /api/import ─────► openapi.ts: doğrula, yerel $ref çöz, GET'leri çıkar
  │                            └─► db.ts: api_documents + operations
  │                            └─► indexing.ts ─► Gemini embedContent ─► operations.embedding (vector(768))
  │
  ├─ POST /api/search ─────► search.ts: hedef → embedding → pgvector `ORDER BY embedding <=> $q` (model yok)
  │
  ├─ POST /api/investigate
  │     mode=rag   ─► rag.ts: search → getirilen bağlam → Gemini (JSON şema) → proposal.ts doğrular
  │     mode=agent ─► agent.ts: Gemini ⇄ tools.ts (search_endpoints, inspect_endpoint), ≤4 adım
  │                     model function_call önerir → sunucu çalıştırır → function_result geri gider
  │                     └─► investigations tablosuna tam iz yazılır
  │     (Bu rota hedef API'ye asla istek göndermez.)
  │
  └─ POST /api/try  ───────► tools.ts try_get_request  (modele TANIMLANMAZ, yalnızca kullanıcı onayı)
                               └─► request-builder.ts: URL'yi yalnızca dokümandaki işlem + doğrulanmış parametrelerden kur
                               └─► safe-fetch.ts: origin izin listesi, redirect takip etme, timeout, boyut sınırı
                               └─► try_runs tablosu

Örnek mağaza API'si aynı uygulamada gerçek Route Handler'lardır: /demo-api/products, /products/{id}, /categories
PostgreSQL 17 + pgvector: Docker Compose (localhost:5433)
```

**Tablolar** (`db/init.sql`): `api_documents`, `operations` (işlem verisi, embedding'e giden metin, `vector(768)`), `try_runs` (her onaylı deneme), `investigations` (her inceleme ve araç izi).

## Kurulum

Gerekenler: Node.js 20+ (24 LTS ile test edildi), Docker Desktop, bir [Gemini API anahtarı](https://aistudio.google.com/apikey).

```bash
git clone <repo-url> api-pathfinder && cd api-pathfinder
npm install
cp .env.example .env.local
```

`.env.local` dosyasında `POSTGRES_PASSWORD` değerini değiştir (aynı parolayı `DATABASE_URL` içine de yaz) ve `GEMINI_API_KEY` değerini gir. Bu dosya `.gitignore`'dadır.

```bash
npm run db:up        # docker compose --env-file .env.local up -d
npm run db:logs      # "running /docker-entrypoint-initdb.d/001-init.sql" ve "ready to accept connections" satırlarını gör
npm run dev          # http://localhost:3000
```

Faydalı komutlar:

```bash
npm test                                                   # 34 birim testi (vitest)
npm run typecheck
npm run db:psql                                            # psql oturumu
node --env-file=.env.local scripts/list-models.mjs         # anahtarının erişebildiği Gemini modelleri
node --env-file=.env.local scripts/probe-gemini.mjs        # gerçek embedding boyutu + tek bir model çağrısı
node scripts/screenshot.mjs                                # README ekran görüntülerini arayüzü sürerek yeniden al (Edge gerekir)
```

Anahtar yoksa içe aktarma ve manuel deneme yine çalışır. Arama ve inceleme ise sahte cevap üretmek yerine açık bir `503` hatası döndürür.

## Demo senaryoları

Örnek doküman: [`demo/store-openapi.json`](demo/store-openapi.json). Arayüzde **Demo dokümanı yükle → İçe aktar** ile yüklenir.

**1. “Satışta olan ürünleri listele”** → **İncele (Agent + araçlar)**
Model `search_endpoints` ve ardından `inspect_endpoint(listProducts)` çağırır, sonra `listProducts` + `status=on_sale` önerir. Kod doğrulaması *hazır — gönderilmedi* der. **Bu işlemi incele ve dene → İsteği dene** adımlarından sonra `GET http://localhost:3000/demo-api/products?status=on_sale` → `200` ve 8 ürün döner.

**2. “17 numaralı ürünü getir”**, ardından hata durumu
`getProductById` + `id=17` → `GET …/products/17` → `200`. Aynı formda `id` alanını boşaltırsan istek **gönderilmez** (“Eksik zorunlu parametre: id”). `999` yazarsan `404` döner ve kırmızı kutuda “API returned an error. This is NOT a successful result.” mesajı çıkar.

**3. “Müşteri yorumlarını listele”** (dokümanda karşılığı yok)
**Ham arama** yine en yakın 4 işlemi getirir; en üstte 0.643 benzerlikle `listOrders` vardır. Bu, doğru eşleşme olan “17 numaralı ürün → getProductById” aramasının puanından (0.622) **yüksektir**. Yani sabit bir benzerlik eşiği doğruyu yanlıştan ayıramaz. RAG ve Agent modlarında model uygun işlem bulunmadığını söyler ve `operation_id: null` döndürür; Pathfinder endpoint uydurmaz.

![Ham pgvector sonuçları: en yakın sonuç doğru sonuç değildir](docs/screenshot-raw-search.png)

## Doğrulanan “bitti” ölçütleri

Hepsi yerelde, gerçek Gemini API'siyle ve demo API'siyle çalıştırıldı:

| # | Ölçüt | Sonuç |
|---|---|---|
| 1 | “Satışta olan ürünleri listele” → `GET /products`, `status` ile gerçek istek | ✅ `…/products?status=on_sale` → 200, 8 ürün |
| 2 | “17 numaralı ürünü getir” → `id` path'e yerleşir | ✅ `…/products/17` → 200 |
| 3 | Eksik zorunlu parametrede dış çağrı yok | ✅ `needs_input`, `try_runs.url` boş; birim testi `safeGet`'in çağrılmadığını doğrular |
| 4 | Dokümanda olmayan işlem uydurulmaz | ✅ “Müşteri yorumları” → `no_match`; uydurulan `operationId` → `invalid_suggestion` (test) |
| 5 | API hatası başarı gibi gösterilmez | ✅ `id=999` → 404, kırmızı kutu, “NOT a successful result” |
| 6 | Gerçek Gemini araç çağrısı + sunucuda çalışan sonuç görünür | ✅ Arayüzdeki araç izi tablosu ve `investigations.trace` (JSONB) |

## Güvenlik kararları

- **URL dışarıdan alınmaz.** İstemci ve model yalnızca `operationId` ve parametre değerleri verir. URL, dokümandaki `servers[0].url` + işlemin path'i + doğrulanmış parametrelerle kurulur (tip, enum, uzunluk kontrolü; path değerleri `encodeURIComponent` ile kodlanır; `.`/`..` reddedilir; dokümanda tanımsız parametre reddedilir).
- **Origin izin listesi** (`ALLOWED_API_ORIGINS`, varsayılan `http://localhost:3000`) tam eşleşme ister. `169.254.169.254` gibi iç adresler listede olmadıkça çağrılamaz; bu durum içe aktarma sırasında uyarı olarak da gösterilir.
- **Yönlendirme takip edilmez** (`redirect: "manual"`), **timeout** 5 sn, **yanıt boyutu** 64 KB ile sınırlıdır.
- **Model istek gönderemez.** `try_get_request` modele tanımlanmaz. Model bu aracı adıyla çağırmaya çalışırsa çağrı reddedilir ve izde görünür.
- **Güvenilmeyen veri:** hedef, OpenAPI açıklamaları ve API yanıtları modele `<untrusted_data>` içinde veri olarak verilir. Asıl koruma modelin uyması değil, yukarıdaki kod katmanlarıdır.
- **Sırlar:** `.env.local` git dışındadır. Veritabanı yalnızca `127.0.0.1:5433`'e açılır. Tüm SQL sorguları parametrelidir (`$1, $2…`).
- Kimlik doğrulama isteyen işlemler (`security`) ve POST/PUT/PATCH/DELETE çalıştırılmaz.

## Bilinen sınırlar

- Yalnızca **JSON** biçiminde **OpenAPI 3.x** (YAML ve Swagger 2.0 desteklenmez).
- Yalnızca **GET**; yalnızca `path` ve `query` parametreleri; yalnızca `string | integer | number | boolean` (+ `enum`) şemaları. `header`/`cookie` parametreleri, dizi/nesne parametreleri, `content` ile tanımlı parametreler ve varsayılan dışı `style`'lar “desteklenmez” olarak işaretlenir. Bu parametre zorunluysa işlem çalıştırılamaz.
- Yalnızca yerel `$ref` (`#/…`); uzak `$ref` indirilmez, açık bir hatayla reddedilir. Sunucu URL değişkenleri (`{region}`) desteklenmez.
- Kimlik doğrulamalı API'ler çalıştırılmaz.
- Benzerlik puanları kalibre edilmemiştir; “uygun değil” kararını model ve kod doğrulaması verir, bir eşik değeri değil.
- Ücretsiz Gemini katmanında günlük istek kotası düşüktür. Bir agent incelemesi 2–3 model çağrısı yapar. Bu yüzden varsayılan model `gemini-3.5-flash-lite`'tır; kota aşılırsa arayüz `429` hatasını açıkça gösterir.
- Tek kullanıcılı yerel prototip: kimlik doğrulama, çoklu kullanıcı veya dağıtım yapılandırması yoktur.

## Sonraki geliştirmeler

- Herkese açık, kimlik doğrulamasız gerçek bir API'yi (izin listesine eklenerek) desteklemek ve belgelemek.
- YAML girişi, dizi tipindeki query parametreleri (`style: form, explode`), header parametreleri.
- Yanıtın dokümandaki şemaya uyup uymadığını kontrol etmek (şimdilik yalnızca durum kodu ve ham JSON gösteriliyor).
- Küçük bir değerlendirme seti: hedef → beklenen `operationId`, RAG ve Agent modlarının isabet oranını ölçmek.
- Eski dokümanları silme ve aynı dokümanı yeniden içe aktarınca tekrar kaydı engelleme.

## Proje yapısı

```
src/app/page.tsx                  arayüz (tek sayfa)
src/app/demo-api/**               örnek mağaza API'si (gerçek HTTP yanıtları)
src/app/api/{import,documents,operations,embed,search,investigate,try}/route.ts
src/lib/openapi.ts                OpenAPI ayrıştırma, yerel $ref, desteklenmeyen yapıların raporu
src/lib/request-builder.ts        URL oluşturma + parametre doğrulama + fetch örneği
src/lib/safe-fetch.ts             izin listesi, timeout, boyut sınırı, redirect yok
src/lib/try-request.ts            onaylı denemenin tek kod yolu
src/lib/db.ts                     pg havuzu, parametreli sorgular, pgvector araması
src/lib/gemini.ts                 SDK istemcisi, embedding
src/lib/search.ts, rag.ts         semantik arama, RAG
src/lib/tools.ts, agent.ts        araç kaydı, sınırlı function-calling döngüsü
src/lib/proposal.ts               model önerisinin kodla doğrulanması
db/init.sql, docker-compose.yml   şema, PostgreSQL + pgvector
tests/                            vitest: ayrıştırma, URL, izin listesi, eksik parametre, öneri doğrulama, agent döngüsü
```

Bağımlılıklar bilinçli olarak az tutuldu: `next`, `react`, `pg` (PostgreSQL sürücüsü; pgvector değerleri metin literal'i olarak gönderilir, ek paket yok), `@google/genai` (resmî Gemini SDK). Geliştirme bağımlılıkları: `typescript`, `vitest`, `playwright-core` (yalnızca README ekran görüntüleri için, yerel Edge'i kullanır).
