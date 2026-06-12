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
  return s;
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
  const total = all.length;
  const packed = all.filter((i) => i.packed).length;
  const skipped = all.filter((i) => !i.packed && i.skip).length;
  const done = packed + skipped;
  return { total, packed, skipped, done, pct: total ? Math.round((done / total) * 100) : 0 };
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

export default function App() {
  const [email, setEmail] = useState(() => localStorage.getItem(LS_LAST) || null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
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
  return <Main email={email} state={state} mutate={mutate} onLogout={logout} />;
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

function Main({ email, state, mutate, onLogout }) {
  const [tab, setTab] = useState('lijsten');
  const [openListId, setOpenListId] = useState(null);
  const status = useSyncStatus();

  const openList = state.lists.find((l) => l.id === openListId);

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
        return (
          <div key={list.id} className="card tap" onClick={() => onOpen(list.id)}>
            <div className="row">
              <span style={{ fontSize: 26 }}>{list.emoji}</span>
              <div className="grow">
                <div className="title">{list.name}</div>
                <div className="muted">
                  {p.done}/{p.total} ingepakt{p.skipped ? ` (${p.skipped} niet mee)` : ''}{list.note ? ` · ${list.note}` : ''}
                </div>
              </div>
              {p.total > 0 && p.done === p.total && <span className="badge">klaar ✓</span>}
            </div>
            <div className={`progress${p.total && p.done === p.total ? ' done' : ''}`}>
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
          onSave={(name, emoji) => {
            mutate((s) => {
              s.lists.push({ id: uid(), name, emoji, note: '', items: [], extras: [] });
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
  return (
    <Sheet title={initial ? 'Lijstje aanpassen' : 'Nieuw lijstje'} onClose={onClose}>
      <input
        className="input"
        placeholder="Bijv. Wintersport 2027"
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
      <div style={{ height: 16 }} />
      <button className="btn" style={{ width: '100%' }} disabled={!name.trim()} onClick={() => onSave(name.trim(), emoji)}>
        Opslaan
      </button>
    </Sheet>
  );
}

/* ================= Lijst detail ================= */

function ListDetail({ list, state, mutate, onClose }) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const p = listProgress(list);

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

  return (
    <div className="page">
      <div className="card">
        <div className="row">
          <div className="grow">
            <b>
              {p.done}/{p.total}
            </b>{' '}
            <span className="muted">ingepakt{p.skipped ? ` · ${p.skipped} niet mee` : ''}</span>
          </div>
          <button className="btn small secondary" onClick={() => setEditing(true)}>
            ✏️ bewerk
          </button>
        </div>
        <div className={`progress${p.total && p.done === p.total ? ' done' : ''}`}>
          <div style={{ width: `${p.pct}%` }} />
        </div>
      </div>

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
                <span className="name">{gear?.name || '(verwijderd item)'}</span>
                {it.skip ? (
                  <span className="badge off">niet mee</span>
                ) : (
                  <span className="qty">
                    <button onClick={() => patchItem(it.gearId, (x) => (x.qty = Math.max(1, x.qty - 1)))}>−</button>
                    <span>{it.qty}</span>
                    <button onClick={() => patchItem(it.gearId, (x) => (x.qty += 1))}>+</button>
                  </span>
                )}
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
                <button
                  className="iconbtn"
                  title="Uit lijstje halen"
                  onClick={() =>
                    mutate((s) => {
                      const l = s.lists.find((x) => x.id === list.id);
                      l.items = l.items.filter((x) => x.gearId !== it.gearId);
                      return s;
                    })
                  }
                >
                  ✕
                </button>
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
              <span className="name">{it.name}</span>
              {it.skip ? (
                <span className="badge off">niet mee</span>
              ) : (
                <span className="qty">
                  <button onClick={() => patchExtra(it.id, (x) => (x.qty = Math.max(1, x.qty - 1)))}>−</button>
                  <span>{it.qty}</span>
                  <button onClick={() => patchExtra(it.id, (x) => (x.qty += 1))}>+</button>
                </span>
              )}
              <button
                className={`iconbtn${it.skip ? ' active' : ''}`}
                title="Dit keer niet mee"
                onClick={() =>
                  patchExtra(it.id, (x) => {
                    x.skip = !x.skip;
                    if (x.skip) x.packed = false;
                  })
                }
              >
                ⊘
              </button>
              <button
                className="iconbtn"
                title="Uit lijstje halen"
                onClick={() =>
                  mutate((s) => {
                    const l = s.lists.find((x) => x.id === list.id);
                    l.extras = (l.extras || []).filter((x) => x.id !== it.id);
                    return s;
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="btn" onClick={() => setPicking(true)}>
        + Spullen toevoegen
      </button>

      <div className="row" style={{ marginTop: 4 }}>
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
          🗑 Verwijder
        </button>
      </div>

      {picking && <Picker list={list} state={state} mutate={mutate} onClose={() => setPicking(false)} />}
      {editing && (
        <ListForm
          initial={list}
          onClose={() => setEditing(false)}
          onSave={(name, emoji) => {
            mutate((s) => {
              const l = s.lists.find((x) => x.id === list.id);
              l.name = name;
              l.emoji = emoji;
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
            {cat.emoji} {cat.name}
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
              s.cats.push({ id: uid(), name: nm, emoji });
              return s;
            });
            setAddingCat(false);
          }}
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

const CAT_EMOJIS = ['🎲', '🎮', '📚', '🎵', '⚽', '🚴', '🎣', '🧗', '🐕', '👶', '🍳', '🛠️', '💼', '🩴'];

function CatForm({ cats, onSave, onClose }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(CAT_EMOJIS[0]);
  const exists = cats.some((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <Sheet title="Nieuwe categorie" onClose={onClose}>
      <input
        className="input"
        placeholder="Bijv. Hond, Baby, Vissen…"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      {exists && <p className="muted">Deze categorie bestaat al.</p>}
      <div style={{ height: 12 }} />
      <div className="emojirow">
        {CAT_EMOJIS.map((e) => (
          <button key={e} className={e === emoji ? 'on' : ''} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <div style={{ height: 16 }} />
      <button
        className="btn"
        style={{ width: '100%' }}
        disabled={!name.trim() || exists}
        onClick={() => onSave(name.trim(), emoji)}
      >
        Toevoegen
      </button>
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
