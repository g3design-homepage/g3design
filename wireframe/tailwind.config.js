/**
 * 정적 CSS 빌드 설정
 *
 * 기존에는 각 페이지가 cdn.tailwindcss.com 을 동기로 불러 브라우저에서 CSS 를
 * 만들었다. 그 스크립트가 렌더를 막아 모바일 첫 화면 표시가 5초까지 늦어져서,
 * 여기서 미리 빌드한 styles.css 한 장으로 대체한다.
 *
 * 색은 전부 CSS 변수(RGB 채널)로 뽑아 둔다. 페이지마다 accent 와 bg-muted 값이
 * 달라서(before-after 는 붉은 계열, index·portfolio 는 bg-muted 가 밝다) 각
 * 페이지가 :root 에서 변수만 덮어쓰면 되게 하려는 것이다. 채널 방식이라야
 * bg-accent/30 같은 투명도 변형이 그대로 작동한다.
 *
 * 빌드: npx tailwindcss -i src/input.css -o styles.css --minify
 * admin.html 은 대상에서 뺐다. 관리자 화면이라 로딩 속도 부담이 없고 클래스가
 * 많아 CSS 만 커진다. 그 페이지는 CDN 을 그대로 쓴다.
 */
const withAlpha = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  content: [
    "./index.html",
    "./portfolio.html",
    "./about.html",
    "./contact.html",
    "./before-after.html",
    "./privacy.html",
    "./terms.html",
  ],
  theme: {
    extend: {
      colors: {
        bg: withAlpha("bg"),
        "bg-warm": withAlpha("bg-warm"),
        "bg-muted": withAlpha("bg-muted"),
        text: withAlpha("text"),
        "text-sub": withAlpha("text-sub"),
        "text-muted": withAlpha("text-muted"),
        accent: withAlpha("accent"),
        "accent-hover": withAlpha("accent-hover"),
        "accent-light": withAlpha("accent-light"),
        "g3-red": withAlpha("g3-red"),
        border: withAlpha("border"),
        dark: withAlpha("dark"),
        "dark-section": withAlpha("dark-section"),
        success: withAlpha("success"),
      },
    },
  },
};
