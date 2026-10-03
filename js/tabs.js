// 탭 관리자: 탭을 등록(register)하면 상단 탭 버튼이 자동으로 생기고 전환을 처리한다.
//   TabManager.register({
//     id: "pinball",            // panel-<id> 요소와 연결
//     label: "핀볼",             // 탭에 표시될 이름
//     onShow() {},              // (선택) 탭이 보여질 때 호출
//     onHide() {},              // (선택) 탭이 숨겨질 때 호출
//   });
const TabManager = (() => {
  const STORAGE_KEY = "roulette_active_tab_v1";
  const bar = document.getElementById("tabBar");
  const tabs = new Map(); // id -> { def, button, panel }
  let activeId = null;

  function savedId() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function register(def) {
    const panel = document.getElementById("panel-" + def.id);
    if (!panel) {
      console.error(`TabManager: #panel-${def.id} 요소를 찾을 수 없습니다.`);
      return;
    }

    const button = document.createElement("button");
    button.className = "tab-btn";
    button.type = "button";
    button.setAttribute("role", "tab");
    button.textContent = def.label;
    button.addEventListener("click", () => activate(def.id));
    bar.appendChild(button);

    tabs.set(def.id, { def, button, panel });

    // 처음 등록된 탭을 기본으로 열고, 마지막에 사용한 탭이 등록되면 그 탭으로 복원
    if (activeId === null || def.id === savedId()) activate(def.id);
    else panel.hidden = true;
  }

  function activate(id) {
    if (!tabs.has(id) || id === activeId) return;

    if (activeId !== null) {
      const prev = tabs.get(activeId);
      prev.panel.hidden = true;
      prev.button.classList.remove("active");
      prev.button.setAttribute("aria-selected", "false");
      if (prev.def.onHide) prev.def.onHide();
    }

    const cur = tabs.get(id);
    cur.panel.hidden = false;
    cur.button.classList.add("active");
    cur.button.setAttribute("aria-selected", "true");
    activeId = id;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* ignore */ }
    if (cur.def.onShow) cur.def.onShow();
  }

  return { register, activate };
})();
