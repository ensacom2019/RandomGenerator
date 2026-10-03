// 핀볼 탭: 구슬이 맵을 굴러 내려가는 뽑기 핀볼 (물리 엔진은 pinball-engine.js)
(() => {
  "use strict";

  const E = PinballEngine;
  const STORAGE_KEY = "pinball_state_v2";
  const VW = 1040, VH = 640;          // 캔버스 크기
  const OFFX = (VW - E.consts.W) / 2; // 맵 가로 오프셋
  const MAP_W = E.consts.W;
  const STEP = 1 / 60;

  const DEFAULT_STATE = {
    text: "짱구*5, 짱아*10, 흰둥이*3",
    rank: 1,
    mapId: "classic",
  };

  // ---------- DOM 생성 ----------
  const panel = document.getElementById("panel-pinball");
  const mapOptions = E.maps
    .map((m) => `<option value="${m.id}">${m.name}</option>`)
    .join("");

  panel.innerHTML = `
    <div class="pb-stage">
      <canvas id="pbCanvas" width="${VW}" height="${VH}"></canvas>
    </div>
    <div class="pb-panel">
      <div class="pb-help">
        이름 뒤에 <b>/숫자</b>를 붙이면 구슬의 질량(충돌 시 밀어내는 힘)을 정할 수 있습니다. (예: 철수/2, 영희/5)<br>
        이름 뒤에 <b>*숫자</b>를 붙이면 그 이름의 구슬 개수를 정할 수 있습니다. (예: 철수*2, 영희*5)<br>
        쉼표(,) 또는 줄바꿈으로 구분합니다. 최대 ${E.consts.MAX_MARBLES}개. 모든 구슬이 결승선에 도착할 때까지 레이스가 진행됩니다.
      </div>
      <textarea id="pbInput" spellcheck="false"></textarea>
      <div class="pb-row">
        <label class="pb-label">맵 선택
          <select id="pbMap" class="pb-select">${mapOptions}</select>
        </label>
        <label class="pb-label">당첨 순위 #
          <input type="number" id="pbRank" min="1" value="1">
        </label>
        <button id="pbRandom" class="pb-btn">랜덤 당첨 순위</button>
        <span class="pb-spacer"></span>
        <button id="pbResultView" class="pb-btn pb-btn-sub" hidden>전체 순위표 보기</button>
        <button id="pbStop" class="pb-btn">정지</button>
        <button id="pbStart" class="pb-btn pb-btn-main">시작</button>
        <button id="pbShuffle" class="pb-btn">셔플</button>
      </div>
    </div>

    <!-- 전체 결과 모달 -->
    <div id="pbModal" class="pb-modal" hidden>
      <div class="pb-modal-box">
        <div class="pb-modal-header">
          <h2>🏁 전체 순위 결과</h2>
          <button id="pbModalClose" class="pb-modal-x">&times;</button>
        </div>
        <div id="pbModalWinner" class="pb-modal-winner"></div>
        <div class="pb-modal-list-wrap">
          <table class="pb-table">
            <thead>
              <tr><th>순위</th><th>이름</th><th>도착 시간</th></tr>
            </thead>
            <tbody id="pbModalTableBody"></tbody>
          </table>
        </div>
        <div class="pb-modal-footer">
          <button id="pbModalOk" class="pb-btn pb-btn-main">닫기</button>
        </div>
      </div>
    </div>`;

  const canvas = document.getElementById("pbCanvas");
  const ctx = canvas.getContext("2d");
  const inputEl = document.getElementById("pbInput");
  const mapEl = document.getElementById("pbMap");
  const rankEl = document.getElementById("pbRank");
  const btnStart = document.getElementById("pbStart");
  const btnStop = document.getElementById("pbStop");
  const btnShuffle = document.getElementById("pbShuffle");
  const btnRandom = document.getElementById("pbRandom");
  const btnResultView = document.getElementById("pbResultView");

  // 모달 요소
  const modalEl = document.getElementById("pbModal");
  const modalClose = document.getElementById("pbModalClose");
  const modalOk = document.getElementById("pbModalOk");
  const modalWinner = document.getElementById("pbModalWinner");
  const modalTableBody = document.getElementById("pbModalTableBody");

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
        text: inputEl.value,
        rank: Number(rankEl.value) || 1,
        mapId: mapEl.value || "classic",
      }));
    } catch (e) { /* ignore */ }
  }

  const init = loadState();
  inputEl.value = init.text;
  rankEl.value = init.rank;
  if (E.maps.some((m) => m.id === init.mapId)) {
    mapEl.value = init.mapId;
  }

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

    world = E.createWorld(list, {
      targetRank: rank,
      mapId: mapEl.value,
    });

    state = "ready";
    camY = 0;
    acc = 0;
    btnResultView.hidden = true;
    modalEl.hidden = true;
    updateButtons();
    saveState();
  }

  function updateButtons() {
    const hasMarbles = world && world.marbles.length > 0;
    btnStart.disabled = !hasMarbles || state === "running";
    btnStop.disabled = !(state === "running" || state === "paused");
    btnStop.textContent = state === "paused" ? "재개" : "정지";
    btnShuffle.disabled = false;
    // 진행 중에는 텍스트 및 맵 변경 잠금 (당첨 순위는 실시간 변경 허용)
    inputEl.disabled = state === "running" || state === "paused";
    mapEl.disabled = state === "running" || state === "paused";
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

  mapEl.addEventListener("change", () => {
    reset();
  });

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
    world.setTarget(rank);
    saveState();
  }
  rankEl.addEventListener("change", applyRank);

  let debounce = null;
  inputEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(reset, 300);
  });

  // ---------- 모달 제어 ----------
  function openResultModal() {
    if (!world) return;
    const fin = world.finished;
    modalTableBody.innerHTML = "";

    if (world.winner) {
      modalWinner.innerHTML = `🎉 당첨 (${world.targetRank}등): <span style="color:${colorOf(world.winner.group, 60)}">${world.winner.name}</span> (${world.winner.finishTime.toFixed(1)}초)`;
    } else {
      modalWinner.textContent = "";
    }

    fin.forEach((m, idx) => {
      const tr = document.createElement("tr");
      const isWinner = (idx + 1) === world.targetRank;
      if (isWinner) tr.className = "pb-winner-row";
      tr.innerHTML = `
        <td>${isWinner ? "★ " : ""}${idx + 1}등</td>
        <td style="color:${colorOf(m.group, 70)};font-weight:bold;">${m.name}</td>
        <td>${m.finishTime.toFixed(2)}초</td>
      `;
      modalTableBody.appendChild(tr);
    });

    modalEl.hidden = false;
  }

  function closeResultModal() {
    modalEl.hidden = true;
  }

  btnResultView.addEventListener("click", openResultModal);
  modalClose.addEventListener("click", closeResultModal);
  modalOk.addEventListener("click", closeResultModal);
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) closeResultModal();
  });

  // ---------- 카메라 및 애니메이션 루프 ----------
  function updateCamera(dt) {
    if (!world) return;
    const mapH = world.map.H;
    let target = 0;

    if (state !== "ready") {
      if (world.active.length > 0) {
        // 아직 달리고 있는 구슬 무리의 선두 추적
        let leadY = 0;
        for (const m of world.active) {
          if (m.y > leadY) leadY = m.y;
        }
        target = leadY - VH * 0.45;
      } else {
        // 모든 구슬이 통과했으면 결승선 뷰에 안착
        target = world.map.FINISH_Y - VH * 0.55;
      }
    }
    target = Math.max(0, Math.min(mapH - VH, target));
    camY += (target - camY) * Math.min(1, dt * 4.5);
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!visible) { lastTs = ts; return; }
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
    lastTs = ts;

    if (state === "running") {
      acc += dt;
      while (acc >= STEP) {
        world.step(STEP);
        acc -= STEP;
      }
      if (world.over) {
        state = "finished";
        btnResultView.hidden = false;
        updateButtons();
        // 전체 종료 시 모달 띄우기
        openResultModal();
      }
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
    ctx.fillStyle = "#0a0a0f";
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
    const FINISH_Y = map.FINISH_Y;
    if (FINISH_Y > camY - 40 && FINISH_Y < camY + VH + 40) {
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(map.chuteL, FINISH_Y); ctx.lineTo(map.chuteR, FINISH_Y);
      ctx.strokeStyle = "#ffe14d"; ctx.lineWidth = 4; ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffe14d";
      ctx.fillText("FINISH", map.chuteR + 10, FINISH_Y + 5);
    }

    // 활성 구슬
    const ranks = world.ranking();
    const showAllNames = world.marbles.length <= 80;
    const topIds = new Set(ranks.slice(0, 10).map((m) => m.id));
    ctx.textAlign = "center";
    ctx.font = "bold 13px 'Malgun Gothic', sans-serif";
    ctx.lineJoin = "round";

    for (const m of world.active) {
      if (m.y < camY - 30 || m.y > camY + VH + 30) continue;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(m.group, 75);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colorOf(m.group, 40);
      ctx.stroke();

      if (showAllNames || topIds.has(m.id)) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#000";
        ctx.strokeText(m.name, m.x, m.y - m.r - 5);
        ctx.fillStyle = colorOf(m.group, 75);
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

    // 당첨자가 결정되었을 때 화면에 당첨자 오버레이 표시 (경기는 끝까지 지속됨)
    if (world.winner) {
      drawWinnerBadge(world.winner, world.targetRank);
    }
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
    const ms = (VH - 16) / map.H;
    const x0 = 8, y0 = 8;
    ctx.fillStyle = "rgba(40,40,50,.85)";
    ctx.fillRect(x0, y0, MAP_W * ms, map.H * ms);
    ctx.strokeStyle = "rgba(255,255,255,.7)";
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
    ctx.font = "bold 16px 'Malgun Gothic', sans-serif";
    ctx.textAlign = "right";
    ctx.lineJoin = "round";

    for (let i = 0; i < maxLines; i++) {
      const m = ranks[i];
      const isTarget = (i + 1) === world.targetRank;
      const isFinished = m.finished;
      const mark = isFinished ? "✔ " : "";
      const star = isTarget ? "★ " : "";
      const label = `${star}${mark}${m.name} #${i + 1}`;
      const y = 24 + i * lineH;

      ctx.lineWidth = 4; ctx.strokeStyle = "#000";
      ctx.strokeText(label, VW - 10, y);
      ctx.fillStyle = isFinished ? "#aaffaa" : colorOf(m.group, 68);
      ctx.fillText(label, VW - 10, y);
    }
    if (ranks.length > maxLines) {
      ctx.fillStyle = "#aaa";
      ctx.font = "13px sans-serif";
      ctx.fillText(`… 외 ${ranks.length - maxLines}개`, VW - 10, 24 + maxLines * lineH);
    }
  }

  function drawWinnerBadge(m, rank) {
    ctx.save();
    ctx.textAlign = "right";
    ctx.lineJoin = "round";

    // "Winner" 타이틀
    ctx.font = "bold 52px 'Malgun Gothic', sans-serif";
    ctx.lineWidth = 8; ctx.strokeStyle = "#000";
    ctx.strokeText(`Winner (#${rank})`, VW - 24, VH - 85);
    ctx.fillStyle = "#ffe14d";
    ctx.fillText(`Winner (#${rank})`, VW - 24, VH - 85);

    // 당첨자 이름
    ctx.font = "bold 64px 'Malgun Gothic', sans-serif";
    ctx.lineWidth = 10; ctx.strokeStyle = "#000";
    ctx.strokeText(m.name, VW - 24, VH - 20, 520);
    ctx.fillStyle = colorOf(m.group, 65);
    ctx.fillText(m.name, VW - 24, VH - 20, 520);
    ctx.restore();
  }

  // ---------- 탭 등록 ----------
  TabManager.register({
    id: "pinball",
    label: "핀볼",
    onShow() { visible = true; },
    onHide() {
      visible = false;
      if (state === "running") { state = "paused"; updateButtons(); }
    },
  });

  reset();
  requestAnimationFrame(loop);
})();
