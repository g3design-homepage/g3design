/**
 * 광고 랜딩 이탈 방지 (exit guard)
 *
 * 진입 시 히스토리 엔트리를 1개 심어 두고, 뒤로가기가 그 엔트리를 소비하면
 * 페이지를 떠나는 대신 상담 유도 팝업을 띄운다. 팝업의 "다음에 볼게요"를 누르면
 * 실제로 이전 페이지(광고 등)로 내보내므로 방문자를 가두지 않는다.
 *
 * 이탈을 시도할 때마다 작동한다. 같은 방문자가 팝업을 닫고 사이트를 더 둘러본 뒤
 * 다시 나가려 해도, 다른 페이지로 이동한 뒤에 나가려 해도 똑같이 뜬다. 대신 팝업이
 * 떠 있는 상태에서 뒤로가기를 한 번 더 누르면 그때는 붙잡지 않고 내보낸다. 이
 * 탈출구가 없으면 브라우저 뒤로가기로는 영영 못 나가는 구조가 되기 때문이다.
 *
 * 오버레이(모달·라이트박스)와의 충돌은 history.state 마커로 구분한다.
 * 스택이 [진입(g3Entry), 가드(g3Guard), 오버레이(g3Overlay)] 순으로 쌓이므로,
 * popstate 직후 state 가 g3Entry 일 때만 팝업을 띄운다. 그래서 모달을 닫는
 * 뒤로가기는 팝업을 부르지 않고, 리스너 등록 순서에도 영향을 받지 않는다.
 *
 * 브라우저 정책 주의: 크롬은 방문자가 페이지를 한 번도 건드리지 않으면
 * (클릭·탭·스크롤이 전혀 없으면) 스크립트가 심은 엔트리를 건너뛴다. 뒤로가기
 * 버튼을 인질로 잡는 수법을 막으려는 정책이라 우회할 방법이 없다. 따라서 광고를
 * 잘못 눌러 즉시 나가는 방문자에게는 작동하지 않고, 스크롤이라도 한 번 한
 * 방문자부터 잡힌다.
 */
(function () {
  "use strict";

  var armed = true;
  var popup = null;

  // 상담을 이미 남긴 방문자에게는 띄우지 않는다 (contact 완료 화면이 노출된 상태)
  function submitted() {
    var ok = document.getElementById("ok");
    return !!(ok && !ok.classList.contains("hidden"));
  }

  function isOpen() {
    return !!(popup && popup.classList.contains("open"));
  }

  // 진입 엔트리에 마커를 남기고, 그 위에 가드 엔트리를 1개 쌓는다
  history.replaceState({ g3Entry: 1 }, "");
  history.pushState({ g3Guard: 1 }, "");

  var CSS = [
    "#g3ExitGuard{position:fixed;inset:0;z-index:11000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(26,26,26,.62)}",
    "#g3ExitGuard.open{display:flex}",
    "#g3ExitGuard .eg-box{position:relative;width:100%;max-width:400px;background:#fff;border-radius:14px;padding:34px 26px 24px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.3);animation:egIn .28s cubic-bezier(.2,.8,.3,1)}",
    "@keyframes egIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}",
    "#g3ExitGuard .eg-x{position:absolute;top:10px;right:12px;width:32px;height:32px;border:0;background:none;color:#999999;font-size:26px;line-height:1;cursor:pointer}",
    "#g3ExitGuard .eg-x:hover{color:#1A1A1A}",
    "#g3ExitGuard .eg-badge{display:inline-block;margin-bottom:14px;padding:5px 12px;border-radius:999px;background:#F5F0E8;color:#A17D4A;font-size:12px;font-weight:700;letter-spacing:.02em}",
    "#g3ExitGuard h2{margin:0 0 10px;color:#1A1A1A;font-size:20px;font-weight:700;line-height:1.4;letter-spacing:-.01em}",
    "#g3ExitGuard p{margin:0 0 22px;color:#555555;font-size:14px;line-height:1.7}",
    "#g3ExitGuard .eg-cta{display:block;width:100%;padding:15px;border:0;border-radius:8px;background:#A17D4A;color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:background .2s}",
    "#g3ExitGuard .eg-cta:hover{background:#8B6A3C}",
    "#g3ExitGuard .eg-leave{display:block;width:100%;margin-top:6px;padding:12px;border:0;background:none;color:#999999;font-size:13px;cursor:pointer}",
    "#g3ExitGuard .eg-leave:hover{color:#555555}",
    "@media (max-width:380px){#g3ExitGuard .eg-box{padding:28px 20px 20px}#g3ExitGuard h2{font-size:18px}}",
  ].join("");

  function build() {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var el = document.createElement("div");
    el.id = "g3ExitGuard";
    el.innerHTML =
      '<div class="eg-box" role="dialog" aria-modal="true" aria-labelledby="egTitle">' +
      '<button class="eg-x" type="button" aria-label="닫기">&times;</button>' +
      '<span class="eg-badge">무료 상담</span>' +
      '<h2 id="egTitle">예상 견적만 받아보고 가세요</h2>' +
      "<p>공간 종류와 평수만 알려주시면 시공 범위와 대략적인 예산을 정리해 보내드립니다. 상담을 신청하셔도 계약 의무는 없습니다.</p>" +
      '<button class="eg-cta" type="button">무료 견적 받기</button>' +
      '<button class="eg-leave" type="button">다음에 볼게요</button>' +
      "</div>";

    el.addEventListener("click", function (e) {
      if (e.target === el) hide();
    });
    el.querySelector(".eg-x").addEventListener("click", hide);
    el.querySelector(".eg-cta").addEventListener("click", goToForm);
    el.querySelector(".eg-leave").addEventListener("click", leave);

    document.body.appendChild(el);
    return el;
  }

  function show() {
    if (!popup) popup = build();
    popup.classList.add("open");
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
  }

  function hide() {
    if (popup) popup.classList.remove("open");
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") hide();
  }

  // 상담 페이지 안이면 폼으로 스크롤하고, 다른 페이지면 상담 페이지로 보낸다
  function goToForm() {
    hide();
    if (/contact/.test(location.pathname)) {
      var form =
        document.getElementById("formWrap") || document.getElementById("form");
      if (form) {
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    location.href = "/contact#form";
  }

  // 실제 이탈: 팝업을 띄우면서 가드 엔트리를 다시 쌓았으므로 2칸을 물러난다
  function leave() {
    armed = false;
    hide();
    history.go(-2);
  }

  window.addEventListener("popstate", function () {
    var st = history.state;
    if (!st || st.g3Entry !== 1) return; // 오버레이를 닫는 뒤로가기는 그냥 통과시킨다

    // 나가기를 눌렀거나 이미 상담을 남긴 방문자는 붙잡지 않는다. 가드 엔트리 때문에
    // 뒤로가기 1회가 헛돌지 않도록 남은 엔트리를 대신 소비한다.
    if (!armed || submitted()) {
      armed = false;
      history.back();
      return;
    }

    // 팝업이 떠 있는데 또 뒤로가기를 눌렀다면 정말 나가려는 뜻이므로 그대로 보낸다.
    // 이 탈출구가 없으면 브라우저 뒤로가기로는 영영 못 나가는 구조가 된다.
    if (isOpen()) {
      armed = false;
      hide();
      history.back();
      return;
    }

    history.pushState({ g3Guard: 1 }, ""); // 다음 이탈 시도도 잡도록 가드를 다시 쌓는다
    show();
  });
})();
