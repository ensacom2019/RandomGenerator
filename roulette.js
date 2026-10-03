(() => {
  "use strict";

  const STORAGE_KEY = "roulette_items_v1";
  const TWO_PI = Math.PI * 2;
  const MAX_SPEED = 10;        // rad/s (최대 회전 속도)
  const ACCEL = 8;             // rad/s^2 (시작 시 가속)
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
  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const listEl = document.getElementById("list");
  const sumInfo = document.getElementById("sumInfo");
  const resultEl = document.getElementById("result");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const btnInstant = document.getElementById("btnInstant");

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
  document.getElementById("btnAdd").addEventListener("click", () => {
    items.push({ name: `항목 ${items.length + 1}`, color: randomColor(), weight: 1 });
    resetResult();
    saveItems();
    renderList();
    draw();
    listEl.scrollTop = listEl.scrollHeight;
  });

  document.getElementById("btnRemove").addEventListener("click", () => {
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

  document.getElementById("btnReset").addEventListener("click", () => {
    if (!confirm("모든 항목을 초기 상태로 되돌릴까요?")) return;
    items = defaultItems();
    rotation = 0;
    resetResult();
    saveItems();
    renderList();
    draw();
  });

  function resetResult() {
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
    document.body.classList.toggle("locked", busy);
  }

  btnStart.addEventListener("click", () => {
    if (mode === "spinning" || mode === "stopping") return;
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
    winnerIndex = indexAtPointer(rotation);
    const w = items[winnerIndex];
    resultEl.textContent = `🎉 결과: ${w.name || `항목 ${winnerIndex + 1}`}`;
    updateButtons();
    draw();
  }

  function frame(ts) {
    const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
    lastTs = ts;

    if (mode === "spinning") {
      speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
      rotation = mod(rotation + speed * dt, TWO_PI);
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
    requestAnimationFrame(frame);
  }

  // ---------- 시작 ----------
  TabManager.register({ id: "roulette", label: "룰렛" });
  renderList();
  updateButtons();
  draw();
  requestAnimationFrame(frame);
})();
