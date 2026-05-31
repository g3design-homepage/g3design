const { verifyAdminToken } = require("../lib/admin-auth");
const { d1, d1Rows } = require("../lib/d1");

const PAGE_SIZE = 50;

function mapRow(r) {
  return {
    id: r.id,
    name: r.name || "",
    phone: r.phone || "",
    email: r.email || "",
    interiorType: r.interiorType || "",
    budget: r.budget || "",
    area: r.area || "",
    address: r.address || "",
    schedule: r.schedule || "",
    message: r.message || "",
    photos: r.photos ? r.photos.split("\n").filter(Boolean) : [],
    status: r.status || "new",
    memo: r.memo || "",
    privacyConsent: !!r.privacyConsent,
    createdAt: r.createdAt || "",
  };
}

module.exports = async (req, res) => {
  if (!verifyAdminToken(req))
    return res.status(401).json({ error: "인증 필요" });

  // GET - list leads (offset = numeric page offset)
  if (req.method === "GET") {
    try {
      const { status, offset } = req.query;
      const off = parseInt(offset) || 0;
      const params = [];
      let where = "";
      if (status && status !== "all") {
        where = "WHERE status=?";
        params.push(status);
      }
      // PAGE_SIZE+1 으로 다음 페이지 존재 여부 판단
      params.push(PAGE_SIZE + 1, off);
      const rows = await d1Rows(
        `SELECT * FROM leads ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
        params,
      );
      const hasMore = rows.length > PAGE_SIZE;
      const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
      return res.json({
        records: page.map(mapRow),
        offset: hasMore ? String(off + PAGE_SIZE) : null,
      });
    } catch (err) {
      console.error("Leads GET error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH - update status/memo
  if (req.method === "PATCH") {
    try {
      const { recordId, status, memo } = req.body;
      if (!recordId) return res.status(400).json({ error: "recordId 필요" });

      const sets = [];
      const params = [];
      if (status) {
        sets.push("status=?");
        params.push(status);
      }
      if (memo !== undefined) {
        sets.push("memo=?");
        params.push(memo);
      }
      if (sets.length) {
        params.push(recordId);
        await d1(`UPDATE leads SET ${sets.join(",")} WHERE id=?`, params);
      }
      const rows = await d1Rows("SELECT * FROM leads WHERE id=?", [recordId]);
      return res.json({
        success: true,
        record: rows[0] ? mapRow(rows[0]) : null,
      });
    } catch (err) {
      console.error("Leads PATCH error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE - delete lead
  if (req.method === "DELETE") {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "id 필요" });

      await d1("DELETE FROM leads WHERE id=?", [id]);
      return res.json({ success: true, deleted: id });
    } catch (err) {
      console.error("Leads DELETE error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
