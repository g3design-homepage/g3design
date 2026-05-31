// GA4 → D1 visitors 백필 (런타임 실행 — GA4 키/D1 프록시가 Vercel에 있음)
// 관리자 인증 필요. 멱등: 합성행은 ipHash 'ga4_' 접두사 → 재실행 시 기존 합성행 삭제 후 재생성.
//   POST /api/backfill?confirm=ga4   (Authorization: Bearer <admin token>)
const { verifyAdminToken } = require("../lib/admin-auth");
const { d1, d1Batch } = require("../lib/d1");

const CITY_KO = {
  Seoul: "서울",
  Busan: "부산",
  Incheon: "인천",
  Daegu: "대구",
  Daejeon: "대전",
  Gwangju: "광주",
  Ulsan: "울산",
  Sejong: "세종",
  Suwon: "수원",
  Goyang: "고양",
  Seongnam: "성남",
  Bucheon: "부천",
  Ansan: "안산",
  Yongin: "용인",
  Anyang: "안양",
  Gimpo: "김포",
  Hwaseong: "화성",
  Pyeongtaek: "평택",
  Cheongju: "청주",
  Jeonju: "전주",
  Changwon: "창원",
  Jeju: "제주",
  Wonju: "원주",
  Chuncheon: "춘천",
  Paju: "파주",
  Siheung: "시흥",
  Gunpo: "군포",
  Gwangmyeong: "광명",
  Guri: "구리",
  Hanam: "하남",
  Osan: "오산",
  Icheon: "이천",
  Yangju: "양주",
  Uijeongbu: "의정부",
  Namyangju: "남양주",
  Asan: "아산",
  Cheonan: "천안",
  Gimhae: "김해",
  Yangsan: "양산",
};
const toKoCity = (c) => {
  if (!c) return "";
  const clean = c.replace(/-(si|gu|dong|gun|myeon)$/i, "");
  return CITY_KO[clean] || CITY_KO[c] || c;
};

async function ga4DailyCityDevice() {
  const { google } = require("googleapis");
  const pid = process.env.GA4_PROPERTY_ID;
  const pk = process.env.GA4_PRIVATE_KEY_B64
    ? Buffer.from(process.env.GA4_PRIVATE_KEY_B64, "base64").toString("utf-8")
    : (process.env.GA4_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GA4_CLIENT_EMAIL,
      private_key: pk,
    },
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const ad = google.analyticsdata({ version: "v1beta", auth });
  const res = await ad.properties.runReport({
    property: `properties/${pid}`,
    requestBody: {
      dateRanges: [{ startDate: "2024-01-01", endDate: "today" }],
      dimensions: [
        { name: "date" },
        { name: "country" },
        { name: "city" },
        { name: "deviceCategory" },
      ],
      metrics: [{ name: "activeUsers" }],
      limit: 100000,
    },
  });
  return res.data.rows || [];
}

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });
  if (!verifyAdminToken(req))
    return res.status(401).json({ error: "인증 필요" });
  if (req.query.confirm !== "ga4")
    return res.status(400).json({ error: "confirm=ga4 필요" });

  try {
    const rows = await ga4DailyCityDevice();

    // 합성행 생성 (사용자 수만큼). 과대 방지 캡.
    const CAP = 60000;
    const inserts = [];
    let truncated = false;
    for (const row of rows) {
      const ymd = row.dimensionValues[0].value; // YYYYMMDD
      const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
      const country = row.dimensionValues[1].value;
      const cityRaw = row.dimensionValues[2].value;
      const device = row.dimensionValues[3].value || "";
      const users = parseInt(row.metricValues[0].value) || 0;
      const isKorea = country === "South Korea" || country === "Korea";
      const city = isKorea ? toKoCity(cityRaw) : cityRaw;
      const region = isKorea ? "" : country; // 읽기측 isKorea 판정 호환
      for (let i = 0; i < users; i++) {
        if (inserts.length >= CAP) {
          truncated = true;
          break;
        }
        inserts.push({
          sql: `INSERT INTO visitors (id,date,ipHash,city,district,region,page,device,referrer)
                VALUES (?,?,?,?,?,?,?,?,?)`,
          params: [
            "ga4" + Math.random().toString(36).slice(2, 12) + inserts.length,
            date,
            `ga4_${date}_${inserts.length}`,
            city || "",
            "",
            region || "",
            "/",
            device,
            "",
          ],
        });
      }
      if (truncated) break;
    }

    // 멱등: 기존 GA4 합성행 제거 후 재삽입
    await d1("DELETE FROM visitors WHERE ipHash LIKE 'ga4\\_%' ESCAPE '\\'");
    if (inserts.length) await d1Batch(inserts);

    const cnt = await d1(
      "SELECT count(*) AS total, sum(case when ipHash LIKE 'ga4\\_%' ESCAPE '\\' then 1 else 0 end) AS ga4 FROM visitors",
    );
    return res.json({
      success: true,
      ga4Rows: rows.length,
      synthesized: inserts.length,
      truncated,
      visitors: cnt.results?.[0] || {},
    });
  } catch (err) {
    console.error("Backfill error:", err);
    return res.status(500).json({ error: err.message });
  }
};
