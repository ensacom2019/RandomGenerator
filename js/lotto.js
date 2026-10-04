// 번호 뽑기 (로또 구슬함 추첨기) 모듈
// - 0부터 사용자가 지정한 끝 번호까지 범위 설정
// - 2가지 추첨 옵션:
//     1) 나온 번호 또 안 나오기 (중복 없음 / 비복원 추출)
//     2) 나온 번호 상관 없이 나오기 (중복 허용 / 복원 추출)
// - 회전하는 투명 아크릴 챔버(구슬함) + 배출 파이프 연출 (HTML5 Canvas 2D)
// - 당첨 번호 결과 트레이, 오름차순 정렬, 클립보드 복사 등 지원

(() => {
  "use strict";

  // ========== UI 템플릿 주입 ==========
  const panel = document.getElementById("panel-lotto");
  if (!panel) return;

  panel.innerHTML = `
    <div class="lt-container">
      <h1>번호 뽑기 (로또 추첨기)</h1>
      <p style="color: #636e72; font-size: 14px; margin-top: -6px; margin-bottom: 14px;">
        0부터 원하는 끝 번호까지 지정하고, 회전하는 구슬함을 돌려 행운의 번호를 뽑아보세요!
      </p>

      <!-- 설정 패널 -->
      <div class="lt-config-panel">
        <div class="lt-config-row">
          <div class="lt-range-group">
            <span>번호 범위:</span>
            <input type="number" id="ltMinNum" value="1" min="0" max="999" title="시작 번호">
            <span>~</span>
            <input type="number" id="ltMaxNum" value="45" min="1" max="999" title="끝 번호">
            <span id="ltRangeInfo" class="lt-range-info">(총 45개)</span>
          </div>
          <span id="ltRemainBadge" class="lt-remain-badge">남은 번호: 45 / 45</span>
        </div>

        <div class="lt-config-row">
          <div class="lt-mode-group">
            <label>
              <input type="radio" name="ltDrawMode" value="unique" checked>
              <span>나온 번호 또 안 나오기 (중복 없음)</span>
            </label>
            <label>
              <input type="radio" name="ltDrawMode" value="repeat">
              <span>나온 번호 상관 없이 나오기 (중복 허용)</span>
            </label>
          </div>
        </div>
      </div>

      <!-- 캔버스 무대 -->
      <div class="lt-stage">
        <canvas id="ltCanvas" class="lt-canvas" width="820" height="460"></canvas>
        <div id="ltAnnouncement" class="lt-announcement hidden">
          <span>당첨 번호!</span>
          <div id="ltAnnBall" class="lotto-ball color-yellow">
            <div class="lotto-ball-inner">?</div>
          </div>
        </div>
      </div>

      <!-- 제어 버튼들 -->
      <div class="lt-controls">
        <button id="btnLottoDraw" class="lt-btn-draw" type="button">🎱 1개 뽑기</button>
        <button id="btnLottoDraw6" class="lt-btn-sub" type="button">✨ 연속 6개 뽑기</button>
        <button id="btnLottoReset" class="lt-btn-sub" type="button">🔄 초기화</button>
      </div>

      <!-- 결과 목록 트레이 -->
      <div class="lt-result-section">
        <div class="lt-result-header">
          <div class="lt-result-title">
            당첨 번호 목록 (<span id="ltPickedCount">0</span>개)
          </div>
          <div class="lt-result-actions">
            <button id="btnLottoSort" class="lt-btn-sm" type="button">🔢 번호순(오름차순) 정렬</button>
            <button id="btnLottoCopy" class="lt-btn-sm" type="button">📋 번호 복사</button>
          </div>
        </div>
        <div id="ltBallsTray" class="lt-balls-tray">
          <span class="lt-tray-empty">추첨 버튼을 눌러 번호를 뽑아보세요.</span>
        </div>
      </div>
    </div>
  `;

  // ========== 엘리먼트 참조 ==========
  const $ = (id) => document.getElementById(id);
  const minNumInput = $("ltMinNum");
  const maxNumInput = $("ltMaxNum");
  const rangeInfoEl = $("ltRangeInfo");
  const remainBadgeEl = $("ltRemainBadge");
  const modeRadios = document.querySelectorAll('input[name="ltDrawMode"]');
  const canvas = $("ltCanvas");
  const ctx = canvas.getContext("2d");
  const annEl = $("ltAnnouncement");
  const annBallEl = $("ltAnnBall");
  const btnDraw = $("btnLottoDraw");
  const btnDraw6 = $("btnLottoDraw6");
  const btnReset = $("btnLottoReset");
  const btnSort = $("btnLottoSort");
  const btnCopy = $("btnLottoCopy");
  const ballsTray = $("ltBallsTray");
  const pickedCountEl = $("ltPickedCount");

  // ========== 상태 관리 ==========
  let minNum = 1;
  let maxNum = 45;
  let isUniqueMode = true; // true: 중복 없음, false: 중복 허용
  let availablePool = [];  // 중복 없을 때 남은 번호 목록
  let pickedHistory = [];  // 뽑힌 번호 히스토리 [{ id, num, colorClass }]
  let isSortedView = false; // 결과 트레이 정렬 여부
  let isDrawing = false;   // 현재 추첨 애니메이션 진행 중 여부
  let multiDrawRemaining = 0; // 연속 뽑기 남은 개수

  // 로또볼 컬러 테마 팔레트 (Canvas & CSS 동기화)
  const COLOR_THEMES = {
    yellow: { fill1: "#ffeaa7", fill2: "#fdcb6e", border: "#d68910", text: "#111", class: "color-yellow" },
    blue:   { fill1: "#74b9ff", fill2: "#0984e3", border: "#0652dd", text: "#fff", class: "color-blue" },
    red:    { fill1: "#ff7675", fill2: "#d63031", border: "#b71540", text: "#fff", class: "color-red" },
    gray:   { fill1: "#dfe6e9", fill2: "#b2bec3", border: "#636e72", text: "#222", class: "color-gray" },
    green:  { fill1: "#55efc4", fill2: "#00b894", border: "#009432", text: "#fff", class: "color-green" },
    purple: { fill1: "#a29bfe", fill2: "#6c5ce7", border: "#4834d4", text: "#fff", class: "color-purple" },
  };

  function getBallTheme(num) {
    if (num === 0) return COLOR_THEMES.purple;
    const n = Math.abs(num);
    const bracket = Math.floor((n - 1) / 10);
    switch (bracket % 5) {
      case 0: return COLOR_THEMES.yellow; // 1~10, 51~60...
      case 1: return COLOR_THEMES.blue;   // 11~20, 61~70...
      case 2: return COLOR_THEMES.red;    // 21~30, 71~80...
      case 3: return COLOR_THEMES.gray;   // 31~40, 81~90...
      case 4: return COLOR_THEMES.green;  // 41~50, 91~100...
      default: return COLOR_THEMES.yellow;
    }
  }

  // ========== 번호 풀 및 통계 초기화 ==========
  function syncRangeAndPool(resetPicked = false) {
    let minVal = parseInt(minNumInput.value, 10);
    let maxVal = parseInt(maxNumInput.value, 10);

    if (isNaN(minVal) || minVal < 0) minVal = 0;
    if (isNaN(maxVal) || maxVal < minVal) maxVal = minVal;
    if (maxVal > 999) maxVal = 999;

    minNum = minVal;
    maxNum = maxVal;
    minNumInput.value = minNum;
    maxNumInput.value = maxNum;

    const totalCount = maxNum - minNum + 1;
    rangeInfoEl.textContent = `(총 ${totalCount}개)`;

    if (resetPicked) {
      pickedHistory = [];
      availablePool = [];
      for (let i = minNum; i <= maxNum; i++) availablePool.push(i);
    } else {
      // 범위 변경 시 이미 뽑힌 것 중 범위 밖의 것 제거하거나 풀 재조정
      const pickedSet = new Set(pickedHistory.map(p => p.num));
      availablePool = [];
      for (let i = minNum; i <= maxNum; i++) {
        if (!isUniqueMode || !pickedSet.has(i)) {
          availablePool.push(i);
        }
      }
    }

    updateUI();
    reseedChamberBalls();
  }

  function updateUI() {
    const totalCount = maxNum - minNum + 1;
    if (isUniqueMode) {
      const remain = availablePool.length;
      remainBadgeEl.textContent = `남은 번호: ${remain} / ${totalCount}`;
      remainBadgeEl.style.color = remain === 0 ? "#e84118" : "#0a7cff";
      remainBadgeEl.style.background = remain === 0 ? "#ffeaa7" : "#e8f3ff";
      btnDraw.disabled = isDrawing || remain === 0;
      btnDraw6.disabled = isDrawing || remain === 0;
    } else {
      remainBadgeEl.textContent = `중복 허용 모드 (총 ${totalCount}개 중 무제한 추첨)`;
      remainBadgeEl.style.color = "#2ed573";
      remainBadgeEl.style.background = "#e9f9ee";
      btnDraw.disabled = isDrawing;
      btnDraw6.disabled = isDrawing;
    }
    pickedCountEl.textContent = pickedHistory.length;
    renderTray();
  }

  // ========== 결과 트레이 렌더링 ==========
  function renderTray() {
    if (pickedHistory.length === 0) {
      ballsTray.innerHTML = `<span class="lt-tray-empty">추첨 버튼을 눌러 번호를 뽑아보세요.</span>`;
      return;
    }

    let list = [...pickedHistory];
    if (isSortedView) {
      list.sort((a, b) => a.num - b.num);
    }

    ballsTray.innerHTML = "";
    list.forEach((item) => {
      const ball = document.createElement("div");
      ball.className = `lotto-ball ${item.theme.class}`;
      ball.title = `추첨 번호: ${item.num}`;
      ball.innerHTML = `<div class="lotto-ball-inner">${item.num}</div>`;
      ballsTray.appendChild(ball);
    });
  }

  // ========== Canvas 시각화 & 물리 시뮬레이션 ==========
  // 챔버(구슬함) 구성 파라미터
  const chamber = {
    x: 350,
    y: 230,
    radius: 145,
    angle: 0,
    spinSpeed: 0.02,
    targetSpeed: 0.02,
    stirBladeAngle: 0,
  };

  // 배출 파이프(아크릴 튜브) 경로
  // 챔버 우측 상단(챔버 원주 부근)에서 시작하여 우측 하단 배출구로 완만하게 S자로 뻗어나가는 튜브
  const pipe = {
    start: { x: 450, y: 150 },
    cp1:   { x: 580, y: 130 },
    cp2:   { x: 620, y: 280 },
    end:   { x: 730, y: 340 },
  };

  // 챔버 내부 구슬 목록
  let chamberBalls = [];
  // 현재 배출 튜브를 통과하고 있는 구슬
  let ejectingBall = null;
  // 당첨 연출 파티클 효과
  let celebrationParticles = [];

  class ChamberBall {
    constructor(num) {
      this.num = num;
      this.theme = getBallTheme(num);
      this.r = 13;
      // 챔버 중심에서 원형 내 무작위 위치
      const a = Math.random() * Math.PI * 2;
      const dist = Math.random() * (chamber.radius - this.r - 8);
      this.x = chamber.x + Math.cos(a) * dist;
      this.y = chamber.y + Math.sin(a) * dist;
      this.vx = (Math.random() - 0.5) * 2;
      this.vy = (Math.random() - 0.5) * 2;
      this.rot = Math.random() * Math.PI * 2;
      this.vRot = (Math.random() - 0.5) * 0.1;
    }

    update(speedMultiplier) {
      // 챔버 회전에 따른 원심력 및 교반 날개 효과
      const dx = this.x - chamber.x;
      const dy = this.y - chamber.y;
      const dist = Math.hypot(dx, dy);

      // 교반 회전력 주입
      const tangX = -dy / (dist || 1);
      const tangY = dx / (dist || 1);

      this.vx += tangX * 0.18 * speedMultiplier;
      this.vy += tangY * 0.18 * speedMultiplier;

      // 중력
      this.vy += 0.22;

      // 바람 및 난류(바람에 날리는 에어볼 효과)
      if (speedMultiplier > 1.2) {
        this.vx += (Math.random() - 0.5) * 1.8 * speedMultiplier;
        this.vy += (Math.random() - 0.5) * 1.8 * speedMultiplier - 0.35 * speedMultiplier;
      }

      // 속도 감쇠
      this.vx *= 0.985;
      this.vy *= 0.985;

      this.x += this.vx;
      this.y += this.vy;
      this.rot += this.vRot + (this.vx * 0.05);

      // 챔버 원형 벽면 충돌 처리
      const maxDist = chamber.radius - this.r - 3;
      const newDx = this.x - chamber.x;
      const newDy = this.y - chamber.y;
      const newDist = Math.hypot(newDx, newDy);

      if (newDist > maxDist) {
        const nx = newDx / newDist;
        const ny = newDy / newDist;
        // 위치 보정
        this.x = chamber.x + nx * maxDist;
        this.y = chamber.y + ny * maxDist;

        // 반사 탄성
        const dot = this.vx * nx + this.vy * ny;
        this.vx = (this.vx - 2 * dot * nx) * 0.75;
        this.vy = (this.vy - 2 * dot * ny) * 0.75;
      }
    }

    draw(ctx) {
      drawSphereBall(ctx, this.x, this.y, this.r, this.theme, this.num);
    }
  }

  function reseedChamberBalls() {
    chamberBalls = [];
    const count = Math.min(48, Math.max(24, maxNum - minNum + 1));
    const step = Math.max(1, Math.floor((maxNum - minNum + 1) / count));
    for (let i = 0; i < count; i++) {
      let num = minNum + (i * step) % (maxNum - minNum + 1);
      chamberBalls.push(new ChamberBall(num));
    }
  }

  // 3D 입체 구형 로또볼 렌더링 헬퍼
  function drawSphereBall(ctx, x, y, r, theme, num, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;

    // 공 그림자
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.fill();

    // 공 베이스 그라디언트 (빛을 받는 3D 볼)
    const grad = ctx.createRadialGradient(
      x - r * 0.35, y - r * 0.35, r * 0.1,
      x, y, r
    );
    grad.addColorStop(0, theme.fill1);
    grad.addColorStop(0.7, theme.fill2);
    grad.addColorStop(1, theme.border);

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = theme.border;
    ctx.stroke();

    // 중앙 흰색 원형 라벨
    const innerR = r * 0.58;
    ctx.beginPath();
    ctx.arc(x, y, innerR, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
    ctx.stroke();

    // 번호 텍스트
    if (num !== null && num !== undefined) {
      ctx.fillStyle = "#1e272e";
      ctx.font = `bold ${Math.max(10, Math.round(innerR * 1.15))}px 'Arial Black', Impact, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(num, x, y + 0.5);
    }

    // 상단 반사 하이라이트 (유리/플라스틱 광택)
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.3, r * 0.15, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
    ctx.fill();

    ctx.restore();
  }

  // 3차 베지에 곡선 위치 계산
  function getBezierPoint(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const x = mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x;
    const y = mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y;
    return { x, y };
  }

  // 축하 파티클
  function spawnCelebration(x, y) {
    celebrationParticles = [];
    const colors = ["#fbc531", "#4cd137", "#487eb0", "#e84118", "#9c88ff", "#00d2d3", "#ff9ff3"];
    for (let i = 0; i < 45; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 7;
      celebrationParticles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + Math.random() * 5,
        life: 1.0,
        decay: 0.015 + Math.random() * 0.02,
        rot: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 0.2,
      });
    }
  }

  // ========== 메인 애니메이션 루프 ==========
  let animId = null;

  function renderScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. 배경 은은한 격자 및 조명
    ctx.save();
    const bgGrad = ctx.createRadialGradient(380, 230, 80, 410, 230, 450);
    bgGrad.addColorStop(0, "#233346");
    bgGrad.addColorStop(1, "#0d131a");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 바닥 그림자
    ctx.beginPath();
    ctx.ellipse(chamber.x, chamber.y + chamber.radius + 38, chamber.radius * 1.1, 24, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fill();
    ctx.restore();

    // 2. 챔버 메탈 스탠드 (거치대)
    ctx.save();
    // V자형 크롬 지지대
    ctx.strokeStyle = "#718093";
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(chamber.x - 90, chamber.y + chamber.radius + 35);
    ctx.lineTo(chamber.x, chamber.y + 40);
    ctx.lineTo(chamber.x + 90, chamber.y + chamber.radius + 35);
    ctx.stroke();

    // 하단 베이스 판
    ctx.fillStyle = "#2f3640";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(chamber.x - 120, chamber.y + chamber.radius + 28, 240, 16, 6);
    } else {
      ctx.rect(chamber.x - 120, chamber.y + chamber.radius + 28, 240, 16);
    }
    ctx.fill();
    ctx.strokeStyle = "#dcdde1";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 3. 투명 배출 파이프 (아크릴 레일 튜브)
    ctx.save();
    // 튜브 외곽선 & 투명 채우기
    ctx.lineWidth = 34;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pipe.start.x, pipe.start.y);
    ctx.bezierCurveTo(pipe.cp1.x, pipe.cp1.y, pipe.cp2.x, pipe.cp2.y, pipe.end.x, pipe.end.y);
    ctx.stroke();

    // 튜브 글라스 하이라이트 테두리
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.stroke();

    // 배출구 금속 링
    ctx.beginPath();
    ctx.arc(pipe.end.x, pipe.end.y, 22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(251, 197, 49, 0.25)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#fbc531";
    ctx.stroke();

    // 배출구 안내 라벨
    ctx.fillStyle = "#fbc531";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("EXIT", pipe.end.x, pipe.end.y + 36);
    ctx.restore();

    // 4. 챔버 구슬함 내부 뒷면 반사광 & 회전 날개
    ctx.save();
    ctx.beginPath();
    ctx.arc(chamber.x, chamber.y, chamber.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10, 25, 45, 0.45)";
    ctx.fill();
    ctx.clip();

    // 회전 교반 날개 (3방향 패들)
    ctx.save();
    ctx.translate(chamber.x, chamber.y);
    ctx.rotate(chamber.stirBladeAngle);
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    for (let b = 0; b < 3; b++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(chamber.radius * 0.85, -12);
      ctx.lineTo(chamber.radius * 0.85, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // 중앙 피벗 캡
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fillStyle = "#dcdde1";
    ctx.fill();
    ctx.restore();

    // 5. 챔버 내부 구슬 시뮬레이션 및 렌더링
    chamber.spinSpeed += (chamber.targetSpeed - chamber.spinSpeed) * 0.08;
    chamber.stirBladeAngle += chamber.spinSpeed * 1.5;
    const speedMult = chamber.spinSpeed / 0.02;

    for (let ball of chamberBalls) {
      ball.update(speedMult);
      ball.draw(ctx);
    }
    ctx.restore(); // 클립 해제

    // 6. 챔버 앞면 유리 구면 렌즈 및 글라스 림(외곽 테두리)
    ctx.save();
    // 유리 돔 표면 반사 (원형 하이라이트)
    const glassGrad = ctx.createRadialGradient(
      chamber.x - chamber.radius * 0.4,
      chamber.y - chamber.radius * 0.45,
      10,
      chamber.x,
      chamber.y,
      chamber.radius
    );
    glassGrad.addColorStop(0, "rgba(255, 255, 255, 0.35)");
    glassGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.05)");
    glassGrad.addColorStop(0.85, "rgba(255, 255, 255, 0.0)");
    glassGrad.addColorStop(1, "rgba(0, 168, 255, 0.2)");

    ctx.beginPath();
    ctx.arc(chamber.x, chamber.y, chamber.radius, 0, Math.PI * 2);
    ctx.fillStyle = glassGrad;
    ctx.fill();

    // 골드/크롬 메탈릭 베젤 링
    ctx.lineWidth = 10;
    const ringGrad = ctx.createLinearGradient(
      chamber.x - chamber.radius, chamber.y - chamber.radius,
      chamber.x + chamber.radius, chamber.y + chamber.radius
    );
    ringGrad.addColorStop(0, "#f5cd79");
    ringGrad.addColorStop(0.5, "#ffffff");
    ringGrad.addColorStop(1, "#e67e22");
    ctx.strokeStyle = ringGrad;
    ctx.stroke();

    // 유리 돔 상단 반원 하이라이트 호
    ctx.beginPath();
    ctx.arc(chamber.x, chamber.y, chamber.radius - 12, -Math.PI * 0.8, -Math.PI * 0.2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.stroke();
    ctx.restore();

    // 7. 배출 중인 구슬 (Ejecting Ball) 애니메이션
    if (ejectingBall) {
      ejectingBall.progress += 0.028; // 약 35프레임(약 0.6초) 동안 파이프 주행
      if (ejectingBall.progress <= 1.0) {
        const pt = getBezierPoint(pipe.start, pipe.cp1, pipe.cp2, pipe.end, ejectingBall.progress);
        const curScale = 1.0 + ejectingBall.progress * 0.45; // 배출구로 오면서 점점 커짐
        drawSphereBall(ctx, pt.x, pt.y, 16 * curScale, ejectingBall.theme, ejectingBall.num);
      } else {
        // 배출 완료 단계 (확대 스포트라이트 연출)
        ejectingBall.revealTimer = (ejectingBall.revealTimer || 0) + 1;
        const pt = pipe.end;

        // 황금빛 펄스 링
        const pulse = Math.sin(ejectingBall.revealTimer * 0.2) * 6;
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 36 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(251, 197, 49, 0.7)";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();

        // 최종 대형 볼 렌더링
        drawSphereBall(ctx, pt.x, pt.y, 28, ejectingBall.theme, ejectingBall.num);

        if (ejectingBall.revealTimer === 1) {
          spawnCelebration(pt.x, pt.y);
          showAnnouncement(ejectingBall.num, ejectingBall.theme);
        }

        if (ejectingBall.revealTimer > 40) {
          // 연출 종료 -> 트레이에 추가
          completeEjection(ejectingBall);
          ejectingBall = null;
        }
      }
    }

    // 8. 축하 파티클 애니메이션
    if (celebrationParticles.length > 0) {
      for (let i = celebrationParticles.length - 1; i >= 0; i--) {
        const p = celebrationParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18; // 중력
        p.rot += p.rotSpeed;
        p.life -= p.decay;

        if (p.life <= 0) {
          celebrationParticles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.5);
        ctx.restore();
      }
    }

    animId = requestAnimationFrame(renderScene);
  }

  function showAnnouncement(num, theme) {
    annBallEl.className = `lotto-ball ${theme.class}`;
    annBallEl.innerHTML = `<div class="lotto-ball-inner">${num}</div>`;
    annEl.classList.remove("hidden");
  }

  function completeEjection(ballData) {
    pickedHistory.push({
      id: Date.now() + Math.random(),
      num: ballData.num,
      theme: ballData.theme,
    });
    updateUI();

    // 고속 회전 해제
    chamber.targetSpeed = 0.02;
    isDrawing = false;

    // 연속 추첨 대기열 처리
    if (multiDrawRemaining > 0) {
      multiDrawRemaining--;
      if (multiDrawRemaining > 0) {
        if (isUniqueMode && availablePool.length === 0) {
          multiDrawRemaining = 0;
          updateUI();
          return;
        }
        setTimeout(() => {
          executeSingleDraw();
        }, 600);
      } else {
        updateUI();
      }
    } else {
      updateUI();
    }
  }

  // ========== 추첨 로직 ==========
  function executeSingleDraw() {
    if (isDrawing) return;

    if (isUniqueMode && availablePool.length === 0) {
      alert("모든 번호를 다 뽑았습니다! 새로운 추첨을 위해 초기화를 눌러주세요.");
      multiDrawRemaining = 0;
      updateUI();
      return;
    }

    isDrawing = true;
    updateUI();
    annEl.classList.add("hidden");

    // 1. 번호 선택
    let chosenNum;
    if (isUniqueMode) {
      const idx = Math.floor(Math.random() * availablePool.length);
      chosenNum = availablePool.splice(idx, 1)[0];
    } else {
      chosenNum = minNum + Math.floor(Math.random() * (maxNum - minNum + 1));
    }

    const theme = getBallTheme(chosenNum);

    // 2. 챔버 초고속 회전 시작 (구슬들이 에어에 춤추듯 회전)
    chamber.targetSpeed = 0.16;

    // 3. 약 1.1초 후 튜브 배출 시작
    setTimeout(() => {
      ejectingBall = {
        num: chosenNum,
        theme: theme,
        progress: 0,
        revealTimer: 0,
      };
    }, 1100);
  }

  // ========== 이벤트 리스너 ==========
  minNumInput.addEventListener("change", () => syncRangeAndPool(true));
  maxNumInput.addEventListener("change", () => syncRangeAndPool(true));

  modeRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      isUniqueMode = e.target.value === "unique";
      syncRangeAndPool(false);
    });
  });

  btnDraw.addEventListener("click", () => {
    multiDrawRemaining = 0;
    executeSingleDraw();
  });

  btnDraw6.addEventListener("click", () => {
    if (isDrawing) return;
    const count = 6;
    if (isUniqueMode && availablePool.length < count) {
      if (availablePool.length === 0) {
        alert("남은 번호가 없습니다!");
        return;
      }
      if (!confirm(`남은 번호가 ${availablePool.length}개 뿐입니다. 남은 번호만 모두 뽑으시겠습니까?`)) {
        return;
      }
      multiDrawRemaining = availablePool.length;
    } else {
      multiDrawRemaining = count;
    }
    executeSingleDraw();
  });

  btnReset.addEventListener("click", () => {
    if (isDrawing) {
      if (!confirm("추첨이 진행 중입니다. 정말 초기화하시겠습니까?")) return;
    }
    ejectingBall = null;
    isDrawing = false;
    multiDrawRemaining = 0;
    chamber.targetSpeed = 0.02;
    annEl.classList.add("hidden");
    syncRangeAndPool(true);
  });

  btnSort.addEventListener("click", () => {
    isSortedView = !isSortedView;
    btnSort.textContent = isSortedView ? "⏱️ 뽑힌 순서로 보기" : "🔢 번호순(오름차순) 정렬";
    renderTray();
  });

  btnCopy.addEventListener("click", async () => {
    if (pickedHistory.length === 0) {
      alert("복사할 당첨 번호가 없습니다.");
      return;
    }
    let list = [...pickedHistory];
    if (isSortedView) list.sort((a, b) => a.num - b.num);
    const text = list.map((p) => p.num).join(", ");

    try {
      await navigator.clipboard.writeText(text);
      const originalText = btnCopy.textContent;
      btnCopy.textContent = "✅ 복사 완료!";
      setTimeout(() => {
        btnCopy.textContent = originalText;
      }, 1500);
    } catch (e) {
      prompt("아래 번호를 복사하세요 (Ctrl+C):", text);
    }
  });

  // ========== 초기화 및 탭 등록 ==========
  function init() {
    syncRangeAndPool(true);
  }

  const tm = (typeof TabManager !== "undefined") ? TabManager : (typeof window !== "undefined" ? window.TabManager : null);
  if (tm) {
    tm.register({
      id: "lotto",
      label: "번호 뽑기",
      onShow() {
        if (!animId) animId = requestAnimationFrame(renderScene);
      },
      onHide() {
        if (animId && !isDrawing) {
          cancelAnimationFrame(animId);
          animId = null;
        }
      },
    });
  } else {
    console.error("TabManager를 찾을 수 없어 번호 뽑기 탭을 등록하지 못했습니다.");
  }

  init();
})();
