// 핀볼(마블 레이스) 물리 엔진 - 화면과 독립적으로 동작 (브라우저/Node 공용)
(function (root) {
  "use strict";

  const W = 800;            // 맵 너비
  const H = 4750;           // 맵 높이
  const GATE_Y = 330;       // 시작 게이트(바닥) 높이
  const FINISH_Y = 4620;    // 결승선
  const R = 10;             // 구슬 반지름
  const GRAVITY = 1100;
  const MAXV = 1100;
  const SUB = 4;            // 프레임당 물리 서브스텝 수
  const BAND = 100;         // 충돌 후보 탐색용 높이 구간
  const FRICTION = 0.9992;  // 접촉 시 접선 속도 감쇠
  const MAX_MARBLES = 300;

  // ---------- 입력 파싱: "이름/질량*개수, 이름2*3" ----------
  function parseEntries(text) {
    const out = [];
    const names = [];
    String(text || "").split(/[,\n]/).forEach((tok) => {
      let s = tok.trim();
      if (!s) return;
      let weight = 1, count = 1;
      for (let k = 0; k < 2; k++) {
        const m = s.match(/([\/*])\s*(\d+(?:\.\d+)?)\s*$/);
        if (!m) break;
        if (m[1] === "/") weight = Math.min(20, Math.max(0.1, parseFloat(m[2])));
        else count = Math.max(1, Math.floor(parseFloat(m[2])));
        s = s.slice(0, m.index).trim();
      }
      if (!s) return;
      let gi = names.indexOf(s);
      if (gi < 0) { names.push(s); gi = names.length - 1; }
      for (let i = 0; i < count && out.length < MAX_MARBLES; i++) {
        out.push({ name: s, weight, group: gi });
      }
    });
    return out;
  }

  // ---------- 맵 ----------
  function buildMap() {
    const statics = [];
    const add = (o) => { statics.push(o); return o; };
    const seg = (x1, y1, x2, y2) => add({ x1, y1, x2, y2, t: 2, e: 0.35 });
    const peg = (x, y, r) => add({ x1: x, y1: y, x2: x, y2: y, t: r, e: 0.45 });
    const bumper = (x, y, r) => add({ x1: x, y1: y, x2: x, y2: y, t: r, e: 1.1, bumper: true });
    const spinner = (cx, cy, half, omega) => add({
      x1: cx - half, y1: cy, x2: cx + half, y2: cy, t: 5, e: 0.5,
      moving: true, cx, cy, half, omega, angle: 0,
    });

    // 1) 핀 지대
    for (let i = 0; i < 9; i++) {
      const y = 420 + i * 60;
      for (let x = i % 2 ? 80 : 40; x <= W - 30; x += 80) peg(x, y, 8);
    }
    // 2) 지그재그 경사로 (한쪽에 구멍)
    for (let k = 0; k < 7; k++) {
      const y = 1000 + k * 150;
      if (k % 2 === 0) seg(0, y, 700, y + 110);
      else seg(W, y, 100, y + 110);
    }
    // 3) 회전 막대
    const rows = [
      { y: 2250, xs: [100, 300, 500, 700], s: 1 },
      { y: 2500, xs: [200, 400, 600], s: -1 },
      { y: 2750, xs: [100, 300, 500, 700], s: 1 },
    ];
    rows.forEach((row) => row.xs.forEach((x, i) => {
      spinner(x, row.y, 60, (i % 2 ? -1 : 1) * row.s * 2.2);
    }));
    // 4) 범퍼 지대
    for (let r = 0; r < 5; r++) {
      const y = 3000 + r * 90;
      const xs = r % 2 === 0 ? [70, 200, 330, 460, 590, 720] : [135, 265, 395, 525, 655];
      xs.forEach((x) => bumper(x, y, 24));
    }
    // 5) 두 번째 경사로
    for (let k = 0; k < 5; k++) {
      const y = 3550 + k * 150;
      if (k % 2 === 0) seg(0, y, 700, y + 110);
      else seg(W, y, 100, y + 110);
    }
    // 6) 깔때기 + 결승 통로
    seg(0, 4350, 365, 4520);
    seg(W, 4350, 435, 4520);
    seg(365, 4520, 365, H);
    seg(435, 4520, 435, H);

    const gate = { x1: 0, y1: GATE_Y, x2: W, y2: GATE_Y, t: 2, e: 0.2, gate: true };
    statics.push(gate);

    // 높이 구간별 버킷 (충돌 후보 축소)
    const bands = [];
    for (let i = 0; i <= Math.ceil(H / BAND) + 1; i++) bands.push([]);
    statics.forEach((s) => {
      let lo, hi;
      if (s.moving) { lo = s.cy - s.half - s.t; hi = s.cy + s.half + s.t; }
      else { lo = Math.min(s.y1, s.y2) - s.t; hi = Math.max(s.y1, s.y2) + s.t; }
      s.y0 = lo; s.y1e = hi;
      const b0 = Math.max(0, Math.floor((lo - R) / BAND));
      const b1 = Math.min(bands.length - 1, Math.floor((hi + R) / BAND));
      for (let b = b0; b <= b1; b++) bands[b].push(s);
    });

    return { W, H, GATE_Y, FINISH_Y, statics, gate, bands };
  }

  // ---------- 월드 ----------
  function createWorld(list, opts) {
    opts = opts || {};
    const map = buildMap();
    const marbles = layout(list);
    const world = {
      map,
      marbles,
      active: marbles.slice(),
      finished: [],
      time: 0,
      gateOpen: false,
      over: false,
      winner: null,
      skills: !!opts.skills,
      targetRank: Math.max(1, Math.min(marbles.length, opts.targetRank || 1)),
      openGate() { world.gateOpen = true; },
      step,
      ranking,
    };

    function layout(items) {
      const cols = 35, gap = 22;
      const rows = Math.max(1, Math.ceil(items.length / cols));
      const slots = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push([c, r]);
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      const x0 = (W - (cols - 1) * gap) / 2;
      return items.map((it, i) => ({
        id: i, name: it.name, group: it.group,
        mass: it.weight, r: R,
        x: x0 + slots[i][0] * gap + (Math.random() - 0.5) * 2,
        y: GATE_Y - R - 2 - slots[i][1] * gap,
        vx: 0, vy: 0, glow: 0, slow: 0,
        finished: false, rank: 0, finishTime: 0,
      }));
    }

    function collideStatic(m, s) {
      const abx = s.x2 - s.x1, aby = s.y2 - s.y1;
      const len2 = abx * abx + aby * aby;
      let t = 0;
      if (len2 > 0) {
        t = ((m.x - s.x1) * abx + (m.y - s.y1) * aby) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
      }
      const px = s.x1 + abx * t, py = s.y1 + aby * t;
      let dx = m.x - px, dy = m.y - py;
      const rr = m.r + s.t;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) return;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 1e-6) {
        if (len2 > 0) { const l = Math.sqrt(len2); nx = -aby / l; ny = abx / l; }
        else { nx = 0; ny = -1; }
        d = 0;
      } else { nx = dx / d; ny = dy / d; }
      const pen = rr - d;
      m.x += nx * pen;
      m.y += ny * pen;

      let vsx = 0, vsy = 0;
      if (s.moving) { vsx = -s.omega * (py - s.cy); vsy = s.omega * (px - s.cx); }
      const rvx = m.vx - vsx, rvy = m.vy - vsy;
      const vn = rvx * nx + rvy * ny;
      if (vn >= 0) return;
      let e = s.e;
      if (-vn < 30) e = 0; // 느린 접촉은 튕기지 않게 (떨림 방지)
      let out = -e * vn;
      if (s.bumper && -vn > 20 && out < 420) out = 420;
      const tx = rvx - vn * nx, ty = rvy - vn * ny;
      m.vx = vsx + tx * FRICTION + nx * out;
      m.vy = vsy + ty * FRICTION + ny * out;
    }

    function substep(h) {
      const act = world.active;
      const bars = map.statics;
      for (let i = 0; i < bars.length; i++) {
        const s = bars[i];
        if (!s.moving) continue;
        s.angle += s.omega * h;
        const c = Math.cos(s.angle) * s.half, sn = Math.sin(s.angle) * s.half;
        s.x1 = s.cx - c; s.y1 = s.cy - sn;
        s.x2 = s.cx + c; s.y2 = s.cy + sn;
      }

      for (let i = 0; i < act.length; i++) {
        const m = act[i];
        m.vy += GRAVITY * h;
        const sp2 = m.vx * m.vx + m.vy * m.vy;
        if (sp2 > MAXV * MAXV) {
          const k = MAXV / Math.sqrt(sp2);
          m.vx *= k; m.vy *= k;
        }
        m.x += m.vx * h;
        m.y += m.vy * h;
      }

      for (let i = 0; i < act.length; i++) {
        const m = act[i];
        const b = Math.floor(m.y / BAND);
        if (b < 0 || b >= map.bands.length) continue;
        const list = map.bands[b];
        for (let k = 0; k < list.length; k++) {
          const s = list[k];
          if (s.gate && world.gateOpen) continue;
          collideStatic(m, s);
        }
      }

      act.sort((a, b) => a.y - b.y);
      const D = R * 2, D2 = D * D;
      for (let i = 0; i < act.length; i++) {
        const a = act[i];
        for (let j = i + 1; j < act.length; j++) {
          const b = act[j];
          const dy = b.y - a.y;
          if (dy >= D) break;
          const dx = b.x - a.x;
          const d2 = dx * dx + dy * dy;
          if (d2 >= D2) continue;
          let d = Math.sqrt(d2), nx, ny;
          if (d < 1e-6) { nx = 1; ny = 0; d = 0; } else { nx = dx / d; ny = dy / d; }
          const ia = 1 / a.mass, ib = 1 / b.mass, is = ia + ib;
          const pen = D - d;
          a.x -= nx * pen * ia / is; a.y -= ny * pen * ia / is;
          b.x += nx * pen * ib / is; b.y += ny * pen * ib / is;
          const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rvn < 0) {
            const e = -rvn < 30 ? 0 : 0.3;
            const j2 = -(1 + e) * rvn / is;
            a.vx -= j2 * ia * nx; a.vy -= j2 * ia * ny;
            b.vx += j2 * ib * nx; b.vy += j2 * ib * ny;
          }
        }
      }

      // 좌우 벽
      for (let i = 0; i < act.length; i++) {
        const m = act[i];
        if (m.x < R) { m.x = R; if (m.vx < 0) m.vx = -m.vx * 0.4; }
        else if (m.x > W - R) { m.x = W - R; if (m.vx > 0) m.vx = -m.vx * 0.4; }
      }
    }

    function step(dt) {
      if (world.over) return;
      world.time += dt;

      // 스킬(랜덤 가속) + 정체 방지
      for (let i = 0; i < world.active.length; i++) {
        const m = world.active[i];
        if (m.glow > 0) m.glow -= dt;
        if (world.skills && m.glow <= 0 && Math.random() < dt * 0.05) {
          m.vy += 500;
          m.vx += (Math.random() - 0.5) * 300;
          m.glow = 0.7;
        }
        if (world.gateOpen) {
          if (m.vx * m.vx + m.vy * m.vy < 400) m.slow += dt; else m.slow = 0;
          if (m.slow > 1.2) {
            m.vx += (Math.random() - 0.5) * 500;
            m.vy -= 250;
            m.slow = 0;
          }
        }
      }

      const h = dt / SUB;
      for (let s = 0; s < SUB; s++) substep(h);

      // 결승 판정
      const arrived = world.active.filter((m) => m.y > FINISH_Y);
      if (arrived.length) {
        arrived.sort((a, b) => b.y - a.y);
        arrived.forEach((m) => {
          m.finished = true;
          m.finishTime = world.time;
          world.finished.push(m);
          m.rank = world.finished.length;
          if (!world.over && m.rank >= world.targetRank) {
            world.over = true;
            world.winner = m;
          }
        });
        world.active = world.active.filter((m) => !m.finished);
      }
    }

    function ranking() {
      const rest = world.active.slice().sort((a, b) => b.y - a.y);
      return world.finished.concat(rest);
    }

    return world;
  }

  const api = {
    parseEntries, buildMap, createWorld,
    consts: { W, H, GATE_Y, FINISH_Y, R, MAX_MARBLES },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PinballEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
