const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/pinball-engine.js');
function seeded(seed, run) {
  const original = Math.random;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  try { return run(); } finally { Math.random = original; }
}
function run(world, seconds = 120) {
  world.openGate();
  for (let i = 0; i < seconds * 60 && !world.over; i++) {
    world.step(1 / 60);
    for (const m of world.active) assert.ok(Number.isFinite(m.x + m.y + m.vx + m.vy));
  }
  assert.equal(world.active.length, 0, `${world.map.id}: all marbles must finish`);
  assert.equal(new Set(world.finished.map(m => m.id)).size, world.marbles.length);
  assert.ok(world.finished.every((m, i) => m.rank === i + 1));
}
for (const map of E.maps) {
  test(`${map.id}: final rotors leave the chute clear and every marble can finish`, () => {
    for (const seed of [19, 42, 203]) seeded(seed, () => {
      for (const count of [1, 18, 100, 300]) {
        const w = E.createWorld(E.parseEntries(`Marble*${count}`), { mapId: map.id, targetRank: count });
        const bars = w.map.statics.filter(s => s.finale);
        assert.equal(bars.length, 5);
        assert.ok(bars.some(s => s.omega > 0) && bars.some(s => s.omega < 0));
        for (const bar of bars) {
          assert.ok(bar.cy + bar.half + bar.t + E.consts.R < w.map.funnelY + 170);
          assert.ok(bar.cx - bar.half > E.consts.R);
          assert.ok(bar.cx + bar.half < E.consts.W - E.consts.R);
        }
        w.marbles.forEach((m, i) => {
          m.x = 26 + (i % 35) * 22;
          m.y = w.map.finaleY - 30 - Math.floor(i / 35) * 24;
          m.vy = 300;
          m.mass = [0.1, 1, 20][i % 3];
        });
        run(w);
        assert.equal(w.winner.id, w.finished[count - 1].id);
      }
    });
  });
  test(`${map.id}: full race still completes with ordered results`, () => seeded(426, () => {
    const w = E.createWorld(E.parseEntries('A*6,B*6,C*6'), { mapId: map.id, targetRank: 5 });
    run(w, 180);
    assert.equal(w.winner.id, w.finished[4].id);
  }));
}
test('moving final bars can bounce a leader upward and change the finish order', () => {
  function race(withBars) {
    return seeded(42, () => {
      const w = E.createWorld(E.parseEntries('Marble*30'), { mapId: 'classic' });
      if (!withBars) {
        w.map.statics = w.map.statics.filter(s => !s.finale);
        w.map.bands = w.map.bands.map(b => b.filter(s => !s.finale));
      }
      w.marbles.forEach((m, i) => {
        m.x = 40 + (i % 10) * 80;
        m.y = w.map.finaleY - 60 - Math.floor(i / 10) * 24;
        m.vy = 300;
      });
      w.openGate();
      let upward = false;
      for (let i = 0; i < 60 * 90 && !w.over; i++) {
        w.step(1 / 60);
        if (w.active.some(m => m.y > w.map.finaleY && m.vy < -100)) upward = true;
      }
      assert.equal(w.finished.length, 30);
      return { upward, order: w.finished.map(m => m.id) };
    });
  }
  const mixed = race(true), plain = race(false);
  assert.ok(mixed.upward);
  assert.notDeepEqual(mixed.order, plain.order);
});

test('both wall-side drop lanes actually hit a final rotor', () => {
  for (const x of [10, 790]) for (const vy of [300, 900]) seeded(42, () => {
    function make(withBars) {
      const w = E.createWorld(E.parseEntries('Side drop'), { mapId: 'classic' });
      Object.assign(w.marbles[0], { x, y: w.map.finaleY - 30, vx: 0, vy });
      if (!withBars) {
        w.map.statics = w.map.statics.filter(s => !s.finale);
        w.map.bands = w.map.bands.map(b => b.filter(s => !s.finale));
      }
      w.openGate();
      return w;
    }
    const mixed = make(true), plain = make(false);
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      mixed.step(1 / 60); plain.step(1 / 60);
      const a = mixed.marbles[0], b = plain.marbles[0];
      hit = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 0.001;
    }
    assert.ok(hit, `side x=${x}, fall speed=${vy} must reach a rotor`);
    run(mixed);
  });
});

test('marbles sliding along either funnel slope hit the added slope rotor', () => {
  for (const side of ['left', 'right']) seeded(42, () => {
    function make(withSlopeRotors) {
      const w = E.createWorld(E.parseEntries('Slope slide'), { mapId: 'classic' });
      Object.assign(w.marbles[0], {
        x: side === 'left' ? 225 : 575,
        y: w.map.funnelY + 225 * 170 / 365 - 14,
        vx: side === 'left' ? 300 : -300, vy: 140,
      });
      if (!withSlopeRotors) {
        const keep = s => !(s.finale && s.cy > w.map.funnelY);
        w.map.statics = w.map.statics.filter(keep);
        w.map.bands = w.map.bands.map(b => b.filter(keep));
      }
      w.openGate();
      return w;
    }
    const mixed = make(true), plain = make(false);
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      mixed.step(1 / 60); plain.step(1 / 60);
      const a = mixed.marbles[0], b = plain.marbles[0];
      hit = Math.hypot(a.x - b.x, a.y - b.y) > 0.001;
    }
    assert.ok(hit, `${side} slope must reach its rotor`);
    run(mixed);
  });
});

test('pachinko pins give a small kick without amplifying a fast impact', () => {
  const circles = E.buildMap('forest').statics.filter(s => s.x1 === s.x2 && s.y1 === s.y2);
  assert.ok(circles.length > 300);
  assert.ok(circles.every(s => s.bumper));
  for (const speed of [100, 500]) seeded(426, () => {
    const w = E.createWorld(E.parseEntries('Impact'), { mapId: 'forest' });
    Object.assign(w.marbles[0], { x: 35, y: 402.5, vx: 0, vy: speed });
    w.openGate();
    w.step(1 / 60);
    const rebound = -w.marbles[0].vy;
    if (speed === 100) assert.ok(rebound > 100 && rebound < 250);
    else assert.ok(rebound > 200 && rebound < speed);
  });
});

test('300 marbles complete the whole pachinko course with soft bumpers', () => seeded(426, () => {
  const w = E.createWorld(E.parseEntries('A*100,B/0.1*100,C/20*100'), { mapId: 'forest', targetRank: 300 });
  run(w, 180);
  assert.equal(w.winner.id, w.finished[299].id);
}));

test('classic uses all three lanes in both branching sections and 300 marbles finish', () => {
  for (const seed of [42, 426]) seeded(seed, () => {
    const w = E.createWorld(E.parseEntries('A*100,B/0.1*100,C/20*100'), { mapId: 'classic', targetRank: 300 });
    const lines = [1260, 3810];
    const seen = [new Set(), new Set()];
    const lanes = [new Set(), new Set()];
    w.openGate();
    for (let i = 0; i < 180 * 60 && !w.over; i++) {
      w.step(1 / 60);
      lines.forEach((y, section) => {
        for (const m of w.active) if (m.y > y && !seen[section].has(m.id)) {
          seen[section].add(m.id);
          lanes[section].add(Math.min(2, Math.floor(m.x / (w.map.W / 3))));
        }
      });
    }
    assert.equal(w.finished.length, 300, `seed ${seed}: all branch routes must drain`);
    assert.equal(w.winner.id, w.finished[299].id);
    assert.equal(lanes[0].size, 3, 'upper section uses left, middle and right paths');
    assert.equal(lanes[1].size, 3, 'lower section uses left, middle and right paths');
  });
});

test('a moving marble caught in a bumper orbit eventually escapes and finishes', () => seeded(426, () => {
  const w = E.createWorld(E.parseEntries('Orbit'), { mapId: 'classic' });
  Object.assign(w.marbles[0], {
    x: 775.2416335484827, y: 2916.310803817775,
    vx: -107.33357419284637, vy: 15.950984390642454, progressY: 2916.31,
  });
  for (const bar of w.map.statics) if (bar.moving) bar.angle += bar.omega * 188.2833333333753;
  run(w, 60);
}));
