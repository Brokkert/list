# Supabase setup

## Stap 1 — SQL (eenmalig)

Dashboard → **SQL Editor** → plak dit en Run:

```sql
-- Profielen: één rij per gebruiker, alleen door de eigenaar te lezen/schrijven
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  state text,
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;

drop policy if exists "own_select" on public.profiles;
create policy "own_select" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own_insert" on public.profiles;
create policy "own_insert" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "own_update" on public.profiles;
create policy "own_update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "own_delete" on public.profiles;
create policy "own_delete" on public.profiles for delete using (auth.uid() = id);

-- Gedeelde lijst-snapshots: publiek leesbaar, alleen de eigenaar schrijft
create table if not exists public.shared_lists (
  id text primary key,
  owner uuid not null references auth.users (id) on delete cascade,
  data text,
  updated_at timestamptz default now()
);
alter table public.shared_lists enable row level security;

drop policy if exists "share_read" on public.shared_lists;
create policy "share_read" on public.shared_lists for select using (true);
drop policy if exists "share_insert" on public.shared_lists;
create policy "share_insert" on public.shared_lists for insert with check (auth.uid() = owner);
drop policy if exists "share_update" on public.shared_lists;
create policy "share_update" on public.shared_lists for update using (auth.uid() = owner) with check (auth.uid() = owner);
drop policy if exists "share_delete" on public.shared_lists;
create policy "share_delete" on public.shared_lists for delete using (auth.uid() = owner);

-- Realtime voor je eigen profiel-rij
alter publication supabase_realtime add table public.profiles;
```

## Stap 2 — Auth-instellingen

1. **Authentication → URL Configuration**:
   - Site URL: `https://brokkert.github.io/list/`
   - Redirect URLs: voeg dezelfde URL toe
2. **Authentication → Sign In / Providers**: Email staat standaard aan — niets te doen.
   Magic links gebruiken Supabase's ingebouwde mailer (gratis, wel traag/gelimiteerd
   tot een paar mails per uur — prima voor eigen gebruik).

## Legacy

De oude open tabel `paklijst_shared` blijft bestaan voor (a) de eenmalige import
van oude profielen bij eerste login en (b) de keepalive-ping. Na het importeren
biedt de app aan je oude openbare rij te verwijderen.

De keepalive-workflow pingt de database dagelijks zodat het gratis project niet
auto-pauzeert.
