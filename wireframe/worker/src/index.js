// G3 Design D1 Proxy Worker
// Vercel API Routes <-> D1 브리지. Bearer 인증(timing-safe).
// 서버 간 호출 전용 — 브라우저에 노출 금지.

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(String(a || ""));
  const bb = enc.encode(String(b || ""));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const secret = env.D1_PROXY_TOKEN;
    if (!secret) return json({ error: "Proxy not configured" }, 500);

    const auth = request.headers.get("authorization") || "";
    if (
      !auth.startsWith("Bearer ") ||
      !timingSafeEqual(auth.slice(7), secret)
    ) {
      return json({ error: "Unauthorized" }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    try {
      // Batch: { batch: [{ sql, params }, ...] }
      if (Array.isArray(payload.batch)) {
        const stmts = payload.batch.map((q) =>
          env.DB.prepare(q.sql).bind(...(q.params || [])),
        );
        const res = await env.DB.batch(stmts);
        return json({ results: res.map((r) => r.results || []) });
      }

      // Single: { sql, params }
      if (typeof payload.sql !== "string") {
        return json({ error: "sql required" }, 400);
      }
      const stmt = env.DB.prepare(payload.sql).bind(...(payload.params || []));
      const res = await stmt.all();
      return json({ results: res.results || [], meta: res.meta || {} });
    } catch (err) {
      return json({ error: "DB error: " + (err.message || String(err)) }, 500);
    }
  },
};
