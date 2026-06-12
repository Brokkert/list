# Supabase setup (eenmalig)

Maak op [supabase.com](https://supabase.com/dashboard) een (gratis) project aan, ga naar **SQL Editor** en run:

```sql
create table if not exists public.paklijst_shared (
  id text primary key,
  state text,
  updated_at timestamptz default now()
);

alter table public.paklijst_shared enable row level security;

drop policy if exists "anon_all" on public.paklijst_shared;
create policy "anon_all"
  on public.paklijst_shared
  for all
  using (true)
  with check (true);

alter publication supabase_realtime add table public.paklijst_shared;
```

Dat zet:
- Een key-value tabel `paklijst_shared`; elke rij is één profiel (key `paklijst:v1:<email-slug>`).
- Anon read/write (hobby-app, geen echte authenticatie — zet er niks geheims in).
- Realtime aan, zodat wijzigingen live naar andere apparaten gepusht worden.

Zet daarna de **Project URL** en **publishable key** (Settings → API) in `src/cloud.js` (`SUPABASE_URL` / `SUPABASE_KEY`) en in `.github/workflows/keepalive.yml`.

> De keepalive-workflow pingt de database elke 3 dagen, zodat het gratis project niet auto-pauzeert.
