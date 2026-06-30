import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  slugify,
  listCloudProfiles,
  loadProfile,
  saveProfileDebounced,
  subscribeProfile,
  onStatus,
  getStatus,
  getLastError,
} from './cloud.js';
import { CATS, uid, seedState } from './seed.js';

const LS_LAST = 'paklijst:lastEmail';
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
  for (const l of s.lists || []) {
    if (l.destination == null) l.destination = '';
    if (l.departure == null) l.departure = '';
    if (l.returnDate == null) l.returnDate = '';
    if (l.people == null) l.people = 1;
    for (const it of l.items || []) if (it.note == null) it.note = '';
    for (const it of l.extras || []) if (it.note == null) it.note = '';
  }
  return s;
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

export default function App() {
  const [email, setEmail] = useState(() => localStorage.getItem(LS_LAST) || null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [theme, cycleTheme] = useTheme();
  const stateRef = useRef(state);
  stateRef.current = state;

  const slug = email ? slugify(email) : null;

  // Profiel laden: eerst lokale cache (instant), dan cloud, dan realtime volgen.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);

    const cached = localStorage.getItem(cacheKey(slug));
    if (cached) {
      try {
        setState(migrate(JSON.parse(cached)));
      } catch { /* kapotte cache negeren */ }
    }

    (async () => {
      try {
        const remote = await loadProfile(slug);
        if (cancelled) return;
        if (remote) {
          const local = stateRef.current;
          if (!local || !local.updatedAt || remote.state.updatedAt >= local.updatedAt) {
            const rs = migrate(remote.state);
            setState(rs);
            localStorage.setItem(cacheKey(slug), JSON.stringify(rs));
          } else {
            saveProfileDebounced(slug, local);
          }
        } else {
          const fresh = stateRef.current || seedState(email);
          setState(fresh);
          localStorage.setItem(cacheKey(slug), JSON.stringify(fresh));
          saveProfileDebounced(slug, fresh);
        }
      } catch (e) {
        console.warn('[paklijst] cloud load mislukt, lokaal verder:', e.message);
        if (!cancelled && !stateRef.current) {
          const fresh = seedState(email);
          setState(fresh);
          localStorage.setItem(cacheKey(slug), JSON.stringify(fresh));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsub = subscribeProfile(slug, (remoteState) => {
      const rs = migrate(remoteState);
      setState(rs);
      localStorage.setItem(cacheKey(slug), JSON.stringify(rs));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [slug]);

  function mutate(fn) {
    setState((prev) => {
      const next = fn(structuredClone(prev));
      next.updatedAt = new Date().toISOString();
      localStorage.setItem(cacheKey(slug), JSON.stringify(next));
      saveProfileDebounced(slug, next);
      return next;
    });
  }

  function login(addr) {
    const clean = addr.trim().toLowerCase();
    localStorage.setItem(LS_LAST, clean);
    setState(null);
    setEmail(clean);
  }

  function logout() {
    localStorage.removeItem(LS_LAST);
    setEmail(null);
    setState(null);
  }

  if (!email) return <Login onLogin={login} />;
  if (!state) {
    return (
      <div className="login">
        <div className="logo">🧳</div>
        <p>{loading ? 'Lijstjes laden…' : 'Even geduld…'}</p>
      </div>
    );
  }
  return <Main email={email} state={state} mutate={mutate} onLogout={logout} theme={theme} cycleTheme={cycleTheme} />;
}

/* ================= Login ================= */

function Login({ onLogin }) {
  const [value, setValue] = useState('');
  const [profiles, setProfiles] = useState(null);
  const valid = /\S+@\S+\.\S+/.test(value);

  useEffect(() => {
    listCloudProfiles()
      .then((p) => setProfiles(p.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))))
      .catch(() => setProfiles([]));
  }, []);

  return (
    <div className="login">
      <div className="logo">🧳</div>
      <h1>Paklijst</h1>
      <p>Eén Bak met al je spullen, lijstjes per vakantie. Log in met alleen je e-mailadres.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onLogin(value);
        }}
      >
        <input
          className="input"
          type="email"
          placeholder="jij@voorbeeld.nl"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        <div style={{ height: 10 }} />
        <button className="btn" style={{ width: '100%' }} disabled={!valid}>
          Verder →
        </button>
      </form>
      {profiles === null && <p className="muted">Bestaande profielen laden…</p>}
      {profiles?.length > 0 && (
        <div>
          <p className="muted" style={{ textAlign: 'left', margin: '6px 4px' }}>
            Bestaande profielen:
          </p>
          {profiles.map((p) => (
            <div key={p.slug} className="card tap row" style={{ marginBottom: 6 }} onClick={() => onLogin(p.email)}>
              <div className="grow">{p.email}</div>
              <span className="badge">{p.listCount} lijstjes</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= Main shell ================= */

function Main({ email, state, mutate, onLogout, theme, cycleTheme }) {
  const [tab, setTab] = useState('lijsten');
  const [openListId, setOpenListId] = useState(null);
  const status = useSyncStatus();

  const openList = state.lists.find((l) => l.id === openListId);
  const prepCount = useMemo(() => collectOpenPrep(state).length, [state.lists, state.gear]);

  return (
    <div className="app">
      <header className="header">
        <h1>
          {openList ? (
            <>
              {openList.emoji} {openList.name}
            </>
          ) : (
            '🧳 Paklijst'
          )}
          <span className="sub">{email}</span>
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
            alert(
              `Sync-status: ${STATUS_LABEL[status]}` +
                (err ? `\n\nLaatste fout: ${err}` : '') +
                `\n\nJe data staat altijd ook lokaal op dit apparaat opgeslagen; zodra de verbinding werkt wordt alles alsnog gesynchroniseerd.`
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
        <ListDetail list={openList} state={state} mutate={mutate} onClose={() => setOpenListId(null)} />
      ) : tab === 'lijsten' ? (
        <ListsView state={state} mutate={mutate} onOpen={setOpenListId} />
      ) : tab === 'vooraf' ? (
        <PrepView state={state} mutate={mutate} />
      ) : tab === 'bak' ? (
        <BakView state={state} mutate={mutate} />
      ) : (
        <OthersView myEmail={email} mutate={mutate} onCopied={() => setTab('lijsten')} />
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
              <span className="ico">📦</span>De Bak
            </button>
            <button className={tab === 'anderen' ? 'active' : ''} onClick={() => setTab('anderen')}>
              <span className="ico">👥</span>Anderen
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
        if (range) metaBits.push(`🗓️ ${range}`);
        if ((list.people || 1) > 1) metaBits.push(`👥 ${list.people}`);
        if (days) metaBits.push(`${days}d`);
        return (
          <div key={list.id} className="card tap" onClick={() => onOpen(list.id)}>
            <div className="row">
              <span style={{ fontSize: 26 }}>{list.emoji}</span>
              <div className="grow">
                <div className="title">{list.name}</div>
                {metaBits.length > 0 && <div className="muted listmeta">{metaBits.join(' · ')}</div>}
                <div className="muted">
                  {p.packed}/{p.toPack} ingepakt
                  {p.skipped ? ` · ${p.skipped} niet mee` : ''}
                  {p.pendingPrep ? ` · 📝 ${p.pendingPrep} te doen vooraf` : ''}
                  {list.note ? ` · ${list.note}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                {p.done && <span className="badge">klaar ✓</span>}
                {countdown && <span className="badge countdown">{countdown}</span>}
              </div>
            </div>
            <div className={`progress${p.done ? ' done' : ''}`}>
              <div style={{ width: `${p.pct}%` }} />
            </div>
          </div>
        );
      })}
      <button className="btn ghost" onClick={() => setCreating(true)}>
        + Nieuw lijstje
      </button>
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
          })
        }
      >
        Opslaan
      </button>
    </Sheet>
  );
}

/* ================= Lijst detail ================= */

function ListDetail({ list, state, mutate, onClose }) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [itemEditing, setItemEditing] = useState(null); // {kind:'item'|'extra', id, item, name}
  const [celebrate, setCelebrate] = useState(false);
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
  const grouped = useMemo(() => {
    const known = new Set(cats.map((c) => c.id));
    const groups = [];
    for (const cat of cats) {
      const items = list.items.filter((it) => {
        const c = gearById[it.gearId]?.cat;
        return (known.has(c) ? c : 'overig') === cat.id;
      });
      if (items.length) groups.push({ cat, items });
    }
    return groups;
  }, [list.items, gearById, cats]);

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

  function applyItemEdit(target, { prep, note }) {
    const apply = (x) => {
      if (prep) x.prep = prep;
      else delete x.prep;
      x.note = note;
    };
    if (target.kind === 'item') patchItem(target.id, apply);
    else patchExtra(target.id, apply);
  }

  function removeFromList(target) {
    mutate((s) => {
      const l = s.lists.find((x) => x.id === list.id);
      if (target.kind === 'item') l.items = l.items.filter((x) => x.gearId !== target.id);
      else l.extras = (l.extras || []).filter((x) => x.id !== target.id);
      return s;
    });
  }

  const countdown = countdownLabel(list.departure);
  const range = formatDateRange(list.departure, list.returnDate);
  const days = tripDays(list.departure, list.returnDate);
  const metaBits = [];
  if (list.destination) metaBits.push(`📍 ${list.destination}`);
  if (range) metaBits.push(`🗓️ ${range}${days ? ` (${days}d)` : ''}`);
  if ((list.people || 1) > 1) metaBits.push(`👥 ${list.people} personen`);

  return (
    <div className="page">
      {celebrate && <Confetti />}
      <div className="card">
        {metaBits.length > 0 && (
          <div className="listdetail-meta">
            {metaBits.join(' · ')}
            {countdown && <span className="badge countdown" style={{ marginLeft: 8 }}>{countdown}</span>}
          </div>
        )}
        <div className="row">
          <div className="grow">
            <b>
              {p.packed}/{p.toPack}
            </b>{' '}
            <span className="muted">ingepakt{p.skipped ? ` · ${p.skipped} niet mee` : ''}</span>
          </div>
          <button className={`btn small ${editMode ? '' : 'secondary'}`} onClick={() => setEditMode(!editMode)}>
            {editMode ? '✓ klaar' : '✏️ bewerk'}
          </button>
        </div>
        <div className={`progress${p.done ? ' done' : ''}`}>
          <div style={{ width: `${p.pct}%` }} />
        </div>
      </div>

      {openPrep.length > 0 && !editMode && (
        <div className="card prep-banner">
          <div className="prep-banner-title">📝 Eerst nog regelen <span className="prep-count">({openPrep.length})</span></div>
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
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {editMode && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn small secondary grow" onClick={() => setEditing(true)}>
            ✏️ Naam & emoji
          </button>
          <button
            className="btn small secondary grow"
            onClick={() =>
              mutate((s) => {
                const l = s.lists.find((x) => x.id === list.id);
                for (const it of [...l.items, ...(l.extras || [])]) {
                  it.packed = false;
                  it.skip = false;
                }
                return s;
              })
            }
          >
            ↺ Vinkjes resetten
          </button>
          <button
            className="btn small secondary grow"
            onClick={() =>
              mutate((s) => {
                const copy = structuredClone(s.lists.find((x) => x.id === list.id));
                copy.id = uid();
                copy.name = `${copy.name} (kopie)`;
                copy.items.forEach((it) => {
                  it.packed = false;
                  it.skip = false;
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
            className="btn small danger grow"
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
          Nog leeg — voeg spullen toe uit je Bak.
        </div>
      )}

      {grouped.map(({ cat, items }) => (
        <div key={cat.id} className="catsec">
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
                  {it.note && <div className="itemnote">💬 {it.note}</div>}
                </div>
                {!editMode && (
                  <PrepBadge
                    it={it}
                    onToggleDone={() => patchItem(it.gearId, (x) => (x.prep.done = !x.prep.done))}
                  />
                )}
                {it.skip ? (
                  <span className="badge off">niet mee</span>
                ) : (
                  <span className="qty">
                    <button onClick={() => patchItem(it.gearId, (x) => (x.qty = Math.max(1, x.qty - 1)))}>−</button>
                    <span>{it.qty}</span>
                    <button onClick={() => patchItem(it.gearId, (x) => (x.qty += 1))}>+</button>
                  </span>
                )}
                {editMode ? (
                  <button
                    className="iconbtn"
                    title="Bewerken (vooraf, notitie, weghalen)"
                    onClick={() => setItemEditing({ kind: 'item', id: it.gearId, item: it, name: gear?.name || '(verwijderd)' })}
                  >
                    ✏️
                  </button>
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

      {(list.extras || []).length > 0 && (
        <div className="catsec">
          <h3>✨ Los in dit lijstje</h3>
          {(list.extras || []).map((it) => (
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
              </div>
              {!editMode && (
                <PrepBadge
                  it={it}
                  onToggleDone={() => patchExtra(it.id, (x) => (x.prep.done = !x.prep.done))}
                />
              )}
              <span className="qty">
                <button onClick={() => patchExtra(it.id, (x) => (x.qty = Math.max(1, x.qty - 1)))}>−</button>
                <span>{it.qty}</span>
                <button onClick={() => patchExtra(it.id, (x) => (x.qty += 1))}>+</button>
              </span>
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

      <button className="btn" onClick={() => setPicking(true)}>
        + Spullen toevoegen
      </button>

      {picking && <Picker list={list} state={state} mutate={mutate} onClose={() => setPicking(false)} />}
      {itemEditing && (
        <ItemSheet
          name={itemEditing.name}
          item={itemEditing.item}
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

function Picker({ list, state, mutate, onClose }) {
  const [q, setQ] = useState('');
  const [newCat, setNewCat] = useState('overig');
  const cats = state.cats || CATS;
  const inList = new Set(list.items.map((i) => i.gearId));

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
    <Sheet title="Spullen uit de Bak" onClose={onClose}>
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
              📦 In Bak + lijstje
            </button>
            <button className="btn small secondary grow" onClick={createExtra}>
              ✨ Alleen dit lijstje
            </button>
          </div>
        </div>
      )}
      {grouped.map(({ cat, items }) => (
        <div key={cat.id} className="catsec">
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
  const [name, setName] = useState('');
  const [cat, setCat] = useState('overig');
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

  function addItem() {
    const nm = name.trim();
    if (!nm) return;
    if (state.gear.some((g) => g.name.toLowerCase() === nm.toLowerCase())) {
      alert('Dit item zit al in je Bak.');
      return;
    }
    mutate((s) => {
      s.gear.push({ id: uid(), name: nm, cat });
      return s;
    });
    setName('');
  }

  return (
    <div className="page">
      <div className="card">
        <div className="title" style={{ marginBottom: 8 }}>
          📦 De Bak <span className="muted">({state.gear.length} spullen)</span>
        </div>
        <div className="row">
          <input className="input grow" placeholder="Nieuw item…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} />
          <select className="input" style={{ width: 'auto', padding: '10px 8px' }} value={cat} onChange={(e) => setCat(e.target.value)}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={addItem} disabled={!name.trim()}>
            +
          </button>
        </div>
      </div>

      <input className="input" placeholder="🔍 Zoeken in de Bak…" value={q} onChange={(e) => setQ(e.target.value)} />

      {grouped.map(({ cat, items }) => (
        <div key={cat.id} className="catsec">
          <h3>
            <span className="grow-empty">{cat.emoji} {cat.name}</span>
            <button className="cat-edit" title="Categorie bewerken" onClick={() => setEditingCat(cat)}>
              ✏️
            </button>
          </h3>
          {items.map((g) => (
            <div key={g.id} className="itemrow">
              <span className="name">{g.name}</span>
              {usage[g.id] ? <span className="badge">in {usage[g.id]} lijstje{usage[g.id] > 1 ? 's' : ''}</span> : null}
              <button className="iconbtn" title="Bewerken" onClick={() => setEditId(g.id)}>
                ✏️
              </button>
              <button
                className="iconbtn"
                title="Verwijderen"
                onClick={() => {
                  const used = usage[g.id];
                  if (!confirm(`"${g.name}" uit de Bak gooien?${used ? ` Het wordt ook uit ${used} lijstje(s) gehaald.` : ''}`)) return;
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

      <button className="btn ghost" onClick={() => setAddingCat(true)}>
        + Nieuwe categorie
      </button>

      {editItem && (
        <GearForm
          item={editItem}
          cats={cats}
          onClose={() => setEditId(null)}
          onSave={(nm, c) => {
            mutate((s) => {
              const g = s.gear.find((x) => x.id === editItem.id);
              g.name = nm;
              g.cat = c;
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
        />
      )}
    </div>
  );
}

function GearForm({ item, cats, onSave, onClose }) {
  const [name, setName] = useState(item.name);
  const [cat, setCat] = useState(item.cat);
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
      <div style={{ height: 14 }} />
      <button className="btn" style={{ width: '100%' }} disabled={!name.trim()} onClick={() => onSave(name.trim(), cat)}>
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

function CatForm({ cats, current, onSave, onDelete, onClose }) {
  const [name, setName] = useState(current?.name || '');
  const [emoji, setEmoji] = useState(current?.emoji || CAT_EMOJIS[0]);
  const exists = cats.some(
    (c) => c.id !== current?.id && c.name.toLowerCase() === name.trim().toLowerCase()
  );
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

/* ================= Anderen ================= */

function OthersView({ myEmail, mutate, onCopied }) {
  const [profiles, setProfiles] = useState(null);
  const [selected, setSelected] = useState(null); // { email, state }
  const [loadingSlug, setLoadingSlug] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listCloudProfiles()
      .then((p) => setProfiles(p.filter((x) => x.email !== myEmail)))
      .catch((e) => setError(e.message));
  }, [myEmail]);

  async function open(profile) {
    setLoadingSlug(profile.slug);
    try {
      const remote = await loadProfile(profile.slug);
      if (remote) setSelected({ email: profile.email, state: remote.state });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingSlug(null);
    }
  }

  function copyList(theirState, theirList) {
    mutate((s) => {
      const myCatIds = new Set((s.cats || CATS).map((c) => c.id));
      const myGearByName = new Map(s.gear.map((g) => [g.name.toLowerCase(), g]));
      const theirGearById = Object.fromEntries(theirState.gear.map((g) => [g.id, g]));
      const items = [];
      for (const it of theirList.items) {
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
        name: `${theirList.name} (van ${selectedName(theirState)})`,
        emoji: theirList.emoji || '🧳',
        note: '',
        items,
        extras: (theirList.extras || []).map((it) => ({ id: uid(), name: it.name, qty: it.qty || 1, packed: false })),
      });
      return s;
    });
    onCopied();
  }

  function selectedName(theirState) {
    const addr = theirState.email || selected?.email || '';
    return addr.split('@')[0] || 'iemand';
  }

  if (selected) {
    return (
      <div className="page">
        <div className="row">
          <button className="btn small secondary" onClick={() => setSelected(null)}>
            ← alle profielen
          </button>
          <div className="grow muted" style={{ textAlign: 'right' }}>
            {selected.email}
          </div>
        </div>
        {selected.state.lists.length === 0 && <div className="empty">Geen lijstjes.</div>}
        {selected.state.lists.map((list) => {
          const gearById = Object.fromEntries(selected.state.gear.map((g) => [g.id, g]));
          return (
            <div key={list.id} className="card">
              <div className="row">
                <span style={{ fontSize: 24 }}>{list.emoji}</span>
                <div className="grow">
                  <div className="title">{list.name}</div>
                  <div className="muted">{list.items.length + (list.extras || []).length} items</div>
                </div>
                <button className="btn small" onClick={() => copyList(selected.state, list)}>
                  ⧉ Kopieer
                </button>
              </div>
              <div className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
                {[
                  ...list.items.map((it) => {
                    const g = gearById[it.gearId];
                    return g ? `${g.name}${it.qty > 1 ? ` ×${it.qty}` : ''}` : null;
                  }),
                  ...(list.extras || []).map((it) => `${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''}`),
                ]
                  .filter(Boolean)
                  .join(' · ') || 'leeg'}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="page">
      <p className="muted" style={{ margin: '0 4px' }}>
        Bekijk de lijstjes van anderen en kopieer ze naar jezelf om aan te passen.
      </p>
      {error && <div className="empty">Kon profielen niet laden: {error}</div>}
      {profiles === null && !error && <div className="empty">Profielen laden…</div>}
      {profiles?.length === 0 && <div className="empty"><span className="big">👻</span>Nog niemand anders hier.</div>}
      {profiles?.map((p) => (
        <div key={p.slug} className="card tap row" onClick={() => open(p)}>
          <div className="grow">
            <div className="title">{p.email}</div>
            <div className="muted">{p.listCount} lijstjes</div>
          </div>
          <span>{loadingSlug === p.slug ? '…' : '→'}</span>
        </div>
      ))}
    </div>
  );
}

/* ================= Sheet (modal) ================= */

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

function ItemSheet({ name, item, onSave, onDelete, onClose }) {
  const [label, setLabel] = useState(item.prep?.label || '');
  const [note, setNote] = useState(item.note || '');
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

      <div className="formsection">
        <label className="formlabel">💬 Notitie</label>
        <textarea
          className="input"
          rows={3}
          placeholder="Bijv. 'in la naast bed', 'oplader in zwarte tas', 'paspoort verloopt 2027'"
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
            onSave({ prep: newPrep, note: note.trim() });
          }}
        >
          Opslaan
        </button>
        {onDelete && (
          <button className="btn small danger" onClick={onDelete}>
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

  function markDone(o) {
    mutate((s) => {
      const l = s.lists.find((x) => x.id === o.list.id);
      const it = o.kind === 'item'
        ? l.items.find((x) => x.gearId === o.gearId)
        : (l.extras || []).find((x) => x.id === o.id);
      if (it?.prep) it.prep.done = true;
      return s;
    });
  }

  if (open.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <span className="big">✨</span>
          Niks vooraf te doen.
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Open een lijstje, tik op <b>✏️ bewerk</b> en geef items een vooraf-actie
            (Kopen, Ophalen, Opzoeken…). Ze verschijnen dan hier als overzicht.
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
            </div>
          ))}
        </div>
      ))}
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
