// Scores: a Cloudflare Worker that keeps a game's best scores, each one checked by playing the game again. A page
// posts what was pressed and when, up to a game's end, with what it says the game came to. A Durable Object keeps
// the scores, and the runs waiting to be checked, in its SQLite store, and plays each run again under the game's
// own rules, a piece at a time, since a free Worker has 10 ms of CPU for a request. A score stands only if the
// rules come to it. player/build.py writes this beside a game's page, with the game's rules, play.js, setup.js
// and a wrangler.jsonc, for `npx wrangler deploy` to put up.
//
//   GET  /scores      the best: { best: [{ id, name, score, level, at }], of, playing }
//   POST /here        { id }, a page's mark, every so often while it is open, gives { playing }: how many pages
//                     have been heard from lately
//   POST /runs        { name, key, ends, claim: { game, score, level }, events: [[t, type, key]] } gives { id }
//   GET  /runs/<id>   how its check goes: { state: 'checking', done }, { state: 'checked', rank, of }, or
//                     { state: 'refused', why }. Each look checks one more piece, and an alarm does the same.
//
// The rules are a module with create(), giving init and step for Play.world, HZ, and result(state), which is
// { game, score, level } once a game is over and null before. `key` is the mark of the rules the page was built
// with, which must be the one this was built with.
import { DurableObject } from 'cloudflare:workers';
import Rules from './rules.js';
import Play from './play.js';
import SETUP from './setup.js';

const HZ = Rules.HZ;
// the steps played again for one request, well inside a free Worker's CPU, and a run's limits
const PIECE = HZ * 10, MOST = { events: 40000, seconds: 4 * 3600, bytes: 2e6, name: 16, key: 24 };
// how long a run may wait to be checked, how many runs one address may post in ten minutes, and how many of the
// best are shown
const STALE = 864e5, POSTS = 8, SHOWN = 10;
// how long a page counts as playing after it was last heard from, and how many pages one address may count as
const HERE = 100e3, HERE_EACH = 4;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, name TEXT, claim TEXT, ends REAL, events TEXT, save TEXT, n INTEGER, state TEXT, why TEXT, score INTEGER, at INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS scores (id TEXT PRIMARY KEY, name TEXT, score INTEGER, level INTEGER, at INTEGER)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS best ON scores (score DESC)');
    // when each address last posted, kept only while the object is awake, and whether it has played a piece since
    // it woke, since the first is the slowest
    this.posts = new Map();
    this.warm = false;
    // the pages heard from lately, each { at, from }, kept only while the object is awake, as is all that is
    // needed for a count of who is playing now
    this.here = new Map();
  }

  async fetch(request) {
    const [what, id] = new URL(request.url).pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && what === 'scores') return json(this.best());
    if (request.method === 'POST' && what === 'runs' && !id) return this.post(request);
    if (request.method === 'POST' && what === 'here') return this.seen(request);
    if (request.method === 'GET' && what === 'runs' && id) { this.check(id); return json(this.state(id)); }
    return json({ error: 'not found' }, 404);
  }

  // The oldest run waiting is checked a piece further, and the alarm is set again while any wait.
  async alarm() {
    this.sql.exec('DELETE FROM runs WHERE at < ?', Date.now() - STALE);
    const next = this.sql.exec("SELECT id FROM runs WHERE state = 'checking' ORDER BY at LIMIT 1").toArray()[0];
    if (next) this.check(next.id);
    if (this.sql.exec("SELECT COUNT(*) AS n FROM runs WHERE state = 'checking'").one().n) await this.ctx.storage.setAlarm(Date.now() + 50);
  }

  best() {
    const best = this.sql.exec('SELECT id, name, score, level, at FROM scores ORDER BY score DESC, at LIMIT ?', SHOWN).toArray();
    return { best, of: this.sql.exec('SELECT COUNT(*) AS n FROM scores').one().n, playing: this.playing() };
  }

  // how many pages have been heard from lately, those not heard from for a while let go
  playing() {
    const now = Date.now();
    for (const [id, h] of this.here) if (now - h.at > HERE) this.here.delete(id);
    return this.here.size;
  }

  // A page says it is open, under a mark of its own. One address counts as only so many pages.
  async seen(request) {
    const b = await request.json().catch(() => null), id = b && typeof b.id === 'string' && /^[\w-]{8,64}$/.test(b.id) ? b.id : null;
    if (!id) return json({ error: 'no mark' }, 400);
    const from = request.headers.get('CF-Connecting-IP') || '', count = this.playing();
    if (!this.here.has(id) && [...this.here.values()].filter(h => h.from === from).length >= HERE_EACH) return json({ playing: count });
    this.here.set(id, { at: Date.now(), from });
    return json({ playing: this.here.size });
  }

  async post(request) {
    const now = Date.now(), from = request.headers.get('CF-Connecting-IP') || '';
    const times = (this.posts.get(from) || []).filter(at => now - at < 6e5);
    if (times.length >= POSTS) return json({ error: 'too many posts' }, 429);
    const text = await request.text();
    if (text.length > MOST.bytes) return json({ error: 'too long' }, 413);
    let run;
    try { run = JSON.parse(text); } catch (e) { return json({ error: 'not json' }, 400); }
    if (!run || run.key !== SETUP.key) return json({ error: 'other rules' }, 409);
    // a name is letters and digits only, from the plain alphabet
    const name = run.name, claim = run.claim || {}, events = run.events, ends = run.ends, whole = v => Number.isInteger(v) && v >= 0;
    if (typeof name !== 'string' || !new RegExp(`^[A-Za-z0-9]{1,${MOST.name}}$`).test(name)) return json({ error: 'name' }, 400);
    if (!whole(claim.game) || !whole(claim.score) || !whole(claim.level)) return json({ error: 'no result' }, 400);
    if (!(ends > 0 && ends <= MOST.seconds) || !Array.isArray(events) || events.length > MOST.events) return json({ error: 'too long a game' }, 400);
    // each event a time no earlier than the last and no later than the end, a press or a release, and a key
    let last = 0;
    for (const e of events) {
      if (!Array.isArray(e) || e.length !== 3 || !(e[0] >= last && e[0] <= ends) || (e[1] !== 'press' && e[1] !== 'release') || typeof e[2] !== 'string' || e[2].length > MOST.key) return json({ error: 'bad events' }, 400);
      last = e[0];
    }
    times.push(now); this.posts.set(from, times);
    const id = crypto.randomUUID();
    this.sql.exec("INSERT INTO runs (id, name, claim, ends, events, save, n, state, why, score, at) VALUES (?, ?, ?, ?, ?, NULL, 0, 'checking', '', 0, ?)",
      id, name, JSON.stringify({ game: claim.game, score: claim.score, level: claim.level }), ends, JSON.stringify(events), now);
    await this.ctx.storage.setAlarm(now + 50);
    return json({ id });
  }

  // A run is played a piece further from where it was saved, told the events it has not come to yet, which are
  // all that is kept of them after each piece. At its end the rules' result must be what the page said, and then
  // the score is kept, once for a name.
  check(id) {
    const run = this.sql.exec('SELECT * FROM runs WHERE id = ?', id).toArray()[0];
    if (!run || run.state !== 'checking') return;
    const G = Rules.create(), from = run.save ? JSON.parse(run.save) : undefined, events = JSON.parse(run.events);
    const W = Play.world({ hz: HZ, init: G.init, step: G.step, keep: 1e9, from });
    for (const [t, type, key] of events) W.input({ t, type, key });
    const piece = this.warm ? PIECE : PIECE / 4;
    this.warm = true;
    const end = Math.floor(run.ends * HZ + 1e-9), to = Math.min(end, (from ? from.n : 0) + piece), S = W.at(to / HZ);
    if (to < end) {
      // the events come in time order, so the world's count of those it has taken is their place in the list
      const save = W.save(), rest = events.slice(save.ei);
      save.ei = 0;
      this.sql.exec('UPDATE runs SET save = ?, events = ?, n = ? WHERE id = ?', JSON.stringify(save), JSON.stringify(rest), to, id);
      return;
    }
    const got = Rules.result(S), claim = JSON.parse(run.claim);
    const same = !!got && got.game === claim.game && got.score === claim.score && got.level === claim.level;
    if (same && !this.sql.exec('SELECT id FROM scores WHERE name = ? AND score = ? AND level = ?', run.name, got.score, got.level).toArray().length) {
      this.sql.exec('INSERT INTO scores (id, name, score, level, at) VALUES (?, ?, ?, ?, ?)', id, run.name, got.score, got.level, run.at);
    }
    const why = same ? '' : got ? 'the game came to ' + got.score : 'the game was not over';
    this.sql.exec("UPDATE runs SET state = ?, why = ?, score = ?, events = '', save = NULL, n = ? WHERE id = ?", same ? 'checked' : 'refused', why, same ? got.score : 0, end, id);
  }

  state(id) {
    const run = this.sql.exec('SELECT state, why, ends, n, score FROM runs WHERE id = ?', id).toArray()[0];
    if (!run) return { state: 'unknown' };
    if (run.state === 'checking') return { state: 'checking', done: Math.min(0.99, run.n / Math.max(1, run.ends * HZ)) };
    if (run.state === 'refused') return { state: 'refused', why: run.why };
    const above = this.sql.exec('SELECT COUNT(*) AS n FROM scores WHERE score > ?', run.score).one().n;
    return { state: 'checked', rank: above + 1, of: this.sql.exec('SELECT COUNT(*) AS n FROM scores').one().n };
  }
}

// The Worker lets the game's own pages, and a page on this computer while it is made, read the scores and post
// to them, and hands every request to the one Board.
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = SETUP.origins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    if (request.method === 'POST' && origin && !allowed) return json({ error: 'not from the game' }, 403);
    const res = await env.BOARD.get(env.BOARD.idFromName('board')).fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
