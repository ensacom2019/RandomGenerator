// 핀볼 탭: 구슬이 맵을 굴러 내려가는 뽑기 핀볼 (물리 엔진은 pinball-engine.js)
(() => {
  "use strict";

  const E = PinballEngine;
  const STORAGE_KEY = "pinball_state_v1";
  const VW = 1040, VH = 640;          // 캔버스 크기
  const OFFX = (VW - E.consts.W) / 2; // 맵 가로 오프셋
  const MAP_W = E.consts.W, MAP_H = E.consts.H, FINISH_Y = E.consts.FINISH_Y;
  const STEP = 1 / 60;

  const DEFAULT_STATE = { text: "짱구*5, 짱아*10, 흰둥이*3", rank: 1, skills: true };

  // ---------- DOM ----------
  const panel = document.getElementById("panel-pinball");
  panel.innerHTML = `
    <div class="pb-stage"><canvas id="pbCanvas" width="${VW}" height="${VH}"></canvas></div>
    <div class="pb-panel">
      <div class="pb-help">
        이름 뒤에 <b>/숫자</b>를 붙이면 구슬의 질량(충돌 시 밀어내는 힘)을 정할 수 있습니다. (예: 철수/2, 영희/5)<br>
        이름 뒤에 <b>*숫자</b>를 붙이면 그 이름의 구슬 개수를 정할 수 있습니다. (예: 철수*2, 영희*5)<br>
        쉼표(,) 또는 줄바꿈으로 구분합니다. 최대 ${E.consts.MAX_MARBLES}개.
      </div>
      <textarea id="pbInput" spellcheck="false"></textarea>
      <div class="pb-row">
        <label>당첨 순위 #
          <input type="number" id="pbRank" min="1" value="1">
        </label>
        <button id="pbRandom" class="pb-btn">랜덤 당첨 순위</button>
        <label class="pb-check"><input type="checkbox" id="pbSkills"> 스킬 사용</label>
        <span class="pb-spacer"></span>
        <button id="pbStop" class="pb-btn">정지</button>
        <button id="pbStart" class="pb-btn">시작</button>
        <button id="pbShuffle" class="pb-btn">셔플</button>
      </div>
    </div>`;

  const canvas = document.getElementById("pbCanvas");
  const ctx = canvas.getContext("2d");
  const inputEl = document.getElementById("pbInput");
  const rankEl = document.getElementById("pbRank");
  const skillsEl = document.getElementById("pbSkills");
  const btnStart = document.getElementById("pbStart");
  const btnStop = document.getElementById("pbStop");
  const btnShuffle = document.getElementById("pbShuffle");
  const btnRandom = document.getElementById("pbRandom");

  // ---------- 상태 ----------
  let state = "ready";   // ready | running | paused | finished
  let world = null;
  let camY = 0;
  let visible = false;
  let acc = 0, lastTs = 0;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, DEFAULT_STATE, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return Object.assign({}, DEFAULT_STATE);
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        text: inputEl.value, rank: Number(rankEl.value) || 1, skills: skillsEl.checked,
      }));
    } catch (e) { /* ignore */ }
  }

  const init = loadState();
  inputEl.value = init.text;
  rankEl.value = init.rank;
  skillsEl.checked = init.skills;

  function colorOf(group, light) {
    const hue = (group * 137.5) % 360;
    return `hsl(${hue}, 90%, ${light || 68}%)`;
  }

  // ---------- 게임 제어 ----------
  function reset() {
    const list = E.parseEntries(inputEl.value);
    const n = list.length;
    rankEl.max = Math.max(1, n);
    let rank = Math.floor(Number(rankEl.value)) || 1;
    rank = Math.max(1, Math.min(Math.max(1, n), rank));
    rankEl.value = rank;
    world = E.createWorld(list, { targetRank: rank, skills: skillsEl.checked });
    state = "ready";
    camY = 0;
    acc = 0;
    updateButtons();
    saveState();
  }

  function updateButtons() {
    const hasMarbles = world && world.marbles.length > 0;
    btnStart.disabled = !hasMarbles || state === "running";
    btnStop.disabled = !(state === "running" || state === "paused");
    btnStop.textContent = state === "paused" ? "재개" : "정지";
    btnShuffle.disabled = false;
    // 진행 중에는 입력 변경 잠금 (당첨 순위/스킬은 허용)
    inputEl.disabled = state === "running" || state === "paused";
  }

  btnStart.addEventListener("click", () => {
    if (!world || world.marbles.length === 0) return;
    if (state === "finished") reset();
    if (state === "ready") world.openGate();
    state = "running";
    updateButtons();
  });

  btnStop.addEventListener("click", () => {
    if (state === "running") state = "paused";
    else if (state === "paused") state = "running";
    updateButtons();
  });

  btnShuffle.addEventListener("click", () => reset());

  btnRandom.addEventListener("click", () => {
    const n = world ? world.marbles.length : 1;
    rankEl.value = 1 + Math.floor(Math.random() * Math.max(1, n));
    applyRank();
  });

  function applyRank() {
    if (!world) return;
    let rank = Math.floor(Number(rankEl.value)) || 1;
    rank = Math.max(1, Math.min(Math.max(1, world.marbles.length), rank));
    rankEl.value = rank;
    if (!world.over) world.targetRank = rank;
    saveState();
  }
  rankEl.addEventListener("change", applyRank);

  skillsEl.addEventListener("change", () => {
    if (world) world.skills = skillsEl.checked;
    saveState();
  });

  let debounce = null;
  inputEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(reset, 300);
  });

  // ---------- 루프 ----------
  function updateCamera(dt) {
    let target = 0;
    if (state !== "ready") {
      let lead = 0;
      for (const m of world.active) if (m.y > lead) lead = m.y;
      if (world.active.length === 0) lead = FINISH_Y;
      target = lead - VH * 0.45;
    }
    target = Math.max(0, Math.min(MAP_H - VH, target));
    camY += (target - camY) * Math.min(1, dt * 4);
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!visible) { lastTs = ts; return; }
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
    lastTs = ts;

    if (state === "running") {
      acc += dt;
      while (acc >= STEP) { world.step(STEP); acc -= STEP; }
      if (world.over) { state = "finished"; updateButtons(); }
    }
    if (world) updateCamera(dt);
    draw();
  }

  // ---------- 그리기 ----------
  function glowLine(x1, y1, x2, y2, w) {
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = "rgba(0, 200, 255, 0.28)";
    ctx.lineWidth = w + 7;
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = w;
    ctx.stroke();
  }

  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, VW, VH);
    if (!world) return;
    const map = world.map;

    ctx.save();
    ctx.translate(OFFX, -camY);
    ctx.lineCap = "round";

    // 좌우 벽
    glowLine(0, camY - 10, 0, camY + VH + 10, 3);
    glowLine(MAP_W, camY - 10, MAP_W, camY + VH + 10, 3);

    // 구조물
    for (const s of map.statics) {
      if (s.gate && world.gateOpen) continue;
      if (s.y1e < camY - 40 || s.y0 > camY + VH + 40) continue;
      if (s.moving) {
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
        ctx.strokeStyle = "rgba(255, 120, 60, 0.35)";
        ctx.lineWidth = s.t * 2 + 6; ctx.stroke();
        ctx.strokeStyle = "#ffb070";
        ctx.lineWidth = s.t * 2; ctx.stroke();
      } else if (s.x1 === s.x2 && s.y1 === s.y2) {
        ctx.beginPath();
        ctx.arc(s.x1, s.y1, s.t, 0, Math.PI * 2);
        if (s.bumper) {
          ctx.fillStyle = "#ff4fa0"; ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.stroke();
        } else {
          ctx.fillStyle = "#fff"; ctx.fill();
        }
      } else {
        glowLine(s.x1, s.y1, s.x2, s.y2, s.gate ? 4 : 3);
      }
    }

    // 결승선
    if (FINISH_Y > camY - 40 && FINISH_Y < camY + VH + 40) {
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(365, FINISH_Y); ctx.lineTo(435, FINISH_Y);
      ctx.strokeStyle = "#ffe14d"; ctx.lineWidth = 4; ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffe14d";
      ctx.fillText("FINISH", 445, FINISH_Y + 5);
    }

    // 구슬
    const ranks = world.ranking();
    const showAllNames = world.marbles.length <= 80;
    const topIds = new Set(ranks.slice(0, 8).map((m) => m.id));
    ctx.textAlign = "center";
    ctx.font = "bold 13px 'Malgun Gothic', sans-serif";
    ctx.lineJoin = "round";
    for (const m of world.active) {
      if (m.y < camY - 30 || m.y > camY + VH + 30) continue;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(m.group, 78);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = m.glow > 0 ? "#ffee55" : colorOf(m.group, 45);
      ctx.stroke();
      if (m.glow > 0) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,238,85,.5)";
        ctx.lineWidth = 3; ctx.stroke();
      }
      if (showAllNames || topIds.has(m.id)) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#000";
        ctx.strokeText(m.name, m.x, m.y - m.r - 5);
        ctx.fillStyle = colorOf(m.group, 70);
        ctx.fillText(m.name, m.x, m.y - m.r - 5);
      }
    }
    ctx.restore();

    drawMinimap(map);
    drawRanking(ranks);

    if (state === "ready" && world.marbles.length === 0) {
      centerText("이름을 입력하세요", "#888");
    }
    if (state === "paused") centerText("일시정지", "rgba(255,255,255,.85)");
    if (world.over && world.winner) drawWinner(world.winner);
  }

  function centerText(text, color) {
    ctx.font = "bold 40px 'Malgun Gothic', sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 6; ctx.strokeStyle = "#000";
    ctx.strokeText(text, VW / 2, VH / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, VW / 2, VH / 2);
  }

  function drawMinimap(map) {
    const ms = (VH - 16) / MAP_H;
    const x0 = 8, y0 = 8;
    ctx.fillStyle = "rgba(60,60,60,.85)";
    ctx.fillRect(x0, y0, MAP_W * ms, MAP_H * ms);
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const s of map.statics) {
      if (s.gate && world.gateOpen) continue;
      if (s.x1 === s.x2 && s.y1 === s.y2) {
        ctx.moveTo(x0 + s.x1 * ms + s.t * ms, y0 + s.y1 * ms);
        ctx.arc(x0 + s.x1 * ms, y0 + s.y1 * ms, Math.max(0.8, s.t * ms), 0, Math.PI * 2);
      } else {
        ctx.moveTo(x0 + s.x1 * ms, y0 + s.y1 * ms);
        ctx.lineTo(x0 + s.x2 * ms, y0 + s.y2 * ms);
      }
    }
    ctx.stroke();
    for (const m of world.active) {
      ctx.fillStyle = colorOf(m.group, 65);
      ctx.fillRect(x0 + m.x * ms - 1, y0 + m.y * ms - 1, 2.5, 2.5);
    }
    ctx.strokeStyle = "#ffe14d";
    ctx.strokeRect(x0, y0 + camY * ms, MAP_W * ms, VH * ms);
  }

  function drawRanking(ranks) {
    const lineH = 22;
    const maxLines = Math.min(ranks.length, Math.floor((VH - 20) / lineH));
    ctx.font = "bold 18px 'Malgun Gothic', sans-serif";
    ctx.textAlign = "right";
    ctx.lineJoin = "round";
    for (let i = 0; i < maxLines; i++) {
      const m = ranks[i];
      const isTarget = i + 1 === world.targetRank;
      const label = `${isTarget ? "☆ " : ""}${m.name} #${i + 1}`;
      const y = 24 + i * lineH;
      ctx.lineWidth = 4; ctx.strokeStyle = "#000";
      ctx.strokeText(label, VW - 10, y);
      ctx.fillStyle = colorOf(m.group, 68);
      ctx.fillText(label, VW - 10, y);
    }
    if (ranks.length > maxLines) {
      ctx.fillStyle = "#aaa";
      ctx.font = "14px sans-serif";
      ctx.fillText(`… 외 ${ranks.length - maxLines}개`, VW - 10, 24 + maxLines * lineH);
    }
  }

  function drawWinner(m) {
    ctx.textAlign = "right";
    ctx.lineJoin = "round";
    ctx.font = "bold 80px 'Malgun Gothic', sans-serif";
    ctx.lineWidth = 10; ctx.strokeStyle = "#000";
    ctx.strokeText("Winner", VW - 30, VH - 150);
    ctx.fillStyle = "#fff";
    ctx.fillText("Winner", VW - 30, VH - 150);

    ctx.font = "bold 96px 'Malgun Gothic', sans-serif";
    ctx.lineWidth = 12;
    ctx.strokeText(m.name, VW - 30, VH - 50, 560);
    ctx.fillStyle = colorOf(m.group, 62);
    ctx.fillText(m.name, VW - 30, VH - 50, 560);
  }

  // ---------- 탭 등록 ----------
  TabManager.register({
    id: "pinball",
    label: "핀볼",
    onShow() { visible = true; },
    onHide() { visible = false; if (state === "running") { state = "paused"; updateButtons(); } },
  });

  reset();
  requestAnimationFrame(loop);
})();
