const { google } = require("googleapis");
const {
  DEFAULT_USERNAME,
  TOKEN_TTL_MS,
  createSessionToken,
  deleteAuthState,
  getClientIp,
  loadPersistedAuthState,
  saveAuthState,
  setAdminPassword,
  verifyAdminToken,
  verifyCredentials,
} = require("../lib/admin-auth");

const OWNER_EMAIL = process.env.ADMIN_OWNER_EMAIL || "g3design@naver.com";
const rateStore = new Map();

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body;
}

function json(res, status, body, extraHeaders = {}) {
  Object.entries({
    "Cache-Control": "no-store",
    ...extraHeaders,
  }).forEach(([key, value]) => res.setHeader(key, value));
  return res.status(status).json(body);
}

function getBucket(ip) {
  const now = Date.now();
  let bucket = rateStore.get(ip);
  if (!bucket) {
    bucket = {
      blockedUntil: 0,
      failures: 0,
      failureWindowStart: now,
      requestCount: 0,
      requestWindowStart: now,
      resetCount: 0,
      resetWindowStart: now,
    };
    rateStore.set(ip, bucket);
  }
  return bucket;
}

function cleanupRateStore() {
  const now = Date.now();
  for (const [ip, bucket] of rateStore) {
    const stale =
      bucket.blockedUntil < now &&
      now - bucket.requestWindowStart > 60 * 60 * 1000 &&
      now - bucket.failureWindowStart > 60 * 60 * 1000 &&
      now - bucket.resetWindowStart > 2 * 60 * 60 * 1000;
    if (stale) rateStore.delete(ip);
  }
}

function block(bucket, durationMs) {
  bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + durationMs);
}

function checkRateLimit(ip, action) {
  cleanupRateStore();
  const now = Date.now();
  const bucket = getBucket(ip);

  if (bucket.blockedUntil > now) {
    return {
      allowed: false,
      retryAfter: Math.ceil((bucket.blockedUntil - now) / 1000),
    };
  }

  if (now - bucket.requestWindowStart > 60 * 1000) {
    bucket.requestWindowStart = now;
    bucket.requestCount = 0;
  }
  bucket.requestCount += 1;
  if (bucket.requestCount > 30) {
    block(bucket, 15 * 60 * 1000);
    return { allowed: false, retryAfter: 15 * 60 };
  }

  if (action === "reset-password") {
    if (now - bucket.resetWindowStart > 60 * 60 * 1000) {
      bucket.resetWindowStart = now;
      bucket.resetCount = 0;
    }
    bucket.resetCount += 1;
    if (bucket.resetCount > 3) {
      block(bucket, 60 * 60 * 1000);
      return { allowed: false, retryAfter: 60 * 60 };
    }
  }

  return { allowed: true };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const bucket = getBucket(ip);
  if (now - bucket.failureWindowStart > 10 * 60 * 1000) {
    bucket.failureWindowStart = now;
    bucket.failures = 0;
  }
  bucket.failures += 1;
  if (bucket.failures >= 5) {
    block(bucket, 30 * 60 * 1000);
    console.warn("Admin login IP blocked", {
      ip,
      failures: bucket.failures,
      blockedUntil: new Date(bucket.blockedUntil).toISOString(),
    });
  }
}

function recordLoginSuccess(ip) {
  const bucket = rateStore.get(ip);
  if (!bucket) return;
  bucket.failures = 0;
  bucket.failureWindowStart = Date.now();
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = require("crypto").randomBytes(12);
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return `g3-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function getGmailClient() {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Gmail 환경변수 누락: ${missing.join(", ")}`);
  }
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2 });
}

async function sendPasswordResetEmail(password, ip) {
  const gmail = getGmailClient();
  const username = process.env.ADMIN_USERNAME || DEFAULT_USERNAME;
  const ts = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
  });
  const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#efefec;font-family:-apple-system,'Apple SD Gothic Neo',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#efefec;padding:18px"><tr><td align="center">
<table cellpadding="0" cellspacing="0" style="background:#fff;max-width:480px;width:100%;border-radius:12px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#8b6a3c,#a17d4a);padding:18px 22px;color:#fff">
    <div style="font-size:12px;font-weight:800;letter-spacing:2px">G3 DESIGN ADMIN</div>
    <div style="font-size:20px;font-weight:800;margin-top:8px">관리자 비밀번호가 변경되었습니다</div>
  </td></tr>
  <tr><td style="padding:22px">
    <p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.7">아래 임시 비밀번호로 관리자 대시보드에 로그인하세요. 본인이 요청하지 않았다면 즉시 다시 비밀번호를 변경하세요.</p>
    <div style="background:#faf7f1;border:1px solid #eadfcf;border-radius:10px;padding:16px;text-align:center">
      <div style="font-size:11px;color:#8b6a3c;font-weight:700;letter-spacing:1px">아이디</div>
      <div style="font-size:18px;font-weight:800;margin:4px 0 14px;color:#1a1a1a">${username}</div>
      <div style="font-size:11px;color:#8b6a3c;font-weight:700;letter-spacing:1px">새 비밀번호</div>
      <div style="font-size:22px;font-weight:900;letter-spacing:1px;margin-top:4px;color:#b94a2c">${password}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:12px;color:#777">
      <tr><td style="padding:4px 0;color:#999">변경 시각</td><td style="text-align:right">${ts}</td></tr>
      <tr><td style="padding:4px 0;color:#999">요청 IP</td><td style="text-align:right">${ip}</td></tr>
    </table>
    <p style="margin:18px 0 0;text-align:center"><a href="https://admin.g3design.kr" style="display:inline-block;background:#b94a2c;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-size:13px;font-weight:700">관리자 로그인</a></p>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  const raw = Buffer.from(
    `From: G3 DESIGN <drdo6890ys@gmail.com>\r\n` +
      `To: ${OWNER_EMAIL}\r\n` +
      `Subject: =?UTF-8?B?${Buffer.from("[G3 DESIGN] 관리자 비밀번호 변경").toString("base64")}?=\r\n` +
      "Content-Type: text/html; charset=utf-8\r\n\r\n" +
      html,
  ).toString("base64url");

  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = parseBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  const action = body?.action;
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip, action);
  if (!limit.allowed) {
    return json(
      res,
      429,
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  if (action === "login") {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      recordLoginFailure(ip);
      return json(res, 400, { error: "아이디와 비밀번호를 입력해주세요." });
    }

    let ok = false;
    try {
      ok = await verifyCredentials(username, password);
    } catch (err) {
      console.error("Admin credential check failed:", err);
      return json(res, 500, { error: "로그인 처리 중 오류가 발생했습니다." });
    }

    if (!ok) {
      recordLoginFailure(ip);
      return json(res, 401, { error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    recordLoginSuccess(ip);
    return json(res, 200, {
      success: true,
      token: createSessionToken(username, ip),
      expiresIn: Math.floor(TOKEN_TTL_MS / 1000),
    });
  }

  if (action === "reset-password") {
    const password = generatePassword();
    let previousState = null;

    try {
      previousState = await loadPersistedAuthState({ skipCache: true });
      await setAdminPassword(password);
      await sendPasswordResetEmail(password, ip);
      console.info("Admin password reset email sent", { ip, to: OWNER_EMAIL });
      return json(res, 200, {
        success: true,
        message: "대표자 이메일로 새 비밀번호를 발송했습니다.",
      });
    } catch (err) {
      console.error("Admin password reset failed:", err);
      try {
        if (previousState) await saveAuthState(previousState);
        else await deleteAuthState();
      } catch (rollbackErr) {
        console.error("Admin password reset rollback failed:", rollbackErr);
      }
      return json(res, 500, {
        error: "비밀번호 변경 메일 발송에 실패했습니다.",
      });
    }
  }

  if (action === "verify-token") {
    if (!verifyAdminToken(req)) {
      return json(res, 401, { error: "인증 필요" });
    }
    return json(res, 200, { success: true });
  }

  return json(res, 400, {
    error: "action must be login, reset-password, or verify-token",
  });
};
