import { createClient } from '@supabase/supabase-js';

// Hergebruikt het bestaande Supabase-project van CATANIA (Brokkert/catan).
// De tabel catan_shared is een generieke key-value store (id text pk, state text,
// updated_at) met anon read/write + realtime — paklijst-data leeft daar onder
// een eigen key-prefix, dus geen extra setup nodig.
const SUPABASE_URL = 'https://ogqytxojtnddzsjidyjf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bo2NeFurx39ErHGee1gfLw_xyYc81yi';
const TABLE = 'catan_shared';
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
  if (!data?.state) return null;
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
          onRemoteState(JSON.parse(row.state));
        } catch (e) {
          console.warn('[paklijst] kon remote state niet parsen:', e);
        }
      }
    )
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') setStatus('online');
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setStatus('error');
    });
  return () => supabase.removeChannel(channel);
}
