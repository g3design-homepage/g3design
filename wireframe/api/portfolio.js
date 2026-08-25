const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { verifyAdminToken } = require("../lib/admin-auth");
const { d1, d1Rows, genId } = require("../lib/d1");

const R2_PUBLIC = "https://pub-64e468fed30d4c00aefa275f39dd9f92.r2.dev";

function getS3() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function uploadBase64ToR2(base64, key) {
  const data = base64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(data, "base64");
  await getS3().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000",
    }),
  );
  return `${R2_PUBLIC}/${key}`;
}

// Background: upload images to R2 then update D1 record
async function uploadImagesBackground(recordId, thumbBase64, imageBase64s) {
  const ts = Date.now();
  const sets = [];
  const params = [];

  try {
    if (thumbBase64) {
      const key = `images/portfolio/admin/${ts}/thumb.webp`;
      const url = await uploadBase64ToR2(thumbBase64, key);
      sets.push("thumbnail=?");
      params.push(url);
    }

    if (imageBase64s && imageBase64s.length) {
      const urls = [];
      for (let i = 0; i < imageBase64s.length; i++) {
        const key = `images/portfolio/admin/${ts}/${i + 1}.webp`;
        const url = await uploadBase64ToR2(imageBase64s[i], key);
        urls.push(url);
      }
      const rows = await d1Rows("SELECT images FROM portfolio WHERE id=?", [
        recordId,
      ]);
      const existing = rows[0]?.images
        ? rows[0].images.split("\n").filter(Boolean)
        : [];
      sets.push("images=?");
      params.push([...existing, ...urls].join("\n"));
    }

    if (sets.length) {
      params.push(recordId);
      await d1(`UPDATE portfolio SET ${sets.join(",")} WHERE id=?`, params);
    }
  } catch (err) {
    console.error("Background image upload error:", err);
  }
}

function mapRow(r) {
  return {
    id: r.id,
    title: r.title || "",
    cat: r.category || "",
    subcategory: r.subcategory || "",
    img: r.thumbnail || "",
    images: r.images ? r.images.split("\n").filter(Boolean) : [],
    description: r.description || "",
    sortOrder: r.sortOrder || 0,
    visible: !!r.visible,
  };
}

// 목록에 상세 이미지 주소까지 실으면 응답이 281KB 까지 불어난다. 목록 화면은
// 썸네일만 쓰므로 필요한 칸만 골라 읽고, 상세 이미지는 모달을 열 때 id 로 따로 받는다.
const LIST_COLUMNS =
  "id, title, category, subcategory, thumbnail, sortOrder, visible";

function mapListRow(r) {
  return {
    id: r.id,
    title: r.title || "",
    cat: r.category || "",
    subcategory: r.subcategory || "",
    img: r.thumbnail || "",
    sortOrder: r.sortOrder || 0,
    visible: !!r.visible,
  };
}

module.exports = async (req, res) => {
  // GET without auth (public portfolio list)
  if (req.method === "GET") {
    const adminMode = verifyAdminToken(req);
    try {
      // 관리자 화면은 항상 최신을 봐야 하므로 캐시하지 않는다.
      // 공개 목록은 엣지에서 1분간 재사용한다. 관리자가 새 시공사례를 올리고 바로
      // 홈페이지에서 확인하는 흐름이라 이보다 길면 "안 올라갔나" 싶은 공백이 생긴다.
      // 1분이어도 그동안 들어온 요청은 전부 한 응답을 나눠 쓰므로 D1 조회는 분당 1회다.
      // 그 뒤 5분간은 낡은 응답을 먼저 주면서 뒤에서 갱신한다.
      res.setHeader(
        "Cache-Control",
        adminMode
          ? "private, no-store"
          : "public, s-maxage=60, stale-while-revalidate=300",
      );

      const { id, page, limit } = req.query || {};

      // 단건 상세 — 모달을 열 때 이 경로로 이미지 목록을 받는다
      if (id) {
        const rows = await d1Rows(
          `SELECT * FROM portfolio WHERE id=?${adminMode ? "" : " AND visible=1"}`,
          [id],
        );
        if (!rows.length) return res.status(404).json({ error: "없는 항목" });
        return res.json({ item: mapRow(rows[0]) });
      }

      const where = adminMode ? "" : "WHERE visible=1";
      const countRows = await d1Rows(
        `SELECT COUNT(*) AS n FROM portfolio ${where}`,
      );
      const total = countRows[0]?.n || 0;

      // page 를 주지 않으면 지금까지처럼 전체를 돌려준다. 기존 화면을 깨지 않으면서
      // 필요할 때만 나눠 받게 하려는 것이다.
      // 관리자 화면은 편집을 위해 이미지 목록까지 필요하므로 모든 칸을 그대로 준다.
      let sql = `SELECT ${adminMode ? "*" : LIST_COLUMNS} FROM portfolio ${where} ORDER BY sortOrder DESC`;
      const params = [];
      let pageInfo = null;
      if (page) {
        const per = Math.min(Math.max(parseInt(limit, 10) || 24, 1), 100);
        const cur = Math.max(parseInt(page, 10) || 1, 1);
        sql += " LIMIT ? OFFSET ?";
        params.push(per, (cur - 1) * per);
        pageInfo = { page: cur, limit: per, totalPages: Math.ceil(total / per) };
      }

      const rows = await d1Rows(sql, params);
      const items = rows.map(adminMode ? mapRow : mapListRow);
      return res.json(pageInfo ? { items, total, ...pageInfo } : { items, total });
    } catch (err) {
      console.error("Portfolio GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Auth required for write operations
  if (!verifyAdminToken(req))
    return res.status(401).json({ error: "인증 필요" });

  // POST - add new portfolio item
  if (req.method === "POST") {
    try {
      const {
        title,
        category,
        cat,
        thumbnail,
        thumbnailUrl,
        images,
        imageUrls,
        description,
        thumbBase64,
        imageBase64s,
      } = req.body;
      const catValue = category || cat;
      const thumbValue = thumbnail || thumbnailUrl;
      const imgsValue = images || imageUrls || [];

      if (!title || !catValue)
        return res.status(400).json({ error: "제목, 카테고리 필요" });

      const maxRows = await d1Rows(
        "SELECT COALESCE(MAX(sortOrder),0) AS m FROM portfolio",
      );
      const maxOrder = maxRows[0]?.m || 0;
      const recordId = genId();

      await d1(
        `INSERT INTO portfolio (id,title,category,thumbnail,images,description,sortOrder,visible,createdAt)
         VALUES (?,?,?,?,?,?,?,1,?)`,
        [
          recordId,
          title,
          catValue,
          thumbValue || "",
          Array.isArray(imgsValue) ? imgsValue.join("\n") : imgsValue || "",
          description || "",
          maxOrder + 1,
          new Date().toISOString(),
        ],
      );

      if (thumbBase64 || (imageBase64s && imageBase64s.length)) {
        await uploadImagesBackground(recordId, thumbBase64, imageBase64s);
      }

      res.json({ success: true, id: recordId });
    } catch (err) {
      console.error("Portfolio POST error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH - update portfolio item
  else if (req.method === "PATCH") {
    try {
      const {
        id,
        title,
        category,
        cat,
        thumbnail,
        thumbnailUrl,
        images,
        imageUrls,
        description,
        visible,
        sortOrder,
        thumbBase64,
        imageBase64s,
      } = req.body;
      if (!id) return res.status(400).json({ error: "id 필요" });

      const sets = [];
      const params = [];
      if (title !== undefined) {
        sets.push("title=?");
        params.push(title);
      }
      if (category || cat) {
        sets.push("category=?");
        params.push(category || cat);
      }
      if (thumbnail || thumbnailUrl) {
        sets.push("thumbnail=?");
        params.push(thumbnail || thumbnailUrl);
      }
      if (images || imageUrls) {
        const imgs = images || imageUrls;
        sets.push("images=?");
        params.push(Array.isArray(imgs) ? imgs.join("\n") : imgs);
      }
      if (description !== undefined) {
        sets.push("description=?");
        params.push(description);
      }
      if (visible !== undefined) {
        sets.push("visible=?");
        params.push(visible ? 1 : 0);
      }
      if (sortOrder !== undefined) {
        sets.push("sortOrder=?");
        params.push(sortOrder);
      }

      if (sets.length) {
        params.push(id);
        await d1(`UPDATE portfolio SET ${sets.join(",")} WHERE id=?`, params);
      }

      if (thumbBase64 || (imageBase64s && imageBase64s.length)) {
        await uploadImagesBackground(id, thumbBase64, imageBase64s);
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Portfolio PATCH error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PUT - bulk update sortOrder
  else if (req.method === "PUT") {
    try {
      const { orders } = req.body;
      if (!Array.isArray(orders) || orders.length === 0)
        return res.status(400).json({ error: "orders 배열 필요" });

      const { d1Batch } = require("../lib/d1");
      await d1Batch(
        orders.map((o) => ({
          sql: "UPDATE portfolio SET sortOrder=? WHERE id=?",
          params: [o.sortOrder, o.id],
        })),
      );
      return res.json({ success: true, updated: orders.length });
    } catch (err) {
      console.error("Portfolio PUT (reorder) error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE - delete portfolio item
  else if (req.method === "DELETE") {
    try {
      const id = req.query?.id || req.body?.id;
      if (!id) return res.status(400).json({ error: "id 필요" });

      await d1("DELETE FROM portfolio WHERE id=?", [id]);
      return res.json({ success: true });
    } catch (err) {
      console.error("Portfolio DELETE error:", err);
      return res.status(500).json({ error: err.message });
    }
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
};
