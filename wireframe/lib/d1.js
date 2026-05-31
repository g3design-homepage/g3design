// D1 Proxy 클라이언트 — Vercel API Routes 에서 사용
// env: D1_PROXY_URL (Worker 엔드포인트), D1_PROXY_TOKEN (Bearer 시크릿)
const crypto = require("crypto");

function getConfig() {
  const url = process.env.D1_PROXY_URL;
  const token = process.env.D1_PROXY_TOKEN;
  if (!url || !token) throw new Error("D1 proxy 미설정");
  return { url, token };
}

// 단일 쿼리 실행 → { results: [...], meta }
async function d1(sql, params = []) {
  const { url, token } = getConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`D1 ${res.status}: ${data.error || ""}`);
  return data;
}

// 배치 실행 → [{results},...]
async function d1Batch(queries) {
  const { url, token } = getConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ batch: queries }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`D1 ${res.status}: ${data.error || ""}`);
  return data.results || [];
}

// 행 목록만 필요할 때
async function d1Rows(sql, params = []) {
  const { results } = await d1(sql, params);
  return results || [];
}

// 고유 ID 생성 (Airtable rec... 호환 형식)
function genId() {
  return "rec" + crypto.randomBytes(12).toString("hex").slice(0, 14);
}

module.exports = { d1, d1Batch, d1Rows, genId };
