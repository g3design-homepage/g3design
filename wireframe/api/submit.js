const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { google } = require("googleapis");
const crypto = require("crypto");
const { d1, genId } = require("../lib/d1");

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadPhoto(dataUrl, key) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000",
    }),
  );
  return `https://pub-64e468fed30d4c00aefa275f39dd9f92.r2.dev/${key}`;
}

async function saveToD1(data, photoUrls) {
  await d1(
    `INSERT INTO leads (id,name,phone,email,interiorType,budget,area,address,schedule,message,photos,privacyConsent,status,source,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'new','homepage',?)`,
    [
      genId(),
      data.name,
      data.phone,
      data.email || "",
      data.interiorType || "",
      data.budget || "",
      data.area || "",
      data.address || "",
      data.schedule || "",
      data.message || "",
      photoUrls.join("\n"),
      data.privacyConsent ? 1 : 0,
      new Date().toISOString(),
    ],
  );
}

async function sendTelegram(data, photoCount) {
  const text =
    `📋 *새 상담 접수*\n\n` +
    `👤 ${data.name}\n` +
    `📞 ${data.phone}\n` +
    `✉️ ${data.email || "-"}\n` +
    `🏠 ${data.interiorType || "-"}\n` +
    `💰 ${data.budget || "-"}\n` +
    `📐 ${data.area || "-"}\n` +
    `📍 ${data.address || "-"}\n` +
    `🗓 ${data.schedule || "-"}\n` +
    `💬 ${(data.message || "").substring(0, 200)}\n` +
    `📷 ${photoCount}장\n` +
    `🕐 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n\n` +
    `[접수 관리 →](https://g3design.kr/admin.html)`;
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    },
  );
}

async function sendLMS(data) {
  const serviceId = process.env.NCP_SMS_SERVICE_ID;
  const accessKey = process.env.NCP_SMS_ACCESS_KEY;
  const secretKey = process.env.NCP_SMS_SECRET_KEY;
  const sender = process.env.NCP_SMS_SENDER;
  if (!serviceId || !accessKey || !secretKey || !sender) return;

  const phone = data.phone.replace(/[^0-9]/g, "");
  if (!phone) return;

  const timestamp = Date.now().toString();
  const method = "POST";
  const url = `/sms/v2/services/${encodeURIComponent(serviceId)}/messages`;
  const message = `[G3 DESIGN] 상담 접수 확인\n\n${data.name}님, 상담이 정상 접수되었습니다.\n\n■ 접수 내용\n- 종류: ${data.interiorType || "-"}\n- 예산: ${data.budget || "-"}\n- 평수: ${data.area || "-"}\n- 희망시기: ${data.schedule || "-"}\n- 지역: ${data.address || "-"}\n\n담당 디자이너가 1일 이내 연락드립니다.\n\nG3 DESIGN | g3design.kr`;

  // HMAC-SHA256 signature
  const space = " ";
  const newLine = "\n";
  const hmac = crypto.createHmac("SHA256", secretKey);
  hmac.update(method + space + url + newLine + timestamp + newLine + accessKey);
  const signature = hmac.digest("base64");

  const body = {
    type: "LMS",
    from: sender,
    subject: "[G3 DESIGN] 상담 접수 확인",
    content: message,
    messages: [{ to: phone }],
  };

  const res = await fetch(`https://sens.apigw.ntruss.com${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "x-ncp-apigw-timestamp": timestamp,
      "x-ncp-iam-access-key": accessKey,
      "x-ncp-apigw-signature-v2": signature,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NCP SMS error ${res.status}: ${text}`);
  }
  console.log("LMS sent to", phone);
}

async function sendEmails(data, photoCount) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const ts = new Date()
    .toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    .replace(/\. /g, ".")
    .replace(/\.$/, "");
  const rid = `#C-${Date.now().toString(36).toUpperCase()}`;

  const htmlBody = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e8e8e6;font-family:-apple-system,'Apple SD Gothic Neo',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e8e6;padding:16px"><tr><td align="center">
<table cellpadding="0" cellspacing="0" style="background:#fff;max-width:460px;width:100%">
  <tr><td style="background:linear-gradient(135deg,#a17d4a,#c49a5c);padding:16px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:12px;font-weight:800;color:#fff;letter-spacing:2px"><span style="color:#ffe8c8">G3</span> DESIGN</td>
      <td style="text-align:right;font-size:9px;color:rgba(255,255,255,0.5)">${rid}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:18px 24px 14px">
    <p style="margin:0;font-size:16px;font-weight:700;color:#1a1a1a">상담 신청이 접수되었습니다</p>
    <p style="margin:6px 0 0;font-size:12px;color:#999">${data.name}님, 담당 디자이너가 1일 이내 연락드립니다.</p>
  </td></tr>
  <tr><td style="padding:0 24px"><div style="border-top:1px solid #e8e8e6"></div></td></tr>
  <tr><td style="padding:14px 24px">
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:11px;color:#1a1a1a">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:16px">
          <p style="margin:0 0 8px;font-size:9px;font-weight:700;color:#999;letter-spacing:2px">접수 정보</p>
          <p style="margin:0;line-height:1.9"><span style="color:#999">이름</span> ${data.name}<br><span style="color:#999">연락처</span> ${data.phone}<br><span style="color:#999">이메일</span> ${data.email}</p>
        </td>
        <td style="vertical-align:top;width:50%;border-left:1px solid #e8e8e6;padding-left:16px">
          <p style="margin:0 0 8px;font-size:9px;font-weight:700;color:#999;letter-spacing:2px">상담 내용</p>
          <p style="margin:0;line-height:1.9"><span style="color:#999">종류</span> ${data.interiorType || "-"}<br><span style="color:#999">예산</span> ${data.budget || "-"}<br><span style="color:#999">평수</span> ${data.area || "-"}</p>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 24px"><div style="border-top:1px solid #e8e8e6"></div></td></tr>
  <tr><td style="padding:12px 24px">
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:11px;color:#1a1a1a">
      <tr>
        <td style="padding:4px 0"><span style="color:#999;font-size:10px">시공 지역</span></td>
        <td style="padding:4px 0;text-align:right">${data.address || "-"}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;border-top:1px solid #f5f5f3"><span style="color:#999;font-size:10px">희망 시기</span></td>
        <td style="padding:4px 0;text-align:right;border-top:1px solid #f5f5f3">${data.schedule ? `<span style="font-size:9px;background:#f5f0e8;color:#a17d4a;padding:2px 6px">${data.schedule}</span>` : "-"}</td>
      </tr>
    </table>
  </td></tr>
  ${
    data.message
      ? `<tr><td style="padding:0 24px"><div style="border-top:1px solid #e8e8e6"></div></td></tr>
  <tr><td style="padding:12px 24px">
    <p style="margin:0 0 6px;font-size:9px;font-weight:700;color:#999;letter-spacing:2px">요청 내용</p>
    <p style="margin:0;font-size:11px;color:#555;line-height:1.7;background:#fafaf8;padding:10px 12px;border-radius:4px">${data.message}</p>
  </td></tr>`
      : ""
  }
  <tr><td style="background:#fafaf8;padding:14px 24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:10px;color:#999;line-height:1.6">무료 현장 실측 · 전문 디자이너 상담<br><span style="font-size:9px;color:#ccc">G3 DESIGN · g3design.kr</span></td>
      <td style="text-align:right"><a href="tel:032-543-6890" style="background:#b94a2c;color:#fff;text-decoration:none;font-size:11px;font-weight:600;padding:10px 18px;border-radius:4px;display:inline-block">032-543-6890</a></td>
    </tr></table>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const raw = Buffer.from(
    `From: G3 DESIGN <drdo6890ys@gmail.com>\r\n` +
      `To: ${data.email}\r\n` +
      `Subject: =?UTF-8?B?${Buffer.from("G3 DESIGN 상담 접수 완료").toString("base64")}?=\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n\r\n` +
      htmlBody,
  ).toString("base64url");

  if (data.email) {
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    console.log("Confirm email sent to", data.email);
  }

  // --- 내부수신 이메일 (mkt@polarad.co.kr) ---
  const iTs = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const iRid = "#C-" + Date.now().toString(36).toUpperCase();
  const scheduleHtml = data.schedule
    ? '<span style="font-size:9px;background:#f5f0e8;color:#a17d4a;padding:2px 6px">' +
      data.schedule +
      "</span>"
    : "-";
  const messageHtml = data.message
    ? '<tr><td style="padding:0 24px"><div style="border-top:1px solid #e8e8e6"></div></td></tr>' +
      '<tr><td style="padding:12px 24px">' +
      '<p style="margin:0 0 6px;font-size:9px;font-weight:700;color:#999;letter-spacing:2px">요청 내용</p>' +
      '<p style="margin:0;font-size:11px;color:#555;line-height:1.7;background:#fafaf8;padding:10px 12px;border-radius:4px">' +
      data.message +
      "</p>" +
      "</td></tr>"
    : "";

  var r = function (label, val) {
    return (
      '<tr><td style="padding:5px 0;color:#999;font-size:10px;width:60px;vertical-align:top">' +
      label +
      '</td><td style="padding:5px 0;font-size:11px">' +
      val +
      "</td></tr>"
    );
  };
  var sep =
    '<tr><td colspan="2" style="border-top:1px solid #f0efed"></td></tr>';

  const internalHtml =
    '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#e8e8e6;font-family:-apple-system,sans-serif">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e8e6;padding:16px"><tr><td align="center">' +
    '<table cellpadding="0" cellspacing="0" style="background:#fff;max-width:460px;width:100%">' +
    '<tr><td style="background:linear-gradient(135deg,#8b6a3c,#a17d4a);padding:12px 16px">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="font-size:10px;font-weight:700;color:#fff;letter-spacing:2px">G3 ADMIN</td>' +
    '<td style="text-align:right;font-size:9px;color:rgba(255,255,255,0.5)">' +
    iRid +
    "</td>" +
    "</tr></table></td></tr>" +
    '<tr><td style="padding:14px 16px 10px">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td><p style="margin:0;font-size:14px;font-weight:700;color:#1a1a1a">새 상담 접수</p><p style="margin:4px 0 0;font-size:10px;color:#999">' +
    iTs +
    "</p></td>" +
    '<td style="text-align:right"><span style="font-size:10px;font-weight:700;background:#fef3f0;color:#b94a2c;padding:4px 10px;border-radius:3px">NEW</span></td>' +
    "</tr></table></td></tr>" +
    '<tr><td style="padding:0 16px"><div style="border-top:1px solid #e8e8e6"></div></td></tr>' +
    '<tr><td style="padding:10px 16px">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="color:#1a1a1a">' +
    r("이름", "<b>" + data.name + "</b>") +
    r("연락처", data.phone) +
    r("이메일", data.email || "-") +
    sep +
    r("종류", data.interiorType || "-") +
    r("예산", data.budget || "-") +
    r("평수", data.area || "-") +
    sep +
    r("지역", data.address || "-") +
    r("시기", scheduleHtml) +
    r("사진", photoCount + "장") +
    "</table></td></tr>" +
    messageHtml +
    '<tr><td style="background:#f5f5f3;padding:10px 16px;text-align:center">' +
    '<p style="margin:0;font-size:9px;color:#ccc">G3 DESIGN 내부 알림 · <a href="https://g3design.kr/admin.html" style="color:#a17d4a;text-decoration:none">접수 관리 바로가기</a></p>' +
    "</td></tr></table></td></tr></table></body></html>";

  const subjectB64 = Buffer.from("[G3] 새 상담 접수 - " + data.name).toString(
    "base64",
  );
  const raw2 = Buffer.from(
    "From: G3 DESIGN <drdo6890ys@gmail.com>\r\n" +
      "To: mkt@polarad.co.kr\r\n" +
      "Subject: =?UTF-8?B?" +
      subjectB64 +
      "?=\r\n" +
      "Content-Type: text/html; charset=utf-8\r\n\r\n" +
      internalHtml,
  ).toString("base64url");

  await gmail.users.messages.send({ userId: "me", requestBody: { raw: raw2 } });
  console.log("Internal email sent to mkt@polarad.co.kr");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let data;
    try {
      data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    // Validate required fields
    if (!data.name || !data.name.trim()) {
      return res.status(400).json({ error: "이름을 입력해주세요." });
    }
    if (!data.phone || !data.phone.trim()) {
      return res.status(400).json({ error: "연락처를 입력해주세요." });
    }

    // Upload photos to R2
    const photos = Array.isArray(data.photos) ? data.photos : [];
    const timestamp = Date.now();
    const photoUrls = [];
    for (let i = 0; i < photos.length; i++) {
      if (!photos[i] || !photos[i].startsWith("data:")) continue;
      try {
        const key = `submissions/${timestamp}_${i}.webp`;
        const url = await uploadPhoto(photos[i], key);
        photoUrls.push(url);
      } catch (err) {
        console.error(`Photo upload failed for index ${i}:`, err);
      }
    }

    // Save to D1 — 실패해도 알림은 발송하여 리드 유실 방지
    try {
      await saveToD1(data, photoUrls);
    } catch (err) {
      console.error("D1 save failed (알림은 계속 발송):", err);
    }

    // Telegram + LMS + emails must complete before response (Vercel kills process after res)
    const telegramP = sendTelegram(data, photoUrls.length).catch((err) =>
      console.error("Telegram send failed:", err),
    );
    const lmsP = sendLMS(data).catch((err) =>
      console.error("LMS send failed:", err),
    );

    try {
      await sendEmails(data, photoUrls.length);
    } catch (err) {
      console.error("Email send failed:", err);
    }

    await Promise.all([telegramP, lmsP]);

    return res.status(200).json({ success: true });
  } catch (globalErr) {
    console.error("Unhandled submit error:", globalErr);
    return res.status(500).json({ error: globalErr.message || "서버 오류" });
  }
};
