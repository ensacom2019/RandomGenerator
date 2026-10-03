// 추첨 탭: 항목(이름/개수)을 설정 → 추첨 시작 → 별 칸을 눌러 숨겨진 항목 확인
(() => {
  "use strict";

  const STORAGE_KEY = "lottery_items_v1";
  const MAX_TOTAL = 100;

  const panel = document.getElementById("panel-draw");
  panel.innerHTML = `
    <!-- 설정 화면 -->
    <div id="ltSetup" class="lt-setup">
      <h1>추첨</h1>
      <p class="lt-desc">추첨판에 들어갈 항목과 개수를 정한 뒤 <b>추첨 시작</b>을 누르세요.</p>
      <div class="toolbar">
        <button id="ltAdd" class="tool">항목 추가</button>
        <button id="ltReset" class="tool">리셋</button>
      </div>
      <div class="lt-list-head"><span class="lt-h-name">항목 이름</span><span class="lt-h-cnt">개수</span></div>
      <div id="ltList" class="lt-list"></div>
      <div id="ltTotal" class="lt-total"></div>
      <div class="controls">
        <button id="ltStart" class="primary">추첨 시작</button>
      </div>
    </div>

    <!-- 추첨판 화면 -->
    <div id="ltPlay" class="lt-play" hidden>
      <div class="lt-topbar">
        <button id="ltBack" class="tool">← 설정으로</button>
        <button id="ltRestart" class="tool">다시 섞기</button>
        <span id="ltRemain" class="lt-remain"></span>
      </div>
      <div class="lt-play-body">
        <div class="lt-board">
          <div class="lt-board-head">추첨판</div>
          <div id="ltGrid" class="lt-grid"></div>
        </div>
        <aside class="lt-side">
          <h3>남은 항목</h3>
          <div id="ltSummary" class="lt-summary"></div>
          <h3>뽑은 결과</h3>
          <ol id="ltHistory" class="lt-history"></ol>
        </aside>
      </div>
    </div>

    <!-- 결과 팝업 -->
    <div id="ltModal" class="lt-modal" hidden>
      <div class="lt-card">
        <div class="lt-card-title">🎉 추첨 결과</div>
        <div id="ltCardName" class="lt-card-name"></div>
        <button id="ltCardOk" class="primary">확인</button>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const setupEl = $("ltSetup"), playEl = $("ltPlay");
  const listEl = $("ltList"), totalEl = $("ltTotal");
  const gridEl = $("ltGrid"), remainEl = $("ltRemain");
  const summaryEl = $("ltSummary"), historyEl = $("ltHistory");
  const modalEl = $("ltModal"), cardNameEl = $("ltCardName");

  // ---------- 데이터 ----------
  function defaultItems() {
    return [
      { name: "1등", count: 1 },
      { name: "2등", count: 2 },
      { name: "3등", count: 3 },
      { name: "꽝", count: 14 },
    ];
  }
  let items = load();
  function load() {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) { /* ignore */ }
    return defaultItems();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
  }
  const total = () => items.reduce((s, it) => s + (it.count || 0), 0);
  const colorOf = (i) => `hsl(${(i * 137.5) % 360}, 70%, 40%)`;

  // ---------- 설정 화면 ----------
  function renderList() {
    listEl.innerHTML = "";
    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "lt-row";

      const dot = document.createElement("span");
      dot.className = "lt-dot";
      dot.style.background = colorOf(i);

      const name = document.createElement("input");
      name.type = "text";
      name.className = "lt-name";
      name.value = it.name;
      name.placeholder = `항목 ${i + 1}`;
      name.addEventListener("input", () => { it.name = name.value; save(); });

      const cnt = document.createElement("input");
      cnt.type = "number";
      cnt.className = "lt-cnt";
      cnt.min = 1;
      cnt.value = it.count;
      cnt.addEventListener("change", () => {
        it.count = Math.max(1, Math.floor(Number(cnt.value)) || 1);
        cnt.value = it.count;
        save(); updateTotal();
      });

      const minus = document.createElement("button");
      minus.textContent = "-";
      minus.addEventListener("click", () => {
        it.count = Math.max(1, it.count - 1); cnt.value = it.count; save(); updateTotal();
      });
      const plus = document.createElement("button");
      plus.textContent = "+";
      plus.addEventListener("click", () => {
        it.count += 1; cnt.value = it.count; save(); updateTotal();
      });

      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "이 항목 삭제";
      del.addEventListener("click", () => {
        if (items.length <= 1) { alert("항목은 최소 1개 이상 필요합니다."); return; }
        items.splice(i, 1); save(); renderList();
      });

      row.append(dot, name, cnt, minus, plus, del);
      listEl.appendChild(row);
    });
    updateTotal();
  }

  function updateTotal() {
    const t = total();
    const over = t > MAX_TOTAL;
    totalEl.textContent = `항목 ${items.length}종 · 추첨판 칸 수 합계 ${t}칸 (최대 ${MAX_TOTAL}칸)` +
      (over ? ` — ${t - MAX_TOTAL}칸 초과! 개수를 줄여주세요.` : "");
    totalEl.style.color = over ? "#d32f2f" : "";
    totalEl.style.fontWeight = over ? "bold" : "";
  }

  $("ltAdd").addEventListener("click", () => {
    items.push({ name: `항목 ${items.length + 1}`, count: 1 });
    save(); renderList();
    listEl.scrollTop = listEl.scrollHeight;
  });
  $("ltReset").addEventListener("click", () => {
    if (!confirm("항목을 초기 상태로 되돌릴까요?")) return;
    items = defaultItems(); save(); renderList();
  });

  // ---------- 추첨판 ----------
  let cells = [];        // { item: index, opened: bool }
  let remainCount = [];  // 항목별 남은 개수
  let picks = 0;
  let busy = false;      // 결과 팝업이 떠 있는 동안 클릭 방지

  function startBoard() {
    if (total() > MAX_TOTAL) {
      alert(`추첨판은 최대 ${MAX_TOTAL}칸까지 만들 수 있습니다.\n현재 ${total()}칸이므로 항목 개수를 줄여주세요.`);
      return;
    }
    const valid = items
      .map((it, i) => ({ name: (it.name || "").trim() || `항목 ${i + 1}`, count: it.count, idx: i }))
      .filter((it) => it.count > 0);
    if (!valid.length) return;

    cells = [];
    remainCount = items.map(() => 0);
    valid.forEach((it) => {
      for (let k = 0; k < it.count && cells.length < MAX_TOTAL; k++) {
        cells.push({ item: it.idx, opened: false });
        remainCount[it.idx]++;
      }
    });
    // Fisher-Yates 셔플: 어느 칸에 무엇이 들어있는지 무작위
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    picks = 0;
    busy = false;
    historyEl.innerHTML = "";
    renderGrid();
    renderSummary();
    updateRemain();
    setupEl.hidden = true;
    playEl.hidden = false;
  }

  function nameOf(i) {
    return (items[i].name || "").trim() || `항목 ${i + 1}`;
  }

  function renderGrid() {
    const n = cells.length;
    const cols = Math.max(3, Math.ceil(Math.sqrt((n * 2) / 3)));
    const size = Math.max(22, Math.min(64, Math.floor(640 / cols)));
    gridEl.style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
    gridEl.style.setProperty("--cell", size + "px");
    gridEl.innerHTML = "";
    cells.forEach((c, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lt-cell";
      b.dataset.idx = idx;
      b.textContent = "★";
      gridEl.appendChild(b);
    });
  }

  function renderSummary() {
    summaryEl.innerHTML = "";
    items.forEach((it, i) => {
      if (!cells.some((c) => c.item === i)) return;
      const row = document.createElement("div");
      row.className = "lt-sum-row" + (remainCount[i] === 0 ? " done" : "");
      const dot = document.createElement("span");
      dot.className = "lt-dot";
      dot.style.background = colorOf(i);
      const name = document.createElement("span");
      name.className = "lt-sum-name";
      name.textContent = nameOf(i);
      const cnt = document.createElement("span");
      cnt.className = "lt-sum-cnt";
      const totalOf = cells.filter((c) => c.item === i).length;
      cnt.textContent = `${remainCount[i]} / ${totalOf}`;
      row.append(dot, name, cnt);
      summaryEl.appendChild(row);
    });
  }

  function updateRemain() {
    const left = cells.length - picks;
    remainEl.textContent = left > 0 ? `남은 칸 ${left} / 전체 ${cells.length}` : "모든 칸을 뽑았습니다!";
  }

  gridEl.addEventListener("click", (e) => {
    const b = e.target.closest(".lt-cell");
    if (!b || busy) return;
    const idx = Number(b.dataset.idx);
    const c = cells[idx];
    if (c.opened) return;
    c.opened = true;
    busy = true;
    picks++;
    remainCount[c.item]--;

    // 별 스티커를 떼어내는 연출 후 결과 공개
    b.classList.add("peeling");
    setTimeout(() => {
      b.classList.remove("peeling");
      b.classList.add("opened");
      b.textContent = nameOf(c.item).slice(0, 2);
      b.style.color = colorOf(c.item);
      b.title = nameOf(c.item);
      showResult(c.item);
    }, 380);
  });

  function showResult(itemIdx) {
    const li = document.createElement("li");
    li.textContent = nameOf(itemIdx);
    li.style.color = colorOf(itemIdx);
    historyEl.prepend(li);
    renderSummary();
    updateRemain();
    cardNameEl.textContent = nameOf(itemIdx);
    cardNameEl.style.color = colorOf(itemIdx);
    modalEl.hidden = false;
    $("ltCardOk").focus();
  }

  function closeModal() {
    modalEl.hidden = true;
    busy = false;
  }
  $("ltCardOk").addEventListener("click", closeModal);
  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (!modalEl.hidden && (e.key === "Escape" || e.key === "Enter")) closeModal();
  });

  $("ltStart").addEventListener("click", startBoard);
  $("ltRestart").addEventListener("click", () => {
    if (picks > 0 && picks < cells.length && !confirm("진행 중인 추첨판을 버리고 다시 섞을까요?")) return;
    startBoard();
  });
  $("ltBack").addEventListener("click", () => {
    if (picks > 0 && picks < cells.length && !confirm("설정 화면으로 돌아가면 현재 추첨판이 사라집니다. 계속할까요?")) return;
    playEl.hidden = true;
    setupEl.hidden = false;
  });

  // ---------- 시작 ----------
  TabManager.register({ id: "draw", label: "추첨" });
  renderList();
})();
