// Airtable → D1 정확 백필 (6/1 한도 리셋 후 실행)
// 전제: Airtable billing-lock 해제 상태여야 함
//
// 실행:
//   cd wireframe
//   npx vercel env pull .env.production --environment=production --token "$VERCEL_TOKEN" --yes
//   set -a; source .env.production; set +a
//   D1_PROXY_URL=https://g3design.drdo6890ys.workers.dev \
//   D1_PROXY_TOKEN=<token> \
//   node worker/backfill-from-airtable.js
//   rm -f .env.production
//
// 멱등: visitors 는 UNIQUE(ipHash,date) → INSERT OR IGNORE.
//       leads/popups 는 Airtable recordId 를 D1 id 로 그대로 사용 → INSERT OR IGNORE 로 재실행 안전.

const crypto = require("crypto");

const AT_KEY = process.env.AIRTABLE_API_KEY;
const BASE = process.env.AIRTABLE_BASE_ID;
const LEADS_TBL = process.env.AIRTABLE_TABLE_ID;
const POPUP_TBL = process.env.AIRTABLE_POPUP_TABLE;
const VISITORS_TBL = "visitors";
const R2_PUBLIC = "https://pub-64e468fed30d4c00aefa275f39dd9f92.r2.dev";

const PROXY = process.env.D1_PROXY_URL;
const PT = process.env.D1_PROXY_TOKEN;
if (!AT_KEY || !BASE || !PROXY || !PT) {
  throw new Error("AIRTABLE_API_KEY/BASE_ID + D1_PROXY_URL/TOKEN 필요");
}

const genId = () => "rec" + crypto.randomBytes(12).toString("hex").slice(0, 14);

async function fetchAll(table) {
  let all = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${BASE}/${table}?pageSize=100${offset ? "&offset=" + offset : ""}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AT_KEY}` },
    });
    const d = await r.json();
    if (d.errors || d.error) {
      throw new Error(
        `Airtable ${table}: ${JSON.stringify(d.errors || d.error)}`,
      );
    }
    all = all.concat(d.records || []);
    offset = d.offset;
  } while (offset);
  return all;
}

async function d1Batch(queries) {
  for (let i = 0; i < queries.length; i += 40) {
    const batch = queries.slice(i, i + 40);
    const res = await fetch(PROXY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(`D1: ${d.error}`);
  }
}

function photosToUrls(photos) {
  if (!Array.isArray(photos)) return "";
  return photos
    .map((p) => {
      if (typeof p === "string") return p;
      if (p.filename) return `${R2_PUBLIC}/submissions/${p.filename}`;
      return p.url || "";
    })
    .filter(Boolean)
    .join("\n");
}

(async () => {
  // 1) visitors
  const vis = await fetchAll(VISITORS_TBL);
  await d1Batch(
    vis.map((r) => {
      const f = r.fields;
      return {
        sql: `INSERT OR IGNORE INTO visitors (id,date,ipHash,city,district,region,page,device,referrer)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        params: [
          genId(),
          f.date || "",
          f.ipHash || "",
          f.city || "",
          f.district || "",
          f.region || "",
          f.page || "/",
          f.device || "",
          f.referrer || "",
        ],
      };
    }),
  );
  console.log(`visitors: ${vis.length} 건 처리`);

  // 2) leads (recordId 를 D1 id 로 사용)
  if (LEADS_TBL) {
    const leads = await fetchAll(LEADS_TBL);
    await d1Batch(
      leads.map((r) => {
        const f = r.fields;
        return {
          sql: `INSERT OR IGNORE INTO leads
                (id,name,phone,email,interiorType,budget,area,address,schedule,message,photos,privacyConsent,status,source,memo,createdAt)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          params: [
            r.id,
            f.Name || "",
            f.phone || "",
            f.email || "",
            f.interiorType || "",
            f.budget || "",
            f.area || "",
            f.address || "",
            f.schedule || "",
            f.message || "",
            photosToUrls(f.photos),
            f.privacyConsent ? 1 : 0,
            f.status || "new",
            f.source || "homepage",
            f.memo || "",
            r.createdTime || "", // ISO — DESC 정렬용
          ],
        };
      }),
    );
    console.log(`leads: ${leads.length} 건 처리`);
  }

  // 3) popups
  if (POPUP_TBL) {
    const popups = await fetchAll(POPUP_TBL);
    await d1Batch(
      popups.map((r) => {
        const f = r.fields;
        return {
          sql: `INSERT OR IGNORE INTO popups (id,title,imageUrl,linkUrl,active,startDate,endDate,createdAt)
                VALUES (?,?,?,?,?,?,?,?)`,
          params: [
            r.id,
            f.title || "",
            f.imageUrl || "",
            f.linkUrl || "",
            f.active === true || f.active === "true" ? 1 : 0,
            f.startDate || "",
            f.endDate || "",
            f.createdAt || r.createdTime || "",
          ],
        };
      }),
    );
    console.log(`popups: ${popups.length} 건 처리`);
  }

  console.log("✅ 백필 완료");
})();
