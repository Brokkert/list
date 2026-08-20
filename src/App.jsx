import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  slugify,
  getSessionUser,
  onAuth,
  signInWithEmail,
  signOut,
  loadProfile,
  saveProfileDebounced,
  subscribeProfile,
  upsertShare,
  loadShare,
  legacyLoadProfile,
  legacyDeleteProfile,
  onStatus,
  getStatus,
  getLastError,
} from './cloud.js';
import { CATS, uid, seedState } from './seed.js';
import { fetchWeather, weatherIcon } from './weather.js';

const cacheKey = (slug) => `paklijst:cache:${slug}`;

const EMOJIS = ['🌞', '🏖️', '⛷️', '🏂', '🏕️', '🚗', '✈️', '🚆', '🛳️', '🥾', '🎉', '👶', '💼', '🧳'];

const PREP_PRESETS = ['Kopen', 'Ophalen', 'Opzoeken', 'Klaarleggen', 'Wassen', 'Lenen'];
const PREP_EMOJI = {
  Kopen: '🛒',
  Ophalen: '📦',
  Opzoeken: '🔍',
  Klaarleggen: '📋',
  Wassen: '🧺',
  Lenen: '🤝',
};
const prepEmoji = (label) => PREP_EMOJI[label] || '📝';

// Oudere profielen hebben nog geen eigen categorielijst; geef ze de
// standaardset en verhuis vermaak-items naar de nieuwe categorie.
function migrate(s) {
  if (!s.cats?.length) {
    s.cats = CATS;
    for (const g of s.gear || []) {
      if (g.cat === 'onderweg' && ['Spelletjes / kaarten', 'Boek / tijdschrift'].includes(g.name)) {
        g.cat = 'vermaak';
      }
    }
  }
  for (const g of s.gear || []) {
    if (g.location == null) g.location = '';
  }
  for (const l of s.lists || []) {
    if (l.destination == null) l.destination = '';
    if (l.departure == null) l.departure = '';
    if (l.returnDate == null) l.returnDate = '';
    if (l.people == null) l.people = 1;
    if (l.color == null) l.color = '';
    for (const it of l.items || []) if (it.note == null) it.note = '';
    for (const it of l.extras || []) if (it.note == null) it.note = '';
  }
  if (!Array.isArray(s.templates)) s.templates = [];
  if (!s.bakName) s.bakName = 'De Bak';
  return s;
}

const LIST_COLORS = [
  { id: '', label: 'Standaard', value: '' },
  { id: 'red', label: 'Rood', value: '#d24a4a' },
  { id: 'orange', label: 'Oranje', value: '#e89c4a' },
  { id: 'yellow', label: 'Geel', value: '#d4ad2e' },
  { id: 'green', label: 'Groen', value: '#0e7a5f' },
  { id: 'teal', label: 'Teal', value: '#2bb9a8' },
  { id: 'blue', label: 'Blauw', value: '#4a9cf2' },
  { id: 'purple', label: 'Paars', value: '#7a4ad2' },
  { id: 'pink', label: 'Roze', value: '#d24aa3' },
];
const colorValue = (id) => LIST_COLORS.find((c) => c.id === id)?.value || '';

function templateFromList(list) {
  return {
    id: uid(),
    name: list.name,
    emoji: list.emoji,
    destination: list.destination || '',
    people: list.people || 1,
    items: list.items.map((it) => ({ gearId: it.gearId, qty: it.qty, note: it.note || '' })),
    extras: (list.extras || []).map((it) => ({ name: it.name, qty: it.qty, note: it.note || '' })),
    savedAt: new Date().toISOString(),
  };
}

function listFromTemplate(tpl, overrides = {}) {
  return {
    id: uid(),
    name: tpl.name,
    emoji: tpl.emoji || '🌞',
    destination: tpl.destination || '',
    departure: '',
    returnDate: '',
    people: tpl.people || 1,
    note: '',
    items: tpl.items.map((it) => ({ gearId: it.gearId, qty: it.qty, packed: false, note: it.note || '' })),
    extras: tpl.extras.map((it) => ({ id: uid(), name: it.name, qty: it.qty, packed: false, note: it.note || '' })),
    ...overrides,
  };
}

function daysUntil(yyyymmdd) {
  if (!yyyymmdd) return null;
  const target = new Date(yyyymmdd + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}
function countdownLabel(dep) {
  const d = daysUntil(dep);
  if (d == null) return '';
  if (d < -1) return `${-d} dagen geleden`;
  if (d === -1) return 'gisteren';
  if (d === 0) return 'vandaag! 🎒';
  if (d === 1) return 'morgen!';
  if (d <= 7) return `nog ${d} dagen`;
  return `nog ${d} dagen`;
}
function formatDateRange(dep, ret) {
  if (!dep) return '';
  const f = (s) =>
    new Date(s + 'T00:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  return ret ? `${f(dep)} – ${f(ret)}` : f(dep);
}
function tripDays(dep, ret) {
  if (!dep || !ret) return null;
  const d1 = new Date(dep + 'T00:00:00');
  const d2 = new Date(ret + 'T00:00:00');
  return Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
}

function groupByCat(gear, cats) {
  const known = new Set(cats.map((c) => c.id));
  const fallback = cats.find((c) => c.id === 'overig') || cats[cats.length - 1];
  const groups = [];
  for (const cat of cats) {
    const items = gear.filter((g) => g.cat === cat.id || (cat === fallback && !known.has(g.cat)));
    if (items.length) groups.push({ cat, items });
  }
  return groups;
}

function listProgress(list) {
  const all = [...list.items, ...(list.extras || [])];
  const skipped = all.filter((i) => !i.packed && i.skip).length;
  const packed = all.filter((i) => i.packed).length;
  const toPack = all.length - skipped;
  const pendingPrep = all.filter((i) => i.prep && !i.prep.done && !i.packed && !i.skip).length;
  return {
    total: all.length,
    toPack,
    packed,
    skipped,
    pendingPrep,
    done: all.length > 0 && packed === toPack,
    pct: toPack ? Math.round((packed / toPack) * 100) : all.length ? 100 : 0,
  };
}

function collectOpenPrep(state) {
  const out = [];
  const gearById = Object.fromEntries(state.gear.map((g) => [g.id, g]));
  for (const list of state.lists) {
    for (const it of list.items) {
      if (it.prep && !it.prep.done && !it.packed && !it.skip) {
        out.push({
          key: `${list.id}:i:${it.gearId}`,
          name: gearById[it.gearId]?.name || '(verwijderd)',
          qty: it.qty,
          list,
          kind: 'item',
          gearId: it.gearId,
          prep: it.prep,
        });
      }
    }
    for (const it of list.extras || []) {
      if (it.prep && !it.prep.done && !it.packed && !it.skip) {
        out.push({
          key: `${list.id}:e:${it.id}`,
          name: it.name,
          qty: it.qty,
          list,
          kind: 'extra',
          id: it.id,
          prep: it.prep,
        });
      }
    }
  }
  return out;
}

function collectLocationPickups(state) {
  const out = [];
  const gearById = Object.fromEntries(state.gear.map((g) => [g.id, g]));
  for (const list of state.lists) {
    for (const it of list.items) {
      const g = gearById[it.gearId];
      if (g?.location && !it.packed && !it.skip && !it.picked) {
        out.push({
          key: `${list.id}:${it.gearId}`,
          name: g.name,
          qty: it.qty,
          location: g.location,
          list,
          gearId: it.gearId,
        });
      }
    }
  }
  return out;
}

function useSyncStatus() {
  const [status, setStatus] = useState(getStatus());
  useEffect(() => onStatus(setStatus), []);
  return status;
}

const STATUS_ICON = { online: '☁️', syncing: '🔄', error: '⚠️', offline: '⚪️' };
const STATUS_LABEL = {
  online: 'gesynchroniseerd',
  syncing: 'opslaan…',
  error: 'sync-fout (lokaal opgeslagen)',
  offline: 'verbinden…',
};

/* ================= App ================= */

const LS_THEME = 'paklijst:theme';
const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '🌗', light: '☀️', dark: '🌙' };
const THEME_LABEL = { auto: 'automatisch', light: 'licht', dark: 'donker' };

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(LS_THEME) || 'auto');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => root.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
      apply();
      mq.addEventListener?.('change', apply);
      return () => mq.removeEventListener?.('change', apply);
    }
    root.setAttribute('data-theme', theme === 'auto' ? 'light' : theme);
  }, [theme]);
  const cycle = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    localStorage.setItem(LS_THEME, next);
    setTheme(next);
  };
  return [theme, cycle];
}

function parseShareHash() {
  const m = window.location.hash.match(/^#share=(.+)$/);
  return m ? m[1] : null;
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = sessie nog aan het laden
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [theme, cycleTheme] = useTheme();
  const [share, setShare] = useState(() => parseShareHash());
  useEffect(() => {
    const onHash = () => setShare(parseShareHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    getSessionUser().then((u) => setUser((cur) => (cur === undefined ? u : cur)));
    return onAuth((u) => setUser(u));
  }, []);

  const uid = user?.id || null;

  // Profiel laden: eerst lokale cache (instant), dan cloud, dan realtime volgen.
  useEffect(() => {
    if (!uid) {
      setState(null);
      setNeedsSetup(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const cached = localStorage.getItem(cacheKey(uid));
    if (cached) {
      try {
        setState(migrate(JSON.parse(cached)));
      } catch { /* kapotte cache negeren */ }
    }

    (async () => {
      try {
        const remote = await loadProfile(uid);
        if (cancelled) return;
        if (remote) {
          const local = stateRef.current;
          if (!local || !local.updatedAt || remote.state.updatedAt >= local.updatedAt) {
            const rs = migrate(remote.state);
            setState(rs);
            localStorage.setItem(cacheKey(uid), JSON.stringify(rs));
          } else {
            saveProfileDebounced(uid, local);
          }
        } else if (stateRef.current) {
          // lokale kopie maar geen cloud-rij: alsnog opslaan
          saveProfileDebounced(uid, stateRef.current);
        } else {
          // gloednieuw account: laat kiezen tussen vers beginnen of importeren
          setNeedsSetup(true);
        }
      } catch (e) {
        console.warn('[paklijst] cloud load mislukt, lokaal verder:', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsub = subscribeProfile(uid, (remoteState) => {
      const rs = migrate(remoteState);
      // Eigen echo's en verlate/oudere updates nooit over verse lokale
      // wijzigingen heen laten gaan: alleen toepassen als echt nieuwer.
      const local = stateRef.current;
      if (local?.updatedAt && rs.updatedAt && rs.updatedAt <= local.updatedAt) return;
      setState(rs);
      localStorage.setItem(cacheKey(uid), JSON.stringify(rs));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [uid]);

  function mutate(fn) {
    setState((prev) => {
      const next = fn(structuredClone(prev));
      next.updatedAt = new Date().toISOString();
      localStorage.setItem(cacheKey(uid), JSON.stringify(next));
      saveProfileDebounced(uid, next);
      return next;
    });
  }

  function adoptState(fresh) {
    const st = migrate(fresh);
    st.updatedAt = new Date().toISOString();
    localStorage.setItem(cacheKey(uid), JSON.stringify(st));
    saveProfileDebounced(uid, st);
    setState(st);
    setNeedsSetup(false);
  }

  async function logout() {
    await signOut();
    setUser(null);
    setState(null);
    setNeedsSetup(false);
  }

  function renameProfile() {
    if (!stateRef.current) return;
    const invoer = prompt('Weergavenaam:', stateRef.current.email || '');
    if (!invoer?.trim()) return;
    mutate((s) => {
      s.email = invoer.trim();
      return s;
    });
  }

  if (share) {
    return (
      <ShareView
        shareId={share}
        user={user || null}
        myState={state}
        mutate={mutate}
        onClose={() => {
          history.replaceState(null, '', window.location.pathname + window.location.search);
          setShare(null);
        }}
      />
    );
  }
  if (user === undefined) {
    return (
      <div className="login">
        <div className="logo">🧳</div>
        <p>Even kijken of je ingelogd bent…</p>
      </div>
    );
  }
  if (!user) return <Login />;
  if (needsSetup) return <Onboarding user={user} onAdopt={adoptState} onLogout={logout} />;
  if (!state) {
    return (
      <div className="login">
        <div className="logo">🧳</div>
        <p>{loading ? 'Lijstjes laden…' : 'Even geduld…'}</p>
      </div>
    );
  }
  return (
    <Main
      user={user}
      state={state}
      mutate={mutate}
      onLogout={logout}
      onRename={renameProfile}
      theme={theme}
      cycleTheme={cycleTheme}
    />
  );
}

/* ================= Login (magic-link) ================= */

function Login() {
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const valid = /\S+@\S+\.\S+/.test(value);

  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithEmail(value.trim());
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="login">
        <div className="logo">📬</div>
        <h1>Check je mail</h1>
        <p>
          We hebben een inloglink gestuurd naar <b>{value.trim()}</b>. Open die op dit
          apparaat en je bent binnen — geen wachtwoord nodig.
        </p>
        <p className="muted">Niks ontvangen? Kijk in je spam, of probeer het over een paar minuten opnieuw (de mailer is traag met versturen bij herhaalde pogingen).</p>
        <button className="btn secondary" onClick={() => setSent(false)}>
          Ander e-mailadres
        </button>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="logo">🧳</div>
      <h1>Paklijst</h1>
      <p>Eén Bak met al je spullen, lijstjes per vakantie. Log in met een magic-link — geen wachtwoord.</p>
      <div className="publicnotice" style={{ background: 'var(--accent-soft)', borderColor: 'transparent', color: 'var(--accent)' }}>
        🔒 Je data is privé: alleen jij kunt je eigen Bak en lijstjes zien. Alleen lijstjes
        die je zelf deelt via een deel-link zijn voor anderen zichtbaar.
      </div>
      <form onSubmit={submit}>
        <input
          className="input"
          type="email"
          placeholder="jij@voorbeeld.nl"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        <div style={{ height: 10 }} />
        <button className="btn" style={{ width: '100%' }} disabled={!valid || busy}>
          {busy ? 'Versturen…' : 'Stuur inloglink →'}
        </button>
      </form>
      {error && <p className="muted" style={{ color: 'var(--danger)' }}>Mislukt: {error}</p>}
    </div>
  );
}

/* ================= Onboarding (nieuw account) ================= */

function Onboarding({ user, onAdopt, onLogout }) {
  const [oldName, setOldName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function importLegacy() {
    const nm = oldName.trim();
    if (!nm || busy) return;
    setBusy(true);
    setError(null);
    try {
      const legacy = await legacyLoadProfile(slugify(nm));
      if (!legacy) {
        setError(`Geen oud profiel gevonden met de naam "${nm}".`);
        return;
      }
      onAdopt(legacy);
      if (confirm('Geïmporteerd! Zal ik je oude, openbare profiel-rij nu verwijderen? (aangeraden)')) {
        legacyDeleteProfile(slugify(nm)).catch(() => {});
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="logo">👋</div>
      <h1>Welkom!</h1>
      <p>
        Ingelogd als <b>{user.email}</b>. Hoe wil je beginnen?
      </p>
      <button
        className="btn"
        onClick={() => onAdopt(seedState(user.email.split('@')[0]))}
      >
        🌱 Start met een verse Bak
      </button>
      <div className="card">
        <div className="title" style={{ marginBottom: 6 }}>📦 Oud profiel importeren</div>
        <p className="muted" style={{ textAlign: 'left', margin: '0 0 8px' }}>
          Gebruikte je de app al vóór de accounts? Typ je oude gebruikersnaam; je Bak en
          lijstjes verhuizen dan naar dit account.
        </p>
        <div className="row">
          <input
            className="input grow"
            placeholder="Oude gebruikersnaam"
            value={oldName}
            onChange={(e) => setOldName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importLegacy()}
          />
          <button className="btn small" disabled={!oldName.trim() || busy} onClick={importLegacy}>
            {busy ? '…' : 'Importeer'}
          </button>
        </div>
        {error && <p className="muted" style={{ color: 'var(--danger)', marginBottom: 0 }}>{error}</p>}
      </div>
      <button className="linkbtn" style={{ color: 'var(--muted)' }} onClick={onLogout}>
        uitloggen
      </button>
    </div>
  );
}

/* ================= Main shell ================= */

function Main({ user, state, mutate, onLogout, onRename, theme, cycleTheme }) {
  const [tab, setTab] = useState('lijsten');
  const [openListId, setOpenListId] = useState(null);
  const status = useSyncStatus();

  const openList = state.lists.find((l) => l.id === openListId);
  const prepCount = useMemo(() => collectOpenPrep(state).length, [state.lists, state.gear]);
  const headerBg = openList ? colorValue(openList.color) : '';

  return (
    <div className="app">
      <header className="header" style={headerBg ? { background: headerBg } : undefined}>
        <h1>
          {openList ? (
            <>
              {openList.emoji} {openList.name}
            </>
          ) : (
            '🧳 Paklijst'
          )}
          <span className="sub subedit" title="Naam wijzigen" onClick={onRename}>
            {state.email || user.email} ✏️
          </span>
        </h1>
        <button
          className="syncdot"
          title={`Thema: ${THEME_LABEL[theme]} (tik om te wisselen)`}
          onClick={cycleTheme}
        >
          {THEME_ICON[theme]}
        </button>
        <button
          className="syncdot"
          title={STATUS_LABEL[status]}
          onClick={() => {
            const err = getLastError();
            const build = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
            alert(
              `Sync-status: ${STATUS_LABEL[status]}` +
                (err ? `\n\nLaatste fout: ${err}` : '') +
                `\n\nJe data staat altijd ook lokaal op dit apparaat opgeslagen; zodra de verbinding werkt wordt alles alsnog gesynchroniseerd.` +
                `\n\nApp-versie: ${build}`
            );
          }}
        >
          {STATUS_ICON[status]}
        </button>
        {openList ? (
          <button className="linkbtn" onClick={() => setOpenListId(null)}>
            ← terug
          </button>
        ) : (
          <button className="linkbtn" onClick={onLogout}>
            uitloggen
          </button>
        )}
      </header>

      {openList ? (
        <ListDetail list={openList} state={state} mutate={mutate} onClose={() => setOpenListId(null)} uid={user.id} />
      ) : tab === 'lijsten' ? (
        <ListsView state={state} mutate={mutate} onOpen={setOpenListId} />
      ) : tab === 'vooraf' ? (
        <PrepView state={state} mutate={mutate} />
      ) : (
        <BakView state={state} mutate={mutate} />
      )}

      {!openList && (
        <nav className="tabbar">
          <div className="inner">
            <button className={tab === 'lijsten' ? 'active' : ''} onClick={() => setTab('lijsten')}>
              <span className="ico">🧳</span>Lijstjes
            </button>
            <button className={tab === 'vooraf' ? 'active' : ''} onClick={() => setTab('vooraf')}>
              <span className="ico">📝</span>
              Vooraf
              {prepCount > 0 && <span className="tabdot">{prepCount}</span>}
            </button>
            <button className={tab === 'bak' ? 'active' : ''} onClick={() => setTab('bak')}>
              <span className="ico">📦</span>
              {state.bakName || 'De Bak'}
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

/* ================= Lijstjes overzicht ================= */

function ListsView({ state, mutate, onOpen }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="page">
      {state.lists.length === 0 && (
        <div className="empty">
          <span className="big">🏝️</span>
          Nog geen lijstjes. Maak je eerste vakantielijstje!
        </div>
      )}
      {state.lists.map((list) => {
        const p = listProgress(list);
        const countdown = countdownLabel(list.departure);
        const range = formatDateRange(list.departure, list.returnDate);
        const days = tripDays(list.departure, list.returnDate);
        const metaBits = [];
        if (list.destination) metaBits.push(`📍 ${list.destination}`);
        if (range) metaBits.push(`🗓️ ${range}${days ? ` (${days}d)` : ''}`);
        if ((list.people || 1) > 1) metaBits.push(`👥 ${list.people}`);
        const cval = colorValue(list.color);
        return (
          <div
            key={list.id}
            className="card tap listcard"
            onClick={() => onOpen(list.id)}
            style={cval ? { borderLeft: `4px solid ${cval}` } : undefined}
          >
            <div className="row">
              <span style={{ fontSize: 26 }}>{list.emoji}</span>
              <div className="grow">
                <div className="title">{list.name}</div>
              </div>
              {p.done && <span className="badge">klaar ✓</span>}
              {countdown && <span className="badge countdown">{countdown}</span>}
            </div>
            {metaBits.length > 0 && <div className="muted listmeta">{metaBits.join(' · ')}</div>}
            <div className="muted listmeta">
              {p.packed}/{p.toPack} ingepakt
              {p.skipped ? ` · ${p.skipped} niet mee` : ''}
              {p.pendingPrep ? ` · 📝 ${p.pendingPrep} vooraf` : ''}
              {list.note ? ` · ${list.note}` : ''}
            </div>
            <div className={`progress${p.done ? ' done' : ''}`}>
              <div style={{ width: `${p.pct}%` }} />
            </div>
          </div>
        );
      })}
      <div className="fabbar abovetabs">
        <button className="btn grow" onClick={() => setCreating(true)}>
          + Nieuw lijstje
        </button>
      </div>
      {(state.templates || []).length > 0 && (
        <div>
          <div className="muted" style={{ margin: '8px 4px 4px' }}>📋 Templates</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {(state.templates || []).map((tpl) => (
              <button
                key={tpl.id}
                className="btn small secondary"
                onClick={() => {
                  mutate((s) => {
                    s.lists.push(listFromTemplate(tpl));
                    return s;
                  });
                }}
                title={`Maak nieuw lijstje uit "${tpl.name}"`}
              >
                {tpl.emoji} {tpl.name}
                <span
                  className="cat-edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Template "${tpl.name}" verwijderen?`)) {
                      mutate((s) => {
                        s.templates = s.templates.filter((t) => t.id !== tpl.id);
                        return s;
                      });
                    }
                  }}
                >
                  ✕
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {creating && (
        <ListForm
          onSave={(meta) => {
            mutate((s) => {
              s.lists.push({
                id: uid(),
                ...meta,
                note: '',
                items: [],
                extras: [],
              });
              return s;
            });
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function ListForm({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || '');
  const [emoji, setEmoji] = useState(initial?.emoji || '🌞');
  const [destination, setDestination] = useState(initial?.destination || '');
  const [departure, setDeparture] = useState(initial?.departure || '');
  const [returnDate, setReturnDate] = useState(initial?.returnDate || '');
  const [people, setPeople] = useState(initial?.people || 1);
  const [color, setColor] = useState(initial?.color || '');

  const days = tripDays(departure, returnDate);

  return (
    <Sheet title={initial ? 'Lijstje aanpassen' : 'Nieuw lijstje'} onClose={onClose}>
      <input
        className="input"
        placeholder="Naam, bijv. Wintersport 2027"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <div style={{ height: 12 }} />
      <div className="emojirow">
        {EMOJIS.map((e) => (
          <button key={e} className={e === emoji ? 'on' : ''} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <div className="formsection">
        <label className="formlabel">📍 Waarheen?</label>
        <input
          className="input"
          placeholder="Bijv. Lissabon, Sauerland, Texel…"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
      </div>
      <div className="formsection">
        <label className="formlabel">🗓️ Wanneer?</label>
        <div className="row">
          <div className="grow">
            <div className="muted formsub">Heen</div>
            <input
              className="input"
              type="date"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </div>
          <div className="grow">
            <div className="muted formsub">Terug</div>
            <input
              className="input"
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </div>
        </div>
        {days && (
          <div className="muted formsub" style={{ marginTop: 6 }}>
            = {days} {days === 1 ? 'dag' : 'dagen'}
          </div>
        )}
      </div>
      <div className="formsection">
        <label className="formlabel">👥 Met hoeveel personen?</label>
        <div className="row">
          <button className="btn small secondary" onClick={() => setPeople(Math.max(1, people - 1))}>
            −
          </button>
          <div className="grow" style={{ textAlign: 'center', fontWeight: 700, fontSize: 18 }}>
            {people}
          </div>
          <button className="btn small secondary" onClick={() => setPeople(people + 1)}>
            +
          </button>
        </div>
      </div>
      <div className="formsection">
        <label className="formlabel">🎨 Kleurtje</label>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {LIST_COLORS.map((c) => (
            <button
              key={c.id}
              className={`colorchip${color === c.id ? ' on' : ''}`}
              style={c.value ? { background: c.value } : undefined}
              onClick={() => setColor(c.id)}
              title={c.label}
            >
              {!c.value && '∅'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 16 }} />
      <button
        className="btn"
        style={{ width: '100%' }}
        disabled={!name.trim()}
        onClick={() =>
          onSave({
            name: name.trim(),
            emoji,
            destination: destination.trim(),
            departure,
            returnDate,
            people,
            color,
          })
        }
      >
        Opslaan
      </button>
    </Sheet>
  );
}

/* ================= Lijst detail ================= */

function ListDetail({ list, state, mutate, onClose, uid }) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [itemEditing, setItemEditing] = useState(null); // {kind:'item'|'extra', id, item, name}
  const [celebrate, setCelebrate] = useState(false);
  const [vertrekModus, setVertrekModus] = useState(false);
  const [zoek, setZoek] = useState('');
  const p = listProgress(list);
  const wasDone = useRef(p.done);
  useEffect(() => {
    if (p.done && !wasDone.current) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 3000);
      return () => clearTimeout(t);
    }
    wasDone.current = p.done;
  }, [p.done]);

  const cats = state.cats || CATS;
  const gearById = useMemo(() => Object.fromEntries(state.gear.map((g) => [g.id, g])), [state.gear]);
  const zq = zoek.trim().toLowerCase();
  const matchesZoek = (name) => !zq || (name || '').toLowerCase().includes(zq);

  const grouped = useMemo(() => {
    const known = new Set(cats.map((c) => c.id));
    const groups = [];
    for (const cat of cats) {
      const items = list.items.filter((it) => {
        const g = gearById[it.gearId];
        const c = g?.cat;
        if ((known.has(c) ? c : 'overig') !== cat.id) return false;
        return !zq || (g?.name || '').toLowerCase().includes(zq);
      });
      if (items.length) groups.push({ cat, items });
    }
    return groups;
  }, [list.items, gearById, cats, zq]);

  const filteredExtras = useMemo(
    () => (list.extras || []).filter((it) => matchesZoek(it.name)),
    [list.extras, zq]
  );

  const openPrep = useMemo(() => {
    const out = [];
    for (const it of list.items) {
      if (it.prep && !it.prep.done && !it.packed && !it.skip) {
        out.push({ kind: 'item', id: it.gearId, name: gearById[it.gearId]?.name || '(verwijderd)', qty: it.qty, prep: it.prep });
      }
    }
    for (const it of list.extras || []) {
      if (it.prep && !it.prep.done && !it.packed && !it.skip) {
        out.push({ kind: 'extra', id: it.id, name: it.name, qty: it.qty, prep: it.prep });
      }
    }
    return out;
  }, [list.items, list.extras, gearById]);

  const openPrepGrouped = useMemo(() => {
    const g = {};
    for (const o of openPrep) (g[o.prep.label] ||= []).push(o);
    return g;
  }, [openPrep]);

  const pickupGroups = useMemo(() => {
    const g = {};
    for (const it of list.items) {
      const gear = gearById[it.gearId];
      if (gear?.location && !it.packed && !it.skip && !it.picked) {
        (g[gear.location] ||= []).push({ gearId: it.gearId, name: gear.name, qty: it.qty });
      }
    }
    return g;
  }, [list.items, gearById]);
  const pickupCount = Object.values(pickupGroups).reduce((n, arr) => n + arr.length, 0);

  function patchItem(gearId, fn) {
    mutate((s) => {
      const l = s.lists.find((x) => x.id === list.id);
      const it = l.items.find((x) => x.gearId === gearId);
      if (it) fn(it, l);
      return s;
    });
  }

  function patchExtra(id, fn) {
    mutate((s) => {
      const l = s.lists.find((x) => x.id === list.id);
      const it = (l.extras || []).find((x) => x.id === id);
      if (it) fn(it, l);
      return s;
    });
  }

  function applyItemEdit(target, { prep, note, location }) {
    if (target.kind === 'item') {
      mutate((s) => {
        const l = s.lists.find((x) => x.id === list.id);
        const it = l.items.find((x) => x.gearId === target.id);
        if (it) {
          if (prep) it.prep = prep;
          else delete it.prep;
          it.note = note;
        }
        if (location != null) {
          const g = s.gear.find((x) => x.id === target.id);
          if (g) g.location = location;
        }
        return s;
      });
    } else {
      patchExtra(target.id, (x) => {
        if (prep) x.prep = prep;
        else delete x.prep;
        x.note = note;
      });
    }
  }

  function moveItemInCat(gearId, dir) {
    mutate((s) => {
      const l = s.lists.find((x) => x.id === list.id);
      const myCat = gearById[gearId]?.cat;
      const sameCatIndices = l.items
        .map((it, i) => (gearById[it.gearId]?.cat === myCat ? i : -1))
        .filter((i) => i >= 0);
      const myPosInCat = sameCatIndices.findIndex((i) => l.items[i].gearId === gearId);
      const targetPosInCat = myPosInCat + dir;
      if (targetPosInCat < 0 || targetPosInCat >= sameCatIndices.length) return s;
      const a = sameCatIndices[myPosInCat];
      const b = sameCatIndices[targetPosInCat];
      [l.items[a], l.items[b]] = [l.items[b], l.items[a]];
      return s;
    });
  }

  function removeFromList(target) {
    mutate((s) => {
      const l = s.lists.find((x) => x.id === list.id);
      if (target.kind === 'item') l.items = l.items.filter((x) => x.gearId !== target.id);
      else l.extras = (l.extras || []).filter((x) => x.id !== target.id);
      return s;
    });
  }

  // Open de picker met de categorie voorgeselecteerd waar je nu naar kijkt:
  // de laatste categorie-sectie waarvan de bovenkant het (sticky) header-
  // gebied al gepasseerd is.
  function openPicker() {
    let current = null;
    document.querySelectorAll('[data-catsec]').forEach((el) => {
      if (el.getBoundingClientRect().top <= 130) current = el.dataset.catsec;
    });
    setPicking(current || true);
  }

  // Delen = bewust een momentopname van dít lijstje publiek zetten.
  // Locaties, notities en vooraf-acties gaan NIET mee in de snapshot.
  async function shareList() {
    let shareId = list.shareId;
    if (!shareId) {
      shareId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      mutate((s) => {
        const l = s.lists.find((x) => x.id === list.id);
        l.shareId = shareId;
        return s;
      });
    }
    const usedGearIds = new Set(list.items.map((i) => i.gearId));
    const snapshot = {
      ownerName: state.email || '',
      cats: state.cats || CATS,
      gear: state.gear.filter((g) => usedGearIds.has(g.id)).map((g) => ({ id: g.id, name: g.name, cat: g.cat })),
      list: {
        name: list.name,
        emoji: list.emoji,
        destination: list.destination || '',
        people: list.people || 1,
        color: list.color || '',
        items: list.items.map((it) => ({ gearId: it.gearId, qty: it.qty })),
        extras: (list.extras || []).map((it) => ({ name: it.name, qty: it.qty })),
      },
    };
    const url = `${window.location.origin}${window.location.pathname}#share=${shareId}`;
    try {
      await upsertShare(shareId, uid, snapshot);
      try {
        await navigator.clipboard.writeText(url);
        alert(`Deel-link gekopieerd!\n\n${url}\n\nDit is een momentopname van dit lijstje (zonder locaties/notities). Opnieuw delen ververst de snapshot.`);
      } catch {
        prompt('Deel-link:', url);
      }
    } catch (e) {
      alert(`Delen mislukt: ${e.message}`);
    }
  }

  const countdown = countdownLabel(list.departure);
  const range = formatDateRange(list.departure, list.returnDate);
  const days = tripDays(list.departure, list.returnDate);
  const metaBits = [];
  if (list.destination) metaBits.push(`📍 ${list.destination}`);
  if (range) metaBits.push(`🗓️ ${range}${days ? ` (${days}d)` : ''}`);
  if ((list.people || 1) > 1) metaBits.push(`👥 ${list.people}`);

  return (
    <div className="page">
      {celebrate && <Confetti />}
      <div className="card">
        {metaBits.length > 0 && (
          <div className="listdetail-meta">
            <span>{metaBits.join(' · ')}</span>
            {countdown && <span className="badge countdown">{countdown}</span>}
          </div>
        )}
        <div className="row">
          <div className="grow">
            <b>
              {p.packed}/{p.toPack}
            </b>{' '}
            <span className="muted">ingepakt{p.skipped ? ` · ${p.skipped} niet mee` : ''}</span>
          </div>
          {!editMode && (
            <button className="btn small secondary" title="Deel-link maken/verversen" onClick={shareList}>
              🔗
            </button>
          )}
          <button className={`btn small ${editMode ? '' : 'secondary'}`} onClick={() => setEditMode(!editMode)}>
            {editMode ? '✓ klaar' : '✏️ bewerk'}
          </button>
        </div>
        <div className={`progress${p.done ? ' done' : ''}`}>
          <div style={{ width: `${p.pct}%` }} />
        </div>
      </div>

      <WeatherInfo destination={list.destination} departure={list.departure} returnDate={list.returnDate} />

      {(openPrep.length > 0 || pickupCount > 0) && !editMode && (
        <div className="card prep-banner">
          <div className="prep-banner-title">
            📝 Eerst nog regelen <span className="prep-count">({openPrep.length + pickupCount})</span>
          </div>
          <div className="muted prep-banner-sub">Doe dit vóór je gaat inpakken.</div>
          {Object.entries(openPrepGrouped).map(([label, items]) => (
            <div key={label} className="prep-group">
              <div className="prep-group-head">{prepEmoji(label)} {label}</div>
              {items.map((o) => (
                <div
                  key={`${o.kind}-${o.id}`}
                  className="prep-banner-row"
                  onClick={() => {
                    if (o.kind === 'item') patchItem(o.id, (x) => (x.prep.done = true));
                    else patchExtra(o.id, (x) => (x.prep.done = true));
                  }}
                >
                  <button className="check" />
                  <span className="name">
                    {o.name}
                    {o.qty > 1 ? ` ×${o.qty}` : ''}
                  </span>
                  <button
                    className="iconbtn"
                    title="Hoeft toch niet — vooraf-actie weghalen"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (o.kind === 'item') patchItem(o.id, (x) => delete x.prep);
                      else patchExtra(o.id, (x) => delete x.prep);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
          {Object.entries(pickupGroups).map(([loc, items]) => (
            <div key={loc} className="prep-group">
              <div className="prep-group-head">📍 {loc}</div>
              {items.map((o) => (
                <div
                  key={o.gearId}
                  className="prep-banner-row"
                  onClick={() => patchItem(o.gearId, (x) => (x.picked = true))}
                >
                  <button className="check" />
                  <span className="name">
                    {o.name}
                    {o.qty > 1 ? ` ×${o.qty}` : ''}
                  </span>
                  <button
                    className="iconbtn"
                    title="Locatie weghalen"
                    onClick={(e) => {
                      e.stopPropagation();
                      mutate((s) => {
                        const g2 = s.gear.find((x) => x.id === o.gearId);
                        if (g2) g2.location = '';
                        return s;
                      });
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!editMode && p.toPack > 0 && (
        <button className="btn" onClick={() => setVertrekModus(true)}>
          🚀 Vertrek-modus ({p.toPack - p.packed} te doen)
        </button>
      )}

      {list.items.length + (list.extras || []).length > 8 && (
        <input
          className="input"
          placeholder="🔍 Zoeken in dit lijstje…"
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
        />
      )}
      {zq && grouped.length === 0 && filteredExtras.length === 0 && (
        <div className="empty">Niks gevonden voor “{zoek.trim()}”.</div>
      )}

      {editMode && (
        <div className="actiongrid">
          <button className="btn small secondary" onClick={() => setEditing(true)}>
            ✏️ Reis-info
          </button>
          <button
            className="btn small secondary"
            onClick={() => {
              const nm = prompt('Naam voor template:', list.name);
              if (!nm) return;
              mutate((s) => {
                if (!s.templates) s.templates = [];
                s.templates.push({ ...templateFromList(list), name: nm });
                return s;
              });
              alert(`Template "${nm}" opgeslagen — terug in Lijstjes-overzicht.`);
            }}
          >
            📋 Bewaar als template
          </button>
          <button className="btn small secondary" onClick={shareList}>
            🔗 Deel-link kopiëren
          </button>
          <button
            className="btn small secondary"
            onClick={() =>
              mutate((s) => {
                const l = s.lists.find((x) => x.id === list.id);
                for (const it of [...l.items, ...(l.extras || [])]) {
                  it.packed = false;
                  it.skip = false;
                  it.picked = false;
                }
                return s;
              })
            }
          >
            ↺ Vinkjes resetten
          </button>
          <button
            className="btn small secondary"
            onClick={() =>
              mutate((s) => {
                const copy = structuredClone(s.lists.find((x) => x.id === list.id));
                copy.id = uid();
                copy.name = `${copy.name} (kopie)`;
                copy.items.forEach((it) => {
                  it.packed = false;
                  it.skip = false;
                  it.picked = false;
                });
                copy.extras = (copy.extras || []).map((it) => ({ ...it, id: uid(), packed: false, skip: false }));
                s.lists.push(copy);
                return s;
              })
            }
          >
            ⧉ Dupliceren
          </button>
          <button
            className="btn small danger"
            onClick={() => {
              if (!confirm(`Lijstje "${list.name}" verwijderen?`)) return;
              mutate((s) => {
                s.lists = s.lists.filter((x) => x.id !== list.id);
                return s;
              });
              onClose();
            }}
          >
            🗑 Verwijder lijstje
          </button>
        </div>
      )}

      {list.items.length === 0 && (list.extras || []).length === 0 && (
        <div className="empty">
          <span className="big">📦</span>
          Nog leeg — voeg spullen toe uit {state.bakName || 'De Bak'}.
        </div>
      )}

      {grouped.map(({ cat, items }) => (
        <div key={cat.id} className="catsec" data-catsec={cat.id}>
          <h3>
            {cat.emoji} {cat.name}
          </h3>
          {items.map((it) => {
            const gear = gearById[it.gearId];
            return (
              <div key={it.gearId} className={`itemrow${it.packed ? ' packed' : ''}${it.skip ? ' skipped' : ''}`}>
                <button
                  className={`check${it.packed ? ' on' : ''}`}
                  onClick={() =>
                    patchItem(it.gearId, (x) => {
                      x.packed = !x.packed;
                      if (x.packed) x.skip = false;
                    })
                  }
                >
                  {it.packed ? '✓' : ''}
                </button>
                <div className="itemnamebox">
                  <span className="name">{gear?.name || '(verwijderd item)'}</span>
                  <LocationBadge
                    gear={gear}
                    it={it}
                    onToggle={() => patchItem(it.gearId, (x) => (x.picked = !x.picked))}
                  />
                  {it.note && <div className="itemnote">💬 {it.note}</div>}
                  <PrepBadge
                    it={it}
                    onToggleDone={() => patchItem(it.gearId, (x) => (x.prep.done = !x.prep.done))}
                  />
                </div>
                {it.skip ? (
                  <span className="badge off">niet mee</span>
                ) : (
                  !editMode && (
                    <span className="qty">
                      <button onClick={() => patchItem(it.gearId, (x) => (x.qty = Math.max(1, x.qty - 1)))}>−</button>
                      <span>{it.qty}</span>
                      <button onClick={() => patchItem(it.gearId, (x) => (x.qty += 1))}>+</button>
                    </span>
                  )
                )}
                {editMode ? (
                  <>
                    <button
                      className="iconbtn small"
                      title="Omhoog (binnen categorie)"
                      onClick={() => moveItemInCat(it.gearId, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="iconbtn small"
                      title="Omlaag (binnen categorie)"
                      onClick={() => moveItemInCat(it.gearId, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="iconbtn"
                      title="Bewerken (vooraf, notitie, weghalen)"
                      onClick={() => setItemEditing({ kind: 'item', id: it.gearId, item: it, name: gear?.name || '(verwijderd)' })}
                    >
                      ✏️
                    </button>
                  </>
                ) : (
                  <button
                    className={`iconbtn${it.skip ? ' active' : ''}`}
                    title="Dit keer niet mee"
                    onClick={() =>
                      patchItem(it.gearId, (x) => {
                        x.skip = !x.skip;
                        if (x.skip) x.packed = false;
                      })
                    }
                  >
                    ⊘
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {filteredExtras.length > 0 && (
        <div className="catsec">
          <h3>✨ Los in dit lijstje</h3>
          {filteredExtras.map((it) => (
            <div key={it.id} className={`itemrow${it.packed ? ' packed' : ''}${it.skip ? ' skipped' : ''}`}>
              <button
                className={`check${it.packed ? ' on' : ''}`}
                onClick={() =>
                  patchExtra(it.id, (x) => {
                    x.packed = !x.packed;
                    if (x.packed) x.skip = false;
                  })
                }
              >
                {it.packed ? '✓' : ''}
              </button>
              <div className="itemnamebox">
                <span className="name">{it.name}</span>
                {it.note && <div className="itemnote">💬 {it.note}</div>}
                <PrepBadge
                  it={it}
                  onToggleDone={() => patchExtra(it.id, (x) => (x.prep.done = !x.prep.done))}
                />
              </div>
              {!editMode && (
                <span className="qty">
                  <button onClick={() => patchExtra(it.id, (x) => (x.qty = Math.max(1, x.qty - 1)))}>−</button>
                  <span>{it.qty}</span>
                  <button onClick={() => patchExtra(it.id, (x) => (x.qty += 1))}>+</button>
                </span>
              )}
              {editMode && (
                <button
                  className="iconbtn"
                  title="Bewerken (vooraf, notitie, weghalen)"
                  onClick={() => setItemEditing({ kind: 'extra', id: it.id, item: it, name: it.name })}
                >
                  ✏️
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="fabbar">
        <button className="btn grow" onClick={openPicker}>
          + Spullen toevoegen
        </button>
      </div>

      {picking && (
        <Picker
          list={list}
          state={state}
          mutate={mutate}
          initialCat={typeof picking === 'string' ? picking : null}
          onClose={() => setPicking(false)}
        />
      )}
      {vertrekModus && (
        <VertrekModus
          list={list}
          gearById={gearById}
          patchItem={patchItem}
          patchExtra={patchExtra}
          onClose={() => setVertrekModus(false)}
        />
      )}
      {itemEditing && (
        <ItemSheet
          name={itemEditing.name}
          item={itemEditing.item}
          gear={itemEditing.kind === 'item' ? gearById[itemEditing.id] : null}
          onClose={() => setItemEditing(null)}
          onSave={(data) => {
            applyItemEdit(itemEditing, data);
            setItemEditing(null);
          }}
          onDelete={() => {
            removeFromList(itemEditing);
            setItemEditing(null);
          }}
        />
      )}
      {editing && (
        <ListForm
          initial={list}
          onClose={() => setEditing(false)}
          onSave={(meta) => {
            mutate((s) => {
              const l = s.lists.find((x) => x.id === list.id);
              Object.assign(l, meta);
              return s;
            });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

/* ================= Picker: spullen uit de bak kiezen ================= */

function Picker({ list, state, mutate, initialCat, onClose }) {
  const [q, setQ] = useState('');
  const [newCat, setNewCat] = useState(initialCat || 'overig');
  const cats = state.cats || CATS;
  const inList = new Set(list.items.map((i) => i.gearId));

  // Scroll de picker direct naar de categorie waar de gebruiker in de
  // lijst naar keek toen die op "+ Spullen toevoegen" tikte.
  useEffect(() => {
    if (!initialCat) return;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-pickcat="${initialCat}"]`);
      const body = el?.closest('.sheet-body');
      if (el && body) {
        body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
      }
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const filtered = state.gear.filter((g) => g.name.toLowerCase().includes(q.toLowerCase()));
  const grouped = groupByCat(filtered, cats);
  const canCreate = q.trim() && !state.gear.some((g) => g.name.toLowerCase() === q.trim().toLowerCase());

  function toggle(gearId) {
    mutate((s) => {
      const l = s.lists.find((x) => x.id === list.id);
      const idx = l.items.findIndex((x) => x.gearId === gearId);
      if (idx >= 0) l.items.splice(idx, 1);
      else l.items.push({ gearId, qty: 1, packed: false });
      return s;
    });
  }

  function createAndAdd() {
    const name = q.trim();
    mutate((s) => {
      const g = { id: uid(), name, cat: newCat };
      s.gear.push(g);
      s.lists.find((x) => x.id === list.id).items.push({ gearId: g.id, qty: 1, packed: false });
      return s;
    });
    setQ('');
  }

  function createExtra() {
    const name = q.trim();
    mutate((s) => {
      const l = s.lists.find((x) => x.id === list.id);
      if (!l.extras) l.extras = [];
      l.extras.push({ id: uid(), name, qty: 1, packed: false });
      return s;
    });
    setQ('');
  }

  return (
    <Sheet title={`Spullen uit ${state.bakName || 'De Bak'}`} onClose={onClose}>
      <input
        className="input"
        placeholder="Zoek of typ iets nieuws…"
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canCreate) createAndAdd();
        }}
      />
      {canCreate && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="grow">
              Nieuw: <b>{q.trim()}</b>
            </div>
            <select className="input" style={{ width: 'auto', padding: '6px 8px' }} value={newCat} onChange={(e) => setNewCat(e.target.value)}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button className="btn small grow" onClick={createAndAdd}>
              📦 In {state.bakName || 'De Bak'} + lijstje
            </button>
            <button className="btn small secondary grow" onClick={createExtra}>
              ✨ Alleen dit lijstje
            </button>
          </div>
        </div>
      )}
      {grouped.map(({ cat, items }) => (
        <div key={cat.id} className="catsec" data-pickcat={cat.id}>
          <h3>
            {cat.emoji} {cat.name}
          </h3>
          <div className="card" style={{ padding: '2px 12px' }}>
            {items.map((g) => (
              <div key={g.id} className="pickrow" onClick={() => toggle(g.id)}>
                <span className={`check${inList.has(g.id) ? ' on' : ''}`}>{inList.has(g.id) ? '✓' : ''}</span>
                <span className="name">{g.name}</span>
                {inList.has(g.id) && <span className="inlist">in lijstje</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ height: 12 }} />
      {canCreate ? (
        <div className="row">
          <button
            className="btn grow"
            onClick={() => {
              createAndAdd();
              onClose();
            }}
          >
            📦 “{q.trim()}” toevoegen & klaar
          </button>
          <button className="btn small secondary" onClick={onClose}>
            Sluiten
          </button>
        </div>
      ) : (
        <button className="btn" style={{ width: '100%' }} onClick={onClose}>
          Klaar ({list.items.length + (list.extras || []).length} items)
        </button>
      )}
    </Sheet>
  );
}

/* ================= De Bak ================= */

function BakView({ state, mutate }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false); // false | true | cat-id
  const [editId, setEditId] = useState(null);
  const [addingCat, setAddingCat] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const cats = state.cats || CATS;

  const usage = useMemo(() => {
    const map = {};
    for (const l of state.lists) for (const it of l.items) map[it.gearId] = (map[it.gearId] || 0) + 1;
    return map;
  }, [state.lists]);

  const filtered = state.gear.filter((g) => g.name.toLowerCase().includes(q.toLowerCase()));
  const grouped = groupByCat(filtered, cats);
  const editItem = state.gear.find((g) => g.id === editId);

  function openAdd() {
    let current = null;
    document.querySelectorAll('[data-baksec]').forEach((el) => {
      if (el.getBoundingClientRect().top <= 130) current = el.dataset.baksec;
    });
    setAdding(current || true);
  }

  return (
    <div className="page">
      <div className="card">
        <div className="title">
          📦 {state.bakName || 'De Bak'} <span className="muted">({state.gear.length} spullen)</span>
          <button
            className="cat-edit"
            title="Naam wijzigen"
            onClick={() => {
              const nm = prompt('Naam voor je spullenbak:', state.bakName || 'De Bak');
              if (!nm?.trim()) return;
              mutate((s) => {
                s.bakName = nm.trim().slice(0, 20);
                return s;
              });
            }}
          >
            ✏️
          </button>
        </div>
      </div>

      <input className="input" placeholder={`🔍 Zoeken in ${state.bakName || 'De Bak'}…`} value={q} onChange={(e) => setQ(e.target.value)} />

      {grouped.map(({ cat, items }) => (
        <div key={cat.id} className="catsec" data-baksec={cat.id}>
          <h3>
            <span className="grow-empty">{cat.emoji} {cat.name}</span>
            <button className="cat-edit" title="Categorie bewerken" onClick={() => setEditingCat(cat)}>
              ✏️
            </button>
          </h3>
          {items.map((g) => (
            <div key={g.id} className="itemrow">
              <div className="itemnamebox">
                <span className="name">{g.name}</span>
                {g.location && <div className="itemnote">📍 {g.location}</div>}
              </div>
              {usage[g.id] ? <span className="badge">in {usage[g.id]} lijstje{usage[g.id] > 1 ? 's' : ''}</span> : null}
              <button className="iconbtn" title="Bewerken" onClick={() => setEditId(g.id)}>
                ✏️
              </button>
              <button
                className="iconbtn"
                title="Verwijderen"
                onClick={() => {
                  const used = usage[g.id];
                  if (!confirm(`"${g.name}" uit ${state.bakName || 'De Bak'} gooien?${used ? ` Het wordt ook uit ${used} lijstje(s) gehaald.` : ''}`)) return;
                  mutate((s) => {
                    s.gear = s.gear.filter((x) => x.id !== g.id);
                    s.lists.forEach((l) => (l.items = l.items.filter((it) => it.gearId !== g.id)));
                    return s;
                  });
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}

      <div className="fabbar abovetabs">
        <button className="btn grow" onClick={openAdd}>
          + Item toevoegen
        </button>
        <button className="btn secondary" title="Nieuwe categorie" onClick={() => setAddingCat(true)}>
          📁
        </button>
      </div>

      {adding && (
        <BakAddSheet
          state={state}
          mutate={mutate}
          initialCat={typeof adding === 'string' ? adding : null}
          onClose={() => setAdding(false)}
        />
      )}

      {editItem && (
        <GearForm
          item={editItem}
          cats={cats}
          onClose={() => setEditId(null)}
          onSave={(nm, c, location) => {
            mutate((s) => {
              const g = s.gear.find((x) => x.id === editItem.id);
              g.name = nm;
              g.cat = c;
              g.location = location;
              return s;
            });
            setEditId(null);
          }}
        />
      )}
      {addingCat && (
        <CatForm
          cats={cats}
          onClose={() => setAddingCat(false)}
          onSave={(nm, emoji) => {
            mutate((s) => {
              if (!s.cats) s.cats = [];
              s.cats.push({ id: uid(), name: nm, emoji });
              return s;
            });
            setAddingCat(false);
          }}
        />
      )}
      {editingCat && (
        <CatForm
          cats={cats}
          current={editingCat}
          onClose={() => setEditingCat(null)}
          onSave={(nm, emoji) => {
            mutate((s) => {
              const c = (s.cats || []).find((x) => x.id === editingCat.id);
              if (c) {
                c.name = nm;
                c.emoji = emoji;
              }
              return s;
            });
            setEditingCat(null);
          }}
          onDelete={
            cats.length > 1
              ? () => {
                  mutate((s) => {
                    s.cats = (s.cats || []).filter((c) => c.id !== editingCat.id);
                    const hasOverig = s.cats.some((c) => c.id === 'overig');
                    const fallback = hasOverig ? 'overig' : s.cats[0]?.id;
                    for (const g of s.gear) {
                      if (g.cat === editingCat.id) g.cat = fallback;
                    }
                    return s;
                  });
                  setEditingCat(null);
                }
              : null
          }
          onMove={(dir) => {
            mutate((s) => {
              const arr = s.cats || [];
              const i = arr.findIndex((c) => c.id === editingCat.id);
              const j = i + dir;
              if (i >= 0 && j >= 0 && j < arr.length) {
                [arr[i], arr[j]] = [arr[j], arr[i]];
              }
              return s;
            });
          }}
        />
      )}
    </div>
  );
}

function BakAddSheet({ state, mutate, initialCat, onClose }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(initialCat || 'overig');
  const cats = state.cats || CATS;
  const bakName = state.bakName || 'De Bak';

  const clean = q.trim();
  const canCreate = clean && !state.gear.some((g) => g.name.toLowerCase() === clean.toLowerCase());
  const isDup = clean && !canCreate;
  const matches = clean
    ? state.gear.filter((g) => g.name.toLowerCase().includes(clean.toLowerCase())).slice(0, 8)
    : [];
  const catName = (id) => {
    const c = cats.find((x) => x.id === id);
    return c ? `${c.emoji} ${c.name}` : '';
  };

  function add() {
    if (!canCreate) return;
    mutate((s) => {
      s.gear.push({ id: uid(), name: clean, cat });
      return s;
    });
    setQ('');
  }

  return (
    <Sheet title={`Item toevoegen — ${bakName}`} onClose={onClose}>
      <input
        className="input"
        placeholder="Typ een nieuw item…"
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canCreate) add();
        }}
      />
      {isDup && (
        <p className="muted" style={{ margin: '8px 4px 0' }}>
          “{clean}” zit al in je {bakName}.
        </p>
      )}
      {canCreate && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="grow">
              Nieuw: <b>{clean}</b>
            </div>
            <select
              className="input"
              style={{ width: 'auto', padding: '6px 8px' }}
              value={cat}
              onChange={(e) => setCat(e.target.value)}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn small" style={{ width: '100%' }} onClick={add}>
            📦 Toevoegen (en nog een typen)
          </button>
        </div>
      )}
      {matches.length > 0 && (
        <div className="catsec">
          <h3>Al in je {bakName}</h3>
          <div className="card" style={{ padding: '2px 12px' }}>
            {matches.map((g) => (
              <div key={g.id} className="pickrow" style={{ cursor: 'default' }}>
                <span className="name">{g.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>{catName(g.cat)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ height: 12 }} />
      {canCreate ? (
        <div className="row">
          <button
            className="btn grow"
            onClick={() => {
              add();
              onClose();
            }}
          >
            📦 “{clean}” toevoegen & klaar
          </button>
          <button className="btn small secondary" onClick={onClose}>
            Sluiten
          </button>
        </div>
      ) : (
        <button className="btn" style={{ width: '100%' }} onClick={onClose}>
          Klaar
        </button>
      )}
    </Sheet>
  );
}

function GearForm({ item, cats, onSave, onClose }) {
  const [name, setName] = useState(item.name);
  const [cat, setCat] = useState(item.cat);
  const [location, setLocation] = useState(item.location || '');
  return (
    <Sheet title="Item bewerken" onClose={onClose}>
      <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <div style={{ height: 10 }} />
      <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
        {cats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.emoji} {c.name}
          </option>
        ))}
      </select>
      <div className="formsection">
        <label className="formlabel">📍 Waar ligt het?</label>
        <input
          className="input"
          placeholder="Bijv. la naast bed, kelderkast, zwarte reistas…"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>
      <div style={{ height: 14 }} />
      <button className="btn" style={{ width: '100%' }} disabled={!name.trim()} onClick={() => onSave(name.trim(), cat, location.trim())}>
        Opslaan
      </button>
    </Sheet>
  );
}

const CAT_EMOJIS = [
  '👕', '🧴', '💊', '📄', '🔌', '🎒', '🏖️', '🏕️', '⛷️', '🎲',
  '🧺', '🎮', '📚', '🎵', '⚽', '🚴', '🎣', '🧗', '🐕', '👶',
  '🍳', '🛠️', '💼', '🩴', '🛍️', '🧳', '📷', '🪥', '🍼', '🏐',
  '🎿', '🛹', '🤿', '🎤', '🎨', '🌧️',
];

function CatForm({ cats, current, onSave, onDelete, onMove, onClose }) {
  const [name, setName] = useState(current?.name || '');
  const [emoji, setEmoji] = useState(current?.emoji || CAT_EMOJIS[0]);
  const exists = cats.some(
    (c) => c.id !== current?.id && c.name.toLowerCase() === name.trim().toLowerCase()
  );
  const idx = current ? cats.findIndex((c) => c.id === current.id) : -1;
  return (
    <Sheet title={current ? 'Categorie bewerken' : 'Nieuwe categorie'} onClose={onClose}>
      <input
        className="input"
        placeholder="Bijv. Hond, Baby, Vissen…"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      {exists && <p className="muted">Deze naam is al in gebruik.</p>}
      <div style={{ height: 12 }} />
      <div className="emojirow">
        {CAT_EMOJIS.map((e) => (
          <button key={e} className={e === emoji ? 'on' : ''} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      {current && onMove && (
        <div className="row" style={{ marginTop: 14 }}>
          <button
            className="btn small secondary grow"
            disabled={idx <= 0}
            onClick={() => onMove(-1)}
          >
            ↑ Omhoog
          </button>
          <button
            className="btn small secondary grow"
            disabled={idx < 0 || idx >= cats.length - 1}
            onClick={() => onMove(1)}
          >
            ↓ Omlaag
          </button>
        </div>
      )}
      <div style={{ height: 16 }} />
      <div className="row">
        <button
          className="btn grow"
          disabled={!name.trim() || exists}
          onClick={() => onSave(name.trim(), emoji)}
        >
          {current ? 'Opslaan' : 'Toevoegen'}
        </button>
        {current && onDelete && (
          <button
            className="btn small danger"
            onClick={() => {
              if (confirm(`"${current.name}" verwijderen? Spullen in deze categorie gaan naar Overig.`)) onDelete();
            }}
          >
            🗑
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ================= Sheet (modal) ================= */

function WeatherInfo({ destination, departure, returnDate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!destination || !departure) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchWeather(destination, departure, returnDate).then((d) => {
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [destination, departure, returnDate]);

  if (!destination || !departure) return null;
  if (loading) return <div className="weather-card muted">🌤️ Weer ophalen…</div>;
  if (!data) return null;
  if (data.tooFar)
    return <div className="weather-card muted">🌤️ Te ver vooruit voor een voorspelling (max 15 dagen).</div>;
  if (data.notFound)
    return <div className="weather-card muted">🌤️ Bestemming "{destination}" niet gevonden.</div>;

  return (
    <div className="weather-card">
      <div className="weather-summary">
        <b>🌤️ {data.place}</b> · {data.tmin}–{data.tmax}°C
        {data.wetDays > 0 ? ` · ${data.wetDays} regendag${data.wetDays > 1 ? 'en' : ''}` : ''}
      </div>
      <div className="weather-days">
        {data.days.map((d) => (
          <div key={d.date} className="weather-day" title={`${d.date}: ${d.tmin}–${d.tmax}°C`}>
            <div className="weather-icon">{weatherIcon(d.code)}</div>
            <div className="weather-tmax">{d.tmax}°</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(() => {
    const colors = ['#f44', '#ffd54a', '#48d68a', '#4a9cf2', '#d864e8', '#f8a14b'];
    return Array.from({ length: 70 }, (_, i) => ({
      i,
      left: Math.random() * 100,
      bg: colors[i % colors.length],
      delay: Math.random() * 0.6,
      duration: 1.6 + Math.random() * 1.4,
      rotateTo: 360 + Math.random() * 720,
      driftX: (Math.random() - 0.5) * 80,
    }));
  }, []);
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p) => (
        <div
          key={p.i}
          className="piece"
          style={{
            left: `${p.left}%`,
            background: p.bg,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--drift': `${p.driftX}px`,
            '--rotate': `${p.rotateTo}deg`,
          }}
        />
      ))}
    </div>
  );
}

function LocationBadge({ gear, it, onToggle }) {
  if (!gear?.location || it.skip || it.packed) return null;
  return (
    <button
      className={`prepbadge loc ${it.picked ? 'done' : 'open'}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={it.picked ? 'Gepakt van z’n plek — tik om terug te zetten' : `Ligt: ${gear.location} — tik als je ’m gepakt hebt`}
    >
      {it.picked ? '✓' : '📍'} {gear.location}
    </button>
  );
}

function PrepBadge({ it, onToggleDone }) {
  if (!it.prep || it.skip || it.packed) return null;
  return (
    <button
      className={`prepbadge ${it.prep.done ? 'done' : 'open'}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggleDone();
      }}
      title={it.prep.done ? `${it.prep.label}: klaar` : `Nog ${it.prep.label.toLowerCase()}`}
    >
      {it.prep.done ? '✓' : prepEmoji(it.prep.label)} {it.prep.label}
    </button>
  );
}

function ItemSheet({ name, item, gear, onSave, onDelete, onClose }) {
  const [label, setLabel] = useState(item.prep?.label || '');
  const [note, setNote] = useState(item.note || '');
  const [location, setLocation] = useState(gear?.location || '');
  return (
    <Sheet title={name} onClose={onClose}>
      <label className="formlabel">📝 Vooraf te doen</label>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {PREP_PRESETS.map((p) => (
          <button
            key={p}
            className={`btn small ${label === p ? '' : 'secondary'}`}
            onClick={() => setLabel(label === p ? '' : p)}
          >
            {prepEmoji(p)} {p}
          </button>
        ))}
      </div>
      <div style={{ height: 8 }} />
      <input
        className="input"
        placeholder="Of typ iets anders…"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />

      {gear && (
        <div className="formsection">
          <label className="formlabel">📍 Waar ligt het? <span className="muted" style={{ fontWeight: 500 }}>(reist mee naar elk lijstje)</span></label>
          <input
            className="input"
            placeholder="Bijv. la naast bed, kelderkast, zwarte reistas…"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      )}

      <div className="formsection">
        <label className="formlabel">💬 Notitie <span className="muted" style={{ fontWeight: 500 }}>(alleen dit lijstje)</span></label>
        <textarea
          className="input"
          rows={3}
          placeholder="Bijv. 'voor Marlou', 'paspoort verloopt 2027'"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div style={{ height: 16 }} />
      <div className="row">
        <button
          className="btn grow"
          onClick={() => {
            const cleanLabel = label.trim();
            const newPrep = cleanLabel
              ? {
                  label: cleanLabel,
                  done: item.prep?.label === cleanLabel ? !!item.prep?.done : false,
                }
              : null;
            onSave({ prep: newPrep, note: note.trim(), location: gear ? location.trim() : null });
          }}
        >
          Opslaan
        </button>
        {onDelete && (
          <button className="btn danger" onClick={onDelete}>
            🗑 Uit lijstje
          </button>
        )}
      </div>
    </Sheet>
  );
}

function PrepView({ state, mutate }) {
  const open = collectOpenPrep(state);
  const groups = {};
  for (const o of open) (groups[o.prep.label] ||= []).push(o);

  const pickups = collectLocationPickups(state);
  const pickupGroups = {};
  for (const o of pickups) (pickupGroups[o.location] ||= []).push(o);

  function markPicked(o) {
    mutate((s) => {
      const l = s.lists.find((x) => x.id === o.list.id);
      const it = l?.items.find((x) => x.gearId === o.gearId);
      if (it) it.picked = true;
      return s;
    });
  }

  function findPrepItem(s, o) {
    const l = s.lists.find((x) => x.id === o.list.id);
    return o.kind === 'item'
      ? l?.items.find((x) => x.gearId === o.gearId)
      : (l?.extras || []).find((x) => x.id === o.id);
  }

  function markDone(o) {
    mutate((s) => {
      const it = findPrepItem(s, o);
      if (it?.prep) it.prep.done = true;
      return s;
    });
  }

  function removePrep(o) {
    mutate((s) => {
      const it = findPrepItem(s, o);
      if (it) delete it.prep;
      return s;
    });
  }

  if (open.length === 0 && pickups.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <span className="big">✨</span>
          Niks vooraf te doen.
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Open een lijstje, tik op <b>✏️ bewerk</b> en geef items een vooraf-actie
            (Kopen, Ophalen, Opzoeken…) of een 📍 locatie. Ze verschijnen dan hier als overzicht.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <p className="muted" style={{ margin: '0 4px' }}>
        Alles wat je nog moet regelen vóór je gaat inpakken, gegroepeerd per actie.
      </p>
      {Object.entries(groups).map(([label, items]) => (
        <div key={label} className="catsec">
          <h3>
            {prepEmoji(label)} {label} <span style={{ opacity: 0.6 }}>({items.length})</span>
          </h3>
          {items.map((o) => (
            <div key={o.key} className="itemrow">
              <button className="check" onClick={() => markDone(o)} />
              <span className="name">
                {o.name}
                {o.qty > 1 ? ` ×${o.qty}` : ''}
              </span>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {o.list.emoji} {o.list.name}
              </span>
              <button
                className="iconbtn"
                title="Hoeft toch niet — vooraf-actie weghalen"
                onClick={() => removePrep(o)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}

      {pickups.length > 0 && (
        <>
          <p className="muted" style={{ margin: '10px 4px 0' }}>
            📍 Nog pakken van hun plek — afvinken = gepakt & ingepakt.
          </p>
          {Object.entries(pickupGroups).map(([loc, items]) => (
            <div key={loc} className="catsec">
              <h3>
                📍 {loc} <span style={{ opacity: 0.6 }}>({items.length})</span>
              </h3>
              {items.map((o) => (
                <div key={o.key} className="itemrow">
                  <button className="check" onClick={() => markPicked(o)} />
                  <span className="name">
                    {o.name}
                    {o.qty > 1 ? ` ×${o.qty}` : ''}
                  </span>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {o.list.emoji} {o.list.name}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ShareView({ shareId, user, myState, mutate, onClose }) {
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Oude links hadden het formaat slug:listId — die snapshots bestaan niet meer.
    if (shareId.includes(':')) {
      setError('Deze deel-link is van de oude app-versie. Vraag een nieuwe link.');
      return;
    }
    loadShare(shareId)
      .then((d) => {
        if (!d) setError('Dit gedeelde lijstje bestaat niet (meer).');
        else setSnap(d);
      })
      .catch((e) => setError(e.message));
  }, [shareId]);

  function copyToMine() {
    if (!user || !myState) {
      alert('Log eerst in (en rond je start af) om dit lijstje naar je eigen profiel te kopiëren.');
      return;
    }
    mutate((s) => {
      const myCatIds = new Set((s.cats || CATS).map((c) => c.id));
      const myGearByName = new Map(s.gear.map((g) => [g.name.toLowerCase(), g]));
      const theirGearById = Object.fromEntries((snap.gear || []).map((g) => [g.id, g]));
      const items = [];
      for (const it of snap.list.items || []) {
        const theirGear = theirGearById[it.gearId];
        if (!theirGear) continue;
        let mine = myGearByName.get(theirGear.name.toLowerCase());
        if (!mine) {
          mine = { id: uid(), name: theirGear.name, cat: myCatIds.has(theirGear.cat) ? theirGear.cat : 'overig' };
          s.gear.push(mine);
          myGearByName.set(mine.name.toLowerCase(), mine);
        }
        if (!items.some((x) => x.gearId === mine.id)) items.push({ gearId: mine.id, qty: it.qty || 1, packed: false });
      }
      s.lists.push({
        id: uid(),
        name: `${snap.list.name}${snap.ownerName ? ` (van ${snap.ownerName})` : ''}`,
        emoji: snap.list.emoji || '🧳',
        note: '',
        destination: snap.list.destination || '',
        departure: '',
        returnDate: '',
        people: snap.list.people || 1,
        color: snap.list.color || '',
        items,
        extras: (snap.list.extras || []).map((it) => ({ id: uid(), name: it.name, qty: it.qty || 1, packed: false })),
      });
      return s;
    });
    alert('Gekopieerd naar je eigen Lijstjes!');
    onClose();
  }

  const cats = snap?.cats || CATS;
  const gearById = snap ? Object.fromEntries((snap.gear || []).map((g) => [g.id, g])) : {};
  const known = new Set(cats.map((c) => c.id));

  return (
    <div className="app">
      <header className="header">
        <h1>
          🔗 Gedeeld lijstje
          <span className="sub">{snap?.ownerName ? `door ${snap.ownerName}` : ''}</span>
        </h1>
        <button className="linkbtn" onClick={onClose}>
          {user ? '← terug' : 'sluiten'}
        </button>
      </header>
      <div className="page">
        {error && <div className="empty">{error}</div>}
        {!error && !snap && <div className="empty">Laden…</div>}
        {snap && (
          <>
            <div className="card">
              <div className="row">
                <span style={{ fontSize: 26 }}>{snap.list.emoji}</span>
                <div className="grow">
                  <div className="title">{snap.list.name}</div>
                  <div className="muted">
                    {(snap.list.items?.length || 0) + (snap.list.extras?.length || 0)} items
                    {snap.list.destination ? ` · 📍 ${snap.list.destination}` : ''}
                  </div>
                </div>
              </div>
            </div>
            <button className="btn" onClick={copyToMine}>
              ⧉ Kopieer naar mijn lijstjes
            </button>
            {cats.map((cat) => {
              const items = (snap.list.items || []).filter((it) => {
                const c = gearById[it.gearId]?.cat;
                return (known.has(c) ? c : 'overig') === cat.id;
              });
              if (!items.length) return null;
              return (
                <div key={cat.id} className="catsec">
                  <h3>{cat.emoji} {cat.name}</h3>
                  {items.map((it) => {
                    const g = gearById[it.gearId];
                    return (
                      <div key={it.gearId} className="itemrow">
                        <span className="name">{g?.name}</span>
                        {it.qty > 1 && <span className="muted">× {it.qty}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {(snap.list.extras || []).length > 0 && (
              <div className="catsec">
                <h3>✨ Los in dit lijstje</h3>
                {snap.list.extras.map((it, i) => (
                  <div key={i} className="itemrow">
                    <span className="name">{it.name}</span>
                    {it.qty > 1 && <span className="muted">× {it.qty}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function VertrekModus({ list, gearById, patchItem, patchExtra, onClose }) {
  // Bevroren wachtrij, één keer opgebouwd bij het openen. Live herberekenen
  // liet afgevinkte items uit de rij vallen terwijl de teller ook vooruit
  // ging — netto werd om het andere item overgeslagen.
  const [queue, setQueue] = useState(() => {
    const out = [];
    for (const it of list.items) {
      if (!it.packed && !it.skip)
        out.push({
          kind: 'item',
          id: it.gearId,
          ref: it,
          name: gearById[it.gearId]?.name || '(verwijderd)',
          gear: gearById[it.gearId],
        });
    }
    for (const it of list.extras || []) {
      if (!it.packed && !it.skip) out.push({ kind: 'extra', id: it.id, ref: it, name: it.name, gear: null });
    }
    return out;
  });

  const total = useMemo(() => {
    const all = [...list.items, ...(list.extras || [])];
    const packed = all.filter((i) => i.packed).length;
    const skipped = all.filter((i) => i.skip).length;
    return { all: all.length, packed, skipped };
  }, [list.items, list.extras]);

  // Live status per wachtrij-item (de refs in de wachtrij zijn bevroren).
  const liveById = useMemo(() => {
    const m = {};
    for (const it of list.items) m[`i${it.gearId}`] = it;
    for (const it of list.extras || []) m[`e${it.id}`] = it;
    return m;
  }, [list.items, list.extras]);
  const liveOf = (o) => liveById[`${o.kind === 'item' ? 'i' : 'e'}${o.id}`];

  const [idx, setIdx] = useState(0);
  const cur = queue[idx];

  if (!cur) {
    // Einde van de rit: overgeslagen items zijn nog niet afgehandeld.
    const remaining = queue.filter((o) => {
      const live = liveOf(o);
      return live && !live.packed && !live.skip;
    });
    if (remaining.length > 0) {
      return (
        <div className="vmodus">
          <div className="vmodus-card">
            <div style={{ fontSize: 56 }}>🌀</div>
            <div className="vmodus-title">
              Nog {remaining.length} {remaining.length === 1 ? 'item' : 'items'} over
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              Deze heb je overgeslagen — nog niet ingepakt en niet op "niet mee" gezet.
            </div>
            <div className="vmodus-actions">
              <button
                className="btn big"
                onClick={() => {
                  setQueue(
                    remaining.map((o) => ({ ...o, ref: liveOf(o) }))
                  );
                  setIdx(0);
                }}
              >
                🔁 Nog een rondje ({remaining.length})
              </button>
              <button className="btn secondary" onClick={onClose}>
                Sluiten
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="vmodus">
        <Confetti />
        <div className="vmodus-card">
          <div style={{ fontSize: 72 }}>🎉</div>
          <div className="vmodus-title">Vakantie ready!</div>
          <div className="muted" style={{ marginTop: 8 }}>
            {total.packed} ingepakt · {total.skipped} niet mee
          </div>
          <div style={{ height: 20 }} />
          <button className="btn" onClick={onClose}>
            Sluiten
          </button>
        </div>
      </div>
    );
  }

  function patch(fn) {
    if (cur.kind === 'item') patchItem(cur.id, fn);
    else patchExtra(cur.id, fn);
  }
  function pak() {
    patch((x) => (x.packed = true));
    setIdx(idx + 1);
  }
  function nietMee() {
    patch((x) => {
      x.skip = true;
      x.packed = false;
    });
    setIdx(idx + 1);
  }
  function later() {
    setIdx(idx + 1);
  }
  function vorige() {
    setIdx(Math.max(0, idx - 1));
  }

  return (
    <div className="vmodus">
      <div className="vmodus-card">
        <button className="vmodus-close" onClick={onClose} title="Sluiten">
          ✕
        </button>
        <div className="muted vmodus-count">
          {idx + 1} van {queue.length}
        </div>
        <div className="vmodus-name">{cur.name}</div>
        {cur.ref.qty > 1 && <div className="muted vmodus-qty">× {cur.ref.qty}</div>}
        {cur.gear?.location && <div className="vmodus-location">📍 {cur.gear.location}</div>}
        {cur.ref.note && <div className="itemnote vmodus-note">💬 {cur.ref.note}</div>}
        {cur.ref.prep && !cur.ref.prep.done && (
          <div className="vmodus-prepwarn">
            ⚠️ Eerst nog {cur.ref.prep.label.toLowerCase()}!
          </div>
        )}
        <div className="vmodus-actions">
          <button className="btn danger" onClick={nietMee}>
            ⊘ Niet mee
          </button>
          <button className="btn secondary" onClick={later}>
            → Sla over
          </button>
          <button className="btn big" onClick={pak}>
            ✓ Ingepakt
          </button>
        </div>
        <button className="linkbtn" onClick={vorige} disabled={idx === 0} style={{ color: 'var(--muted)' }}>
          ← Vorige
        </button>
      </div>
    </div>
  );
}

function Sheet({ title, children, onClose }) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <div className="title">{title}</div>
          <button className="iconbtn" onClick={onClose} style={{ fontSize: 20 }}>
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
