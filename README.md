# REPRESENTATIVE – Standalone Web App

Samostatná webová aplikácia replikujúca SharePoint stránku REPRESENTATIVE (ŠEPS).  
Prepojená na SharePoint Online cez Microsoft MSAL (OAuth2 PKCE).

---

## Štruktúra projektu

```
P2_Representative/
├── frontend/               # Vite + SolidJS + Tailwind CSS v4
│   └── src/
│       ├── config/
│       │   ├── msal.js         ← ⚠️ VYPLNIŤ: Client ID + Tenant ID
│       │   └── sharepoint.js   ← ⚠️ prispôsobiť navigáciu a listy
│       ├── services/
│       │   ├── auth.js         # MSAL auth service
│       │   └── sp.js           # SharePoint REST API calls
│       ├── components/
│       │   ├── layout/         # Header, Sidebar
│       │   ├── events/         # EventsPanel
│       │   ├── news/           # NewsPanel
│       │   └── ticker/         # Ticker + TickerModal
│       └── styles/
│           └── ticker.css      # Štýly tickera
└── backend/                # Express – produkčný server + SP proxy
    └── app.js
```

---

## 1. Registrácia Azure AD aplikácie

1. Otvorte [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Nastavte:
   - **Name**: `REPRESENTATIVE App`
   - **Supported account types**: *Accounts in this organizational directory only*
   - **Redirect URI**: `Single-page application (SPA)` → `http://localhost:3000` (dev)  
     Pre produkciu pridajte ďalšiu URI, napr. `https://vas-server.sepssk.sk`
3. Po registrácii skopírujte:
   - **Application (client) ID** → `clientId` v `msal.js`
   - **Directory (tenant) ID** → časť URL v `authority` v `msal.js`

### API Permissions

V záložke **API permissions** pridajte:

| API | Permission | Typ |
|-----|-----------|-----|
| Microsoft Graph | `User.Read` | Delegated |
| SharePoint | `AllSites.Read` | Delegated |
| SharePoint | `AllSites.Write` | Delegated |

Kliknite **Grant admin consent**.

---

## 2. Konfigurácia aplikácie

Otvorte `frontend/src/config/msal.js` a vyplňte:

```js
export const MSAL_CONFIG = {
  auth: {
    clientId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',  // ← váš Client ID
    authority: 'https://login.microsoftonline.com/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    redirectUri: window.location.origin,
  },
  ...
};
```

Prispôsobte `frontend/src/config/sharepoint.js`:
- `SP_LISTS.events` – názov SharePoint Calendar listu (predvolene `'Udalosti'`)
- `NAV_ITEMS` – navigačné linky v sidebari

---

## 3. Spustenie (vývoj)

```bash
# Frontend (Vite dev server na port 3000)
cd frontend
npm install
npm run dev
```

Otvorte `http://localhost:3000` – prihlásenie cez Microsoft 365.

---

## 4. Produkčný build + spustenie

```bash
# Build frontendu
cd frontend
npm run build

# Spustenie Express backendу (servíruje dist/ + SP proxy)
cd ../backend
npm install
npm start
```

Backend štandardne beží na porte 3000 (konfigurovateľné v `bin/www`).

---

## 5. Ticker – správa správ

- **Pravý klik** na ticker (dolná páska) → otvorí správcovský modal
- Pridávanie, úprava, mazanie správ priamo cez SharePoint list `Ticker news`
- Každá správa môže mať URL odkaz a životnosť (v dňoch alebo bez expirácie)

---

## SharePoint listy

| List | Použitie |
|------|---------|
| `Udalosti` | SharePoint Calendar – udalosti v paneli vľavo |
| `Ticker news` | Vlastný list – správy v dolnej páske |
| Site Pages | News Posts – novinky v paneli vpravo |

---

## Technológie

- **Frontend**: [SolidJS](https://solidjs.com) + [Vite](https://vitejs.dev) + [Tailwind CSS v4](https://tailwindcss.com)
- **Auth**: [@azure/msal-browser](https://github.com/AzureAD/microsoft-authentication-library-for-js)
- **Backend**: [Express](https://expressjs.com) (produkčný server + voliteľný SP proxy)
