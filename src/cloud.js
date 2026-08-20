import { createClient } from '@supabase/supabase-js';

// Supabase met echte accounts (zie SUPABASE_SETUP.md):
// - auth via magic-link (e-mail, geen wachtwoord)
// - tabel `profiles` (id uuid = auth-uid, state text, updated_at) met RLS:
//   alleen de eigenaar kan z'n eigen rij lezen/schrijven
// - tabel `shared_lists` (id text, owner uuid, data text): expliciet gedeelde
//   lijst-snapshots, publiek leesbaar, alleen door de eigenaar te schrijven
// - legacy: `paklijst_shared` (open key-value) blijft bestaan voor eenmalige
//   import van oude profielen en voor de keepalive-ping
const SUPABASE_URL = 'https://anglxcniiktoenoqapqz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qyGsqcHIofui-1rI0WZadQ_cb91iv26';
const TABLE = 'profiles';
const LEGACY_TABLE = 'paklijst_shared';
const LEGACY_PREFIX = 'paklijst:v1:';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { params: { eventsPerSecond: 5 } },
});

export function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ---------------- auth ---------------- */

export async function getSessionUser() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user || null;
}

export function onAuth(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user || null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

/* ---------------- status ---------------- */

let saveTimer = null;
let lastSavedUpdatedAt = null;
let lastKnownUpdatedAt = null;
let statusListeners = new Set();
let status = 'offline'; // offline | syncing | online | error
let lastError = null;
let pending = null; // laatste niet-opgeslagen { uid, state }
let inflight = false;

function setStatus(s) {
  status = s;
  statusListeners.forEach((fn) => fn(s));
}
export function getStatus() {
  return status;
}
export function getLastError() {
  return lastError;
}
export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/* ---------------- profiel (eigen rij, RLS) ---------------- */

export async function loadProfile(uid) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('state, updated_at')
    .eq('id', uid)
    .maybeSingle();
  if (error) {
    lastError = error.message;
    setStatus('error');
    throw error;
  }
  setStatus('online');
  if (!data?.state) return null;
  lastKnownUpdatedAt = data.updated_at;
  return { state: JSON.parse(data.state), updatedAt: data.updated_at };
}

async function flushSave() {
  if (!pending || inflight) return;
  const job = pending;
  inflight = true;
  const updated_at = new Date().toISOString();
  let error = null;
  try {
    ({ error } = await supabase
      .from(TABLE)
      .upsert({ id: job.uid, state: JSON.stringify(job.state), updated_at }, { onConflict: 'id' }));
  } catch (e) {
    error = e;
  }
  inflight = false;
  if (error) {
    console.warn('[paklijst] save error:', error.message);
    lastError = error.message;
    setStatus('error');
    // blijven proberen tot het lukt; pending bevat altijd de nieuwste state
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 15000);
  } else {
    lastSavedUpdatedAt = updated_at;
    lastKnownUpdatedAt = updated_at;
    lastError = null;
    if (pending === job) {
      pending = null;
      setStatus('online');
    } else {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, 100);
    }
  }
}

export function saveProfileDebounced(uid, state) {
  pending = { uid, state };
  clearTimeout(saveTimer);
  setStatus('syncing');
  saveTimer = setTimeout(flushSave, 700);
}

export function subscribeProfile(uid, onRemoteState) {
  const apply = (state, updatedAt) => {
    lastKnownUpdatedAt = updatedAt || lastKnownUpdatedAt;
    onRemoteState(state);
  };

  const channel = supabase
    .channel(`paklijst_${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE, filter: `id=eq.${uid}` },
      (payload) => {
        const row = payload.new;
        if (!row?.state) return;
        if (row.updated_at && row.updated_at === lastSavedUpdatedAt) return; // eigen echo
        try {
          apply(JSON.parse(row.state), row.updated_at);
        } catch (e) {
          console.warn('[paklijst] kon remote state niet parsen:', e);
        }
      }
    )
    .subscribe((s) => {
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        console.warn('[paklijst] realtime-kanaal:', s);
      }
    });

  // Polling-fallback: elke 30s checken of een ander apparaat iets wijzigde.
  const poll = setInterval(async () => {
    if (pending) return;
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('state, updated_at')
        .eq('id', uid)
        .maybeSingle();
      if (error || !data?.state) return;
      if (data.updated_at && data.updated_at !== lastKnownUpdatedAt && data.updated_at !== lastSavedUpdatedAt) {
        apply(JSON.parse(data.state), data.updated_at);
      }
    } catch {
      /* tijdelijke netwerkfout; volgende poll probeert opnieuw */
    }
  }, 30000);

  return () => {
    clearInterval(poll);
    supabase.removeChannel(channel);
  };
}

/* ---------------- delen (expliciete snapshots) ---------------- */

export async function upsertShare(id, ownerUid, data) {
  const { error } = await supabase
    .from('shared_lists')
    .upsert(
      { id, owner: ownerUid, data: JSON.stringify(data), updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
  if (error) throw error;
}

export async function loadShare(id) {
  const { data, error } = await supabase
    .from('shared_lists')
    .select('data, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.data) return null;
  return JSON.parse(data.data);
}

export async function deleteShare(id) {
  const { error } = await supabase.from('shared_lists').delete().eq('id', id);
  if (error) throw error;
}

/* ---------------- legacy (oude open tabel, voor import) ---------------- */

export async function legacyLoadProfile(slug) {
  const { data, error } = await supabase
    .from(LEGACY_TABLE)
    .select('state, updated_at')
    .eq('id', LEGACY_PREFIX + slug)
    .maybeSingle();
  if (error) throw error;
  if (!data?.state) return null;
  return JSON.parse(data.state);
}

export async function legacyDeleteProfile(slug) {
  const { error } = await supabase.from(LEGACY_TABLE).delete().eq('id', LEGACY_PREFIX + slug);
  if (error) throw error;
}
