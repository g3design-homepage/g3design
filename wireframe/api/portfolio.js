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

module.exports = async (req, res) => {
  // GET without auth (public portfolio list)
  if (req.method === "GET") {
    const adminMode = verifyAdminToken(req);
    try {
      const where = adminMode ? "" : "WHERE visible=1";
      const rows = await d1Rows(
        `SELECT * FROM portfolio ${where} ORDER BY sortOrder DESC`,
      );
      const items = rows.map(mapRow);
      return res.json({ items, total: items.length });
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
