// portfolio 정적 JSON → D1 시드 (1회용)
// 실행: node worker/seed-portfolio.js
const crypto = require("crypto");
const data = require("../data/portfolio-data.json");
const details = require("../data/portfolio-details.json");

const URL = process.env.D1_PROXY_URL;
const TOKEN = process.env.D1_PROXY_TOKEN;
if (!URL || !TOKEN) throw new Error("D1_PROXY_URL / D1_PROXY_TOKEN 필요");

const genId = () => "rec" + crypto.randomBytes(12).toString("hex").slice(0, 14);
const total = data.length;

const queries = data.map((item, i) => {
  const imgs = details[String(i + 1)] || [];
  return {
    sql: `INSERT INTO portfolio (id,title,category,subcategory,thumbnail,images,description,sortOrder,visible,createdAt)
          VALUES (?,?,?,?,?,?,?,?,1,?)`,
    params: [
      genId(),
      item.title || "",
      item.cat || "",
      "",
      item.img || "",
      Array.isArray(imgs) ? imgs.join("\n") : "",
      "",
      total - i, // JSON 순서 보존 (DESC 정렬 시 첫 항목이 최상단)
      new Date().toISOString(),
    ],
  };
});

(async () => {
  const CHUNK = 40;
  let done = 0;
  for (let i = 0; i < queries.length; i += CHUNK) {
    const batch = queries.slice(i, i + CHUNK);
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch }),
    });
    const d = await res.json();
    if (!res.ok) {
      console.error("FAIL at chunk", i, d);
      process.exit(1);
    }
    done += batch.length;
    console.log(`seeded ${done}/${total}`);
  }
  console.log("✅ done");
})();
