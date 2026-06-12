# 🧳 Paklijst

Mobile-first web-app voor vakantie-paklijstjes: één **Bak** met al je spullen, en per vakantie een **lijstje** dat items uit die Bak gebruikt (met aantallen en afvinken).

## Features

- **📦 De Bak** — al je spullen, ingedeeld in categorieën (kleding, kamperen, wintersport, …). Nieuwe profielen starten met een gevulde voorbeeld-Bak.
- **🧳 Lijstjes** — per vakantie een lijst; items kies je uit de Bak, met aantal en vinkje. Progress-balk, dupliceren, vinkjes resetten.
- **✨ Losse items** — dingen die alleen in één lijstje horen (en niet in de Bak), zoals "cadeau voor oma".
- **👥 Anderen** — bekijk lijstjes van andere profielen en kopieer ze naar jezelf; ontbrekende spullen worden automatisch aan je eigen Bak toegevoegd.
- **Login met alleen e-mail** — geen wachtwoord; elk e-mailadres is een eigen profiel met eigen Bak + lijstjes.
- **Persistent + realtime** — data staat in Supabase, met localStorage als cache/offline-fallback en realtime sync tussen apparaten.

## Database

Eigen gratis Supabase-project met één key-value tabel `paklijst_shared` (anon read/write + realtime), key per profiel: `paklijst:v1:<email-slug>`. Eenmalige setup staat in [SUPABASE_SETUP.md](SUPABASE_SETUP.md); de keepalive-workflow houdt het gratis project wakker zodat het niet auto-pauzeert.

> ⚠️ Beveiligingsniveau is "hobby-app": er is geen echte authenticatie en iedereen met de anon key kan alle profielen lezen/schrijven. Zet er niks geheims in.

## Ontwikkelen

```bash
npm install
npm run dev      # dev server
npm run build    # productie build → dist/
```

## Deployen

Elke push naar `main` (of de huidige claude-branch) bouwt en deployt automatisch naar **GitHub Pages** via `.github/workflows/deploy.yml` — zelfde opzet als CATANIA. Let op: GitHub Pages op een gratis account vereist een **publieke** repo.
