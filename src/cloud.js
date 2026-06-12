import { createClient } from '@supabase/supabase-js';

// Eigen Supabase-project voor de paklijst-app (zie SUPABASE_SETUP.md).
// paklijst_shared is een key-value store (id text pk, state text, updated_at)
// met anon read/write + realtime; elke rij is één profiel.
const SUPABASE_URL = 'https://anglxcniiktoenoqapqz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qyGsqcHIofui-1rI0WZadQ_cb91iv26';
const TABLE = 'paklijst_shared';
const PREFIX = 'paklijst:v1:';

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

const keyFor = (slug) => PREFIX + slug;

export async function listCloudProfiles() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, state, updated_at')
    .like('id', `${PREFIX}%`);
  if (error) {
    lastError = error.message;
    setStatus('error');
    throw error;
  }
  return (data || []).map((row) => {
    const slug = row.id.slice(PREFIX.length);
    let email = slug;
    let listCount = 0;
    try {
      const s = JSON.parse(row.state);
      if (s?.email) email = s.email;
      listCount = s?.lists?.length || 0;
    } catch {
      /* corrupt rows tonen we gewoon op slug */
    }
    return { slug, email, listCount, updatedAt: row.updated_at };
  });
}

let lastKnownUpdatedAt = null;

export async function loadProfile(slug) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('state, updated_at')
    .eq('id', keyFor(slug))
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

let saveTimer = null;
let lastSavedUpdatedAt = null;
let statusListeners = new Set();
let status = 'offline'; // offline | syncing | online | error
let lastError = null;
let pending = null; // laatste niet-opgeslagen { slug, state }

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

async function flushSave() {
  if (!pending) return;
  const { slug, state } = pending;
  const updated_at = new Date().toISOString();
  let error = null;
  try {
    ({ error } = await supabase
      .from(TABLE)
      .upsert({ id: keyFor(slug), state: JSON.stringify(state), updated_at }, { onConflict: 'id' }));
  } catch (e) {
    error = e;
  }
  if (error) {
    console.warn('[paklijst] save error:', error.message);
    lastError = error.message;
    setStatus('error');
    // blijven proberen tot het lukt; pending bevat altijd de nieuwste state
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 15000);
  } else {
    pending = null;
    lastSavedUpdatedAt = updated_at;
    lastKnownUpdatedAt = updated_at;
    lastError = null;
    setStatus('online');
  }
}

export function saveProfileDebounced(slug, state) {
  pending = { slug, state };
  clearTimeout(saveTimer);
  setStatus('syncing');
  saveTimer = setTimeout(flushSave, 700);
}

export async function deleteProfile(slug) {
  const { error } = await supabase.from(TABLE).delete().eq('id', keyFor(slug));
  if (error) throw error;
}

export function subscribeProfile(slug, onRemoteState) {
  const apply = (state, updatedAt) => {
    lastKnownUpdatedAt = updatedAt || lastKnownUpdatedAt;
    onRemoteState(state);
  };

  const channel = supabase
    .channel(`paklijst_${slug}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE, filter: `id=eq.${keyFor(slug)}` },
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
      // Realtime is een nice-to-have: een kapot kanaal is geen sync-fout,
      // de polling hieronder vangt wijzigingen alsnog op.
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        console.warn('[paklijst] realtime-kanaal:', s);
      }
    });

  // Polling-fallback: elke 30s checken of een ander apparaat iets wijzigde.
  const poll = setInterval(async () => {
    if (pending) return; // eigen wijziging onderweg, niet overschrijven
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('state, updated_at')
        .eq('id', keyFor(slug))
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
