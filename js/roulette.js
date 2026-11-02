(() => {
  "use strict";

  // Build both tabs from the same editor before either one is initialized.
  const originalPanel = document.getElementById("panel-roulette");
  const dartPanel = originalPanel.cloneNode(true);
  dartPanel.id = "panel-roulette-darts";
  dartPanel.hidden = true;
  dartPanel.querySelectorAll("[id]").forEach(el => { el.id = "dart-" + el.id; });
  dartPanel.querySelectorAll('[name="bulkMode"]').forEach(el => { el.name = "dart-bulkMode"; });
  dartPanel.querySelector("h1").textContent = "룰렛 다트";
  dartPanel.querySelector(".pointer").remove();
  dartPanel.querySelector(".controls").insertAdjacentHTML("beforebegin", `
    <div class="dart-settings">
      <label>다트 개수 <input id="dart-count" type="number" min="1" max="100" step="1" value="3" required></label>
      <span id="dart-status" role="status" aria-live="polite">다트 개수를 설정하고 시작하세요.</span>
    </div>
    <p class="dart-help">판 안쪽을 클릭·터치해서 조준하거나, <kbd>Space</kbd>로 위쪽 조준점에 던지세요.<br>마지막 다트가 꽂히면 서서히 멈춥니다. 같은 항목에 여러 번 맞을 수 있어요.</p>`);
  dartPanel.querySelector(".controls").insertAdjacentHTML("beforeend", '<button id="dart-throw" class="primary" type="button" disabled>다트 던지기 · Space</button>');
  dartPanel.insertAdjacentHTML("beforeend", '<section id="dart-results" class="dart-results" aria-label="다트 결과" hidden></section>');
  originalPanel.after(dartPanel);

  function createWheel(panel, dartMode) {
  const get = id => panel.querySelector("#" + (dartMode ? "dart-" : "") + id);
  const STORAGE_KEY = dartMode ? "roulette_darts_items_v1" : "roulette_items_v1";
  const TWO_PI = Math.PI * 2;
  const MAX_SPEED = 20;        // rad/s (최대 회전 속도)
  const ACCEL = 16;            // rad/s^2 (시작 시 가속)
  const STOP_TIME_MIN = 2.5;   // 정지 버튼 후 감속 시간(초) 범위
  const STOP_TIME_MAX = 4.5;

  // ---------- 상태 ----------
  let items = loadItems();
  let rotation = 0;            // 현재 휠 회전각(rad)
  let speed = 0;               // 현재 각속도(rad/s)
  let mode = "idle";           // idle | spinning | stopping | stopped
  let stopInfo = null;         // { a0, v0, T, t, final }
  let lastTs = 0;
  let winnerIndex = -1;

  // ---------- 엘리먼트 ----------
  const canvas = get("wheel");
  const ctx = canvas.getContext("2d");
  const listEl = get("list");
  const sumInfo = get("sumInfo");
  const resultEl = get("result");
  const btnStart = get("btnStart");
  const btnStop = get("btnStop");
  const btnInstant = get("btnInstant");

  const FLIGHT_TIME = 0.36;
  const IMPACT_TIME = 0.42;
  let dartCount = 3;
  let hits = [];
  let flight = null;
  let hover = null;
  const countInput = dartMode ? panel.querySelector("#dart-count") : null;
  const dartStatus = dartMode ? panel.querySelector("#dart-status") : null;
  const throwButton = dartMode ? panel.querySelector("#dart-throw") : null;
  const dartResults = dartMode ? panel.querySelector("#dart-results") : null;
  if (dartMode) {
    try {
      const saved = Number(localStorage.getItem("roulette_darts_count_v1"));
      if (Number.isInteger(saved) && saved >= 1 && saved <= 100) countInput.value = saved;
    } catch (e) { /* storage is optional */ }
    countInput.addEventListener("change", () => {
      if (countInput.checkValidity()) {
        try { localStorage.setItem("roulette_darts_count_v1", countInput.value); } catch (e) { /* optional */ }
      }
    });
    btnStart.textContent = "시작!";
    btnStop.hidden = true;
    btnInstant.hidden = true;
    canvas.setAttribute("aria-label", "회전하는 다트 룰렛. 판 안쪽을 클릭하거나 스페이스바로 던지세요.");
    canvas.tabIndex = 0;
    canvas.addEventListener("click", e => {
      const rect = canvas.getBoundingClientRect();
      throwDart((e.clientX - rect.left) * 520 / rect.width, (e.clientY - rect.top) * 520 / rect.height);
    });
    canvas.addEventListener("pointermove", e => {
      const rect = canvas.getBoundingClientRect();
      hover = { x: (e.clientX - rect.left) * 520 / rect.width, y: (e.clientY - rect.top) * 520 / rect.height };
      if (!insideBoard(hover.x, hover.y)) hover = null;
      draw();
    });
    canvas.addEventListener("pointerleave", () => { hover = null; draw(); });
    throwButton.addEventListener("click", () => throwDart(260, 80));
    document.addEventListener("keydown", e => {
      if (e.code !== "Space" || panel.hidden || mode !== "spinning") return;
      if (!bulkModal.hidden || !presetModal.hidden) return;
      if (e.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      e.preventDefault(); // Also suppress the focused button's native Space click.
      if (!e.repeat) throwDart(260, 80);
    });
    window.render_game_to_text = () => JSON.stringify({
      mode, visible: !panel.hidden, rotation, speed,
      coordinates: "520x520; origin top-left; x right, y down; center (260,260); radius 254",
      fixedTarget: { x: 260, y: 80 }, dartCount,
      remaining: dartCount - hits.length - (flight ? 1 : 0),
      flight: flight && { x: flight.x, y: flight.y, elapsed: flight.t, duration: FLIGHT_TIME },
      hits: hits.map(h => ({ number: h.number, item: items[h.index].name, index: h.index, angle: h.angle, radius: h.radius, impactAge: h.age })),
      items: items.map(it => ({ name: it.name, weight: it.weight }))
    });
    window.advanceTime = ms => {
      for (let remaining = ms / 1000; remaining > 1e-9; remaining -= Math.min(remaining, 1 / 60)) {
        step(Math.min(remaining, 1 / 60));
      }
      lastTs = 0;
      draw();
    };
  }

  function insideBoard(x, y) { return Math.hypot(x - 260, y - 260) < 254; }

  function clearDarts() {
    hits = [];
    flight = null;
    dartResults.hidden = true;
    dartResults.replaceChildren();
    dartStatus.textContent = "다트 개수를 설정하고 시작하세요.";
  }

  function startDarts() {
    if (!countInput.reportValidity()) return false;
    clearDarts();
    dartCount = Number(countInput.value);
    return true;
  }

  function updateDartControls() {
    const busy = mode === "spinning" || mode === "stopping";
    countInput.disabled = busy;
    throwButton.disabled = mode !== "spinning" || !!flight || hits.length >= dartCount;
    canvas.classList.toggle("dart-ready", !throwButton.disabled);
    if (mode === "spinning") {
      const remaining = dartCount - hits.length - (flight ? 1 : 0);
      dartStatus.textContent = `${flight ? "다트가 날아가는 중 · " : ""}남은 다트 ${remaining} / ${dartCount}개`;
    } else if (mode === "stopping") {
      dartStatus.textContent = "모두 던졌어요! 룰렛이 멈추는 중…";
    } else if (mode === "stopped") {
      dartStatus.textContent = `다트 ${hits.length}개 투척 완료`;
    }
  }

  function throwDart(x, y) {
    if (panel.hidden || mode !== "spinning" || flight || hits.length >= dartCount || !insideBoard(x, y)) return;
    flight = { x, y, t: 0, number: hits.length + 1 };
    updateDartControls();
  }

  function updateFlight(dt) {
    if (!flight) return;
    flight.t += dt;
    if (flight.t < FLIGHT_TIME - 1e-9) return;
    // Resolve against the rotating sector at impact, then store board-local coordinates.
    const angle = mod(Math.atan2(flight.y - 260, flight.x - 260) - rotation, TWO_PI);
    let edge = 0;
    const total = totalWeight();
    let index = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      edge += items[i].weight / total * TWO_PI;
      if (angle < edge) { index = i; break; }
    }
    hits.push({ number: flight.number, index, angle, radius: Math.hypot(flight.x - 260, flight.y - 260), age: 0, tilt: flightPosition(1).tilt - rotation });
    flight = null;
    if (hits.length === dartCount) beginStopping();
    else updateDartControls();
  }

  function drawDart(x, y, number, scale = 1, wobble = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.rotate(wobble);
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#182033";
    // Needle tip stays on the exact impact point; the barrel and fins vibrate around it.
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, -17);
    ctx.strokeStyle = "#172136"; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = "#f0f6ff"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(1, -2); ctx.lineTo(10, -17); ctx.stroke();
    const metal = ctx.createLinearGradient(8, -20, 20, -15);
    metal.addColorStop(0, "#56637c"); metal.addColorStop(0.45, "#edf5ff"); metal.addColorStop(1, "#6c7a92");
    ctx.fillStyle = metal; ctx.strokeStyle = "#182033"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(7, -15); ctx.lineTo(16, -32); ctx.lineTo(23, -28); ctx.lineTo(13, -11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(19, -30); ctx.lineTo(29, -47); ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#ffbd32";
    ctx.beginPath(); ctx.moveTo(24, -39); ctx.lineTo(21, -59); ctx.lineTo(38, -54); ctx.lineTo(34, -35); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ff703e";
    ctx.beginPath(); ctx.moveTo(29, -47); ctx.lineTo(38, -54); ctx.lineTo(34, -35); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(30, -55, 9, 0, TWO_PI);
    ctx.lineWidth = 2; ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#182033";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.translate(30, -55);
    ctx.rotate(-wobble); // Keep the numbered badge upright as the dart turns in flight.
    ctx.fillText(number, 0, 0);
    ctx.restore();
  }

  function flightPosition(p) {
    const travel = p * p;
    const arc = Math.sin(Math.PI * p);
    return { x: 260 + (flight.x - 260) * travel - 35 * arc,
      y: 500 + (flight.y - 500) * travel - 32 * arc,
      tilt: Math.atan2(2 * p * (flight.y - 500) - 32 * Math.PI * Math.cos(Math.PI * p),
        2 * p * (flight.x - 260) - 35 * Math.PI * Math.cos(Math.PI * p)) - Math.atan2(17, -10) };
  }

  function drawImpact(x, y, age) {
    if (age >= IMPACT_TIME) return;
    const p = age / IMPACT_TIME;
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3 * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(x, y, 5 + 29 * p, 0, TWO_PI); ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i * TWO_PI / 8 + 0.2;
      const radius = 8 + 32 * p;
      ctx.strokeStyle = i % 2 ? "#ffdc65" : "#fff";
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
      ctx.lineTo(x + Math.cos(a) * (radius + 8 * (1 - p)), y + Math.sin(a) * (radius + 8 * (1 - p)));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDarts() {
    function crosshair(x, y, dashed) {
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.shadowColor = "#111"; ctx.shadowBlur = 4;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(x, y, 14, 0, TWO_PI); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x - 21, y); ctx.lineTo(x + 21, y);
      ctx.moveTo(x, y - 21); ctx.lineTo(x, y + 21); ctx.stroke();
      ctx.restore();
    }
    if (mode !== "stopped") {
      crosshair(260, 80, false);
      if (hover && mode === "spinning" && !flight) crosshair(hover.x, hover.y, true);
    }
    hits.forEach(h => {
      const x = 260 + Math.cos(h.angle + rotation) * h.radius;
      const y = 260 + Math.sin(h.angle + rotation) * h.radius;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.beginPath(); ctx.ellipse(x + 6, y + 3, 11, 4, -0.6, 0, TWO_PI); ctx.fill();
      ctx.restore();
      drawImpact(x, y, h.age);
      const vibration = Math.sin(h.age * 85) * Math.exp(-h.age * 12) * 0.22;
      const settle = 1 - 0.12 * Math.sin(Math.min(1, h.age / 0.12) * Math.PI);
      drawDart(x, y, h.number, settle, h.tilt + rotation + vibration);
    });
    if (flight) {
      const p = Math.min(1, flight.t / FLIGHT_TIME);
      const pos = flightPosition(p);
      // A fading trail and shrinking silhouette convey travel from the viewer to the board.
      ctx.save();
      ctx.lineCap = "round";
      for (let i = 5; i > 0; i--) {
        const from = flightPosition(Math.max(0, p - i * 0.045));
        const to = flightPosition(Math.max(0, p - (i - 1) * 0.045));
        ctx.globalAlpha = (1 - i / 6) * 0.6;
        ctx.strokeStyle = i % 2 ? "#fff4bc" : "#fff";
        ctx.lineWidth = 2 + 4 * (1 - p);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      }
      ctx.restore();
      drawDart(pos.x, pos.y, flight.number, 2.3 - 1.3 * p, pos.tilt);
    }
  }

  function showDartResults() {
    resultEl.textContent = `🎯 다트 ${hits.length}개 결과`;
    dartResults.replaceChildren();
    const summary = document.createElement("div");
    summary.className = "dart-summary";
    const counts = new Map();
    hits.forEach(h => counts.set(h.index, (counts.get(h.index) || 0) + 1));
    counts.forEach((count, index) => {
      const badge = document.createElement("span");
      badge.textContent = `${items[index].name || `항목 ${index + 1}`} ${count}회`;
      summary.appendChild(badge);
    });
    const sequence = document.createElement("ol");
    hits.forEach(h => {
      const row = document.createElement("li");
      row.textContent = `${h.number}번째 다트: ${items[h.index].name || `항목 ${h.index + 1}`}`;
      sequence.appendChild(row);
    });
    dartResults.append(summary, sequence);
    dartResults.hidden = false;
  }

  // 고해상도 대응
  const SIZE = 520;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.scale(dpr, dpr);

  // ---------- 데이터 ----------
  function defaultItems() {
    return [
      { name: "항목 1", color: "#e6194b", weight: 1 },
      { name: "항목 2", color: "#3cb44b", weight: 1 },
      { name: "항목 3", color: "#4363d8", weight: 1 },
      { name: "항목 4", color: "#f58231", weight: 1 },
    ];
  }

  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) return arr;
      }
    } catch (e) { /* ignore */ }
    return defaultItems();
  }

  function saveItems() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
  }

  function totalWeight() {
    return items.reduce((s, it) => s + it.weight, 0);
  }

  function randomColor() {
    const h = Math.floor(Math.random() * 360);
    const s = 55 + Math.random() * 30;
    const l = 40 + Math.random() * 25;
    return hslToHex(h, s, l);
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
    return "#" + to(f(0)) + to(f(8)) + to(f(4));
  }

  function mod(a, n) { return ((a % n) + n) % n; }

  // 포인터(12시 방향)가 가리키는 항목 index
  function indexAtPointer(rot) {
    const total = totalWeight();
    const ang = mod(-Math.PI / 2 - rot, TWO_PI);
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      const span = (items[i].weight / total) * TWO_PI;
      if (ang < acc + span) return i;
      acc += span;
    }
    return items.length - 1;
  }

  // ---------- 그리기 ----------
  function draw() {
    const cx = SIZE / 2, cy = SIZE / 2, R = SIZE / 2 - 6;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const total = totalWeight();
    let acc = 0;

    items.forEach((it, i) => {
      const span = (it.weight / total) * TWO_PI;
      const start = rotation + acc;
      const end = start + span;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, start, end);
      ctx.closePath();
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.stroke();

      // 글자 (조각 너비에 맞춰 크기 조절, 너무 좁으면 생략)
      const mid = start + span / 2;
      const arcWidth = span * R * 0.6;
      const fontSize = Math.min(24, arcWidth * 0.7);
      if (fontSize >= 8) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(mid);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px "Malgun Gothic", sans-serif`;
        ctx.lineJoin = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.fillStyle = "#fff";
        const label = it.name || "";
        ctx.strokeText(label, R - 14, 0, R * 0.7);
        ctx.fillText(label, R - 14, 0, R * 0.7);
        ctx.restore();
      }
      acc += span;
    });

    // 당첨 항목 강조
    if (mode === "stopped" && winnerIndex >= 0 && winnerIndex < items.length) {
      let a = 0;
      for (let i = 0; i < winnerIndex; i++) a += (items[i].weight / total) * TWO_PI;
      const span = (items[winnerIndex].weight / total) * TWO_PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, rotation + a, rotation + a + span);
      ctx.closePath();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }

    // 중앙 캡
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, TWO_PI);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (dartMode) drawDarts();
  }

  // ---------- 항목 목록 UI ----------
  function renderList() {
    listEl.innerHTML = "";
    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "row";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.dataset.index = i;

      const name = document.createElement("input");
      name.type = "text";
      name.className = "name";
      name.value = it.name;
      name.placeholder = `항목 ${i + 1}`;
      name.addEventListener("input", () => {
        if (dartMode) resetResult();
        it.name = name.value;
        saveItems();
        draw();
      });

      const color = document.createElement("input");
      color.type = "color";
      color.value = it.color;
      color.addEventListener("input", () => {
        it.color = color.value;
        saveItems();
        draw();
      });

      const pct = document.createElement("input");
      pct.type = "text";
      pct.className = "pct";
      pct.dataset.pct = i;
      pct.title = "비율(%)을 직접 입력하면 나머지 항목이 자동으로 조정됩니다";
      pct.addEventListener("focus", () => pct.select());
      pct.addEventListener("change", () => setPercent(i, parseFloat(pct.value)));
      pct.addEventListener("keydown", (e) => { if (e.key === "Enter") pct.blur(); });

      const plus = document.createElement("button");
      plus.textContent = "+";
      plus.title = "비율 증가";
      plus.addEventListener("click", () => { it.weight += 1; afterWeightChange(); });

      const minus = document.createElement("button");
      minus.textContent = "-";
      minus.title = "비율 감소";
      minus.addEventListener("click", () => {
        if (it.weight > 1) it.weight = Math.max(1, it.weight - 1);
        afterWeightChange();
      });

      row.append(chk, name, color, pct, plus, minus);
      listEl.appendChild(row);
    });
    updatePercents();
  }

  function updatePercents() {
    const total = totalWeight();
    listEl.querySelectorAll("input.pct").forEach((el) => {
      const i = Number(el.dataset.pct);
      el.value = ((items[i].weight / total) * 100).toFixed(2) + "%";
    });
    sumInfo.textContent = `항목 ${items.length}개 · 비율 합계는 항상 100%로 자동 정규화됩니다`;
  }

  function afterWeightChange() {
    if (dartMode) resetResult();
    saveItems();
    updatePercents();
    draw();
  }

  // 특정 항목의 비율(%)을 지정 → 나머지 항목은 기존 비율을 유지한 채 자동 조정
  function setPercent(i, p) {
    if (!isFinite(p) || items.length < 2) { updatePercents(); return; }
    p = Math.min(99.9, Math.max(0.1, p));
    const others = totalWeight() - items[i].weight;
    items[i].weight = (p / (100 - p)) * others;
    afterWeightChange();
  }

  // ---------- 버튼: 항목 추가/제거/리셋 ----------
  get("btnAdd").addEventListener("click", () => {
    items.push({ name: `항목 ${items.length + 1}`, color: randomColor(), weight: 1 });
    resetResult();
    saveItems();
    renderList();
    draw();
    listEl.scrollTop = listEl.scrollHeight;
  });

  // ---------- 항목 순서 섞기 ----------
  get("btnShuffleItems").addEventListener("click", () => {
    if (mode === "spinning" || mode === "stopping" || items.length < 2) return;
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    resetResult();
    saveItems();
    renderList();
    draw();
  });

  // ---------- 한번에 넣기 (쉼표/줄바꿈 구분, 동일 가중치) ----------
  const bulkModal = get("bulkModal");
  const bulkInput = get("bulkInput");
  const btnBulk = get("btnBulk");
  const btnBulkCancel = get("btnBulkCancel");
  const btnBulkApply = get("btnBulkApply");

  function openBulkModal() {
    if (mode === "spinning" || mode === "stopping") return;
    bulkModal.hidden = false;
    bulkInput.focus();
  }

  function closeBulkModal() {
    bulkModal.hidden = true;
  }

  btnBulk.addEventListener("click", openBulkModal);
  btnBulkCancel.addEventListener("click", closeBulkModal);
  bulkModal.addEventListener("click", (e) => {
    if (e.target === bulkModal) closeBulkModal();
  });

  btnBulkApply.addEventListener("click", () => {
    const raw = bulkInput.value || "";
    const names = raw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (names.length === 0) {
      alert("최소 1개 이상의 항목 이름을 입력해 주세요.");
      bulkInput.focus();
      return;
    }

    const newItems = names.map((name) => ({
      name,
      color: randomColor(),
      weight: 1, // 모두 같은 확률(가중치 1)
    }));

    const modeChoice = panel.querySelector('input[type="radio"]:checked')?.value || "replace";
    if (modeChoice === "replace") {
      items = newItems;
    } else {
      items = items.concat(newItems);
    }

    bulkInput.value = "";
    closeBulkModal();
    resetResult();
    saveItems();
    renderList();
    draw();
    listEl.scrollTop = 0;
  });

  document.addEventListener("keydown", (e) => {
    if (!bulkModal.hidden && e.key === "Escape") {
      closeBulkModal();
    }
  });

  get("btnRemove").addEventListener("click", () => {
    const checked = [...listEl.querySelectorAll('input[type="checkbox"]:checked')]
      .map((c) => Number(c.dataset.index));
    let next;
    if (checked.length > 0) {
      next = items.filter((_, i) => !checked.includes(i));
    } else {
      next = items.slice(0, -1); // 체크된 항목이 없으면 마지막 항목 제거
    }
    if (next.length < 1) { alert("항목은 최소 1개 이상 필요합니다."); return; }
    items = next;
    resetResult();
    saveItems();
    renderList();
    draw();
  });

  get("btnReset").addEventListener("click", () => {
    if (!confirm("모든 항목을 초기 상태로 되돌릴까요?")) return;
    items = defaultItems();
    rotation = 0;
    resetResult();
    saveItems();
    renderList();
    draw();
  });

  function resetResult() {
    if (dartMode) clearDarts();
    winnerIndex = -1;
    if (mode === "stopped") mode = "idle";
    resultEl.innerHTML = "&nbsp;";
  }

  // ---------- 회전 제어 ----------
  function updateButtons() {
    const busy = mode === "spinning" || mode === "stopping";
    btnStart.disabled = busy;
    btnStop.disabled = mode !== "spinning";
    btnInstant.disabled = !busy;
    panel.classList.toggle("locked", busy);
    panel.querySelectorAll(".toolbar button, .preset-quick-bar button, .preset-quick-bar select, .list-wrap input, .list-wrap button").forEach(el => { el.disabled = busy; });
    if (dartMode) updateDartControls();
  }

  btnStart.addEventListener("click", () => {
    if (mode === "spinning" || mode === "stopping") return;
    if (dartMode && !startDarts()) return;
    winnerIndex = -1;
    resultEl.innerHTML = "&nbsp;";
    speed = 0;
    mode = "spinning";
    updateButtons();
  });

  // 정지: 누른 시점의 속도에서 서서히 감속하며 멈춤 (최종 위치는 이 순간 결정됨)
  btnStop.addEventListener("click", () => {
    if (mode !== "spinning") return;
    beginStopping();
  });

  // 즉시 정지: 감속 연출 없이, 멈추게 될 위치로 바로 이동
  btnInstant.addEventListener("click", () => {
    if (mode === "spinning") beginStopping();
    if (mode === "stopping") finishAt(stopInfo.final);
  });

  function beginStopping() {
    const T = STOP_TIME_MIN + Math.random() * (STOP_TIME_MAX - STOP_TIME_MIN);
    stopInfo = {
      a0: rotation,
      v0: speed,
      T,
      t: 0,
      // 선형 감속: 이동거리 = v0 * T / 2
      final: rotation + (speed * T) / 2,
    };
    mode = "stopping";
    updateButtons();
  }

  function finishAt(angle) {
    rotation = mod(angle, TWO_PI);
    speed = 0;
    mode = "stopped";
    if (dartMode) {
      showDartResults();
    } else {
      winnerIndex = indexAtPointer(rotation);
      const w = items[winnerIndex];
      resultEl.textContent = `🎉 결과: ${w.name || `항목 ${winnerIndex + 1}`}`;
    }
    updateButtons();
    draw();
  }

  function step(dt) {
    if (dartMode && panel.hidden) return;
    // Split a frame at impact so hit detection is independent of frame rate.
    if (dartMode && flight && dt > FLIGHT_TIME - flight.t + 1e-9) {
      const first = FLIGHT_TIME - flight.t;
      step(first);
      step(dt - first);
      return;
    }
    if (dartMode) hits.forEach(h => { h.age = Math.min(IMPACT_TIME + 1, h.age + dt); });
    if (mode === "spinning") {
      const accelerating = Math.min(dt, (MAX_SPEED - speed) / ACCEL);
      rotation = mod(rotation + speed * accelerating + ACCEL * accelerating * accelerating / 2 + MAX_SPEED * (dt - accelerating), TWO_PI);
      speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
      draw();
    } else if (mode === "stopping") {
      stopInfo.t += dt;
      if (stopInfo.t >= stopInfo.T) {
        finishAt(stopInfo.final);
      } else {
        const { a0, v0, T, t } = stopInfo;
        rotation = a0 + v0 * (t - (t * t) / (2 * T));
        speed = v0 * (1 - t / T);
        draw();
      }
    }
    if (dartMode) {
      updateFlight(dt);
      draw();
    }
  }

  function frame(ts) {
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
    lastTs = ts;
    step(dt);
    requestAnimationFrame(frame);
  }

  // ---------- 프리셋 (1~10 슬롯) 관리 ----------
  const PRESET_KEY = dartMode ? "roulette_darts_presets_v1" : "roulette_presets_v1";
  const PRESET_COUNT = 10;
  let presets = loadPresets();

  function defaultPresets() {
    const arr = [];
    for (let i = 1; i <= PRESET_COUNT; i++) {
      arr.push({
        id: i,
        title: `프리셋 ${i}`,
        items: null,
      });
    }
    return arr;
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === PRESET_COUNT) return arr;
      }
    } catch (e) { /* ignore */ }
    return defaultPresets();
  }

  function savePresets() {
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    } catch (e) { /* ignore */ }
    updatePresetQuickSelect();
  }

  const presetQuickSelect = get("presetQuickSelect");
  const btnQuickLoad = get("btnQuickLoad");
  const btnQuickSave = get("btnQuickSave");
  const btnPresetManage = get("btnPresetManage");
  const presetModal = get("presetModal");
  const presetList = get("presetList");
  const btnPresetModalClose = get("btnPresetModalClose");
  const btnPresetModalOk = get("btnPresetModalOk");

  function updatePresetQuickSelect() {
    const curVal = presetQuickSelect.value;
    presetQuickSelect.innerHTML = "";
    presets.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      const countText = p.items && p.items.length > 0 ? `(${p.items.length}개)` : "[비어있음]";
      opt.textContent = `${p.id}. ${p.title} ${countText}`;
      presetQuickSelect.appendChild(opt);
    });
    if (curVal) presetQuickSelect.value = curVal;
  }

  function saveToSlot(slotId, newTitle) {
    const slot = presets.find((p) => p.id === slotId);
    if (!slot) return;
    if (newTitle !== undefined && newTitle.trim().length > 0) {
      slot.title = newTitle.trim();
    }
    slot.items = JSON.parse(JSON.stringify(items));
    savePresets();
    renderPresetModalList();
  }

  function loadFromSlot(slotId) {
    if (mode === "spinning" || mode === "stopping") {
      alert("회전 중에는 프리셋을 불러올 수 없습니다.");
      return;
    }
    const slot = presets.find((p) => p.id === slotId);
    if (!slot || !slot.items || slot.items.length === 0) {
      alert(`프리셋 ${slotId}번 슬롯이 비어 있습니다.\n'현재 룰렛 저장'을 눌러 항목을 먼저 저장해 주세요.`);
      return;
    }
    items = JSON.parse(JSON.stringify(slot.items));
    resetResult();
    saveItems();
    renderList();
    draw();
    listEl.scrollTop = 0;
  }

  function clearSlot(slotId) {
    const slot = presets.find((p) => p.id === slotId);
    if (!slot) return;
    if (!confirm(`'${slot.title}' 프리셋을 비우시겠습니까?`)) return;
    slot.items = null;
    savePresets();
    renderPresetModalList();
  }

  function renderPresetModalList() {
    presetList.innerHTML = "";
    presets.forEach((p) => {
      const row = document.createElement("div");
      row.className = "preset-row";

      const num = document.createElement("span");
      num.className = "preset-slot-num";
      num.textContent = `#${p.id}`;

      const info = document.createElement("div");
      info.className = "preset-info";

      const nameWrap = document.createElement("div");
      nameWrap.className = "preset-name-wrap";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "preset-name-input";
      nameInput.value = p.title;
      nameInput.placeholder = `프리셋 ${p.id}`;
      nameInput.title = "프리셋 이름을 수정할 수 있습니다";
      nameInput.addEventListener("change", () => {
        p.title = nameInput.value.trim() || `프리셋 ${p.id}`;
        savePresets();
      });

      nameWrap.appendChild(nameInput);

      const preview = document.createElement("div");
      const hasItems = p.items && p.items.length > 0;
      preview.className = "preset-preview" + (hasItems ? "" : " empty");
      if (hasItems) {
        const itemNames = p.items.map((it) => it.name).join(", ");
        preview.textContent = `항목 ${p.items.length}개: ${itemNames}`;
        preview.title = itemNames;
      } else {
        preview.textContent = "(비어 있음 - 현재 룰렛을 저장해 보세요)";
      }

      info.append(nameWrap, preview);

      const actions = document.createElement("div");
      actions.className = "preset-row-actions";

      const btnLoad = document.createElement("button");
      btnLoad.type = "button";
      btnLoad.className = "preset-btn-sm preset-btn-load";
      btnLoad.textContent = "불러오기";
      btnLoad.disabled = !hasItems;
      btnLoad.addEventListener("click", () => {
        loadFromSlot(p.id);
        closePresetModal();
      });

      const btnSave = document.createElement("button");
      btnSave.type = "button";
      btnSave.className = "preset-btn-sm";
      btnSave.textContent = "현재 저장";
      btnSave.title = "현재 룰렛 항목을 이 슬롯에 저장합니다";
      btnSave.addEventListener("click", () => {
        saveToSlot(p.id, nameInput.value);
      });

      const btnClear = document.createElement("button");
      btnClear.type = "button";
      btnClear.className = "preset-btn-sm";
      btnClear.textContent = "비우기";
      btnClear.disabled = !hasItems;
      btnClear.addEventListener("click", () => {
        clearSlot(p.id);
      });

      actions.append(btnLoad, btnSave, btnClear);
      row.append(num, info, actions);
      presetList.appendChild(row);
    });
  }

  function openPresetModal() {
    renderPresetModalList();
    presetModal.hidden = false;
  }

  function closePresetModal() {
    presetModal.hidden = true;
  }

  btnPresetManage.addEventListener("click", openPresetModal);
  btnPresetModalClose.addEventListener("click", closePresetModal);
  btnPresetModalOk.addEventListener("click", closePresetModal);
  presetModal.addEventListener("click", (e) => {
    if (e.target === presetModal) closePresetModal();
  });

  btnQuickLoad.addEventListener("click", () => {
    const slotId = Number(presetQuickSelect.value) || 1;
    loadFromSlot(slotId);
  });

  btnQuickSave.addEventListener("click", () => {
    const slotId = Number(presetQuickSelect.value) || 1;
    const curSlot = presets.find((p) => p.id === slotId);
    const defaultName = curSlot ? curSlot.title : `프리셋 ${slotId}`;
    const newTitle = prompt(`프리셋 #${slotId}에 저장할 이름을 입력하세요:`, defaultName);
    if (newTitle !== null) {
      saveToSlot(slotId, newTitle);
      alert(`프리셋 #${slotId} ('${newTitle.trim() || defaultName}')에 현재 룰렛 항목이 저장되었습니다.`);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!presetModal.hidden && e.key === "Escape") {
      closePresetModal();
    }
  });

  // ---------- 시작 ----------
  TabManager.register({
    id: dartMode ? "roulette-darts" : "roulette",
    label: dartMode ? "룰렛 다트" : "룰렛",
    onHide() { bulkModal.hidden = true; presetModal.hidden = true; },
    onShow() { lastTs = 0; draw(); }
  });
  updatePresetQuickSelect();
  renderList();
  updateButtons();
  draw();
  requestAnimationFrame(frame);
  }
  createWheel(originalPanel, false);
  createWheel(dartPanel, true);
})();
