const { verifyAdminToken } = require("../lib/admin-auth");
const { d1, d1Rows, genId } = require("../lib/d1");

function mapRow(r) {
  return {
    id: r.id,
    title: r.title || "",
    imageUrl: r.imageUrl || "",
    linkUrl: r.linkUrl || "",
    active: !!r.active,
    startDate: r.startDate || "",
    endDate: r.endDate || "",
    createdAt: r.createdAt || "",
  };
}

module.exports = async (req, res) => {
  // GET - public (no auth required for fetching active popups)
  if (req.method === "GET" && req.query.public === "true") {
    try {
      const rows = await d1Rows(
        "SELECT * FROM popups WHERE active=1 ORDER BY createdAt DESC",
      );
      const now = new Date().toISOString().slice(0, 10);
      const popups = rows.map(mapRow).filter((p) => {
        if (p.startDate && p.startDate > now) return false;
        if (p.endDate && p.endDate < now) return false;
        return true;
      });
      return res.json({ popups });
    } catch (err) {
      return res.json({ popups: [] });
    }
  }

  // Admin endpoints require auth
  if (!verifyAdminToken(req))
    return res.status(401).json({ error: "인증 필요" });

  // GET - list all popups (admin)
  if (req.method === "GET") {
    try {
      const rows = await d1Rows("SELECT * FROM popups ORDER BY createdAt DESC");
      return res.json({ popups: rows.map(mapRow) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST - create popup
  if (req.method === "POST") {
    try {
      const { title, imageUrl, linkUrl, active, startDate, endDate } = req.body;
      await d1(
        `INSERT INTO popups (id,title,imageUrl,linkUrl,active,startDate,endDate,createdAt)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          genId(),
          title || "",
          imageUrl || "",
          linkUrl || "",
          active !== false ? 1 : 0,
          startDate || "",
          endDate || "",
          new Date().toISOString(),
        ],
      );
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH - update popup
  if (req.method === "PATCH") {
    try {
      const { recordId, ...fields } = req.body;
      if (!recordId) return res.status(400).json({ error: "recordId 필요" });

      const allowed = [
        "title",
        "imageUrl",
        "linkUrl",
        "active",
        "startDate",
        "endDate",
      ];
      const sets = [];
      const params = [];
      for (const k of allowed) {
        if (fields[k] !== undefined) {
          sets.push(`${k}=?`);
          params.push(k === "active" ? (fields[k] ? 1 : 0) : fields[k]);
        }
      }
      if (sets.length) {
        params.push(recordId);
        await d1(`UPDATE popups SET ${sets.join(",")} WHERE id=?`, params);
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE - delete popup
  if (req.method === "DELETE") {
    try {
      const { recordId } = req.body;
      if (!recordId) return res.status(400).json({ error: "recordId 필요" });
      await d1("DELETE FROM popups WHERE id=?", [recordId]);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
