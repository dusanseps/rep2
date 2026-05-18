# Reindex Endpoint – Popis a Vzory Použitia

## Popis

Endpoint `/api/documents/reindex` umožňuje re-indexovať všetky existujúce dokumenty z databázy do Meilisearch full-text vyhľadávacieho indexu. Tento endpoint je užitočný pre:

- **Migrácia**: Po nasadení vyhľadávacej funkcie pre dokumenty, ktoré boli nahraté pred jej zavedie-ním
- **Obnovenie indexu**: Ak bol index poškodený alebo vyčistený
- **Aktualizácia**: Ak sa zmeny v `textExtract.js` alebo Meilisearch konfigurácii vyžadujú re-indexáciu

## Bezpečnosť

- **Autentifikácia**: Vyžaduje platný JWT token (`Authorization: Bearer <token>`)
- **Autorizácia**: Iba **editori** a **admini** majú prístup (iní dostanú `401 Unauthorized`)
- **Bezpečnosť operácie**: Reindexovanie sa spúšťa **v pozadí** bez blokovania ostatných requestov

## Technické Detaily

### Endpoint

```
POST /api/documents/reindex
```

### Request Headers

```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Request Body

```json
{}
```

(Bez požadovaných parametrov)

### Response – Okamžitá (synchronná)

```json
{
  "message": "Reindexovanie začalo v pozadí",
  "total": 42,
  "status": "processing",
  "startedAt": "2024-01-15T14:32:45.123Z",
  "estimatedCompletionTime": "5 sekúnd (orientačne)"
}
```

### Backend Logging

Počas reindexovania sa v logoch backendu objavujú správy:

```
[Reindex] ✓ Indexed file 5: annual-report.pdf
[Reindex] ✓ Indexed file 12: policy-document.docx
[Reindex] Skipping file 8 – file not found at /path/to/file
[Reindex] ✗ Failed to index file 15: Error processing file
[Reindex] Finished: 40 indexed, 2 skipped, 0 failed in 28s
```

### Server-Sent Events (SSE) Notifikácia

Keď je reindexovanie hotové, všetci klienti s aktívnym SSE pripojením (`/api/documents/subscribe`) dostanú správu:

```json
{
  "type": "reindex-complete",
  "indexed": 40,
  "skipped": 2,
  "failed": 0,
  "elapsedSeconds": 28,
  "ts": 1705334365123
}
```

---

## Príklady Použitia

### Príklad 1: cURL

```bash
# Reindexovanie všetkých súborov
curl -X POST http://localhost:5300/api/documents/reindex \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json"

# Odpoveď:
# {
#   "message": "Reindexovanie začalo v pozadí",
#   "total": 42,
#   "status": "processing",
#   "startedAt": "2024-01-15T14:32:45.123Z",
#   "estimatedCompletionTime": "5 sekúnd (orientačne)"
# }
```

### Príklad 2: JavaScript/Fetch

```javascript
async function reindexDocuments(token) {
  const response = await fetch('/api/documents/reindex', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('Reindex failed:', error.error);
    return;
  }

  const result = await response.json();
  console.log(`Reindexovanie: ${result.total} súborov`);
  console.log(`Odhadovaný čas: ${result.estimatedCompletionTime}`);
}
```

### Príklad 3: Backend Script

```javascript
// backend/scripts/reindex.js

const axios = require('axios');

async function reindex() {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    console.error('ADMIN_TOKEN nie je nastavený');
    process.exit(1);
  }

  try {
    const response = await axios.post('http://localhost:5300/api/documents/reindex', {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    console.log('✓ Reindexovanie spustené');
    console.log(response.data);
  } catch (err) {
    console.error('✗ Reindex error:', err.response?.data || err.message);
  }
}

reindex();
```

---

## Očakávaný Priebeh Reindexovania

### Fáza 1: Iniciácia (< 100 ms)

```
POST /api/documents/reindex
↓
[Backend] Načítanie všetkých doc_files z DB
↓
[Backend] Počítanie: total = 42 súborov
↓
← Odpoveď: {message: "Reindexovanie začalo...", total: 42}
```

**Klient dostane odpoveď ihneď.**

### Fáza 2: Spracovanie (20–60 sekúnd)

```
[Backend – pozadie] Pre každý súbor:
  1. Overiť, že súbor existuje na disku
  2. Extrahovať text (PDF → text, DOCX → text, atď.)
  3. Budovať folder path
  4. Volať indexDocument() → Meilisearch
  5. Log: "✓ Indexed file X: name"
  ↓
  [10 ms oneskorenie] – predídenie overloadu
```

### Fáza 3: Dokončenie

```
[Backend] Výpočet: indexed=40, skipped=2, failed=0
[Backend] Log: "Finished: 40 indexed, 2 skipped, 0 failed in 28s"
[Backend] SSE Broadcast: {type: "reindex-complete", ...}
↓
[Frontend] Ak je DocumentsPage otvorená s SSE:
  Klient dostane notifikáciu a môže si zobraziť sprievodné správy
```

---

## Možné Výstupy – Štatistika

### Scenario 1: Všetci Súbory Úspešne Indexovaní

```json
{
  "indexed": 42,
  "skipped": 0,
  "failed": 0,
  "elapsedSeconds": 28
}
```

**Interpretácia**: Všetko OK, všetky 42 súborov sú teraz v Meilisearch.

### Scenario 2: Niektoré Súbory Preskočené

```json
{
  "indexed": 40,
  "skipped": 2,
  "failed": 0,
  "elapsedSeconds": 22
}
```

**Interpretácia**: 2 súbory boli preskočené (pravdepodobne preto, že:
- Súbor neexistuje na disku (bol vymazaný)
- Formát nie je podporovaný
- `file_url` je poškodená

Kontrola logov:
```bash
docker logs backend | grep "\[Reindex\] Skipping"
```

### Scenario 3: Niektoré Súbory Zlyhali

```json
{
  "indexed": 38,
  "skipped": 2,
  "failed": 2,
  "elapsedSeconds": 25
}
```

**Interpretácia**: 2 súbory zlyhali počas spracovania (chyba pri extrakcii textu alebo Meilisearch).

Kontrola logov:
```bash
docker logs backend | grep "\[Reindex\] ✗ Failed"
```

---

## Bezpečnosť a Dobrá Prax

### ✅ Bezpečné Použitie

1. **Spustenie na produkčnom serveri**:
   ```bash
   # 1. SSH do servera
   ssh user@production.server.com
   
   # 2. Spustenie reindexovania cez admin API
   curl -X POST https://production.server.com/api/documents/reindex \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json"
   
   # 3. Monitoring logov
   docker logs -f backend | grep "Reindex"
   ```

2. **Počas chodu aplikácie**: Reindexovanie neblokuje ostatné requesty – aplikácia stále funguje normálne.

### ⚠️ Varovanie – Čo NEROBIŤ

- **❌ Nespúšťajte v desenvolvimento** bez potreby – zbytočne zaberá zdroje
- **❌ Nevolejte endpoint viac ako 1x za 5 minút** – môže preťažiť Meilisearch
- **❌ Nespúšťajte bez overenia JWT tokenu** – endpoint vyžaduje autentifikáciu
- **❌ Nepredpokladajte okamžitosť** – operácia trvá 20–60 sekúnd podľa počtu súborov

---

## Chybové Stavy a Riešenie

### Chyba: 401 Unauthorized

```json
{"error": "Unauthorized"}
```

**Príčina**: Nikto není prihlásiný ako editor/admin alebo JWT token je neplatný.

**Riešenie**:
```bash
# Overenie, že ste prihlásený ako editor
# (Kontrola headers a JWT tokenu)
```

### Chyba: 500 Internal Server Error

```json
{"error": "Reindexovanie zlyhalo. Skúste prosím neskôr."}
```

**Príčina**: Neočakávaná chyba v backendu.

**Riešenie**:
```bash
# Kontrola logov backendu
docker logs backend | tail -50

# Overenie, že Meilisearch beží
docker ps | grep meilisearch

# Reštart backendu
npm run dev
```

### Chyba: Reindexovanie Trvá Príliš Dlho

**Príčina**: Veľa súborov alebo pomalý disk.

**Riešenie**:
- Počkajte – operácia je normálne.
- Sledujte log: `docker logs backend | grep "Indexed file"` – aby ste videli priebeh
- Ak je Meilisearch vypnutý, opravte: `docker compose up -d meilisearch`

---

## Monitoring – Ako Sledovať Priebeh

### Real-Time Monitoring z Backendu

```bash
# Terminal 1: Sledovanie logov reindexovania
docker logs -f backend | grep "Reindex"

# Výstup:
# [Reindex] ✓ Indexed file 1: annual-report.pdf
# [Reindex] ✓ Indexed file 2: policy-2024.docx
# [Reindex] Skipping file 3 – file not found
# [Reindex] ✓ Indexed file 4: manual.pdf
# ...
# [Reindex] Finished: 40 indexed, 2 skipped, 0 failed in 28s
```

### Frontend – Notifikácia po Dokončení

Ak je frontendová aplikácia otvorená a SSE pripojená:

```javascript
// Frontend automaticky dostane:
{
  "type": "reindex-complete",
  "indexed": 40,
  "skipped": 2,
  "failed": 0,
  "elapsedSeconds": 28
}

// Aplikácia môže zobraziť toast notifikáciu:
// "✓ Reindexovanie hotové: 40 súborov indexovaných"
```

---

## Vzorová Sekventácia – Produkčné Nasadenie

```
Den 0: Nasadenie vyhľadávacej funkcie
├─ 10:00 – Deploynuť backend s novým kódom (routes/documents.js + services/)
├─ 10:10 – Verifikácia: Backend beží, Meilisearch dostupný
├─ 10:15 – Spustenie reindexovania:
│  curl -X POST https://prod.server/api/documents/reindex \
│    -H "Authorization: Bearer $ADMIN_TOKEN"
├─ 10:16 – Monitoring: docker logs -f backend | grep "Reindex"
├─ 10:45 – Reindexovanie hotové (40 súborov za 30 sekúnd)
├─ 10:46 – Overenie: Vyhľadávanie funguje
└─ 10:47 – ✓ Hotovo, aplikácia live
```

---

## Dodatočné Otázky

**Q: Koľko trvá reindexovanie?**  
A: 20–60 sekúnd v závislosti od počtu súborov a typu. V priemere 1 súbor za ~0.5–1 sekundu.

**Q: Blokuje reindexovanie ostatné requesty?**  
A: Nie. Reindexovanie beží v pozadí. Ostatní používatelia môžu normálne pracovať.

**Q: Čo sa stane, ak Meilisearch padne počas reindexovania?**  
A: Reindexovanie zlyhá pre zostávajúce súbory. Existujúce indexované súbory ostanú. Môžete reindexovanie spustiť znova.

**Q: Je bezpečné spustenie reindexovania viac ako 1x?**  
A: Áno. Duplicitné indexovanie prepíše existujúce záznamy. Nie sú duplicitné záznamy.

**Q: Ako sa reindexovanie spúšťa automaticky pri aplikácii?**  
A: Zatiaľ **ručne** cez API endpoint. V budúcnosti by sa dal automatizovať cron job.

---

## Implementačné Detaily (Pre Vývojárov)

### Lokácia Kódu

```
backend/routes/documents.js – POST /documents/reindex (riadky ~555–612)
```

### Volané Funkcie

1. `query()` – Načítanie súborov z DB
2. `extractText()` – Extrakcia textu z súboru
3. `buildFolderDisplayPath()` – Budovanie cesty pre index
4. `indexDocument()` – Indexovanie v Meilisearch
5. `broadcastDocumentsUpdate()` – SSE notifikácia

### Chybové Stavy

- **Pokračuje aj pri chybách**: Ak jeden súbor zlyhá, reindexovanie pokračuje ďalším
- **Non-blocking**: `setImmediate()` zabezpečuje, že HTTP response je vrátená okamžite
- **Logging**: Všetky chyby sú logované s detailami pre debugovanie

---

## Záver

Endpoint `/api/documents/reindex` je **bezpečný**, **efektívny** a **spoľahlivý** spôsob na re-indexovanie existujúcich dokumentov. Počas prvého nasadenia vyhľadávacej funkcie na produkčný server:

1. Spustite: `POST /api/documents/reindex`
2. Počkajte na dokončenie
3. Overite: Vyhľadávanie funguje s existujúcimi súbormi

✓ Aplikácia je hotová!
