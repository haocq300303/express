const express = require("express");
const app = express();
const morgan = require("morgan");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
// ========= ENV & constants =========
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.resolve("./data");
const INGEST_TOKEN = process.env.INGEST_TOKEN || "lng_2025";

// ========= chuẩn bị thư mục =========
fs.mkdirSync(DATA_DIR, { recursive: true });

// middlewares
app.use(morgan("dev"));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "30mb" })); // cho JSON mode

// ========= Multer (multipart/form-data) =========
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ========= tiny utils =========
function nowISO() {
  return new Date().toISOString();
}
function ymd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function sanitizeName(s) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .slice(0, 120);
}
function saveBufferFile(dir, filename, buf) {
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, filename);
  fs.writeFileSync(fp, buf);
  return fp;
}
function saveTextFile(dir, filename, text) {
  return saveBufferFile(dir, filename, Buffer.from(text, "utf8"));
}

// ========= auth helper (token) =========
function assertAuth(req) {
  const headerToken = req.headers["x-access-token"];
  const queryToken = req.query?.token;
  const ok =
    !!INGEST_TOKEN &&
    (headerToken === INGEST_TOKEN || queryToken === INGEST_TOKEN);
  if (!ok) {
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
}

app.post("/ext/ingest", upload.any(), async (req, res) => {
  try {
    assertAuth(req);

    const ct = req.headers["content-type"] || "";
    if (ct.includes("multipart/form-data")) {
      // ---- multipart (file) mode ----
      const kindField = req.body.kind;
      if (!kindField)
        return res.status(400).json({ ok: false, message: "kind required" });

      const metaJson = req.body.meta || "{}";
      let meta;
      try {
        meta = JSON.parse(metaJson);
      } catch {
        meta = {};
      }

      const shopId = sanitizeName(meta.shopId || "unknown");
      const today = ymd();

      const file = req.files && req.files[0] ? req.files[0] : null;
      if (!file)
        return res.status(400).json({ ok: false, message: "file required" });

      const origName = sanitizeName(
        file.originalname || `${kindField}-${uuidv4()}.txt`
      );

      let subdir = "";
      if (kindField === "orders/import-new-tsv") subdir = "orders_new";
      else if (kindField === "orders/report-all-tsv") subdir = "orders_all";
      else if (kindField === "ads/spend-tsv") subdir = "ads_spend";
      else subdir = "unknown";

      const dir = path.join(DATA_DIR, shopId, subdir, today);
      const savedPath = saveBufferFile(dir, origName, file.buffer);

      // TODO: bạn có thể parse TSV -> upsert DB ở đây (async queue càng tốt)
      return res.json({
        ok: true,
        kind: kindField,
        file: path.relative(process.cwd(), savedPath),
        meta,
        size: file.size,
      });
    }

    // ---- JSON mode (ít dùng) ----
    const { kind, data, meta } = req.body || {};
    if (!kind)
      return res.status(400).json({ ok: false, message: "kind required" });

    const shopId = sanitizeName(meta?.shopId || "unknown");
    const today = ymd();
    const dir = path.join(DATA_DIR, shopId, "json", today);
    const filename = `${kind}-${uuidv4()}.json`;
    const savedPath = saveTextFile(
      dir,
      filename,
      JSON.stringify({ data, meta }, null, 2)
    );
    return res.json({
      ok: true,
      kind,
      file: path.relative(process.cwd(), savedPath),
    });
  } catch (e) {
    res
      .status(e.status || 500)
      .json({ ok: false, message: e.message || "error" });
  }
});

// ========= 404 JSON (đặt cuối) =========
app.use((req, res) => {
  res.status(404).json({ ok: false, message: "not found", path: req.path });
});

// ========= Error handler =========
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({
    ok: false,
    message: err.message || "Internal Server Error",
  });
});

// ========= Root =========
app.get("/", (_req, res) => {
  res.json({ message: "Welcome to RESTful API - Node.js", at: nowISO() });
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
