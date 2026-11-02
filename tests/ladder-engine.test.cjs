const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/ladder-engine.js');

function randomFor(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
test('a known ladder follows every junction in order', () => {
  const ladder = { count: 4, rows: [[0, 2], [1], [0, 2]] };
  assert.deepEqual([0, 1, 2, 3].map(i => E.trace(ladder, i).finish), [3, 1, 2, 0]);
});
test('2–20 people always get one distinct destination and paths are reversible', () => {
  for (let count = 2; count <= 20; count++) for (let seed = 1; seed <= 100; seed++) {
    const ladder = E.create(count, randomFor(seed));
    const results = Array.from({ length: count }, (_, start) => E.trace(ladder, start));
    assert.deepEqual(results.map(r => r.finish).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
    for (const row of ladder.rows) for (let i = 0; i < row.length; i++) {
      assert.ok(row[i] >= 0 && row[i] < count - 1);
      if (i) assert.ok(row[i] - row[i - 1] >= 2, 'adjacent bridges must not meet at the same height');
    }
    const reverse = { count, rows: ladder.rows.slice().reverse() };
    results.forEach(result => assert.equal(E.trace(reverse, result.finish).finish, result.start));
  }
});
test('even a sparse random draw connects all neighboring lanes', () => {
  const ladder = E.create(20, () => 0.999);
  const edges = new Set(ladder.rows.flat());
  assert.equal(edges.size, 19);
  assert.equal(new Set(Array.from({ length: 20 }, (_, i) => E.trace(ladder, i).finish)).size, 20);
});
test('invalid counts and starting points are rejected', () => {
  for (const count of [0, 1, 21, 2.5, NaN]) assert.throws(() => E.create(count), RangeError);
  const ladder = E.create(3, randomFor(42));
  for (const start of [-1, 3, 1.5, NaN]) assert.throws(() => E.trace(ladder, start), RangeError);
});
