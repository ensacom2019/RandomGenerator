// 핀볼(마블 레이스) 물리 엔진 - 화면과 독립적으로 동작 (브라우저/Node 공용)
(function (root) {
  "use strict";

  const W = 800;            // 맵 너비 (모든 맵 공통)
  const GATE_Y = 330;       // 시작 게이트(바닥) 높이
  const R = 10;             // 구슬 반지름
  const GRAVITY = 1100;
  const MAXV = 1350;
  const SUB = 4;            // 프레임당 물리 서브스텝 수
  const BAND = 100;         // 충돌 후보 탐색용 높이 구간
  const FRICTION = 0.9992;  // 접촉 시 접선 속도 감쇠
  const MAX_MARBLES = 300;
  const CHUTE_L = 365, CHUTE_R = 435; // 결승 통로 좌우 벽 x

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

  // ---------- 맵 정의 ----------
  const MAPS = [
    {
      id: "classic",
      name: "클래식 (밸런스)",
      build(b) {
        // 1) 핀 지대
        for (let i = 0; i < 9; i++) {
          const y = 420 + i * 60;
          for (let x = i % 2 ? 80 : 40; x <= W - 30; x += 80) b.peg(x, y, 8);
        }
        // 2) 지그재그 경사로
        for (let k = 0; k < 7; k++) {
          const y = 1000 + k * 150;
          if (k % 2 === 0) b.seg(0, y, 700, y + 110);
          else b.seg(W, y, 100, y + 110);
        }
        // 3) 회전 막대
        [
          { y: 2250, xs: [100, 300, 500, 700], s: 1 },
          { y: 2500, xs: [200, 400, 600], s: -1 },
          { y: 2750, xs: [100, 300, 500, 700], s: 1 },
        ].forEach((row) => row.xs.forEach((x, i) => {
          b.spinner(x, row.y, 60, (i % 2 ? -1 : 1) * row.s * 2.2);
        }));
        // 4) 범퍼 지대
        for (let r = 0; r < 5; r++) {
          const y = 3000 + r * 90;
          const xs = r % 2 === 0 ? [70, 200, 330, 460, 590, 720] : [135, 265, 395, 525, 655];
          xs.forEach((x) => b.bumper(x, y, 24));
        }
        // 5) 두 번째 경사로
        for (let k = 0; k < 5; k++) {
          const y = 3550 + k * 150;
          if (k % 2 === 0) b.seg(0, y, 700, y + 110);
          else b.seg(W, y, 100, y + 110);
        }
        return 4350;
      },
    },
    {
      id: "forest",
      name: "핀 숲 (파칭코)",
      build(b) {
        // 수직 직하를 막기 위해 중간중간 꺾임 선반을 두고 핀 밀도를 높임
        let curY = 420;
        for (let section = 0; section < 4; section++) {
          // 핀 블록 (8줄)
          for (let r = 0; r < 8; r++) {
            const y = curY + r * 55;
            const offset = (r % 2 === 0) ? 35 : 65;
            for (let x = offset; x < W; x += 60) {
              if ((r + section) % 3 === 0 && (x > 200 && x < 600) && x % 120 === 0) {
                b.bumper(x, y, 16);
              } else {
                b.peg(x, y, 7);
              }
            }
          }
          curY += 8 * 55 + 20;

          // 완충 교차 선반 (구슬을 모아서 흘림)
          if (section % 2 === 0) {
            b.seg(0, curY, 640, curY + 130);
            b.seg(W, curY + 100, W - 70, curY + 120);
          } else {
            b.seg(W, curY, 160, curY + 130);
            b.seg(0, curY + 100, 70, curY + 120);
          }
          curY += 190;
        }
        return curY;
      },
    },
    {
      id: "spinner",
      name: "회전 지옥 (스피너)",
      build(b) {
        let curY = 440;
        for (let tier = 0; tier < 7; tier++) {
          // 스피너 배치 (한 줄 또는 두 줄)
          const isEven = tier % 2 === 0;
          const xs = isEven ? [120, 300, 500, 680] : [200, 400, 600];
          const speed = (1.8 + (tier % 3) * 0.5) * (isEven ? 1 : -1);
          xs.forEach((x, i) => {
            b.spinner(x, curY + 40, 70, speed * (i % 2 === 0 ? 1 : -1));
          });

          // 아래 받침 경사로: 구슬이 스피너와 부딪히지 않고 틈새로 그냥 추락하는 것을 방지
          const shelfY = curY + 140;
          if (isEven) {
            b.seg(0, shelfY, 320, shelfY + 80);
            b.seg(W, shelfY, W - 320, shelfY + 80);
            b.bumper(400, shelfY + 100, 22);
          } else {
            b.seg(W * 0.25, shelfY + 80, W * 0.75, shelfY + 80);
            b.bumper(120, shelfY + 60, 20);
            b.bumper(W - 120, shelfY + 60, 20);
          }
          curY += 270;
        }
        return curY + 50;
      },
    },
    {
      id: "funnel",
      name: "다단 깔때기 (슬라이드)",
      build(b) {
        // 넓은 슬라이드와 좁은 깔때기 병목을 반복
        let curY = 440;
        for (let stage = 0; stage < 7; stage++) {
          // 깔때기 구조: 위는 넓고 아래는 좁음
          const chokeX = (stage % 2 === 0) ? 550 : 250;
          const chokeY = curY + 280;

          // 깔때기 벽
          b.seg(0, curY, chokeX - 45, chokeY);
          b.seg(W, curY, chokeX + 45, chokeY);

          // 병목 통로 바로 아래에 튕김 범퍼 배치
          b.bumper(chokeX, chokeY + 70, 20);

          // 옆으로 퍼져 나가도록 분산 핀
          b.peg(chokeX - 90, chokeY + 110, 8);
          b.peg(chokeX + 90, chokeY + 110, 8);

          curY += 380;
        }
        return curY;
      },
    },
    {
      id: "chaos",
      name: "익스트림 바운스 (카오스)",
      build(b) {
        let curY = 420;

        // 1구역: 오프닝 슈퍼 바운스 & 점프대 (시작부터 폭발적으로 사방으로 튕겨 날아감)
        b.seg(0, curY + 60, 240, curY + 140);
        b.seg(W, curY + 60, W - 240, curY + 140);
        b.superBumper(400, curY + 130, 32, 920);
        b.superBumper(260, curY + 210, 24, 860);
        b.superBumper(540, curY + 210, 24, 860);
        curY += 300;

        // 2구역: 고속 4연속 트윈 해머 (Fast Spinners) - 닿는 구슬을 허공과 벽으로 맹렬하게 날려버림
        b.bounceWall(0, curY, 70, curY + 220, 850);
        b.bounceWall(W, curY, W - 70, curY + 220, 850);
        b.fastSpinner(250, curY + 80, 75, 4.6);
        b.fastSpinner(550, curY + 80, 75, -4.6);
        b.fastSpinner(400, curY + 230, 85, 4.8);
        b.superBumper(170, curY + 220, 24, 880);
        b.superBumper(630, curY + 220, 24, 880);
        curY += 360;

        // 3구역: 핀볼 팝 범퍼 클러스터 (지그재그 14개 슈퍼 범퍼의 핑퐁 연속 반사)
        for (let r = 0; r < 4; r++) {
          const y = curY + r * 90;
          const isEven = r % 2 === 0;
          const xs = isEven ? [140, 310, 490, 660] : [220, 400, 580];
          xs.forEach((x) => b.superBumper(x, y, 22, 880));
          // 벽면 반사 패드
          b.bounceWall(0, y - 20, 45, y + 40, 820);
          b.bounceWall(W, y - 20, W - 45, y + 40, 820);
        }
        curY += 4 * 90 + 40;

        // 4구역: 고속 점프 런치 램프 (슬라이딩 후 공중으로 날아올라 슈퍼 범퍼에 다이빙)
        b.seg(0, curY, 520, curY + 120);
        b.superBumper(580, curY + 100, 28, 950);
        curY += 190;
        b.seg(W, curY, 280, curY + 120);
        b.superBumper(220, curY + 100, 28, 950);
        curY += 210;

        // 5구역: 파이널 카오스 휠 & 메가 범퍼 (골인 직전 대역전극)
        b.fastSpinner(220, curY + 80, 70, -5.2);
        b.fastSpinner(580, curY + 80, 70, 5.2);
        b.superBumper(400, curY + 110, 32, 980);
        b.superBumper(290, curY + 230, 22, 880);
        b.superBumper(510, curY + 230, 22, 880);
        curY += 330;

        return curY;
      },
    },
  ];

  function buildMap(mapId) {
    const def = MAPS.find((m) => m.id === mapId) || MAPS[0];
    const statics = [];
    const add = (o) => { statics.push(o); return o; };
    const b = {
      seg: (x1, y1, x2, y2) => add({ x1, y1, x2, y2, t: 2, e: 0.35 }),
      peg: (x, y, r) => add({ x1: x, y1: y, x2: x, y2: y, t: r, e: 0.45 }),
      bumper: (x, y, r, force) => add({
        x1: x, y1: y, x2: x, y2: y, t: r, e: 1.25, bumper: true, force: force || 440
      }),
      superBumper: (x, y, r, force) => add({
        x1: x, y1: y, x2: x, y2: y, t: r, e: 1.6, bumper: true, super: true, force: force || 880
      }),
      spinner: (cx, cy, half, omega) => add({
        x1: cx - half, y1: cy, x2: cx + half, y2: cy, t: 5, e: 0.5,
        moving: true, cx, cy, half, omega, angle: 0,
      }),
      fastSpinner: (cx, cy, half, omega) => add({
        x1: cx - half, y1: cy, x2: cx + half, y2: cy, t: 6, e: 0.85,
        moving: true, fast: true, cx, cy, half, omega, angle: 0,
      }),
      bounceWall: (x1, y1, x2, y2, force) => add({
        x1, y1, x2, y2, t: 4, e: 1.5, bumper: true, super: true, force: force || 800
      }),
    };

    const fy = def.build(b);       // 결승 깔때기 시작 y
    const H = fy + 400;
    const FINISH_Y = fy + 270;
    // 결승 깔때기 + 통로
    b.seg(0, fy, CHUTE_L, fy + 170);
    b.seg(W, fy, CHUTE_R, fy + 170);
    b.seg(CHUTE_L, fy + 170, CHUTE_L, H);
    b.seg(CHUTE_R, fy + 170, CHUTE_R, H);

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
      for (let k = b0; k <= b1; k++) bands[k].push(s);
    });

    return {
      id: def.id, name: def.name,
      W, H, GATE_Y, FINISH_Y,
      chuteL: CHUTE_L, chuteR: CHUTE_R,
      statics, gate, bands,
    };
  }

  // ---------- 월드 ----------
  function createWorld(list, opts) {
    opts = opts || {};
    const map = buildMap(opts.mapId);
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
      targetRank: 1,
      openGate() { world.gateOpen = true; },
      setTarget,
      step,
      ranking,
    };
    setTarget(opts.targetRank || 1);

    function setTarget(rank) {
      world.targetRank = Math.max(1, Math.min(Math.max(1, marbles.length), Math.floor(rank) || 1));
      if (!world.winner && world.finished.length >= world.targetRank) {
        world.winner = world.finished[world.targetRank - 1];
      }
    }

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
        vx: 0, vy: 0, slow: 0,
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
      if (-vn < 30) e = 0; // 떨림 방지
      let out = -e * vn;
      if (s.bumper && -vn > 15) {
        const minForce = s.force || (s.super ? 850 : 440);
        if (out < minForce) out = minForce;
      }
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

      // 정체 방지: 멈춰 있는 구슬 털어주기
      if (world.gateOpen) {
        for (let i = 0; i < world.active.length; i++) {
          const m = world.active[i];
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
      const arrived = world.active.filter((m) => m.y > map.FINISH_Y);
      if (arrived.length) {
        arrived.sort((a, b) => b.y - a.y);
        arrived.forEach((m) => {
          m.finished = true;
          m.finishTime = world.time;
          world.finished.push(m);
          m.rank = world.finished.length;
          if (!world.winner && m.rank >= world.targetRank) {
            world.winner = m;
          }
        });
        world.active = world.active.filter((m) => !m.finished);
        if (world.active.length === 0) {
          world.over = true; // 모든 구슬 통과 완료!
        }
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
    maps: MAPS.map((m) => ({ id: m.id, name: m.name })),
    consts: { W, GATE_Y, R, MAX_MARBLES },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PinballEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
