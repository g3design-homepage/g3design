-- G3 Design D1 schema (Airtable 대체)
-- 적용: wrangler d1 execute g3design-db --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS portfolio (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  subcategory TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT NOT NULL DEFAULT '',
  images      TEXT NOT NULL DEFAULT '',   -- newline-joined URLs
  description TEXT NOT NULL DEFAULT '',
  sortOrder   INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1, -- 0/1
  createdAt   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_portfolio_sort ON portfolio(sortOrder DESC);

CREATE TABLE IF NOT EXISTS leads (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  interiorType   TEXT NOT NULL DEFAULT '',
  budget         TEXT NOT NULL DEFAULT '',
  area           TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  schedule       TEXT NOT NULL DEFAULT '',
  message        TEXT NOT NULL DEFAULT '',
  photos         TEXT NOT NULL DEFAULT '',   -- newline-joined URLs
  privacyConsent INTEGER NOT NULL DEFAULT 0, -- 0/1
  status         TEXT NOT NULL DEFAULT 'new',
  source         TEXT NOT NULL DEFAULT 'homepage',
  memo           TEXT NOT NULL DEFAULT '',
  createdAt      TEXT NOT NULL DEFAULT ''     -- ISO 8601
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS popups (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL DEFAULT '',
  imageUrl  TEXT NOT NULL DEFAULT '',
  linkUrl   TEXT NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 1, -- 0/1
  startDate TEXT NOT NULL DEFAULT '',
  endDate   TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_popups_created ON popups(createdAt DESC);

CREATE TABLE IF NOT EXISTS visitors (
  id        TEXT PRIMARY KEY,
  date      TEXT NOT NULL DEFAULT '',
  ipHash    TEXT NOT NULL DEFAULT '',
  city      TEXT NOT NULL DEFAULT '',
  district  TEXT NOT NULL DEFAULT '',
  region    TEXT NOT NULL DEFAULT '',
  page      TEXT NOT NULL DEFAULT '',
  device    TEXT NOT NULL DEFAULT '',
  referrer  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_visitors_date ON visitors(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_dedup ON visitors(ipHash, date);
