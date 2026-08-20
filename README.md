# 🧳 Paklijst

Mobile-first web-app voor vakantie-paklijstjes: één **Bak** met al je spullen, en per vakantie een **lijstje** dat items uit die Bak gebruikt (met aantallen en afvinken).

## Features

- **📦 De Bak** — al je spullen, ingedeeld in categorieën (kleding, kamperen, wintersport, …). Nieuwe profielen starten met een gevulde voorbeeld-Bak.
- **🧳 Lijstjes** — per vakantie een lijst; items kies je uit de Bak, met aantal en vinkje. Progress-balk, dupliceren, vinkjes resetten.
- **✨ Losse items** — dingen die alleen in één lijstje horen (en niet in de Bak), zoals "cadeau voor oma".
- **🔗 Delen** — een lijstje delen zet bewust een momentopname (zonder locaties/notities) achter een deel-link; de ontvanger kan meekijken en kopiëren naar het eigen account.
- **Login met magic-link** — e-mail invullen, link in je mail, klaar. Geen wachtwoord.
- **Privé + realtime** — je data staat in Supabase achter row-level security: alleen jij kunt je eigen Bak en lijstjes lezen/schrijven. localStorage als cache/offline-fallback, realtime sync tussen apparaten.

## Database

Eigen gratis Supabase-project met Supabase Auth (magic-link) en twee tabellen: `profiles` (RLS: alleen de eigenaar) en `shared_lists` (expliciet gedeelde snapshots, publiek leesbaar). Setup staat in [SUPABASE_SETUP.md](SUPABASE_SETUP.md); de keepalive-workflow houdt het gratis project wakker zodat het niet auto-pauzeert.

## Ontwikkelen

```bash
npm install
npm run dev      # dev server
npm run build    # productie build → dist/
```

## Deployen

Elke push naar `main` (of de huidige claude-branch) bouwt en deployt automatisch naar **GitHub Pages** via `.github/workflows/deploy.yml` — zelfde opzet als CATANIA. Let op: GitHub Pages op een gratis account vereist een **publieke** repo.
