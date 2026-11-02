// Each row is a set of disjoint adjacent swaps, so the whole ladder is a permutation.
(function (root) {
  "use strict";

  function create(count, random = Math.random) {
    if (!Number.isInteger(count) || count < 2 || count > 20) {
      throw new RangeError("참가자는 2~20명이어야 합니다.");
    }
    const rows = [];
    const used = new Set();
    for (let r = 0; r < Math.max(16, count * 3); r++) {
      const row = [];
      for (let lane = 0; lane < count - 1;) {
        if (random() < 0.45) {
          row.push(lane);
          used.add(lane);
          lane += 2;
        } else lane++;
      }
      rows.push(row);
    }
    // Every neighboring pair has a connection, even with an unusually sparse draw.
    for (let lane = 0; lane < count - 1; lane++) {
      if (!used.has(lane)) rows.push([lane]);
    }
    return { count, rows };
  }

  function trace(ladder, start) {
    if (!Number.isInteger(start) || start < 0 || start >= ladder.count) {
      throw new RangeError("잘못된 참가자 번호입니다.");
    }
    let lane = start;
    const steps = ladder.rows.map((row, index) => {
      const from = lane;
      if (row.includes(lane)) lane++;
      else if (row.includes(lane - 1)) lane--;
      return { row: index, from, to: lane };
    });
    return { start, finish: lane, steps };
  }

  const api = { create, trace };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LadderEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
