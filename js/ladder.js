(() => {
  "use strict";
  const E = LadderEngine;
  const panel = document.getElementById("panel-ladder");
  panel.innerHTML = `
    <h1>사다리타기</h1>
    <p class="ld-intro">위아래 칸에 이름과 결과를 입력하고 시작을 누르세요. 첫 칸에 쉼표로 여러 항목을 한 번에 넣을 수 있어요.</p>
    <div class="ld-toolbar">
      <label for="ldCount">인원 <input id="ldCount" type="number" min="2" max="20" step="1" value="6" required>명</label>
      <button id="ldEdit" class="tool" type="button">이름·결과 수정</button>
      <button id="ldShuffleNames" class="tool" type="button">참가자 섞기</button>
      <button id="ldShufflePrizes" class="tool" type="button">결과 섞기</button>
      <button id="ldGenerate" class="tool" type="button">다시 만들기</button>
    </div>
    <div class="ld-options">
      <label><input id="ldHide" type="checkbox" checked> 도착 전 결과 숨기기</label>
      <label for="ldSpeed">진행 속도 <select id="ldSpeed"><option value="1">보통</option><option value="2">빠르게</option><option value="3">아주 빠르게</option></select></label>
    </div>
    <div class="ld-actions">
      <button id="ldStart" class="primary" type="button">시작</button>
      <button id="ldAll" class="primary" type="button" disabled>전체 타기</button>
      <button id="ldPause" class="tool" type="button" disabled>일시정지</button>
      <button id="ldReveal" class="tool" type="button">결과 바로 보기</button>
    </div>
    <p id="ldError" class="ld-error" role="alert" hidden></p>
    <p id="ldStatus" class="ld-status" role="status" aria-live="polite"></p>
    <div id="ldWinners" class="ld-winners" role="status" aria-live="polite" hidden></div>
    <div id="ldBoardWrap" class="ld-board-wrap">
      <div id="ldBoard" class="ld-board">
        <div id="ldPeople" class="ld-labels ld-people" role="group" aria-label="참가자 이름과 경로 선택"></div>
        <canvas id="ldCanvas" aria-label="시작 버튼을 누르면 공개되는 사다리"></canvas>
        <div id="ldOutcomes" class="ld-labels ld-outcomes" role="group" aria-label="결과 칸"></div>
      </div>
    </div>
    <section id="ldTableWrap" class="ld-table-wrap" hidden>
      <h2>참가자별 결과</h2>
      <table class="ld-table"><thead><tr><th scope="col">참가자</th><th scope="col">결과</th></tr></thead><tbody id="ldTableBody"></tbody></table>
    </section>`;

  const $ = id => panel.querySelector("#" + id);
  const countInput = $("ldCount"), hideInput = $("ldHide"), speedInput = $("ldSpeed");
  const peopleEl = $("ldPeople"), outcomesEl = $("ldOutcomes");
  const wrap = $("ldBoardWrap"), canvas = $("ldCanvas"), ctx = canvas.getContext("2d");
  const errorEl = $("ldError"), statusEl = $("ldStatus");
  const STORAGE_KEY = "ladder_config_v1";
  const parse = text => text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  const colorOf = i => `hsl(${(i * 137.5 + 210) % 360}, 68%, 42%)`;
  let model = null, names = [], prizes = [], paths = [];
  let width = 0, height = 0, opened = false, editing = true, started = false;
  let revealed = new Set(), active = null, queue = [], selected = null;
  let visible = false, paused = false, lastTs = 0;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ names: names.join("\n"), prizes: prizes.join("\n"), hide: hideInput.checked, speed: speedInput.value }));
    } catch (e) { /* storage is optional */ }
  }
  function load() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { /* optional */ }
    const previous = typeof saved?.names === "string" ? parse(saved.names.slice(0, 3000)) : [];
    names = previous.length >= 2 && previous.length <= 20 ? previous : Array.from({ length: 6 }, (_, i) => `참가자 ${i + 1}`);
    prizes = typeof saved?.prizes === "string" ? parse(saved.prizes.slice(0, 3000)).slice(0, names.length) : ["당첨"];
    while (prizes.length < names.length) prizes.push("꽝");
    hideInput.checked = saved?.hide !== false;
    speedInput.value = ["1", "2", "3"].includes(saved?.speed) ? saved.speed : "1";
  }
  function showError(message) { errorEl.textContent = message; errorEl.hidden = !message; }
  function laneX(lane) { return (lane + 0.5) * width / model.count; }
  function rowY(row) { return 18 + (row + 1) * (height - 36) / (model.rows.length + 1); }
  function makePath(start) {
    const trace = E.trace(model, start);
    const points = [{ x: laneX(start), y: 18 }];
    trace.steps.forEach(step => {
      points.push({ x: laneX(step.from), y: rowY(step.row) });
      if (step.from !== step.to) points.push({ x: laneX(step.to), y: rowY(step.row) });
    });
    points.push({ x: laneX(trace.finish), y: height - 18 });
    let length = 0;
    const segments = points.slice(1).map((point, i) => {
      const from = points[i];
      const distance = Math.hypot(point.x - from.x, point.y - from.y);
      const segment = { from, to: point, offset: length, length: distance };
      length += distance;
      return segment;
    });
    return { start, finish: trace.finish, segments, length };
  }
  function build(relabel = true) {
    if (active) return;
    model = E.create(names.length);
    width = Math.max(540, names.length * 104);
    height = Math.max(460, model.rows.length * 14 + 36);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px"; canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    $("ldBoard").style.width = width + "px";
    peopleEl.style.gridTemplateColumns = outcomesEl.style.gridTemplateColumns = `repeat(${names.length}, 1fr)`;
    paths = names.map((_, i) => makePath(i));
    revealed = new Set(); queue = []; selected = null; paused = false; opened = false; editing = true; started = false;
    countInput.value = names.length;
    if (relabel) renderLabels();
    wrap.scrollLeft = 0; wrap.scrollTop = 0;
    showError(""); save(); renderResults(); updateControls(); draw();
  }
  function resize(count) {
    names = Array.from({ length: count }, (_, i) => names[i] || `참가자 ${i + 1}`);
    prizes = Array.from({ length: count }, (_, i) => prizes[i] || "꽝");
  }
  function commit(kind, index, input) {
    if (active) return;
    const values = parse(input.value);
    const target = kind === "name" ? names : prizes;
    const previousCount = names.length;
    if (values.length > 1) {
      const length = index === 0 ? values.length : Math.max(target.length, index + values.length);
      if (length > 20) { showError("한 번에 입력할 수 있는 항목은 최대 20개입니다."); input.focus(); return; }
      if (kind === "name" && index === 0) {
        names = values;
        resize(values.length);
      } else {
        if (index + values.length > names.length) resize(index + values.length);
        const next = kind === "name" ? names : prizes;
        if (kind === "prize" && index === 0) next.fill("꽝");
        values.forEach((value, offset) => { next[index + offset] = value; });
      }
    } else target[index] = values[0] || (kind === "name" ? `참가자 ${index + 1}` : "꽝");
    input.value = (kind === "name" ? names : prizes)[index];
    // Keep sibling inputs mounted while moving between fields of the same-sized ladder.
    build(previousCount !== names.length || values.length > 1);
  }
  function renderLabels() {
    peopleEl.replaceChildren(); outcomesEl.replaceChildren();
    names.forEach((name, i) => {
      if (editing) {
        const input = document.createElement("input");
        input.type = "text"; input.className = "ld-name-input"; input.value = name; input.maxLength = 3000;
        input.setAttribute("aria-label", `${i + 1}번 참가자 이름`);
        input.title = "쉼표로 여러 이름을 한 번에 입력할 수 있습니다";
        input.style.setProperty("--ld-color", colorOf(i));
        input.addEventListener("change", () => commit("name", i, input));
        input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
        peopleEl.appendChild(input);
        const result = document.createElement("input");
        result.type = "text"; result.className = "ld-prize-input"; result.value = prizes[i]; result.maxLength = 3000;
        result.setAttribute("aria-label", `${i + 1}번 결과`);
        result.title = "쉼표로 여러 결과를 한 번에 입력할 수 있습니다";
        result.addEventListener("change", () => commit("prize", i, result));
        result.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); result.blur(); } });
        outcomesEl.appendChild(result);
      } else {
        const button = document.createElement("button");
        button.type = "button"; button.className = "ld-person"; button.title = name;
        button.style.setProperty("--ld-color", colorOf(i));
        button.addEventListener("click", () => { if (started && !active) begin(i); });
        peopleEl.appendChild(button);
        const outcome = document.createElement("button");
        outcome.type = "button"; outcome.className = "ld-outcome";
        outcome.addEventListener("click", () => {
          if (active) return;
          edit();
          outcomesEl.children[i].focus(); outcomesEl.children[i].select();
        });
        outcomesEl.appendChild(outcome);
      }
    });
  }
  function renderResults() {
    if (!model) return;
    const winners = names.map((_, i) => i).filter(isWinner);
    $("ldWinners").hidden = winners.length === 0;
    $("ldWinners").textContent = winners.length ? `🎉 당첨자: ${winners.map(i => names[i]).join(", ")}` : "";
    if (!editing) {
      const known = new Set([...revealed].map(i => paths[i].finish));
      [...outcomesEl.children].forEach((el, i) => {
        const shown = !hideInput.checked || known.has(i);
        el.textContent = shown ? prizes[i] : "?";
        el.title = shown ? `${prizes[i]} · 클릭해서 수정` : "클릭해서 결과 수정";
        el.setAttribute("aria-label", `${i + 1}번 결과 ${shown ? prizes[i] : "미공개"}, 클릭해서 수정`);
        el.classList.toggle("ld-revealed", known.has(i));
        el.classList.toggle("ld-winning", isDrawMode() && known.has(i) && prizes[i].trim() === "당첨");
      });
    }
    $("ldTableWrap").hidden = revealed.size === 0;
    const body = $("ldTableBody"); body.replaceChildren();
    names.forEach((name, i) => {
      const row = document.createElement("tr"), person = document.createElement("td"), result = document.createElement("td");
      row.classList.toggle("ld-winner-row", isWinner(i));
      person.textContent = name;
      result.textContent = revealed.has(i) ? prizes[paths[i].finish] : "미공개";
      result.className = revealed.has(i) ? "" : "ld-pending";
      row.append(person, result); body.appendChild(row);
    });
  }
  function isDrawMode() {
    return prizes.every(prize => ["꽝", "당첨"].includes(prize.trim()));
  }
  function isWinner(index) {
    return isDrawMode() && revealed.has(index) && prizes[paths[index].finish].trim() === "당첨";
  }
  function updateControls() {
    const busy = !!active;
    panel.querySelectorAll(".ld-toolbar button, #ldCount, #ldHide, .ld-name-input, .ld-prize-input, .ld-outcome").forEach(el => { el.disabled = busy; });
    $("ldEdit").hidden = !started;
    $("ldStart").hidden = started;
    $("ldStart").disabled = busy || started;
    $("ldAll").hidden = !started;
    $("ldAll").disabled = !started || busy;
    $("ldAll").textContent = revealed.size === names.length ? "전체 다시 타기" : "전체 타기";
    $("ldReveal").disabled = !started || (!busy && revealed.size === names.length);
    $("ldPause").disabled = !busy;
    $("ldPause").textContent = paused ? "재개" : "일시정지";
    [...peopleEl.querySelectorAll(".ld-person")].forEach((button, i) => {
      button.disabled = !started || busy;
      const winner = isWinner(i);
      button.textContent = `${winner ? "🏆 " : revealed.has(i) ? "✓ " : ""}${names[i]}`;
      button.classList.toggle("ld-winner", winner);
      button.title = `${names[i]}${winner ? " · 당첨" : ""}`;
      button.setAttribute("aria-label", `${names[i]}${winner ? ", 당첨" : ""}`);
      button.setAttribute("aria-pressed", String(i === selected));
    });
    if (active) statusEl.textContent = `${names[active.start]} ${paused ? "일시정지" : "내려가는 중…"} · ${revealed.size} / ${names.length}명 공개`;
    else if (!started) statusEl.textContent = "위쪽 이름과 아래쪽 결과를 입력한 뒤 시작을 눌러 주세요.";
    else if (revealed.size === names.length) statusEl.textContent = `${names.length}명의 결과를 모두 확인했어요.`;
    else statusEl.textContent = `${revealed.size} / ${names.length}명 공개 · 위쪽 이름을 눌러 타거나 전체 타기를 선택하세요.`;
  }
  function edit() {
    if (active) return;
    build();
  }
  function begin(start) {
    if (!started || active) return;
    active = { start, distance: 0 };
    selected = start; paused = false; lastTs = 0;
    updateControls(); draw();
  }
  function follow(point) {
    const x = point.x, y = point.y + peopleEl.offsetHeight;
    if (x < wrap.scrollLeft + 35 || x > wrap.scrollLeft + wrap.clientWidth - 35) wrap.scrollLeft = Math.max(0, x - wrap.clientWidth / 2);
    if (y < wrap.scrollTop + peopleEl.offsetHeight + 10 || y > wrap.scrollTop + wrap.clientHeight - outcomesEl.offsetHeight - 20) wrap.scrollTop = Math.max(0, y - wrap.clientHeight / 2);
  }
  function update(dt) {
    if (!visible || !active || paused) return;
    let remaining = dt * Number(speedInput.value);
    while (active && remaining > 0) {
      const path = paths[active.start];
      const velocity = Math.max(360, path.length / 6);
      const needed = (path.length - active.distance) / velocity;
      if (remaining < needed) { active.distance += remaining * velocity; remaining = 0; }
      else {
        remaining -= needed; revealed.add(active.start); active = null;
        if (queue.length) { active = { start: queue.shift(), distance: 0 }; selected = active.start; }
        renderResults(); updateControls();
      }
    }
  }
  function drawPath(path, distance, alpha) {
    let marker = path.segments[0].from;
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = colorOf(path.start); ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(marker.x, marker.y);
    for (const segment of path.segments) {
      if (distance <= segment.offset) break;
      const ratio = Math.min(1, (distance - segment.offset) / segment.length);
      marker = { x: segment.from.x + (segment.to.x - segment.from.x) * ratio, y: segment.from.y + (segment.to.y - segment.from.y) * ratio };
      ctx.lineTo(marker.x, marker.y); if (ratio < 1) break;
    }
    ctx.stroke(); ctx.restore(); return marker;
  }
  function draw() {
    if (!model) return;
    ctx.fillStyle = opened ? "#fff" : "#f5f8fc"; ctx.fillRect(0, 0, width, height);
    if (!opened) {
      const centerX = wrap.clientWidth ? Math.max(100, Math.min(width - 100, wrap.scrollLeft + wrap.clientWidth / 2)) : width / 2;
      const centerY = wrap.clientHeight ? Math.max(85, Math.min(height - 85, wrap.scrollTop + (wrap.clientHeight - peopleEl.offsetHeight - outcomesEl.offsetHeight) / 2)) : height / 2;
      ctx.fillStyle = "#c1d1e3"; ctx.font = "bold 52px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("?", centerX, centerY - 12);
      ctx.fillStyle = "#5b718b"; ctx.font = '15px "Malgun Gothic", sans-serif';
      ctx.fillText("이름과 결과를 입력한 뒤", centerX, centerY + 25);
      ctx.fillText("시작을 눌러 주세요", centerX, centerY + 49);
      return;
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "#d4dce6"; ctx.lineWidth = 3; ctx.beginPath();
    for (let lane = 0; lane < model.count; lane++) { ctx.moveTo(laneX(lane), 18); ctx.lineTo(laneX(lane), height - 18); }
    ctx.stroke(); ctx.strokeStyle = "#9faec0"; ctx.beginPath();
    model.rows.forEach((row, r) => row.forEach(lane => { ctx.moveTo(laneX(lane), rowY(r)); ctx.lineTo(laneX(lane + 1), rowY(r)); }));
    ctx.stroke();
    revealed.forEach(i => { if (i !== selected) drawPath(paths[i], paths[i].length, isWinner(i) ? 0.85 : 0.12); });
    if (selected !== null) {
      const path = paths[selected], point = drawPath(path, active ? active.distance : path.length, 1);
      ctx.beginPath(); ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(selected); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
      if (active && visible) follow(point);
    }
  }
  function loop(ts) {
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000); lastTs = ts;
    if (visible && active && !paused) { update(dt); draw(); }
    requestAnimationFrame(loop);
  }
  function shuffle(kind) {
    if (active) return;
    const values = kind === "name" ? names : prizes;
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); [values[i], values[j]] = [values[j], values[i]];
    }
    build();
  }
  countInput.addEventListener("change", () => {
    if (active) return;
    if (!countInput.checkValidity()) { showError("인원은 2~20명의 정수로 입력해 주세요."); countInput.value = names.length; return; }
    resize(Number(countInput.value)); build();
  });
  wrap.addEventListener("scroll", () => { if (!opened && visible) draw(); });
  hideInput.addEventListener("change", () => { save(); renderResults(); });
  speedInput.addEventListener("change", save);
  $("ldEdit").addEventListener("click", edit);
  $("ldGenerate").addEventListener("click", () => build());
  $("ldShuffleNames").addEventListener("click", () => shuffle("name"));
  $("ldShufflePrizes").addEventListener("click", () => shuffle("prize"));
  $("ldStart").addEventListener("click", () => {
    if (active || started || !model || !errorEl.hidden) return;
    started = true; editing = false; opened = true;
    renderLabels(); renderResults(); updateControls(); draw();
  });
  $("ldAll").addEventListener("click", () => {
    if (!started || active) return;
    queue = names.map((_, i) => i).filter(i => !revealed.has(i));
    if (!queue.length) queue = names.map((_, i) => i);
    begin(queue.shift());
  });
  $("ldPause").addEventListener("click", () => { if (active) { paused = !paused; lastTs = 0; updateControls(); } });
  $("ldReveal").addEventListener("click", () => {
    if (!started) return;
    opened = true; active = null; queue = []; paused = false; revealed = new Set(names.map((_, i) => i));
    const winner = names.findIndex((_, i) => isWinner(i));
    selected = winner >= 0 ? winner : null;
    renderResults(); updateControls(); draw();
  });
  load(); build();
  TabManager.register({ id: "ladder", label: "사다리타기",
    onShow() { visible = true; lastTs = 0; draw(); }, onHide() { visible = false; lastTs = 0; }
  });
  const otherRender = window.render_game_to_text, otherAdvance = window.advanceTime;
  window.render_game_to_text = () => {
    if (!visible) return otherRender ? otherRender() : "{}";
    return JSON.stringify({ game: "ladder", mode: !started ? "setup" : active ? "running" : revealed.size === names.length ? "finished" : "ready",
      paused, editing, opened, started, coordinates: "canvas origin top-left; x right, y down; name controls above; editable result controls below", width, height,
      participants: names, rows: opened ? model.rows : [], revealed: [...revealed],
      active: active && { start: active.start, distance: active.distance, length: paths[active.start].length },
      results: names.map((name, i) => ({ name, result: revealed.has(i) ? prizes[paths[i].finish] : null, finish: revealed.has(i) ? paths[i].finish : null })) });
  };
  window.advanceTime = ms => { if (!visible) { if (otherAdvance) otherAdvance(ms); return; } update(ms / 1000); lastTs = 0; draw(); };
  requestAnimationFrame(loop);
})();
