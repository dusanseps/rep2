# Produkčné nastavenie Meilisearch

> **Dôležitá bezpečnostná poznámka**: MEILI_MASTER_KEY je kritický bezpečnostný prvok. Slabý alebo standardný kľúč umožňuje neautorizovaný prístup k plným-textovému vyhľadávaciemu indexu vrátane všetkých indexovaných dokumentov. **Nikdy** nepoužívajte „changeme-dev-key" v produkcii.

## 1. Generovanie silného Master Kľúča

### Požiadavky na kľúč
- **Dĺžka**: Minimálne 32 znakov (odporúčané 64+ znakov)
- **Znaky**: Kombinácia veľkých/malých písmen, číslic, špeciálnych znakov
- **Entrópia**: Náhodne generovaný, nie ľudsky vytvorený

### Generovanie kľúča – Možnosť A (Linux/macOS/WSL)

```bash
# Jednoduchý príkaz na vygenerovanie 64-znakového kľúča
openssl rand -base64 48

# Príklad výstupu:
# aBc1De2Fg3Hj4Kl5Mn6Op7Qr8St9Uv0Wx1Yz2Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1Stuvwxyz
```

### Generovanie kľúča – Možnosť B (Node.js)

```bash
# Ak máte Node.js nainštalovaný
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# Príklad výstupu:
# X9yZaB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN
```

### Generovanie kľúča – Možnosť C (Bez nástrojov – Python)

```bash
python3 -c "import secrets; import base64; print(base64.b64encode(secrets.token_bytes(48)).decode())"
```

### Generovanie kľúča – Možnosť D (Online – iba ak nedostupný príkaz)

Návštevte https://generate.plus/ a vygenerujte:
- **Kľúč**: 64 znakov
- **Typ**: Custom (Uppercase + Lowercase + Numbers + Symbols)

⚠️ **NIKDY** nepoužívajte online generátor pre produkčné kľúče s citlivými údajmi - prejde cez tretiu stranu.

---

## 2. Nastavenie Produkčného Kľúča

### Krok 1: Uloženie Kľúča do `docker-compose.yml`

Úprava súboru: **`docker-compose.yml`** (v koreňovom priečinku projektu)

```yaml
version: '3.8'

services:
  meilisearch:
    image: getmeili/meilisearch:v1.6
    container_name: meilisearch
    ports:
      - "7700:7700"
    environment:
      MEILI_MASTER_KEY: "VÁŠ_VYGENEROVANÝ_64_ZNAKOVÝ_KĽÚČ_TU"
      MEILI_NO_ANALYTICS: "true"
    volumes:
      - meili-data:/meili_data

volumes:
  meili-data:
```

**Konkrétny príklad:**

```yaml
environment:
  MEILI_MASTER_KEY: "X9yZaB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN"
  MEILI_NO_ANALYTICS: "true"
```

### Krok 2: Uloženie Kľúča do Backend Premenných Okolia

Úprava/vytvorenie súboru: **`backend/.env`** (alebo `backend/.env.production`)

```ini
# Meilisearch Configuration
MEILI_URL=http://localhost:7700
MEILI_MASTER_KEY=VÁŠ_VYGENEROVANÝ_64_ZNAKOVÝ_KĽÚČ_TU
```

**Príklad:**

```ini
MEILI_URL=http://meilisearch:7700
MEILI_MASTER_KEY=X9yZaB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN
```

### Krok 3: Git Security – Zabránenie Únikum Kľúčov

⚠️ **KRITICKÉ**: Nikdy necommitujte `.env` alebo `docker-compose.yml` s reálnymi kľúčmi!

**Akcia 1: Pridajte do `.gitignore`**

```bash
# V koreňovom priečinku projektu
echo ".env" >> .gitignore
echo ".env.production" >> .gitignore
echo ".env.local" >> .gitignore
echo "backend/.env" >> .gitignore
echo "backend/.env.production" >> .gitignore
```

**Akcia 2: Ak ste už commitli `.env`**

```bash
# Odstrániť z gitu bez vymazania súboru
git rm --cached backend/.env
git rm --cached docker-compose.yml
git commit -m "Remove sensitive files from version control"
```

---

## 3. Overenie Nastavenia – Predspustením Produkcii

### Test 1: Overenie Kľúča v docker-compose.yml

```bash
cd /home/libor/Plocha/repositories/rep2

# Skontrolovať, či je kľúč správne nastavený
grep -A 5 "MEILI_MASTER_KEY" docker-compose.yml

# Výstup by mal byť:
# MEILI_MASTER_KEY: "X9yZaB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN"
```

### Test 2: Overenie Kľúča v backend/.env

```bash
cd backend
grep "MEILI_MASTER_KEY" .env

# Výstup by mal byť:
# MEILI_MASTER_KEY=X9yZaB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3aB4cD5eF6gH7iJ8kL9mN
```

### Test 3: Spustenie Meilisearch Kontajnera

```bash
cd /home/libor/Plocha/repositories/rep2

# Spustenie s vašim produkčným kľúčom
docker compose up -d meilisearch

# Overenie, že kontajner beží
docker ps | grep meilisearch
# Výstup: meilisearch (bez "Exited")

# Overenie logov na chyby
docker logs meilisearch | head -20
```

### Test 4: Overenie Pripojenia z Backend

```bash
cd backend

# Spustenie backendu v dev móde s produkčným kľúčom
npm run dev

# V inom terminálnom okne: Test API s autentifikáciou
curl -X POST http://localhost:5300/api/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_MASTER_KEY" \
  -d '{"query":"test"}'

# Ak vráti 200 a nejaké výsledky (aj keby prázdne): ✓ Kľúč funguje
# Ak vráti 401 Unauthorized: ✗ Kľúč je nesprávny v .env
```

### Test 5: Verifikácia v Browser – Admin Panel

```bash
# Ak máte Meilisearch Admin UI dostupný na:
# http://localhost:7700/admin

# 1. Prejdite na http://localhost:7700
# 2. Kliknite na "Settings" alebo admin panel
# 3. Zadajte MEILI_MASTER_KEY
# 4. Ak ste sa úspešne prihlásilí: ✓ Kľúč je správny
```

---

## 4. Bezpečnostný Checklist – Pred Deploymentom

### ✅ Predspustením (Všetky Nižšie Položky Musia Byť Hotové)

- [ ] **Kľúč je vygenerovaný** – 64+ znakov, náhodný
- [ ] **Nie je `changeme-dev-key`** v docker-compose.yml
- [ ] **Kľúč v docker-compose.yml nastavený** – riadok `MEILI_MASTER_KEY: "..."`
- [ ] **Kľúč v backend/.env nastavený** – riadok `MEILI_MASTER_KEY=...`
- [ ] **`.env` súbory v `.gitignore`** – `git status` neukazuje `.env`
- [ ] **Žiadne `.env` súbory v repoziTóriu** – `git log` neukazuje "Add .env" commits
- [ ] **Spojenie na Meilisearch testované** – `docker logs meilisearch` bez chýb
- [ ] **Kľúč MIMO zdrojového kódu** – Nikde v `.js`, `.jsx` súboroch

### 🔒 Produkčné Postupy (Keď Je Server Live)

1. **Bezpečnosť Kontajnera**: Pokiaľ je možné, nespúšťajte Meilisearch ako `root`
2. **Firewall**: Port 7700 by mal byť dostupný iba z backendu – NIE z internetu
3. **Backup**: Zálohujte `/meili-data` volume pravidelne
4. **Rotácia Kľúčov**: Každý rok alebo po bezpečnostnom incidente vygenerujte nový kľúč

---

## 5. Troubleshooting – Čo Robiť, Ak Niečo Zlyhá

### Chyba: „Connection refused on port 7700"

```bash
# Meilisearch nie je spustený
docker compose up -d meilisearch
docker logs meilisearch

# Ak vraví MEILI_MASTER_KEY error:
# → Skontrolujte docker-compose.yml, či je kľúč bez únikových znakov
```

### Chyba: „Unauthorized – Invalid Master Key"

```bash
# Kľúč v backend/.env sa nepodarí
# 1. Skontrolujte, či ste správne skopírovali kľúč
cat backend/.env | grep MEILI_MASTER_KEY

# 2. Porovnajte s docker-compose.yml
grep MEILI_MASTER_KEY docker-compose.yml

# 3. Reštartujte backend:
npm run dev
```

### Chyba: „env file not found"

```bash
# backend/.env neexistuje
# Vytvorte ho:
cd backend
echo "MEILI_MASTER_KEY=VÁĽ_KĽÚČ_TU" > .env
echo "MEILI_URL=http://localhost:7700" >> .env
```

---

## 6. Diferencia: Development vs Production

| Aspekt | **Development** | **Production** |
|--------|-----------------|----------------|
| **Kľúč** | `changeme-dev-key` OK | ❌ NIKDY! |
| **Kľúč Dĺžka** | Akákoľvek | Min 32, radšej 64+ |
| **Kľúč Zdrojom** | Hardkóded v `services/meili.js` | `.env` súbor (nikdy v git) |
| **Port 7700** | Lokálne (localhost:7700) | Firewall chránený |
| **Logy** | Viacslužbové debug | Monitorované/archivované |
| **Backup** | Voliteľný | Povinný (denný) |

---

## 7. Príklady – Krok Po Kroku

### Príklad Produktívneho Nasadenia

```bash
# 1. Generovanie kľúča
MEILI_KEY=$(openssl rand -base64 48)
echo "Vygenerovaný kľúč: $MEILI_KEY"

# 2. Úprava docker-compose.yml
sed -i "s/MEILI_MASTER_KEY: .*/MEILI_MASTER_KEY: \"$MEILI_KEY\"/" docker-compose.yml

# 3. Úprava backend/.env
cat > backend/.env << EOF
MEILI_URL=http://meilisearch:7700
MEILI_MASTER_KEY=$MEILI_KEY
NODE_ENV=production
EOF

# 4. Git bezpečnosť
git add .gitignore && git commit -m "Add .env to gitignore"
git rm --cached backend/.env docker-compose.yml 2>/dev/null || true
git commit -m "Remove sensitive files"

# 5. Spustenie
docker compose up -d meilisearch
npm run dev

# 6. Overenie
curl http://localhost:7700 -H "Authorization: Bearer $MEILI_KEY"
```

---

## 8. Ďalšie Zdroje

- **Meilisearch Dokumentácia**: https://docs.meilisearch.com/
- **Meilisearch Bezpečnosť**: https://docs.meilisearch.com/learn/security/master_key
- **Docker Compose**: https://docs.docker.com/compose/

---

## Kontakt Pre Problémy

Ak sa vyskytnú problémy s produkčným nastavením:

1. Skontrolujte `docker logs meilisearch` 
2. Verifikujte kľúč v oboch súboroch (`docker-compose.yml` a `backend/.env`)
3. Reštartujte kontajner: `docker compose restart meilisearch`
4. V krajnom prípade: Vygenerujte úplne nový kľúč a opakujte Kroky 2-3

**Kľúčová Myšlienka**: MEILI_MASTER_KEY je ekvivalent hesla k vášmu databázovému serveru – chráňte ho ako také.
