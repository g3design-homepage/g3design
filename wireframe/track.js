// G3 Design 방문 기록 (/api/track → D1 visitors)
// 위치는 서버가 Vercel 지역 헤더로 채운다. 브라우저에서 http://ip-api.com 을 부르면
// HTTPS 페이지가 Mixed Content 로 막아 기록이 한 건도 남지 않았다.
(function () {
  if (sessionStorage.getItem("g3t")) return;
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      page: location.pathname,
      device: /mobile|android|iphone/i.test(navigator.userAgent)
        ? "mobile"
        : "desktop",
      referrer: document.referrer || "",
    }),
  })
    .then(function (r) {
      if (r.ok) sessionStorage.setItem("g3t", "1");
    })
    .catch(function () {});
})();
