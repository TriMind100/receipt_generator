import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import dns from "dns";

// Override DNS resolution to Google & Cloudflare DNS to bypass local Windows/ISP SRV lookup blocks
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (err) {
  console.warn("Could not set custom DNS servers:", err.message);
}

const app = express();
const port = 3001;

app.use(express.json());

// Database connection middleware for Serverless compatibility
app.use(async (req, res, next) => {
  await ensureDb();
  next();
});

// Setup storage paths for JSON fallback
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbDir = path.join(__dirname, "data");
const dbPath = path.join(dbDir, "db.json");

// Load .env file variables manually
async function loadEnv() {
  try {
    const raw = await fs.readFile(".env", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const part = line.trim();
      if (part && !part.startsWith("#") && part.includes("=")) {
        const index = part.indexOf("=");
        const key = part.slice(0, index).trim();
        const val = part.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
        process.env[key] = val;
      }
    }
  } catch {}
}

// MongoDB Config
let mongoUrl = "mongodb://127.0.0.1:27017/recipts";
let mongoClient = null;
let mongoDb = null;
let useMongo = false;
let lastMongoError = null;
let dbPromise = null;

// Initialize Database
async function initDb() {
  await loadEnv();
  if (process.env.MONGO_URI) {
    mongoUrl = process.env.MONGO_URI;
  }

  const isForceMongo = process.env.FORCE_MONGO === "true";
  const maskedUrl = mongoUrl.replace(/:([^@]+)@/, ":******@");
  console.log(`Attempting to connect to MongoDB at: ${maskedUrl}...`);

  try {
    mongoClient = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 2000 });
    await mongoClient.connect();
    mongoDb = mongoClient.db("recipts");
    useMongo = true;
    console.log("✓ Connected to MongoDB successfully!");
  } catch (err) {
    console.warn("⚠️ MongoDB connection failed.");
    console.warn("Error details:", err.message);
    lastMongoError = err.message;

    if (isForceMongo) {
      console.error("✗ FORCE_MONGO is enabled. Stopping server.");
      process.exit(1);
    }

    console.log("➔ Falling back to local db.json storage.");
    useMongo = false;

    // Setup local JSON fallback
    try {
      await fs.mkdir(dbDir, { recursive: true });
      try {
        await fs.access(dbPath);
      } catch {
        await fs.writeFile(
          dbPath,
          JSON.stringify({ clients: [], receipts: [], settings: {} }, null, 2),
          "utf8"
        );
      }
    } catch (fsErr) {
      console.error("Local DB Init Error:", fsErr);
    }
  }
}

function ensureDb() {
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

// JSON Fallback: Read
async function readJsonDb() {
  try {
    const raw = await fs.readFile(dbPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return { clients: [], receipts: [], settings: {} };
  }
}

// JSON Fallback: Write
async function writeJsonDb(data) {
  try {
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2), "utf8");
  } catch {}
}

// Test Diagnostic Endpoint
app.get("/api/test", (req, res) => {
  res.json({
    status: "healthy",
    message: "Kolkode Receipt System API is fully operational",
    database: useMongo ? "MongoDB Atlas (Connected)" : "Local db.json (Fallback Active)",
    diagnostics: {
      hasMongoUri: !!process.env.MONGO_URI,
      hasForceMongo: process.env.FORCE_MONGO || "not set",
      mongoUriLength: process.env.MONGO_URI ? process.env.MONGO_URI.length : 0,
      lastError: lastMongoError
    },
    timestamp: new Date().toISOString()
  });
});

// Clients Endpoints
app.get("/api/clients", async (req, res) => {
  if (useMongo) {
    try {
      const clients = await mongoDb.collection("clients").find({}).toArray();
      res.json(clients);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const db = await readJsonDb();
    res.json(db.clients);
  }
});

app.post("/api/clients", async (req, res) => {
  const newClient = req.body;
  if (useMongo) {
    try {
      await mongoDb.collection("clients").replaceOne(
        { id: newClient.id },
        newClient,
        { upsert: true }
      );
      res.json({ success: true, client: newClient });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const db = await readJsonDb();
    const index = db.clients.findIndex((c) => c.id === newClient.id);
    if (index >= 0) {
      db.clients[index] = newClient;
    } else {
      db.clients.push(newClient);
    }
    await writeJsonDb(db);
    res.json({ success: true, client: newClient });
  }
});

app.delete("/api/clients/:id", async (req, res) => {
  const { id } = req.params;
  if (useMongo) {
    try {
      await mongoDb.collection("clients").deleteOne({ id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const db = await readJsonDb();
    db.clients = db.clients.filter((c) => c.id !== id);
    await writeJsonDb(db);
    res.json({ success: true });
  }
});

// Receipts Endpoints
app.get("/api/receipts", async (req, res) => {
  if (useMongo) {
    try {
      const receipts = await mongoDb.collection("receipts").find({}).toArray();
      res.json(receipts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const db = await readJsonDb();
    res.json(db.receipts);
  }
});

app.post("/api/receipts", async (req, res) => {
  const newReceipt = req.body;
  if (useMongo) {
    try {
      await mongoDb.collection("receipts").replaceOne(
        { id: newReceipt.id },
        newReceipt,
        { upsert: true }
      );
      res.json({ success: true, receipt: newReceipt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const db = await readJsonDb();
    const index = db.receipts.findIndex((r) => r.id === newReceipt.id);
    if (index >= 0) {
      db.receipts[index] = newReceipt;
    } else {
      db.receipts.push(newReceipt);
    }
    await writeJsonDb(db);
    res.json({ success: true, receipt: newReceipt });
  }
});

app.delete("/api/receipts/:id", async (req, res) => {
  const { id } = req.params;
  if (useMongo) {
    try {
      await mongoDb.collection("receipts").deleteOne({ id });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const db = await readJsonDb();
    db.receipts = db.receipts.filter((r) => r.id !== id);
    await writeJsonDb(db);
    res.json({ success: true });
  }
});

// Settings Endpoints
app.get("/api/settings", async (req, res) => {
  if (useMongo) {
    try {
      const settings = await mongoDb.collection("settings").findOne({});
      res.json(settings || {});
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const db = await readJsonDb();
    res.json(db.settings || {});
  }
});

app.post("/api/settings", async (req, res) => {
  const newSettings = req.body;
  if (useMongo) {
    try {
      await mongoDb.collection("settings").deleteMany({});
      await mongoDb.collection("settings").insertOne(newSettings);
      res.json({ success: true, settings: newSettings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const db = await readJsonDb();
    db.settings = newSettings;
    await writeJsonDb(db);
    res.json({ success: true, settings: newSettings });
  }
});

// Admin Login Endpoint
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || "admin";
  const adminPass = process.env.ADMIN_PASSWORD || "kolkodeadmin";

  if (username === adminUser && password === adminPass) {
    res.json({ success: true, token: "kolkode-session-authorized" });
  } else {
    res.status(401).json({ success: false, error: "Invalid username or password" });
  }
});

// Start Server
if (process.env.NODE_ENV !== "production") {
  ensureDb().then(() => {
    app.listen(port, () => {
      console.log(`Backend server listening at http://localhost:${port}`);
    });
  });
}

export default app;
