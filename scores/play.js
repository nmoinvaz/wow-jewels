// Play: games whose world is stepped. A film is a pure function of time. A game that is steered, with a figure
// that runs and climbs where it is told, has a state that moves on step by step. Here the world is stepped at a
// fixed rate from a log of what was pressed, so it is still a pure function of the presses and the time: any
// moment of a recorded game can be drawn on its own, a turned phone can be told everything again, and the same
// presses always play the same game.
//
//   const W = Play.world({ hz: 60, init: () => ({ x: 0 }), step(s, held, hit) { if (held.right) s.x++; } });
//   W.input({ type: 'press', key: 'right', t: 1.2 });     // from the page, or a recorded game
//   const s = W.at(t);                                    // the world after every step up to t
//
// Play.pad turns fingers on a touch screen into the same keys: a stick under one thumb, buttons under the other.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Play = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const copy = v => JSON.parse(JSON.stringify(v));

  // world({ hz, init, step, keep }): init() gives the first state, which must be plain data (numbers, strings,
  // arrays and objects of them), since it is copied to keep. step(state, held, hit, n) moves it on by one step
  // of 1 / hz seconds, in place: held is the keys down during the step and hit those that went down in it, each
  // as { key: true }, and n is the step's number. A state is kept every `keep` steps (a second's worth), so going
  // back in time, or being told of a press after its step was taken, costs at most that many steps again.
  // save() gives where the world has come to, as plain data, and a world made with it as `from` and told the same
  // events again takes it up there, so a long game can be played through in pieces, as a server checking a score
  // does. Events from before that step are counted in it already.
  function world(o) {
    const hz = o.hz || 60, keep = o.keep || hz, events = [], kept = [];
    // how many steps have been taken, and how many times the world went back to a kept state, for a page to watch
    const stats = { steps: 0, restarts: 0 };
    let state = null, held = {}, n = 0, ei = 0;
    const stepOf = t => Math.max(0, Math.floor(t * hz + 1e-9));
    function restart(to) {
      // the last kept state at or before step `to`
      while (kept.length > 1 && kept[kept.length - 1].n > to) kept.pop();
      const k = kept[kept.length - 1];
      stats.restarts++;
      state = copy(k.state); held = copy(k.held); n = k.n; ei = k.ei;
    }
    kept.push(o.from ? copy(o.from) : { n: 0, ei: 0, held: {}, state: copy(o.init()) });
    restart(kept[0].n);
    // a key pressed or let go at e.t seconds; anything else is ignored
    function input(e) {
      if ((e.type !== 'press' && e.type !== 'release') || e.key == null) return;
      const ev = { s: stepOf(e.t), down: e.type === 'press', key: e.key };
      let i = events.length;
      while (i > 0 && events[i - 1].s > ev.s) i--;
      events.splice(i, 0, ev);
      // its step was taken already: take it again from the last kept state before it
      if (ev.s < n && ev.s >= kept[0].n) { while (kept.length > 1 && kept[kept.length - 1].n > ev.s) kept.pop(); restart(ev.s); }
    }
    function at(t) {
      const to = stepOf(t);
      if (to < n) restart(to);
      while (n < to) {
        const hit = {};
        for (; ei < events.length && events[ei].s <= n; ei++) {
          const ev = events[ei];
          if (ev.down) { hit[ev.key] = true; held[ev.key] = true; } else delete held[ev.key];
        }
        // a key let go in the step it went down still counts as hit in it
        o.step(state, held, hit, n);
        n++; stats.steps++;
        if (n % keep === 0 && kept[kept.length - 1].n < n) kept.push({ n, ei, held: copy(held), state: copy(state) });
      }
      return state;
    }
    const save = () => ({ n, ei, held: copy(held), state: copy(state) });
    return { input, at, save, hz, events, stats };
  }

  // pad({ stick: { x, y, w, h, dead, reach }, buttons: [{ key, x, y, w, h }] }): the places on the picture, in
  // its own pixels, where a finger steers and where it presses. A finger that comes down in the stick's place
  // is the stick from where it came down: pushed more than `dead` px from there it holds 'left' or 'right', 'up'
  // or 'down', or two of them on a diagonal, and the stick's middle follows a finger pushed further than `reach`.
  // input(e) takes the page's pointer events ({ type: 'press' | 'move' | 'release', key: 'pointer', id, x, y, t })
  // and gives the key events they make, [{ type, key, t }], for the world and for the page to remember. Any
  // other event is given back as it came. `sticks` says where each finger's stick is, for drawing it.
  function pad(o) {
    const S = o.stick, dead = (S && S.dead) || 8, reach = (S && S.reach) || 26, fingers = new Map();
    const inside = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    function steer(f, x, y, t, out) {
      // the middle is dragged along by a finger at the end of its reach, so turning back takes a small move
      const dx0 = x - f.ox, dy0 = y - f.oy, d = Math.hypot(dx0, dy0);
      if (d > reach) { f.ox += dx0 * (1 - reach / d); f.oy += dy0 * (1 - reach / d); }
      const dx = x - f.ox, dy = y - f.oy, ax = Math.abs(dx), ay = Math.abs(dy), want = {};
      if (ax > dead && ax > ay * 0.45) want[dx < 0 ? 'left' : 'right'] = true;
      if (ay > dead && ay > ax * 0.45) want[dy < 0 ? 'up' : 'down'] = true;
      for (const k of Object.keys(f.keys)) if (!want[k]) { delete f.keys[k]; out.push({ type: 'release', key: k, t }); }
      for (const k of Object.keys(want)) if (!f.keys[k]) { f.keys[k] = true; out.push({ type: 'press', key: k, t }); }
      f.x = x; f.y = y;
    }
    function input(e) {
      if (e.key !== 'pointer') return [e];
      const out = [], id = e.id ?? 0, f = fingers.get(id);
      if (e.type === 'press') {
        const b = (o.buttons || []).find(q => inside(q, e.x, e.y));
        if (b) { fingers.set(id, { key: b.key }); out.push({ type: 'press', key: b.key, t: e.t }); }
        else if (inside(S, e.x, e.y)) fingers.set(id, { stick: true, ox: e.x, oy: e.y, x: e.x, y: e.y, keys: {} });
      } else if (f && f.stick && e.type === 'move') steer(f, e.x, e.y, e.t, out);
      else if (f && e.type === 'release') {
        for (const k of f.stick ? Object.keys(f.keys) : [f.key]) out.push({ type: 'release', key: k, t: e.t });
        fingers.delete(id);
      }
      return out;
    }
    return { input, get sticks() { return [...fingers.values()].filter(f => f.stick); }, get pressed() { return [...fingers.values()].filter(f => !f.stick).map(f => f.key); } };
  }

  return { world, pad };
});
