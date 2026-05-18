# REPRESENTATIVE – Standalone Web App

Interná webová aplikácia SEPS REPRESENTATIVE.

---

## Štruktúra projektu

```
P2_Representative/
├── frontend/               # Vite + SolidJS + Tailwind CSS v4
│   └── src/
│       ├── components/
│       │   ├── layout/         # Header, Sidebar, Shell
│       │   ├── events/         # EventsPanel
│       │   ├── news/           # NewsPanel
│       │   └── ticker/         # Ticker + TickerModal
│       ├── pages/              # DashboardPage, DocumentsPage, EventsPage, NewsPage, ManualPage
│       ├── context/            # UserContext (JWT auth)
│       └── styles/
│           └── ticker.css
└── backend/                # Express + PostgreSQL
    ├── routes/             # auth, ticker, events, news, documents, users, upload
    ├── middleware/         # auth.js (JWT)
    ├── db/
    │   ├── schema.sql      # Schéma databázy
    │   ├── seed.js         # Admin používateľ + ukážkové dáta
    │   ├── seed_docs.js    # Štruktúra priečinkov dokumentov
    │   └── migrate_ticker_att.js  # Prílohy tickera
    └── public/uploads/     # Nahrané súbory
```

---

## 1. Prvotné nastavenie (po klonovaní z gitu)

Celý postup sa vykonáva **jedenkrát** po stiahnutí projektu.

### Krok 1 – Konfigurácia prostredia

```bash
cp backend/.env.example backend/.env
```

Otvor `backend/.env` a doplň hodnoty:

```
DB_PASSWORD=Representative2026
JWT_SECRET=<vygeneruj: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
```

### Krok 2 – Vytvor databázu (PostgreSQL, raz ako superuser)

```bash
sudo -u postgres psql -c "CREATE USER rep_test WITH PASSWORD 'Representative2026';"
sudo -u postgres psql -c "CREATE DATABASE representative OWNER rep_test;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE representative TO rep_test;"
```

### Krok 3 – Vytvor tabuľky (schéma)

```bash
psql -U rep_test -d representative -h localhost -f backend/db/schema.sql
```

### Krok 4 – Spusti migrácie

```bash
cd backend
node ./db/migrate_ticker_att.js
```

### Krok 5 – Naplň počiatočné dáta (seed)

```bash
node ./db/seed.js
node ./db/seed_docs.js
```

> Po seede je vytvorený admin účet: **admin / Representative2026**

### Krok 6 – Nainštaluj závislosti

```bash
# Backend
cd backend && npm install

# Frontend (v novom termináli)
cd frontend && npm install
```

---

## 2. Spustenie (vývoj)

Spusti v **dvoch samostatných termináloch**:

```bash
# Terminál 1 – Backend (port 5300)
cd backend && npm run dev
```

```bash
# Terminál 2 – Frontend (port 3300)
cd frontend && npm run dev
```

Aplikácia beží na `http://localhost:3300`.

---

## 3. Produkčný build

```bash
cd frontend && npm run build
cd ../backend && npm start
```

---

## 4. Ticker – správa správ

- **Pravý klik** na ticker (dolná páska) → otvorí správcovský modal
- Pridávanie, úprava, mazanie správ, možnosť priložiť súbory
- Každá správa môže mať URL odkaz a expiráciu (v dňoch alebo bez expirácie)

---

## 5. Reindexovanie dokumentov (na čo je to)

Reindexovanie je admin akcia, ktorá znovu prečíta existujúce dokumenty z databázy a pripraví ich pre full-text vyhľadávanie (Meilisearch).

Čo to prakticky robí:

- Prejde existujúce dokumenty v systéme.
- Extrahuje text z podporovaných súborov (napr. PDF/DOCX/TXT).
- Uloží názov, cestu a text do vyhľadávacieho indexu.

Prečo je to užitočné:

- Vyhľadávanie je rýchlejšie a presnejšie.
- Dá sa hľadať aj podľa obsahu dokumentu, nie len podľa názvu.
- Je to záchranná akcia po migrácii, obnove dát alebo ak index nie je synchronizovaný.

Je to nevyhnutné pri bežnej prevádzke?

- Nie. Nové dokumenty sa indexujú priebežne pri nahraní.
- Reindex sa používa skôr výnimočne, keď treba "dorovnať" index.

Odporúčanie pre produkciu:

- Tlačidlo "Reindexovať" ponechať ako servisnú admin funkciu.
- Spúšťať len pri potrebe (migrácia, obnova, podozrenie na neúplné výsledky vyhľadávania).

Čo sa deje pri výpadku Meilisearch:

- Aplikácia beží ďalej (graceful degradation), ale full-text dokumentov je dočasne nedostupný.
- Backend sa pokúša o automatické opätovné pripojenie každých 30 sekúnd.
- V Administrácii je dostupný stav vyhľadávania a tlačidlo "Skúsiť pripojiť teraz" pre okamžitý manuálny pokus.

---

## Technológie

- **Frontend**: [SolidJS](https://solidjs.com) + [Vite](https://vitejs.dev) + [Tailwind CSS v4](https://tailwindcss.com)
- **Backend**: [Express](https://expressjs.com) + [PostgreSQL](https://www.postgresql.org) + JWT auth
