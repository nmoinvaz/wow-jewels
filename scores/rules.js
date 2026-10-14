// Wow Jewels: the rules. A tray of jewels, eight by eight, of seven kinds. Two jewels side by side change
// places when that brings three or more of a kind into a row, across or down. The row goes, the jewels above
// fall into its place, new ones fall in from the top, and any row that makes goes too, each worth more than
// the last. It plays as Bejeweled (PopCap, 2001) does. A clock runs down slowly, a little faster with each
// level, and every row puts some of it back, more when rows come back to back. Now and then a jewel on a still tray turns into another kind, never
// into a row. The game is over when the time is gone, or when no two jewels can change places. Eddy says wow at
// a row, though not at every one, and others come up in his place: Borat when the wows come thick, Happy and
// the Church Lady by turns at a row of four or more, Val when two rows go at once, and Tommy when the score passes a mark. Now and then, when
// a cascade of three rows has come to rest, The Mask comes up and brings up fire, which lands on the tray and
// takes the jewels round it. Urkel comes up at what was not meant: a change that makes nothing, or a row that
// falls in by luck. A player who does nothing for a while is called for, as a teacher calls a roll, and the first
// row made after that is told it has redeemed itself. When the clock is getting low, or the next level is near,
// a townie shouts you can do it. Now and then, as a jewel turns into another kind, as a replicator makes a thing,
// Captain Picard asks for his tea, and the jewel it makes wears Starfleet's badge.
//
// A row of four leaves a striped jewel where it was, which takes its whole row or column with it when it goes. A
// row of five or more leaves a peacock, which is no kind: changed with a neighbour, it takes every jewel of the
// neighbour's kind. A jewel with Starfleet's badge on it, which Picard's replicator makes, takes its row and its
// column both when it goes.
//
// A row is worth more for a change made quickly after the tray comes to rest, for rows that come back to back,
// for being of the kind wanted just then, which changes every half minute, and for having the gilded jewel in
// it, which is one jewel picked out now and then for ten seconds.
//
// There is no drawing here. Rules.create() gives init and step for Play.world, so a game is a pure function
// of what was asked for and when, and a script can play it (check.js does). What is asked for comes as keys:
//   go            begin a game, or another once one is over
//   meat          buy a meatball with a tenth of the score: The Mask comes and his fire lands on the tray
//   tip           tap whoever is up, once each time someone comes, for a few points
//   p<i>          pick the jewel in cell i (0 to 63, by rows from the top left), or let it go if it is picked
//   s<i>d<dir>    change the jewel in cell i with the one to its right (0), below (1), left (2) or above (3)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const N = 8, CELLS = N * N, KINDS = 7, HZ = 60;
  // Steps a change of places takes and a row takes to go. A jewel falls d cells in sqrt(2 d / FALL) steps.
  const SWAP = 9, CLEAR = 17, FALL = 0.011;
  // steps of stillness before a jewel that can move is pointed out, before a finished game can begin again, and
  // steps Eddy stays up after a wow
  const HINT = HZ * 8, AGAIN = HZ * 1.5, WOW = 100;
  // the least steps from one wow to the next: a row made inside them goes without one
  const WOW_GAP = HZ * 5;
  // Borat comes up in Eddy's place to say the last of so many wows made within so many steps, and the steps he
  // stays, long enough to read him
  const BORAT = 3, BORAT_IN = HZ * 30, BORAT_UP = 176;
  // the steps Val stays, who comes up when two rows go at once
  const VAL_UP = 160;
  // The Mask comes up when a cascade of so many rows has come to rest, though not within so many steps of a
  // game's start, nor of his last visit. So many steps after he is up his fire lands, and takes every jewel
  // within so many cells of where it lands, each worth so much. Then he says his line, and these are the steps
  // he stays.
  const SPICY = 3, MASK_FIRST = HZ * 40, MASK_REST = HZ * 90, MASK_LANDS = 96, BLAST = 2, CINDER = 20, MASK_UP = 300;
  // What a row's worth is multiplied by. A change made within QUICK steps of the tray's coming to rest pays half
  // as much again. Rows back to back pay a tenth more for each row of the run before them, up to five. A row of
  // the wanted kind pays double, and the wanted kind changes every WANT_FOR steps. A row with the gilded jewel in
  // it pays five times: a jewel is gilded every GILD[0] to GILD[1] seconds for GILT_FOR steps, and taken some
  // other way it pays GILT_FLAT a level. A tap on whoever is up pays TIP a level.
  const QUICK = HZ * 1.5, QUICK_PAYS = 1.5, STREAK_PAYS = 0.1, STREAK_MOST = 5, WANTED_PAYS = 2, WANT_FOR = HZ * 30;
  const GILT_PAYS = 5, GILT_FOR = HZ * 10, GILD = [25, 45], GILT_FLAT = 100, TIP = 20;
  // A meatball is bought with so much of the score, once the score is at least so much, and then not again for so
  // many steps of play. Its fire pays back what it cost so many times over, on top of what the jewels it takes
  // are worth, so it is always worth having.
  const MEAT_SHARE = 0.1, MEAT_MIN = 1000, MEAT_REST = HZ * 600, MEAT_BACK = 1.5;
  // The peacock is the kind after the last. A jewel is plain, or striped across, when it takes its row, or
  // striped down, when it takes its column, or wears the badge, when it takes both.
  const PEACOCK = KINDS, PLAIN = 0, ACROSS = 1, DOWN = 2, BADGE = 3;
  // Tommy says holy schnikes when a striped jewel goes off, at so long a cascade and when a peacock is used,
  // though not within so many steps of the last time; and the steps he stays for it
  const SCHNIKES = 4, SCHNIKES_REST = HZ * 45, SCHNIKES_UP = 184;
  // Urkel comes up at a change that makes nothing and at the second row of a cascade, though not within so many
  // steps of his last visit; and the steps he stays
  const OOPS_REST = HZ * 150, URKEL_UP = 150;
  // A player who has done nothing for so many steps is called for by the teacher, and again every so many while
  // nothing is done; and the steps the teacher stays, which is his three calls
  const ROLL = HZ * 12, ROLL_AGAIN = HZ * 25, ROLL_UP = 270;
  // Harry comes up at the first row made after the teacher has called, and these are the steps he stays
  const REDEEM_UP = 200;
  // The townie shouts when the clock has fallen under so many steps and more than so many are left, and once in
  // each level when so much of it is made and the next is near, though not within so many steps of his last
  // shout; and the steps he stays
  const CHEER_UNDER = HZ * 45, CHEER_OVER = HZ * 8, CHEER_NEAR = 0.85, CHEER_REST = HZ * 40, CHEER_UP = 130;
  // the score that first brings Tommy up, the score between his marks after it, the least steps between two of
  // his visits, since late in a game the marks come fast, and the steps he stays
  const MARK = 5000, MARK_EVERY = 15000, TOMMY_REST = HZ * 90, TOMMY_UP = 200;
  // seconds between one jewel's turning into another kind and the next, at the least and the most on the first
  // level, and the steps the turning takes
  const TURN = [4, 8], TURNING = 26;
  // the steps Happy stays, who comes up when a row is of four jewels or more: his line is a long one
  const HAPPY_UP = 304;
  // the steps the Church Lady stays, who comes up by turns with Happy at a row of four or more
  const CHURCH_UP = 160;
  // Picard comes up as a jewel turns into another kind, though not within so many steps of a game's start nor of his
  // last visit; and the steps he stays
  const PICARD_FIRST = HZ * 50, PICARD_REST = HZ * 120, PICARD_UP = 180;
  // the score at each multiple of which an alarm goes off, and the steps it rings and lights everything up
  const ALARM = 1000, ALARM_UP = 110;
  // How often the new jewels are dealt again when they would end the game: often, since it is the clock that
  // should end it, and a little less with each level.
  const mercy = level => Math.max(3, 18 - level);
  // The clock: the steps it holds when full, what each step takes off it at a level, and what a row puts back.
  // A tray left alone on the first level lasts TIME. A row of three gives three and a half seconds back and a longer row
  // more. A row made back to back with the last, within BACK steps of it, gives a quarter more for each row of
  // the run before it, up to twice. Past the tenth level the clock runs faster again, so that the quickest hand
  // is beaten in the end.
  // Spy mode comes on when no row has been made for so many steps, of the game or since the last spying, and stays
  // on so many, or until a row is made: while it is on, the picture shows the rows a jewel could make.
  const SPY_AFTER = HZ * 10, SPY_FOR = HZ * 12;
  // how many steps the pace of time won back is a mean over, for the picture of how likely the game is to be lost
  const PACE = HZ * 20;
  const TIME = HZ * 90, drain = level => 1 + 0.08 * (level - 1) + 0.004 * Math.max(0, level - 10) ** 2, BACK = HZ * 3;
  const gain = (len, run = 1) => HZ * 1.75 * (len - 1) * (1 + 0.25 * Math.min(run - 1, 4));
  // what a row of 3, 4, 5 and more is worth, before the cascade and the level multiply it
  const WORTH = [0, 0, 0, 30, 60, 100, 150, 200, 250];
  // the points a level takes: its rows are worth more, so each level is some four rows longer than the last
  const need = level => 150 * level * level;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const rowOf = i => (i / N) | 0, colOf = i => i % N;

  // ---------- the tray ----------
  // every row of three or more of a kind, across and down, each as its cells
  function rows(b) {
    const out = [];
    // along one line of the tray, from a cell and by a stride
    const line = (from, by) => {
      let run = [from];
      for (let k = 1; k <= N; k++) {
        const i = from + k * by;
        if (k < N && b[i] >= 0 && b[i] < KINDS && b[i] === b[run[0]]) run.push(i);
        else { if (run.length >= 3 && b[run[0]] >= 0 && b[run[0]] < KINDS) out.push(run); run = [i]; }
      }
    };
    for (let r = 0; r < N; r++) line(r * N, 1);
    for (let c = 0; c < N; c++) line(c, N);
    return out;
  }
  // the cell next to i on a side, or -1 at the tray's edge
  function beside(i, dir) {
    const c = colOf(i) + DIRS[dir][0], r = rowOf(i) + DIRS[dir][1];
    return c < 0 || c >= N || r < 0 || r >= N ? -1 : r * N + c;
  }
  // is there a row through cell i?
  function through(b, i) {
    const k = b[i], r = rowOf(i), c = colOf(i);
    if (k < 0 || k >= KINDS) return false;
    let n = 1;
    for (let x = c - 1; x >= 0 && b[r * N + x] === k; x--) n++;
    for (let x = c + 1; x < N && b[r * N + x] === k; x++) n++;
    if (n >= 3) return true;
    n = 1;
    for (let y = r - 1; y >= 0 && b[y * N + c] === k; y--) n++;
    for (let y = r + 1; y < N && b[y * N + c] === k; y++) n++;
    return n >= 3;
  }
  // every change of places that makes a row, as [cell, side], looking right and down from each cell. A peacock
  // can be changed with any neighbour.
  function moves(b) {
    const out = [];
    for (let i = 0; i < CELLS; i++) for (const dir of [0, 1]) {
      const j = beside(i, dir);
      if (j < 0 || b[i] === b[j]) continue;
      if (b[i] === PEACOCK || b[j] === PEACOCK) { out.push([i, dir]); continue; }
      const t = b[i]; b[i] = b[j]; b[j] = t;
      if (through(b, i) || through(b, j)) out.push([i, dir]);
      b[j] = b[i]; b[i] = t;
    }
    return out;
  }

  // create({ clock: false }) leaves the clock out, for a game that ends only when no change can be made
  function create(o = {}) {
    const say = (S, name, arg = 0) => { S.ev.push([S.n, name, arg]); if (S.ev.length > 40) S.ev.shift(); };
    const rnd = S => { S.seed = (S.seed * 16807) % 2147483647; return S.seed / 2147483647; };
    // a full tray with no row in it and at least three changes to be made
    function deal(S) {
      for (;;) {
        const b = [];
        for (let i = 0; i < CELLS; i++) {
          let k;
          do k = Math.floor(rnd(S) * KINDS);
          while ((colOf(i) > 1 && b[i - 1] === k && b[i - 2] === k) || (rowOf(i) > 1 && b[i - N] === k && b[i - 2 * N] === k));
          b.push(k);
        }
        if (moves(b).length >= 3) return b;
      }
    }
    const blank = () => Array.from({ length: CELLS }, () => 0);
    const init = () => {
      const S = { phase: 'title', n: 0, t: 0, seed: 20261012, board: [], drop: blank(), mode: 'still', k: 0, a: -1, b: -1, back: 0, gone: [], want: '', sel: -1, hint: -1, idle: 0,
        score: 0, level: 1, into: 0, chain: 0, left: 0, games: 0, time: TIME, shown: TIME, why: '', wow: { said: -1e6, run: 0, n: -1e6, count: 0, len: 0, cells: [] }, wows: [], quiet: -1e6, borat: -1e6, tommy: -1e6, happy: -1e6, church: -1e6, picard: -1e6, val: -1e6, mask: -1e6, due: false, spice: MASK_FIRST, spec: blank(), born: { n: -1e6, i: -1 }, lines: [], fan: { n: -1e6, at: 0, kind: 0, cells: [] }, broke: [], fell: { n: -1e6, far: 0, drop: [] }, schnikes: -1e6, quick: false, rested: 0, wanted: { kind: 0, n: 0 }, gilt: { i: -1, n: -1e6, until: 0, got: -1e6 }, gild: HZ * 20, tip: { n: -1e6, pts: 0 }, tipped: -1, bought: { n: -1e6, cost: 0 }, owed: 0, ready: 0, urkel: -1e6, oops: 0, roll: -1e6, called: false, redeem: -1e6, cheer: -1e6, cheered: 0, run: 0, last: -1e6, gave: { n: -1e6, secs: 0, run: 0 }, blast: { n: -1e6, at: 0, cells: [], kinds: [] }, home: { n: -1e6, cells: [], kinds: [], at: 0 }, hush: -1e6, pace: 1, ran: TIME, spy: -1e6, spying: SPY_AFTER, mark: MARK, rose: -1e6, alarm: -1e6, rung: 0, shift: HZ * 6, morph: { n: -1e6, i: 0, from: 0 }, pops: [], ev: [] };
      S.board = deal(S);
      S.left = moves(S.board).length;
      return S;
    };
    function begin(S) {
      // the tray is dealt from the moment the game was asked for, so no two games are alike
      S.seed = ((S.n + 1) * 48271 + S.games * 9973 + 12345) % 2147483647 || 1;
      Object.assign(S, { phase: 'play', t: 0, mode: 'fall', k: 0, a: -1, b: -1, back: 0, gone: [], want: '', sel: -1, hint: -1, idle: 0, score: 0, level: 1, into: 0, chain: 0, pops: [], time: TIME, shown: TIME, why: '', wows: [], quiet: -1e6, borat: -1e6, tommy: -1e6, happy: -1e6, church: -1e6, picard: -1e6, val: -1e6, mask: -1e6, due: false, spice: MASK_FIRST, spec: blank(), born: { n: -1e6, i: -1 }, lines: [], fan: { n: -1e6, at: 0, kind: 0, cells: [] }, broke: [], fell: { n: -1e6, far: 0, drop: [] }, schnikes: -1e6, quick: false, rested: 0, wanted: { kind: 0, n: 0 }, gilt: { i: -1, n: -1e6, until: 0, got: -1e6 }, gild: HZ * 20, tip: { n: -1e6, pts: 0 }, tipped: -1, bought: { n: -1e6, cost: 0 }, owed: 0, ready: 0, urkel: -1e6, oops: 0, roll: -1e6, called: false, redeem: -1e6, cheer: -1e6, cheered: 0, run: 0, last: -1e6, gave: { n: -1e6, secs: 0, run: 0 }, blast: { n: -1e6, at: 0, cells: [], kinds: [] }, home: { n: -1e6, cells: [], kinds: [], at: 0 }, hush: -1e6, pace: 1, ran: TIME, spy: -1e6, spying: SPY_AFTER, mark: MARK, rose: -1e6, alarm: -1e6, rung: 0, shift: HZ * 6, morph: { n: -1e6, i: 0, from: 0 } });
      S.games++;
      S.spice = S.n + MASK_FIRST;
      S.spying = S.n + SPY_AFTER;
      S.picard = S.n - PICARD_REST + PICARD_FIRST;
      S.ready = S.n;
      S.rested = S.n;
      S.wanted = { kind: Math.floor(rnd(S) * KINDS), n: S.n };
      S.board = deal(S);
      S.left = moves(S.board).length;
      // every jewel falls in from above the tray, a row at a time from the bottom
      S.drop = S.board.map((k, i) => N + (N - 1 - rowOf(i)) * 0.6);
      say(S, 'deal');
    }
    // Every striped jewel among those going takes its row or its column with it, a badge both, and any striped
    // jewel or badge in that takes its own. A peacock is not taken: it stays until it is used. What comes back is
    // each line that went.
    function burst(S, gone) {
      const lines = [], queue = [...gone];
      while (queue.length) {
        const i = queue.pop(), mark = S.spec[i];
        if (!mark || lines.some(l => l.at === i)) continue;
        for (const dir of mark === BADGE ? [ACROSS, DOWN] : [mark]) {
          lines.push({ n: S.n, at: i, dir });
          for (let k = 0; k < N; k++) {
            const j = dir === ACROSS ? rowOf(i) * N + k : k * N + colOf(i);
            if (S.board[j] !== PEACOCK && !gone.has(j)) { gone.add(j); queue.push(j); }
          }
        }
      }
      if (lines.length) { S.lines = S.lines.concat(lines).slice(-6); say(S, 'stripe', lines.length); }
      return lines;
    }
    // The gilded jewel is taken: its gilding is done, and when it was taken is kept.
    const caught = S => { S.gilt = { i: -1, n: S.gilt.n, until: 0, got: S.n }; say(S, 'gilt', 1); };
    // Taken some other way than in its own row, by a stripe, a peacock or The Mask, it pays a flat sum.
    function gilded(S, gone) {
      if (S.gilt.i < 0 || !gone.has(S.gilt.i)) return;
      const pts = GILT_FLAT * S.level;
      S.score += pts; S.into += pts;
      S.pops.push({ i: S.gilt.i, pts, n: S.n, kind: S.board[S.gilt.i], run: 1, tags: ['GOLD'] });
      caught(S);
    }
    // One jewel on the still tray is gilded for a while: a plain one, and not the one picked.
    function gild(S) {
      for (let tries = 0; tries < 12; tries++) {
        const i = Math.floor(rnd(S) * CELLS);
        if (i === S.sel || S.spec[i] || S.board[i] >= KINDS) continue;
        S.gilt = { i, n: S.n, until: S.n + GILT_FOR, got: S.gilt.got };
        break;
      }
      S.gild = Math.round(HZ * (GILD[0] + (GILD[1] - GILD[0]) * rnd(S)));
    }
    // A tap on whoever is up pays a little, once for each time someone comes up.
    const STAYS = { tommy: TOMMY_UP, happy: HAPPY_UP, church: CHURCH_UP, picard: PICARD_UP, val: VAL_UP, borat: BORAT_UP, mask: MASK_UP, urkel: URKEL_UP, roll: ROLL_UP, schnikes: SCHNIKES_UP, redeem: REDEEM_UP, cheer: CHEER_UP };
    function tip(S) {
      let up = S.n - S.wow.said < WOW ? S.wow.said : -1;
      for (const who in STAYS) if (S.n - S[who] >= 0 && S.n - S[who] < STAYS[who]) up = Math.max(up, S[who]);
      if (up < 0 || up === S.tipped) return;
      const pts = TIP * S.level;
      S.tipped = up;
      S.score += pts; S.into += pts;
      S.tip = { n: S.n, pts };
      say(S, 'tip');
      rung(S);
      risen(S);
    }
    // what is going is kept a while with its kinds, for the picture to break up
    const broken = (S, cells) => { S.broke = S.broke.concat({ n: S.n, cells: cells.slice(), kinds: cells.map(i => S.board[i]) }).slice(-3); };
    // The first thing made after the teacher has called brings Harry up in his place, whoever else might have come.
    // It says whether he came.
    function redeemed(S) {
      if (!S.called) return false;
      Object.assign(S, { called: false, roll: -1e6, redeem: S.n, hush: S.n + REDEEM_UP });
      say(S, 'redeem');
      return true;
    }
    // A row made puts spy mode away, if it is on, and the wait for it begins again.
    const scored = S => { if (S.n - S.spy < SPY_FOR) S.spy = S.n - SPY_FOR; S.spying = S.n + SPY_AFTER; };
    // Tommy comes up amazed, if no one else is up
    const amazed = S => { if (S.n > S.hush && S.n - S.schnikes >= SCHNIKES_REST) { S.schnikes = S.n; S.hush = S.n + SCHNIKES_UP; say(S, 'schnikes'); } };
    // The rows go: their worth is scored, and Eddy or a guest may say so.
    function score(S, found) {
      const gone = new Set();
      let best = 0, given = 0;
      // `run` is how many rows have come back to back, this one with them
      S.run = S.n - S.last <= BACK ? S.run + 1 : 1;
      S.last = S.n;
      scored(S);
      // a quick change counts for the rows it makes itself, and rows back to back for all of them
      const quick = S.chain === 1 && S.quick ? QUICK_PAYS : 1, streak = 1 + STREAK_PAYS * Math.min(S.run - 1, STREAK_MOST);
      for (const cells of found) {
        const kind = S.board[cells[0]], wanted = kind === S.wanted.kind ? WANTED_PAYS : 1, gold = cells.includes(S.gilt.i) ? GILT_PAYS : 1;
        const pts = Math.round(WORTH[Math.min(cells.length, WORTH.length - 1)] * S.chain * S.level * quick * streak * wanted * gold / 10) * 10;
        S.score += pts; S.into += pts;
        given += gain(cells.length, S.run);
        // what made it worth more goes with it, for the picture to say
        S.pops.push({ i: cells[cells.length >> 1], pts, n: S.n, kind, run: S.run, tags: [quick > 1 && 'QUICK', wanted > 1 && 'WANTED', gold > 1 && 'GOLD'].filter(Boolean) });
        if (gold > 1) caught(S);
        for (const i of cells) gone.add(i);
        best = Math.max(best, cells.length);
      }
      // the striped jewels in the rows go off, and what they take is scored
      const rowed = gone.size, lines = burst(S, gone);
      gilded(S, gone);
      if (lines.length) {
        const pts = (gone.size - rowed) * CINDER * S.level;
        S.score += pts; S.into += pts;
        given += gain(4, S.run) * lines.length;
        S.pops.push({ i: lines[0].at, pts, n: S.n, kind: S.board[lines[0].at], run: 1, tags: [] });
      }
      while (S.pops.length > 8) S.pops.shift();
      // A row of four leaves a striped jewel and a row of five or more a peacock: where the row's middle was if
      // it lay across, and at its foot if it stood, so that the jewel left has nowhere to fall.
      const kept = found.filter(cells => cells.length >= 4).sort((a, b) => b.length - a.length).map(cells => {
        const down = cells[1] - cells[0] === N;
        return { at: down ? cells[cells.length - 1] : cells[cells.length >> 1], kind: cells.length >= 5 ? PEACOCK : S.board[cells[0]], mark: cells.length >= 5 ? PLAIN : down ? DOWN : ACROSS };
      });
      // the time given back, kept for the picture to show
      S.time = Math.min(TIME, S.time + given);
      S.gave = { n: S.n, secs: given / HZ, run: S.run };
      // A row of four or more goes home: its jewels, what kind each was, and the cell they make for, which is
      // where the jewel it leaves comes up.
      const long = found.filter(cells => cells.length >= 4);
      if (long.length) { const cells = [...new Set(long.flat())]; S.home = { n: S.n, cells, kinds: cells.map(i => S.board[i]), at: kept[0].at }; }
      for (const k of kept) gone.delete(k.at);
      S.gone = [...gone];
      broken(S, S.gone);
      for (const k of kept) { S.board[k.at] = k.kind; S.spec[k.at] = k.mark; }
      if (kept.length) { S.born = { n: S.n, i: kept[0].at }; say(S, 'born', kept[0].kind === PEACOCK ? 2 : 1); }
      Object.assign(S, { mode: 'clear', k: 0 });
      say(S, 'row', S.chain);
      rung(S);
      // Guests come up at what a row is: Harry at the first after the teacher's call, Tommy when the score has passed a mark, Happy and the Church Lady by
      // turns at a row of four or more,
      // Val when two rows go at once, Tommy again, amazed, at a cascade's fourth row, and Urkel at its second.
      // While one is up, until `hush`, no other comes and Eddy keeps his peace.
      if (redeemed(S)) { /* Harry has it */ }
      else if (S.score >= S.mark && S.n > S.hush && S.n - S.tommy >= TOMMY_REST) { S.tommy = S.n; S.mark = (Math.floor(S.score / MARK_EVERY) + 1) * MARK_EVERY; S.hush = S.n + TOMMY_UP; say(S, 'tommy'); }
      else if (long.length && S.n > S.hush && S.happy >= S.church) { S.church = S.n; S.hush = S.n + CHURCH_UP; say(S, 'church'); }
      else if (long.length && S.n > S.hush) { S.happy = S.n; S.hush = S.n + HAPPY_UP; say(S, 'happy'); }
      else if (found.length >= 2 && S.n > S.hush) { S.val = S.n; S.hush = S.n + VAL_UP; say(S, 'val'); }
      else if (S.chain === SCHNIKES || lines.length) amazed(S);
      else if (S.chain === 2) oops(S);
      // Eddy comes up and says wow at a row, though not at every one: after a wow there is none until `quiet`.
      // `wows` is when each late wow was, and the one that makes BORAT of them within BORAT_IN is Borat's to say.
      // `run` is which of them Eddy's is.
      if (S.n > S.hush && S.n >= S.quiet) {
        S.wows = S.wows.filter(n => S.n - n < BORAT_IN).concat(S.n);
        S.quiet = S.n + WOW_GAP;
        if (S.wows.length >= BORAT) { S.borat = S.n; S.hush = S.n + BORAT_UP; S.wows = []; say(S, 'borat'); }
        else { S.wow.said = S.n; S.wow.run = S.wows.length; say(S, 'wow', S.wows.length); }
      }
      // the row's place in its cascade and its cells are kept, for what a cascade sets off
      Object.assign(S.wow, { n: S.n, count: S.chain, len: best, cells: S.gone.slice() });
      risen(S);
    }
    // A peacock is changed with a neighbour: every jewel of the neighbour's kind goes, and the peacock with them.
    // Two peacocks changed together take the whole tray.
    function fan(S) {
      const b = S.board, pea = b[S.a] === PEACOCK ? S.a : S.b, kind = b[pea === S.a ? S.b : S.a], gone = new Set([pea]);
      for (let i = 0; i < CELLS; i++) if (kind === PEACOCK || b[i] === kind) gone.add(i);
      burst(S, gone);
      gilded(S, gone);
      const pts = gone.size * CINDER * S.level;
      S.score += pts; S.into += pts;
      S.time = Math.min(TIME, S.time + gain(5));
      S.gave = { n: S.n, secs: gain(5) / HZ, run: 1 };
      S.pops.push({ i: pea, pts, n: S.n, kind, run: 1, tags: [] });
      while (S.pops.length > 8) S.pops.shift();
      S.fan = { n: S.n, at: pea, kind, cells: [...gone] };
      S.run = 1; S.last = S.n;
      scored(S);
      Object.assign(S, { mode: 'clear', k: 0, gone: [...gone], chain: 0 });
      broken(S, S.gone);
      say(S, 'fan');
      rung(S);
      risen(S);
      if (!redeemed(S)) amazed(S);
    }
    // Urkel comes up, if no one else is up and he has not been lately
    function oops(S) { if (S.n > S.hush && S.n >= S.oops) { S.urkel = S.n; S.oops = S.n + OOPS_REST; S.hush = S.n + URKEL_UP; say(S, 'urkel'); } }
    // every thousand points an alarm goes off: `rung` is how many thousands have rung, and `alarm` when
    const rung = S => { if (Math.floor(S.score / ALARM) > S.rung) { S.rung = Math.floor(S.score / ALARM); S.alarm = S.n; say(S, 'alarm', S.rung); } };
    // a level is made when its points are
    const risen = S => { if (S.into >= need(S.level)) { S.into -= need(S.level); S.level++; S.rose = S.n; say(S, 'level', S.level); } };
    // A meatball is bought: a tenth of the score is paid, The Mask is sent for, and whoever is up gives way to him.
    // It is not to be had again for a while.
    function buy(S) {
      if (S.n < S.ready || S.score < MEAT_MIN || S.due || S.mode === 'mask') return;
      const cost = Math.round(S.score * MEAT_SHARE / 10) * 10;
      S.score -= cost;
      S.bought = { n: S.n, cost };
      S.owed = Math.round(cost * MEAT_BACK / 10) * 10;
      S.ready = S.n + MEAT_REST;
      S.due = true;
      S.hush = Math.min(S.hush, S.n);
      here(S);
      say(S, 'buy');
    }
    // The Mask comes up, and where his fire will land is chosen: a cell far enough in that all of it is on the tray.
    function feed(S) {
      const span = N - 2 * BLAST, at = (BLAST + Math.floor(rnd(S) * span)) * N + BLAST + Math.floor(rnd(S) * span);
      Object.assign(S, { mode: 'mask', k: 0, due: false, mask: S.n, spice: S.n + MASK_REST, hush: S.n + MASK_UP, sel: -1, hint: -1, idle: 0 });
      S.blast = { n: -1e6, at, cells: [], kinds: [] };
      say(S, 'mask');
    }
    // His fire lands: every jewel within its reach goes and is scored, and some time comes back. The fire of a
    // meatball that was bought pays back what is owed for it as well, which counts to the score and not to the
    // level.
    function blast(S) {
      const at = S.blast.at, cells = [];
      for (let i = 0; i < CELLS; i++) if ((colOf(i) - colOf(at)) ** 2 + (rowOf(i) - rowOf(at)) ** 2 <= BLAST * BLAST) cells.push(i);
      // a peacock in its reach is spared, and a striped jewel goes off
      const gone = new Set(cells.filter(i => S.board[i] !== PEACOCK));
      burst(S, gone);
      gilded(S, gone);
      const pts = gone.size * CINDER * S.level, back = S.owed;
      S.score += pts + back; S.into += pts; S.owed = 0;
      S.time = Math.min(TIME, S.time + gain(4));
      S.gave = { n: S.n, secs: gain(4) / HZ, run: 1 };
      S.pops.push({ i: at, pts: pts + back, n: S.n, kind: S.board[at], run: 1, tags: back ? ['SPICY'] : [] });
      while (S.pops.length > 8) S.pops.shift();
      S.blast = { n: S.n, at, cells, kinds: cells.map(i => S.board[i]) };
      Object.assign(S, { mode: 'clear', k: 0, gone: [...gone], chain: 0 });
      broken(S, S.gone);
      say(S, 'blast');
      rung(S);
      risen(S);
    }
    // The jewels above the gaps fall, and new ones come in over them: drop is how far each has to fall.
    function settle(S) {
      const b = S.board, fresh = [];
      for (const i of S.gone) { b[i] = -1; S.spec[i] = PLAIN; }
      S.gone = [];
      for (let c = 0; c < N; c++) {
        let to = N - 1;
        for (let r = N - 1; r >= 0; r--) {
          const i = r * N + c;
          if (b[i] < 0) continue;
          const j = to * N + c;
          if (j !== i) { b[j] = b[i]; b[i] = -1; S.spec[j] = S.spec[i]; S.spec[i] = PLAIN; if (S.born.i === i) S.born.i = j; if (S.gilt.i === i) S.gilt.i = j; }
          S.drop[j] = to - r;
          to--;
        }
        for (let r = to; r >= 0; r--) { fresh.push(r * N + c); S.drop[r * N + c] = to + 1; }
      }
      // the new jewels are dealt again, a few times, while they leave a tray with nothing to be done in it
      for (let tries = 0, most = mercy(S.level); tries <= most; tries++) {
        for (const i of fresh) b[i] = Math.floor(rnd(S) * KINDS);
        if (rows(b).length || moves(b).length) break;
      }
      Object.assign(S, { mode: 'fall', k: 0 });
    }
    // One jewel turns into another kind: not the picked one, never into a row, and never so as to leave nothing
    // to be done. The next is sooner on a later level.
    function turn(S) {
      const b = S.board;
      for (let tries = 0; tries < 12; tries++) {
        const i = Math.floor(rnd(S) * CELLS), was = b[i], k = (was + 1 + Math.floor(rnd(S) * (KINDS - 1))) % KINDS;
        if (i === S.sel || i === S.gilt.i || S.spec[i] || was >= KINDS) continue;
        b[i] = k;
        const left = through(b, i) ? 0 : moves(b).length;
        if (!left) { b[i] = was; continue; }
        S.morph = { n: S.n, i, from: was };
        S.left = left;
        if (S.hint === i) S.hint = -1;
        say(S, 'turn');
        // Picard asks the replicator for his tea, if no one else is up and he has not lately, and the jewel it makes
        // wears the badge
        if (S.n > S.hush && S.n - S.picard >= PICARD_REST) { S.spec[i] = BADGE; S.picard = S.n; S.hush = S.n + PICARD_UP; say(S, 'picard'); }
        break;
      }
      S.shift = Math.round(HZ * (TURN[0] + (TURN[1] - TURN[0]) * rnd(S)) / (1 + 0.06 * (S.level - 1)));
    }
    // what is asked for, when the tray is still: a jewel picked, or two to change places
    function ask(S, key) {
      const pick = key.match(/^p(\d+)$/), swap = key.match(/^s(\d+)d(\d)$/);
      if (pick) {
        const i = Number(pick[1]);
        if (i >= CELLS) return;
        // a second pick beside the first changes them, and anywhere else it is the new pick
        const dir = S.sel < 0 ? -1 : [0, 1, 2, 3].find(d => beside(S.sel, d) === i);
        here(S);
        if (S.sel === i) S.sel = -1;
        else if (dir != null && dir >= 0) change(S, S.sel, dir);
        else { S.sel = i; say(S, 'pick'); }
      } else if (swap) change(S, Number(swap[1]), Number(swap[2]));
    }
    // The player is there after all: the stillness is counted from now, and the teacher, if he is up, goes.
    function here(S) {
      S.idle = 0;
      if (S.n - S.roll < ROLL_UP - 16) { S.roll = S.n - (ROLL_UP - 16); S.hush = Math.min(S.hush, S.n + 16); }
    }
    function change(S, i, dir) {
      const j = i < CELLS ? beside(i, dir) : -1;
      if (j < 0) return;
      // a change asked for soon after the tray came to rest is a quick one
      S.quick = S.n - S.rested <= QUICK;
      here(S);
      Object.assign(S, { mode: 'swap', k: 0, a: i, b: j, back: 0, sel: -1, hint: -1, idle: 0 });
      say(S, 'swap');
    }

    function step(S, held, hit, n) {
      S.n = n; S.t++;
      const keys = Object.keys(hit);
      if (S.phase === 'title') { if (hit.go) begin(S); return; }
      if (S.phase === 'over') { if (hit.go && S.t > AGAIN) begin(S); return; }
      if (hit.meat) buy(S);
      if (hit.tip) tip(S);
      // the wanted kind changes, to another, every so often
      if (S.n - S.wanted.n >= WANT_FOR) S.wanted = { kind: (S.wanted.kind + 1 + Math.floor(rnd(S) * (KINDS - 1))) % KINDS, n: S.n };
      // on a still tray a jewel's gilding wears off when its time is up, and now and then another is gilded
      if (S.mode === 'still' && S.gilt.i >= 0 && S.n >= S.gilt.until) S.gilt = { i: -1, n: S.gilt.n, until: 0, got: S.gilt.got };
      else if (S.mode === 'still' && S.gilt.i < 0 && --S.gild <= 0) gild(S);
      // one thing asked for while the jewels are moving is kept until they are still
      for (const key of keys) if (key !== 'go' && key !== 'meat' && key !== 'tip') S.want = key;
      // the clock runs, and its last ten seconds are counted aloud; `shown` follows it without a jump, for the
      // picture, when a row puts time back
      const was = S.time;
      // How fast time is being won back, in steps a step, a mean over PACE steps: whatever the clock gained since
      // the last step's draining, which only rows and fire give it.
      S.pace += (Math.max(0, S.time - S.ran) - S.pace) / PACE;
      // the clock stands while The Mask is at his work
      if (o.clock !== false && S.mode !== 'mask') S.time = Math.max(0, S.time - drain(S.level));
      S.ran = S.time;
      S.shown += (S.time - S.shown) * 0.07;
      if (S.time > 0 && S.time < HZ * 10 && Math.ceil(S.time / HZ) !== Math.ceil(was / HZ)) say(S, 'tick', Math.ceil(S.time / HZ));
      // spy mode, when no row has been made for a while
      if (S.n >= S.spying) { S.spy = S.n; S.spying = S.n + SPY_FOR + SPY_AFTER; say(S, 'spy'); }
      // the townie's shout, when the clock is getting low or the next level is near, and no one else is up
      const low = S.time < CHEER_UNDER && S.time > CHEER_OVER, near = S.cheered !== S.level && S.into >= CHEER_NEAR * need(S.level);
      if (S.mode !== 'mask' && (low || near) && S.n > S.hush && S.n - S.cheer >= CHEER_REST) { S.cheer = S.n; S.hush = S.n + CHEER_UP; if (near) S.cheered = S.level; say(S, 'cheer'); }
      // out of time, once the jewels are still: a row made at the last moment may yet put some back
      if (S.mode === 'still' && S.time <= 0) { Object.assign(S, { phase: 'over', t: 0, sel: -1, want: '', why: 'time', shown: 0 }); say(S, 'over'); return; }
      if (S.mode === 'still' && S.due && S.n > S.hush) feed(S);
      else if (S.mode === 'mask') { if (++S.k >= MASK_LANDS) blast(S); }
      else if (S.mode === 'still') {
        if (S.want) { const key = S.want; S.want = ''; ask(S, key); }
        if (S.mode === 'still' && ++S.idle === HINT) { const m = moves(S.board); S.hint = m.length ? m[Math.floor(rnd(S) * m.length)][0] : -1; }
        if (S.mode === 'still' && S.idle >= ROLL && (S.idle - ROLL) % ROLL_AGAIN === 0 && S.n > S.hush) { S.roll = S.n; S.called = true; S.hush = S.n + ROLL_UP; say(S, 'roll'); }
        if (S.mode === 'still' && --S.shift <= 0) turn(S);
      } else if (S.mode === 'swap') {
        if (++S.k < SWAP) return;
        const b = S.board, t = b[S.a], mark = S.spec[S.a];
        b[S.a] = b[S.b]; b[S.b] = t;
        S.spec[S.a] = S.spec[S.b]; S.spec[S.b] = mark;
        if (S.born.i === S.a) S.born.i = S.b; else if (S.born.i === S.b) S.born.i = S.a;
        if (S.gilt.i === S.a) S.gilt.i = S.b; else if (S.gilt.i === S.b) S.gilt.i = S.a;
        if (S.back) { S.mode = 'still'; return; }
        if (b[S.a] === PEACOCK || b[S.b] === PEACOCK) { fan(S); return; }
        const found = rows(b);
        if (found.length) { S.chain = 1; score(S, found); }
        else { Object.assign(S, { back: 1, k: 0 }); say(S, 'no'); oops(S); }
      } else if (S.mode === 'clear') {
        if (++S.k >= CLEAR) settle(S);
      } else if (S.mode === 'fall') {
        const was = 0.5 * FALL * S.k * S.k, now = 0.5 * FALL * ++S.k * S.k;
        let far = 0, landed = 0;
        for (const d of S.drop) { far = Math.max(far, d); if (d > was && d <= now) landed++; }
        if (landed) say(S, 'land', landed);
        if (now < far) return;
        // how far each fell is kept a moment, for the picture to have them settle
        S.fell = { n: S.n, far, drop: S.drop.slice() };
        S.drop.fill(0);
        const found = rows(S.board);
        if (found.length) { S.chain++; score(S, found); return; }
        // a cascade long enough, come to rest, brings The Mask, at once or when the guest who is up has gone
        if (S.chain >= SPICY && S.n >= S.spice) S.due = true;
        Object.assign(S, { mode: 'still', chain: 0, idle: 0, rested: S.n });
        S.left = moves(S.board).length;
        if (S.due && S.n > S.hush) feed(S);
        else if (!S.left) { Object.assign(S, { phase: 'over', t: 0, sel: -1, want: '', why: 'moves' }); say(S, 'over'); }
      }
    }
    return { init, step };
  }
  // how far above its place a falling jewel is, in cells, k steps into a fall
  const above = (d, k) => Math.max(0, d - 0.5 * FALL * k * k);
  // what a game came to once it is over, for a page to post and a server to check by playing it again, or null
  // while one is going
  const result = S => (S.phase === 'over' ? { game: S.games, score: S.score, level: S.level } : null);
  return { create, result, rows, moves, beside, through, need, above, drain, N, CELLS, KINDS, PEACOCK, ACROSS, DOWN, BADGE, HZ, SWAP, CLEAR, FALL, HINT, AGAIN, WOW, WOW_GAP, TIME, BORAT, BORAT_IN, BORAT_UP, TOMMY_UP, HAPPY_UP, CHURCH_UP, PICARD_UP, VAL_UP, MASK_UP, MASK_LANDS, URKEL_UP, ROLL_UP, REDEEM_UP, CHEER_UP, SCHNIKES_UP, BLAST, BACK, MEAT_MIN, MEAT_REST, WANT_FOR, GILT_FOR, MARK, ALARM, ALARM_UP, TURNING, SPY_FOR };
});
