const crypto = require("crypto");
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin260506";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HASH_ITERATIONS = 180000;

let authStateCache = null;
let authStateCacheAt = 0;
let s3Client = null;

function getSessionSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.AIRTABLE_API_KEY ||
    process.env.GOOGLE_REFRESH_TOKEN ||
    "g3design-local-admin-session-secret"
  );
}

function getPasswordPepper() {
  return (
    process.env.ADMIN_PASSWORD_PEPPER ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.AIRTABLE_API_KEY ||
    "g3design-local-admin-password-pepper"
  );
}

function getAuthStateKey() {
  if (process.env.ADMIN_AUTH_STATE_KEY) return process.env.ADMIN_AUTH_STATE_KEY;
  const suffix = crypto
    .createHash("sha256")
    .update(getSessionSecret())
    .digest("hex")
    .slice(0, 16);
  return `private/admin-auth-${suffix}.json`;
}

function hasR2Config() {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function getS3Client() {
  if (!hasR2Config()) {
    throw new Error("관리자 비밀번호 저장소가 구성되지 않았습니다.");
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function defaultAuthState() {
  return {
    version: 1,
    username: process.env.ADMIN_USERNAME || DEFAULT_USERNAME,
    defaultPassword: process.env.ADMIN_INITIAL_PASSWORD || DEFAULT_PASSWORD,
    source: "default",
  };
}

async function loadPersistedAuthState({ skipCache = false } = {}) {
  if (!hasR2Config()) return null;
  const now = Date.now();
  if (!skipCache && authStateCache && now - authStateCacheAt < 5000) {
    return authStateCache;
  }

  try {
    const result = await getS3Client().send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: getAuthStateKey(),
      }),
    );
    const raw = await streamToString(result.Body);
    const parsed = JSON.parse(raw);
    authStateCache = parsed;
    authStateCacheAt = now;
    return parsed;
  } catch (err) {
    const statusCode = err?.$metadata?.httpStatusCode;
    if (
      err?.name === "NoSuchKey" ||
      err?.Code === "NoSuchKey" ||
      statusCode === 404
    ) {
      authStateCache = null;
      authStateCacheAt = 0;
      return null;
    }
    throw err;
  }
}

async function getAuthState() {
  const persisted = await loadPersistedAuthState();
  return persisted || defaultAuthState();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const peppered = `${password}:${getPasswordPepper()}`;
  const hash = crypto
    .pbkdf2Sync(peppered, salt, HASH_ITERATIONS, 32, "sha256")
    .toString("hex");
  return {
    passwordHash: hash,
    passwordSalt: salt,
    passwordIterations: HASH_ITERATIONS,
    passwordDigest: "sha256",
  };
}

function hashPasswordWithState(password, state) {
  const peppered = `${password}:${getPasswordPepper()}`;
  return crypto
    .pbkdf2Sync(
      peppered,
      state.passwordSalt,
      state.passwordIterations || HASH_ITERATIONS,
      32,
      state.passwordDigest || "sha256",
    )
    .toString("hex");
}

function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a || "")).digest();
  const right = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(left, right);
}

function verifyPassword(password, state) {
  if (state.passwordHash && state.passwordSalt) {
    return safeEqual(hashPasswordWithState(password, state), state.passwordHash);
  }
  return safeEqual(password, state.defaultPassword || DEFAULT_PASSWORD);
}

async function verifyCredentials(username, password) {
  const state = await getAuthState();
  const expectedUsername = state.username || DEFAULT_USERNAME;
  const usernameOk = safeEqual(username, expectedUsername);
  const passwordOk = verifyPassword(password, state);
  return usernameOk && passwordOk;
}

async function saveAuthState(state) {
  if (!hasR2Config()) {
    throw new Error("관리자 비밀번호 저장소가 구성되지 않았습니다.");
  }
  const body = JSON.stringify(state, null, 2);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: getAuthStateKey(),
      Body: body,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store",
    }),
  );
  authStateCache = state;
  authStateCacheAt = Date.now();
}

async function deleteAuthState() {
  if (!hasR2Config()) return;
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: getAuthStateKey(),
    }),
  );
  authStateCache = null;
  authStateCacheAt = 0;
}

async function setAdminPassword(password) {
  const current = await getAuthState();
  const next = {
    version: 1,
    username: current.username || process.env.ADMIN_USERNAME || DEFAULT_USERNAME,
    ...hashPassword(password),
    updatedAt: new Date().toISOString(),
  };
  await saveAuthState(next);
  return next;
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function createSessionToken(username, ip) {
  const now = Date.now();
  const payload = {
    sub: username,
    ip: ip || "",
    iat: now,
    exp: now + TOKEN_TTL_MS,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  const body = toBase64Url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, signature] = parts;
  if (!safeEqual(signature, sign(body))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return false;
    return payload;
  } catch {
    return false;
  }
}

function verifyAdminToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return !!verifySessionToken(auth.slice("Bearer ".length));
}

function getClientIp(req) {
  const headers = req.headers || {};
  const forwarded =
    headers["x-forwarded-for"] ||
    headers["x-vercel-forwarded-for"] ||
    headers["cf-connecting-ip"] ||
    headers["x-real-ip"];
  if (Array.isArray(forwarded)) return forwarded[0];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

module.exports = {
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
};
