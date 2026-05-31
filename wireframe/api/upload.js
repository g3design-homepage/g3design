const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { verifyAdminToken } = require("../lib/admin-auth");

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

const R2_PUBLIC = "https://pub-64e468fed30d4c00aefa275f39dd9f92.r2.dev";

module.exports = async (req, res) => {
  if (!verifyAdminToken(req))
    return res.status(401).json({ error: "인증 필요" });

  // POST - upload image
  if (req.method === "POST") {
    try {
      const { base64, key, contentType } = req.body;
      if (!base64 || !key)
        return res.status(400).json({ error: "base64, key 필요" });

      const data = base64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(data, "base64");

      await getS3().send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: contentType || "image/webp",
          CacheControl: "public, max-age=31536000",
        }),
      );

      return res.json({ success: true, url: `${R2_PUBLIC}/${key}` });
    } catch (err) {
      console.error("Upload error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE - delete image
  if (req.method === "DELETE") {
    try {
      const { key } = req.body;
      if (!key) return res.status(400).json({ error: "key 필요" });

      await getS3().send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
        }),
      );

      return res.json({ success: true });
    } catch (err) {
      console.error("Delete error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
