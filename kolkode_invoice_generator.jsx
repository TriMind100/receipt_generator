import { useState, useEffect, useMemo, useCallback } from "react";
import logoUrl from "./logo.png";

/* ---------- storage helpers ---------- */
const KEYS = {
  clients: "kolkode:clients",
  receipts: "kolkode:receipts",
  settings: "kolkode:settings",
};

async function loadKey(key, fallback) {
  try {
    if (window.storage && typeof window.storage.get === "function") {
      const res = await window.storage.get(key, false);
      return res ? JSON.parse(res.value) : fallback;
    } else {
      const res = localStorage.getItem(key);
      return res ? JSON.parse(res) : fallback;
    }
  } catch {
    return fallback;
  }
}
async function saveKey(key, value) {
  try {
    if (window.storage && typeof window.storage.set === "function") {
      await window.storage.set(key, JSON.stringify(value), false);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}

/* ---------- utils ---------- */
const uid = () => {
  if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};
const inr = (n) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const date = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
};
const addDays = (iso, d) => {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const dt = new Date(y, m, day);
  dt.setDate(dt.getDate() + d);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const date = String(dt.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
};
const fmtDate = (iso) => {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const dt = new Date(y, m, d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

function financialYear(iso) {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return "";
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const start = m >= 3 ? y : y - 1;
  const end = start + 1;
  return `${start}-${String(end).slice(2)}`;
}

function nextReceiptNumber(receipts, receiptDate) {
  const fy = financialYear(receiptDate || todayISO());
  const prefix = `REC/${fy}/`;
  let max = 0;
  receipts.forEach((rcpt) => {
    if (rcpt.receiptNumber && rcpt.receiptNumber.startsWith(prefix)) {
      const seq = parseInt(rcpt.receiptNumber.split("/").pop(), 10);
      if (!isNaN(seq) && seq > max) max = seq;
    }
  });
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function computeTotals(rcpt) {
  const subtotal = rcpt.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const discountAmt =
    rcpt.discountType === "percent" ? (subtotal * (Number(rcpt.discount) || 0)) / 100 : Number(rcpt.discount) || 0;
  const total = Math.max(subtotal - discountAmt, 0);

  let totalPaid = 0;
  if (rcpt.payments && rcpt.payments.length > 0) {
    totalPaid = rcpt.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  } else {
    totalPaid = total;
  }
  const balance = Math.max(total - totalPaid, 0);

  return { subtotal, discountAmt, total, totalPaid, balance };
}

function computeStatus(rcpt) {
  const { balance } = computeTotals(rcpt);
  return balance <= 0 ? "paid" : "partial";
}

const STATUS_META = {
  paid: { label: "Paid in Full", color: "#3DDC84", bg: "#3DDC841a" },
  partial: { label: "Partially Paid", color: "#FF6A1F", bg: "#FF6A1F1a" },
};

const DEFAULT_SETTINGS = {
  businessName: "KOLKODE",
  tagline: "Kolkata + Code",
  address: "Jaipur, Rajasthan / Kolkata, West Bengal, India",
  email: "hello@kolkode.studio",
  phone: "+91 00000 00000",
  defaultNotes: "Thank you for your payment.",
  defaultTemplate: "classic",
};

/* ---------- lattice / truss decorative motif (Howrah Bridge abstraction) ---------- */
function TrussPattern({ id }) {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <pattern id={id} width="64" height="32" patternUnits="userSpaceOnUse">
          <path
            d="M0 32 L32 0 L64 32 M0 0 L32 32 L64 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
      </defs>
    </svg>
  );
}

/* ---------- main app ---------- */
export default function KolkodeInvoiceApp() {
  const [ready, setReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("kolkode_auth_token") === "kolkode-session-authorized";
  });
  const [clients, setClients] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [view, setView] = useState("dashboard");
  const [editingReceiptId, setEditingReceiptId] = useState(null);
  const [viewingReceiptId, setViewingReceiptId] = useState(null);
  const [editingClientId, setEditingClientId] = useState(null);
  const [toast, setToast] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState("classic");

  useEffect(() => {
    if (settings.defaultTemplate) {
      setSelectedTemplate(settings.defaultTemplate);
    }
  }, [settings.defaultTemplate, viewingReceiptId]);

  useEffect(() => {
    (async () => {
      try {
        const [resClients, resReceipts, resSettings] = await Promise.all([
          fetch("/api/clients")
            .then((res) => (res.ok ? res.json() : []))
            .catch(() => []),
          fetch("/api/receipts")
            .then((res) => (res.ok ? res.json() : []))
            .catch(() => []),
          fetch("/api/settings")
            .then((res) => (res.ok ? res.json() : {}))
            .catch(() => ({})),
        ]);

        setClients(resClients || []);
        setReceipts(resReceipts || []);
        if (resSettings && Object.keys(resSettings).length > 0) {
          setSettings({ ...DEFAULT_SETTINGS, ...resSettings });
        }
        setReady(true);
      } catch (err) {
        console.warn("Failed to load from backend API, falling back to localStorage cache:", err);
        const [c, r, s] = await Promise.all([
          loadKey(KEYS.clients, []),
          loadKey(KEYS.receipts, []),
          loadKey(KEYS.settings, DEFAULT_SETTINGS),
        ]);
        setClients(c);
        setReceipts(r);
        setSettings({ ...DEFAULT_SETTINGS, ...s });
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (ready) saveKey(KEYS.clients, clients);
  }, [clients, ready]);
  useEffect(() => {
    if (ready) saveKey(KEYS.receipts, receipts);
  }, [receipts, ready]);
  useEffect(() => {
    if (ready) saveKey(KEYS.settings, settings);
  }, [settings, ready]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const upsertClient = async (client) => {
    setClients((prev) => {
      const exists = prev.some((c) => c.id === client.id);
      return exists ? prev.map((c) => (c.id === client.id ? client : c)) : [...prev, client];
    });

    try {
      await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(client),
      });
    } catch (err) {
      console.error("API error upsertClient:", err);
      showToast("Saved locally (offline mode)");
    }
  };

  const deleteClient = async (id) => {
    if (receipts.some((rcpt) => rcpt.clientId === id)) {
      showToast("Can't delete — client has receipts");
      return;
    }
    setClients((prev) => prev.filter((c) => c.id !== id));
    showToast("Client deleted");

    try {
      await fetch(`/api/clients/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("API error deleteClient:", err);
    }
  };

  const upsertReceipt = async (receipt) => {
    setReceipts((prev) => {
      const exists = prev.some((r) => r.id === receipt.id);
      return exists ? prev.map((r) => (r.id === receipt.id ? receipt : r)) : [...prev, receipt];
    });

    try {
      await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receipt),
      });
    } catch (err) {
      console.error("API error upsertReceipt:", err);
      showToast("Saved locally (offline mode)");
    }
  };

  const deleteReceipt = async (id) => {
    setReceipts((prev) => prev.filter((r) => r.id !== id));
    showToast("Receipt deleted");

    try {
      await fetch(`/api/receipts/${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("API error deleteReceipt:", err);
    }
  };

  if (!ready) {
    return (
      <div style={{ ...S.app, alignItems: "center", justifyContent: "center", display: "flex" }}>
        <div style={{ color: C.orange, fontFamily: F.mono, letterSpacing: 2 }}>LOADING KOLKODE…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <GlobalStyle />
        <LoginView onLoginSuccess={() => setIsAuthenticated(true)} />
      </>
    );
  }

  return (
    <div className="app-container" style={S.app}>
      <GlobalStyle />
      <TrussPattern id="truss" />
      <Sidebar view={view} setView={(v) => {
        setView(v);
        setEditingReceiptId(null);
        setViewingReceiptId(null);
        setEditingClientId(null);
      }} receipts={receipts} onLogout={() => {
        sessionStorage.removeItem("kolkode_auth_token");
        setIsAuthenticated(false);
      }} />
      <main style={S.main} className="no-print">
        {view === "dashboard" && (
          <Dashboard
            clients={clients}
            receipts={receipts}
            onOpenReceipt={(id) => {
              setViewingReceiptId(id);
              setView("receipt-view");
            }}
            onNewReceipt={() => {
              setEditingReceiptId(null);
              setView("receipt-edit");
            }}
          />
        )}
        {view === "clients" && (
          <ClientsView
            clients={clients}
            receipts={receipts}
            onEdit={(id) => {
              setEditingClientId(id);
              setView("client-edit");
            }}
            onNew={() => {
              setEditingClientId(null);
              setView("client-edit");
            }}
            onDelete={deleteClient}
            setView={setView}
            setViewingReceiptId={setViewingReceiptId}
          />
        )}
        {view === "client-edit" && (
          <ClientForm
            client={clients.find((c) => c.id === editingClientId) || null}
            onSave={(c) => {
              upsertClient(c);
              setView("clients");
              showToast("Client saved");
            }}
            onCancel={() => setView("clients")}
          />
        )}
        {view === "receipts" && (
          <ReceiptsView
            receipts={receipts}
            clients={clients}
            onOpen={(id) => {
              setViewingReceiptId(id);
              setView("receipt-view");
            }}
            onEdit={(id) => {
              setEditingReceiptId(id);
              setView("receipt-edit");
            }}
            onDelete={deleteReceipt}
            onNew={() => {
              setEditingReceiptId(null);
              setView("receipt-edit");
            }}
          />
        )}
        {view === "receipt-edit" && (
          <ReceiptForm
            receipt={receipts.find((r) => r.id === editingReceiptId) || null}
            clients={clients}
            receipts={receipts}
            settings={settings}
            onSave={(rcpt) => {
              upsertReceipt(rcpt);
              setViewingReceiptId(rcpt.id);
              setView("receipt-view");
              showToast("Receipt saved");
            }}
            onCancel={() => setView("receipts")}
            onNewClient={() => {
              setEditingClientId(null);
              setView("client-edit");
            }}
            onAddClient={upsertClient}
            showToast={showToast}
          />
        )}
        {view === "receipt-view" && (
          <ReceiptDetail
            receipt={receipts.find((r) => r.id === viewingReceiptId)}
            client={clients.find((c) => c.id === (receipts.find((r) => r.id === viewingReceiptId) || {}).clientId)}
            settings={settings}
            selectedTemplate={selectedTemplate}
            setSelectedTemplate={setSelectedTemplate}
            onEdit={() => {
              setEditingReceiptId(viewingReceiptId);
              setView("receipt-edit");
            }}
            onBack={() => setView("receipts")}
          />
        )}
        {view === "reports" && (
          <ReportsView receipts={receipts} clients={clients} />
        )}
        {view === "settings" && (
          <SettingsView settings={settings} onSave={async (s) => {
            setSettings(s);
            showToast("Settings saved");
            try {
              await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(s),
              });
            } catch (err) {
              console.error("API error settings save:", err);
            }
          }} />
        )}
      </main>

      {/* printable receipt - only shown during print */}
      {viewingReceiptId && view === "receipt-view" && (
        <PrintReceipt
          receipt={receipts.find((r) => r.id === viewingReceiptId)}
          client={clients.find((c) => c.id === (receipts.find((r) => r.id === viewingReceiptId) || {}).clientId)}
          settings={settings}
          template={selectedTemplate}
        />
      )}

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

/* ---------- design tokens ---------- */
const C = {
  bg: "#0B0B0D",
  surface: "#151317",
  surfaceAlt: "#1D1B20",
  border: "#2A272E",
  text: "#F3F1EC",
  muted: "#9C97A0",
  orange: "#FF6A1F",
  orangeDim: "#FF6A1F26",
  orangeSoft: "#FF6A1F0f",
  green: "#3DDC84",
  red: "#FF4D4D",
};
const F = {
  display: "'Outfit', 'Space Grotesk', system-ui, sans-serif",
  body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

const S = {
  app: {
    display: "flex",
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: F.body,
    fontSize: 14,
  },
  main: { flex: 1, padding: "28px 32px", overflowY: "auto" },
  toast: {
    position: "fixed",
    bottom: 20,
    right: 20,
    background: C.surfaceAlt,
    border: `1px solid ${C.orange}`,
    color: C.text,
    padding: "10px 16px",
    borderRadius: 8,
    fontFamily: F.mono,
    fontSize: 12.5,
    zIndex: 999,
    boxShadow: "0 8px 24px rgba(0,0,0,.5)",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    backdropFilter: "blur(4px)",
  },
  modalContent: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 28,
    width: "100%",
    maxWidth: 520,
    boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
  },
};

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap');

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ${F.body};
        background-color: ${C.bg};
        -webkit-font-smoothing: antialiased;
      }
      
      input, select, textarea {
        font-family: ${F.body};
        background: ${C.bg};
        border: 1px solid ${C.border};
        color: ${C.text};
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 13.5px;
        outline: none;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        width: 100%;
      }
      input:focus, select:focus, textarea:focus {
        border-color: ${C.orange};
        box-shadow: 0 0 0 3px ${C.orangeDim};
        background: ${C.surfaceAlt};
      }
      button { font-family: ${F.body}; cursor: pointer; }
      table { border-collapse: collapse; width: 100%; }
      
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: ${C.bg}; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: ${C.muted}; }

      .btn {
        background: ${C.orange};
        color: #100C08;
        border: none;
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: 700;
        font-size: 13.5px;
        letter-spacing: .2px;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .btn:hover {
        filter: brightness(1.08);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px ${C.orangeDim};
      }
      .btn:active {
        transform: translateY(0);
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
        box-shadow: none !important;
      }

      .btn-ghost {
        background: transparent;
        border: 1px solid ${C.border};
        color: ${C.text};
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 13.5px;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .btn-ghost:hover {
        border-color: ${C.orange};
        color: ${C.orange};
        background: ${C.orangeSoft};
      }
      .btn-ghost:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .btn-danger { color: ${C.red}; }
      .btn-danger:hover {
        border-color: ${C.red} !important;
        color: ${C.red} !important;
        background: ${C.red}12 !important;
      }

      .row-hover {
        transition: background-color 0.15s ease;
      }
      .row-hover:hover {
        background: ${C.surfaceAlt};
      }
      .print-only { display: none; }
      
      .table-wrapper {
        width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        border-radius: 8px;
      }

      .align-responsive {
        text-align: right;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      main > div {
        animation: fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }

      @media (max-width: 768px) {
        .app-container {
          flex-direction: column !important;
        }
        aside {
          width: 100% !important;
          border-right: none !important;
          border-bottom: 1px solid ${C.border} !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: space-between !important;
          padding: 12px 16px !important;
          flex-wrap: wrap !important;
          gap: 12px !important;
        }
        aside > div:first-child {
          padding: 0 !important;
        }
        aside button {
          width: auto !important;
        }
        main {
          padding: 16px 14px !important;
        }
        .grid-responsive {
          grid-template-columns: 1fr !important;
          gap: 14px !important;
        }
        .flex-responsive {
          flex-direction: column !important;
          align-items: flex-start !important;
          gap: 16px !important;
        }
        .align-responsive {
          text-align: left !important;
        }
        .dashboard-grid {
          grid-template-columns: 1fr !important;
        }
      }

      @media print {
        .no-print { display: none !important; }
        .print-only { display: block !important; }
        body { background: white !important; color: black !important; }
        .app-container {
          display: block !important;
          background: transparent !important;
          color: black !important;
          min-height: auto !important;
          padding: 0 !important;
          margin: 0 !important;
        }
      }
    `}</style>
  );
}

/* ---------- sidebar ---------- */
function Sidebar({ view, setView, receipts, onLogout }) {
  const NavItem = ({ id, label }) => (
    <div
      onClick={() => setView(id)}
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        cursor: "pointer",
        marginBottom: 4,
        fontSize: 13.5,
        fontWeight: view === id ? 700 : 500,
        color: view === id ? C.orange : C.muted,
        background: view === id ? C.orangeDim : "transparent",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>{label}</span>
    </div>
  );
  return (
    <aside className="no-print" style={{ width: 220, background: C.surface, borderRight: `1px solid ${C.border}`, padding: "24px 16px", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "0 6px 24px", position: "relative" }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, letterSpacing: 0.5, color: C.text }}>
          KOL<span style={{ color: C.orange }}>KODE</span>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, letterSpacing: 1.5, marginTop: 2 }}>
          RECEIPT_SYSTEM
        </div>
      </div>
      <NavItem id="dashboard" label="Dashboard" />
      <NavItem id="receipts" label="Receipts" />
      <NavItem id="clients" label="Clients" />
      <NavItem id="reports" label="Reports" />
      <NavItem id="settings" label="Settings" />
      <div style={{ marginTop: "auto", paddingTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        <button className="btn" style={{ width: "100%" }} onClick={() => setView("receipt-edit")}>
          + New Receipt
        </button>
        <button
          className="btn-ghost"
          style={{
            width: "100%",
            height: 38,
            borderColor: C.border,
            color: C.muted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12.5,
          }}
          onClick={onLogout}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}

/* ---------- Dashboard ---------- */
function Dashboard({ clients, receipts, onOpenReceipt, onNewReceipt }) {
  const stats = useMemo(() => {
    let totalAmount = 0;
    let totalReceived = 0;
    let totalPending = 0;
    receipts.forEach((rcpt) => {
      const { total, totalPaid, balance } = computeTotals(rcpt);
      totalAmount += total;
      totalReceived += totalPaid;
      totalPending += balance;
    });
    return { totalAmount, totalReceived, totalPending };
  }, [receipts]);

  const recent = [...receipts].sort((a, b) => (b.receiptDate > a.receiptDate ? 1 : -1)).slice(0, 6);

  return (
    <div>
      <Header title="Dashboard" subtitle="Overview of KOLKODE's receipt logs" action={{ label: "+ New Receipt", onClick: onNewReceipt }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 28 }} className="dashboard-grid">
        <StatCard label="Total Amount" value={inr(stats.totalAmount)} accent={C.orange} />
        <StatCard label="Total Received" value={inr(stats.totalReceived)} accent={C.green} />
        <StatCard label="Total Pending" value={inr(stats.totalPending)} accent={C.red} />
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, letterSpacing: 1, marginBottom: 10 }}>
        RECENT RECEIPTS
      </div>
      <div className="table-wrapper" style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table>
          <thead>
            <tr style={{ background: C.surface }}>
              {["Receipt #", "Client", "Date", "Payment Mode", "UTR / Txn ID", "Amount"].map((h) => (
                <th key={h} style={S_th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr><td colSpan={6} style={{ ...S_td, textAlign: "center", color: C.muted, padding: 28 }}>No receipts yet. Create your first one.</td></tr>
            )}
            {recent.map((rcpt) => {
              const client = clients.find((c) => c.id === rcpt.clientId);
              const { total } = computeTotals(rcpt);
              return (
                <tr key={rcpt.id} className="row-hover" style={{ cursor: "pointer" }} onClick={() => onOpenReceipt(rcpt.id)}>
                  <td style={{ ...S_td, fontFamily: F.mono }}>{rcpt.receiptNumber}</td>
                  <td style={S_td}>{client?.name || "—"}</td>
                  <td style={S_td}>{fmtDate(rcpt.receiptDate)}</td>
                  <td style={S_td}>{rcpt.paymentMethod || "—"}</td>
                  <td style={{ ...S_td, fontFamily: F.mono }}>{rcpt.utrId || "—"}</td>
                  <td style={{ ...S_td, fontWeight: 600 }}>{inr(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.muted, letterSpacing: 1, marginBottom: 8 }}>{label.toUpperCase()}</div>
      <div style={{ fontFamily: F.display, fontSize: 24, fontWeight: 700, color: accent }}>{value}</div>
    </div>
  );
}

function Header({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
      <div>
        <div style={{ fontFamily: F.display, fontSize: 24, fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>{subtitle}</div>}
      </div>
      {action && <button className="btn" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

const S_th = { textAlign: "left", padding: "10px 14px", fontSize: 11, fontFamily: F.mono, color: C.muted, letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` };
const S_td = { padding: "12px 14px", borderBottom: `1px solid ${C.border}`, fontSize: 13.5 };

function StatusPill({ status }) {
  const m = STATUS_META[status];
  return (
    <span style={{ background: m.bg, color: m.color, padding: "4px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 700, fontFamily: F.mono, letterSpacing: 0.3 }}>
      {m.label}
    </span>
  );
}

/* ---------- Clients ---------- */
function ClientsView({ clients, receipts, onEdit, onNew, onDelete, setView, setViewingReceiptId }) {
  const [search, setSearch] = useState("");
  const [historyClient, setHistoryClient] = useState(null);

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.businessName || "").toLowerCase().includes(search.toLowerCase())
  );

  const clientReceipts = historyClient ? receipts.filter((r) => r.clientId === historyClient.id) : [];

  return (
    <div>
      <Header title="Clients" subtitle={`${clients.length} client${clients.length === 1 ? "" : "s"}`} action={{ label: "+ New Client", onClick: onNew }} />

      <div style={{ marginBottom: 18, maxWidth: 360 }}>
        <input
          type="text"
          placeholder="Search clients by name or business..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: C.surface,
            borderColor: C.border,
            color: C.text,
            padding: "10px 14px",
            borderRadius: 8,
          }}
        />
      </div>

      <div className="table-wrapper" style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table>
          <thead>
            <tr style={{ background: C.surface }}>
              {["Name", "Business", "Email", "Phone", "Receipts Issued", ""].map((h) => (
                <th key={h} style={S_th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredClients.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...S_td, textAlign: "center", color: C.muted, padding: 28 }}>
                  {search ? "No clients match your search." : "No clients yet."}
                </td>
              </tr>
            )}
            {filteredClients.map((c) => {
              const count = receipts.filter((r) => r.clientId === c.id).length;
              return (
                <tr key={c.id} className="row-hover">
                  <td style={{ ...S_td, fontWeight: 600 }}>{c.name}</td>
                  <td style={S_td}>{c.businessName || "—"}</td>
                  <td style={S_td}>{c.email || "—"}</td>
                  <td style={S_td}>{c.phone || "—"}</td>
                  <td style={S_td}>
                    {count > 0 ? (
                      <button
                        className="btn-ghost"
                        style={{ padding: "4px 10px", fontSize: 12, border: `1px solid ${C.orange}`, color: C.orange, fontWeight: 700 }}
                        onClick={() => setHistoryClient(c)}
                      >
                        {count} {count === 1 ? "Receipt" : "Receipts"} →
                      </button>
                    ) : (
                      "0 Receipts"
                    )}
                  </td>
                  <td style={{ ...S_td, textAlign: "right" }}>
                    <button className="btn-ghost" style={{ marginRight: 8 }} onClick={() => onEdit(c.id)}>Edit</button>
                    <button className="btn-ghost btn-danger" onClick={() => onDelete(c.id)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {historyClient && (
        <div style={S.modalOverlay}>
          <div style={{ ...S.modalContent, maxWidth: 680 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Receipt History</div>
                <div style={{ fontSize: 13, color: C.muted }}>Issued to {historyClient.name} ({historyClient.businessName || "No Business"})</div>
              </div>
              <button className="btn-ghost" style={{ padding: "6px 12px" }} onClick={() => setHistoryClient(null)}>✕ Close</button>
            </div>

            <div style={{ maxHeight: 380, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ ...S_td, textAlign: "left", fontSize: 11, fontWeight: 700, color: C.muted }}>RECEIPT #</th>
                    <th style={{ ...S_td, textAlign: "left", fontSize: 11, fontWeight: 700, color: C.muted }}>DATE</th>
                    <th style={{ ...S_td, textAlign: "left", fontSize: 11, fontWeight: 700, color: C.muted }}>PAYMENT MODE</th>
                    <th style={{ ...S_td, textAlign: "right", fontSize: 11, fontWeight: 700, color: C.muted }}>AMOUNT</th>
                    <th style={{ ...S_td, width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {clientReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ ...S_td, textAlign: "center", color: C.muted, padding: 20 }}>
                        No receipts found for this client.
                      </td>
                    </tr>
                  ) : (
                    clientReceipts.map((rcpt) => {
                      const { total } = computeTotals(rcpt);
                      return (
                        <tr key={rcpt.id} className="row-hover">
                          <td style={{ ...S_td, fontFamily: F.mono, fontWeight: 600 }}>{rcpt.receiptNumber}</td>
                          <td style={S_td}>{fmtDate(rcpt.receiptDate)}</td>
                          <td style={S_td}>{rcpt.paymentMethod}</td>
                          <td style={{ ...S_td, textAlign: "right", fontFamily: F.mono, fontWeight: 600 }}>{inr(total)}</td>
                          <td style={{ ...S_td, textAlign: "right" }}>
                            <button
                              className="btn"
                              style={{ padding: "4px 8px", fontSize: 12 }}
                              onClick={() => {
                                setViewingReceiptId(rcpt.id);
                                setView("receipt-view");
                                setHistoryClient(null);
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientForm({ client, onSave, onCancel }) {
  const [form, setForm] = useState(client || { id: uid(), name: "", businessName: "", email: "", phone: "", address: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div style={{ maxWidth: 520 }}>
      <Header title={client ? "Edit Client" : "New Client"} />
      <Field label="Client / Contact Name *"><input value={form.name} onChange={set("name")} placeholder="e.g. Rahul Sharma" /></Field>
      <Field label="Business Name"><input value={form.businessName} onChange={set("businessName")} placeholder="e.g. Raja Rani Restaurant" /></Field>
      <Field label="Email"><input value={form.email} onChange={set("email")} placeholder="client@email.com" /></Field>
      <Field label="Phone"><input value={form.phone} onChange={set("phone")} placeholder="+91 XXXXX XXXXX" /></Field>
      <Field label="Billing Address"><textarea rows={3} value={form.address} onChange={set("address")} placeholder="Street, City, State, PIN" /></Field>
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button className="btn" onClick={() => form.name.trim() && onSave(form)} disabled={!form.name.trim()}>Save Client</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 6, fontFamily: F.mono, letterSpacing: 0.3 }}>{label}</div>
      {children}
    </div>
  );
}

/* ---------- Receipts list ---------- */
function ReceiptsView({ receipts, clients, onOpen, onEdit, onDelete, onNew }) {
  const [search, setSearch] = useState("");
  const sorted = [...receipts].sort((a, b) => (b.receiptDate > a.receiptDate ? 1 : -1));

  const filteredReceipts = sorted.filter((rcpt) => {
    const client = clients.find((c) => c.id === rcpt.clientId);
    const clientName = client?.name || "";
    const clientBusiness = client?.businessName || "";
    const query = search.toLowerCase();
    return (
      clientName.toLowerCase().includes(query) ||
      clientBusiness.toLowerCase().includes(query) ||
      rcpt.receiptNumber.toLowerCase().includes(query) ||
      (rcpt.utrId || "").toLowerCase().includes(query)
    );
  });

  return (
    <div>
      <Header title="Receipts" subtitle={`${receipts.length} total`} action={{ label: "+ New Receipt", onClick: onNew }} />

      <div style={{ marginBottom: 18, maxWidth: 360 }}>
        <input
          type="text"
          placeholder="Search receipts by client, number, or UTR..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: C.surface,
            borderColor: C.border,
            color: C.text,
            padding: "10px 14px",
            borderRadius: 8,
          }}
        />
      </div>

      <div className="table-wrapper" style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table>
          <thead>
            <tr style={{ background: C.surface }}>
              {["Receipt #", "Client", "Receipt Date", "Payment Mode", "UTR / Txn ID", "Amount", "Status", ""].map((h) => (
                <th key={h} style={S_th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredReceipts.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...S_td, textAlign: "center", color: C.muted, padding: 28 }}>
                  {search ? "No receipts match your search." : "No receipts yet. Create your first one."}
                </td>
              </tr>
            )}
            {filteredReceipts.map((rcpt) => {
              const client = clients.find((c) => c.id === rcpt.clientId);
              const { total } = computeTotals(rcpt);
              return (
                <tr key={rcpt.id} className="row-hover">
                  <td style={{ ...S_td, fontFamily: F.mono, cursor: "pointer" }} onClick={() => onOpen(rcpt.id)}>{rcpt.receiptNumber}</td>
                  <td style={{ ...S_td, cursor: "pointer" }} onClick={() => onOpen(rcpt.id)}>{client?.name || "—"}</td>
                  <td style={S_td}>{fmtDate(rcpt.receiptDate)}</td>
                  <td style={S_td}>{rcpt.paymentMethod || "—"}</td>
                  <td style={{ ...S_td, fontFamily: F.mono }}>{rcpt.utrId || "—"}</td>
                  <td style={{ ...S_td, fontWeight: 600 }}>{inr(total)}</td>
                  <td style={S_td}><StatusPill status={computeStatus(rcpt)} /></td>
                  <td style={{ ...S_td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn-ghost" style={{ marginRight: 8 }} onClick={() => onEdit(rcpt.id)}>Edit</button>
                    <button className="btn-ghost btn-danger" onClick={() => onDelete(rcpt.id)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Receipt form (builder) ---------- */
function ReceiptForm({ receipt, clients, receipts, settings, onSave, onCancel, onNewClient, onAddClient, showToast }) {
  const isNew = !receipt;
  const [clientId, setClientId] = useState(receipt?.clientId || clients[0]?.id || "");
  const [receiptDate, setReceiptDate] = useState(receipt?.receiptDate || todayISO());
  const [items, setItems] = useState(receipt?.items || [{ id: uid(), description: "", qty: 1, rate: 0 }]);
  const [discount, setDiscount] = useState(receipt?.discount || 0);
  const [discountType, setDiscountType] = useState(receipt?.discountType || "flat");
  const [notes, setNotes] = useState(receipt?.notes ?? settings.defaultNotes);
  const [showQuickClient, setShowQuickClient] = useState(false);

  const [payments, setPayments] = useState(() => {
    if (receipt?.payments && receipt.payments.length > 0) {
      return receipt.payments;
    }
    return [
      {
        id: uid(),
        amount: receipt?.totalPaid || 0,
        date: receipt?.receiptDate || todayISO(),
        method: receipt?.paymentMethod || "UPI",
        utrId: receipt?.utrId || "",
      }
    ];
  });

  const draft = { items, discount, discountType };
  const { subtotal, discountAmt, total } = computeTotals(draft);

  const receiptNumber = receipt?.receiptNumber || nextReceiptNumber(receipts, receiptDate);

  // Auto-sync initial installment amount for new receipts or single legacy records
  useEffect(() => {
    if (payments.length === 1 && Number(payments[0].amount) === 0 && total > 0) {
      setPayments([{ ...payments[0], amount: total }]);
    }
  }, [total]);

  const addItem = () => setItems([...items, { id: uid(), description: "", qty: 1, rate: 0 }]);
  const updateItem = (id, field, val) => setItems(items.map((it) => (it.id === id ? { ...it, [field]: val } : it)));
  const removeItem = (id) => setItems(items.filter((it) => it.id !== id));

  const addPayment = () => {
    const currentPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const remaining = Math.max(total - currentPaid, 0);
    setPayments([
      ...payments,
      {
        id: uid(),
        amount: remaining,
        date: todayISO(),
        method: "UPI",
        utrId: "",
      }
    ]);
  };

  const updatePayment = (id, field, val) => {
    setPayments(payments.map((p) => (p.id === id ? { ...p, [field]: val } : p)));
  };

  const removePayment = (id) => {
    if (payments.length === 1) {
      showToast("At least one payment is required");
      return;
    }
    setPayments(payments.filter((p) => p.id !== id));
  };

  const canSave = clientId && items.some((it) => it.description.trim() && Number(it.qty) > 0);

  const handleSave = () => {
    const finalizedPayments = payments.map((p) => ({
      ...p,
      amount: Number(p.amount) || 0,
    }));
    onSave({
      id: receipt?.id || uid(),
      receiptNumber,
      clientId,
      receiptDate: receiptDate || finalizedPayments[0]?.date || todayISO(),
      paymentMethod: finalizedPayments[0]?.method || "UPI",
      utrId: finalizedPayments[0]?.utrId || "",
      items: items
        .filter((it) => it.description.trim())
        .map((it) => ({
          ...it,
          qty: Number(it.qty) || 0,
          rate: Number(it.rate) || 0,
        })),
      discount: Number(discount) || 0,
      discountType,
      notes,
      payments: finalizedPayments,
      status: "issued",
      createdAt: receipt?.createdAt || new Date().toISOString(),
    });
  };

  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const outstandingBalance = Math.max(total - totalPaid, 0);

  return (
    <div style={{ maxWidth: 820 }}>
      <Header title={isNew ? "New Receipt" : `Edit ${receipt.receiptNumber}`} subtitle={`Receipt # ${receiptNumber} (auto-generated)`} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 8 }} className="grid-responsive">
        <Field label="Client / Received From *">
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              {clients.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13.5, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, display: "flex", alignItems: "center", height: 38 }}>
                  No clients. Click "+ New Client".
                </div>
              ) : (
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ height: 38 }}>
                  <option value="" disabled>Select a client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.businessName ? ` — ${c.businessName}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: "0 14px", height: 38, flexShrink: 0, whiteSpace: "nowrap" }}
              onClick={() => setShowQuickClient(true)}
            >
              + New Client
            </button>
          </div>
        </Field>
        <Field label="Receipt Date"><input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></Field>
      </div>

      <div style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, letterSpacing: 1, margin: "20px 0 10px" }}>RECEIPT ITEMS</div>
      <div className="table-wrapper" style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
        <table>
          <thead>
            <tr style={{ background: C.surface }}>
              <th style={S_th}>Description</th>
              <th style={{ ...S_th, width: 90 }}>Qty</th>
              <th style={{ ...S_th, width: 130 }}>Rate (₹)</th>
              <th style={{ ...S_th, width: 130 }}>Amount</th>
              <th style={{ ...S_th, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={S_td}><input value={it.description} onChange={(e) => updateItem(it.id, "description", e.target.value)} placeholder="e.g. Services rendered" /></td>
                <td style={S_td}><input type="number" min="0" step="1" value={it.qty} onChange={(e) => updateItem(it.id, "qty", e.target.value)} /></td>
                <td style={S_td}><input type="number" min="0" step="0.01" value={it.rate} onChange={(e) => updateItem(it.id, "rate", e.target.value)} /></td>
                <td style={{ ...S_td, fontFamily: F.mono }}>{inr((Number(it.qty) || 0) * (Number(it.rate) || 0))}</td>
                <td style={S_td}>
                  <button type="button" className="btn-ghost btn-danger" style={{ padding: "4px 8px" }} onClick={() => removeItem(it.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn-ghost" onClick={addItem} style={{ marginBottom: 20 }}>+ Add Line Item</button>

      {/* Payments and Installments received */}
      <div style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, letterSpacing: 1, margin: "24px 0 10px" }}>PAYMENTS & INSTALLMENTS RECEIVED</div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 16px 4px", marginBottom: 20 }}>
        {payments.map((p, idx) => (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1.5fr auto", gap: 12, alignItems: "flex-start", marginBottom: 12 }} className="grid-responsive">
            <Field label={`Part ${idx + 1} Amount (₹) *`}>
              <input type="number" min="0" value={p.amount} onChange={(e) => updatePayment(p.id, "amount", e.target.value)} />
            </Field>
            <Field label="Payment Date">
              <input type="date" value={p.date} onChange={(e) => updatePayment(p.id, "date", e.target.value)} />
            </Field>
            <Field label="Payment Mode">
              <select value={p.method} onChange={(e) => updatePayment(p.id, "method", e.target.value)} style={{ height: 38 }}>
                <option>UPI</option>
                <option>Bank Transfer</option>
                <option>Cash</option>
                <option>Card</option>
                <option>Net Banking</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="UTR / Transaction ID">
              <input type="text" value={p.utrId} onChange={(e) => updatePayment(p.id, "utrId", e.target.value)} placeholder="Txn Ref/UTR" />
            </Field>
            <div style={{ marginTop: 24 }}>
              <button type="button" className="btn-ghost btn-danger" style={{ padding: "8px 12px" }} onClick={() => removePayment(p.id)} disabled={payments.length === 1}>✕</button>
            </div>
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={addPayment} style={{ marginBottom: 14 }}>+ Add Payment Part / Installment</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }} className="grid-responsive">
        <div>
          <Field label="Notes"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <Row label="Subtotal" value={inr(subtotal)} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
              <span style={{ fontSize: 13, color: C.muted, flex: 1 }}>Discount</span>
              <input type="number" min="0" style={{ width: 90 }} value={discount} onChange={(e) => setDiscount(e.target.value)} />
              <select style={{ width: 80 }} value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                <option value="flat">₹</option>
                <option value="percent">%</option>
              </select>
            </div>
            <Row label="Discount Applied" value={"– " + inr(discountAmt)} muted />
            <div style={{ borderTop: `1px solid ${C.border}`, margin: "12px 0" }} />
            <Row label="Total Bill (Charged)" value={inr(total)} />
            <Row label="Total Paid (Received)" value={inr(totalPaid)} muted />
            <div style={{ borderTop: `2px double ${C.border}`, margin: "8px 0" }} />
            {outstandingBalance <= 0 ? (
              <div style={{ color: C.green, fontWeight: 700, display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>Status</span><span>✓ FULLY SETTLED</span>
              </div>
            ) : (
              <Row label="Balance Outstanding" value={inr(outstandingBalance)} big />
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button className="btn" disabled={!canSave} onClick={handleSave}>Save Receipt</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>

      {showQuickClient && (
        <div style={S.modalOverlay}>
          <div style={S.modalContent}>
            <ClientForm
              client={null}
              onSave={(newClient) => {
                if (onAddClient) onAddClient(newClient);
                setClientId(newClient.id);
                setShowQuickClient(false);
                if (showToast) showToast("Client added");
              }}
              onCancel={() => setShowQuickClient(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, big, muted }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: big ? 16 : 13, fontWeight: big ? 700 : 400, color: muted ? C.muted : C.text, fontFamily: big ? F.display : F.body }}>
      <span>{label}</span>
      <span style={{ fontFamily: F.mono }}>{value}</span>
    </div>
  );
}

function getPayments(rcpt) {
  if (rcpt.payments && rcpt.payments.length > 0) return rcpt.payments;

  const sub = rcpt.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const disc = rcpt.discountType === "percent" ? (sub * (Number(rcpt.discount) || 0)) / 100 : Number(rcpt.discount) || 0;
  const tot = Math.max(sub - disc, 0);

  return [
    {
      id: "legacy",
      amount: tot,
      date: rcpt.receiptDate,
      method: rcpt.paymentMethod || "UPI",
      utrId: rcpt.utrId || "",
    }
  ];
}

/* ---------- Receipt detail (screen view) ---------- */
function ReceiptDetail({ receipt, client, settings, selectedTemplate, setSelectedTemplate, onEdit, onBack }) {
  if (!receipt) return <div>Receipt not found.</div>;
  const { subtotal, discountAmt, total, totalPaid, balance } = computeTotals(receipt);
  const status = computeStatus(receipt);

  return (
    <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* Left Column: Details metadata (dark card) */}
      <div style={{ flex: 1, minWidth: 320, maxWidth: 780 }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <button className="btn-ghost" onClick={onBack}>← Back to Receipts</button>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              style={{ width: 150, height: 35, fontSize: 13, background: C.surfaceAlt, borderColor: C.border, color: C.text, padding: "4px 8px", borderRadius: 7 }}
            >
              <option value="classic">Classic (Serif)</option>
              <option value="modern">Modern (Sleek)</option>
              <option value="minimalist">Minimalist</option>
            </select>
            <button className="btn-ghost" onClick={() => window.print()}>Download / Print PDF</button>
            <button className="btn" onClick={onEdit}>Edit</button>
          </div>
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 24 }} className="flex-responsive">
            <div>
              {settings.businessName.toLowerCase() === "kolkode" ? (
                <img src={logoUrl} alt="KOLKODE" style={{ height: 120, display: "block", marginBottom: 6 }} />
              ) : (
                <div style={{ fontFamily: F.display, fontSize: 22, fontWeight: 700 }}>{settings.businessName}</div>
              )}
              <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{settings.tagline}</div>
            </div>
            <StatusPill status={status} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 24, fontSize: 13 }} className="flex-responsive">
            <div>
              <div style={{ color: C.muted, fontFamily: F.mono, fontSize: 11, marginBottom: 4 }}>RECEIVED FROM</div>
              <div style={{ fontWeight: 700 }}>{client?.name}</div>
              {client?.businessName && <div>{client?.businessName}</div>}
              <div style={{ color: C.muted, whiteSpace: "pre-line" }}>{client?.address}</div>
              <div style={{ color: C.muted }}>{client?.email}</div>
            </div>
            <div style={{ textAlign: "right" }} className="align-responsive">
              <div style={{ color: C.muted, fontFamily: F.mono, fontSize: 11, marginBottom: 4 }}>PAYMENT RECEIPT</div>
              <div style={{ fontFamily: F.mono, fontWeight: 700 }}>{receipt.receiptNumber}</div>
              <div style={{ color: C.muted, marginTop: 6 }}>Date Issued: {fmtDate(receipt.receiptDate)}</div>
            </div>
          </div>

          <div className="table-wrapper">
            <table style={{ marginBottom: 16 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ ...S_th, padding: "8px 0" }}>Description</th>
                  <th style={{ ...S_th, padding: "8px 0", textAlign: "right", width: 60 }}>Qty</th>
                  <th style={{ ...S_th, padding: "8px 0", textAlign: "right", width: 110 }}>Rate</th>
                  <th style={{ ...S_th, padding: "8px 0", textAlign: "right", width: 120 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((it) => (
                  <tr key={it.id}>
                    <td style={{ ...S_td, padding: "10px 0", border: "none" }}>{it.description}</td>
                    <td style={{ ...S_td, padding: "10px 0", border: "none", textAlign: "right" }}>{it.qty}</td>
                    <td style={{ ...S_td, padding: "10px 0", border: "none", textAlign: "right" }}>{inr(it.rate)}</td>
                    <td style={{ ...S_td, padding: "10px 0", border: "none", textAlign: "right", fontFamily: F.mono }}>{inr(it.qty * it.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
            <div style={{ width: 260 }}>
              <Row label="Subtotal" value={inr(subtotal)} />
              {discountAmt > 0 && <Row label="Discount" value={"– " + inr(discountAmt)} muted />}
              <div style={{ borderTop: `1px solid ${C.border}`, margin: "8px 0" }} />
              <Row label="Total Bill (Charged)" value={inr(total)} />
              <Row label="Total Paid (Received)" value={inr(totalPaid)} muted />
              <div style={{ borderTop: `2px double ${C.border}`, margin: "8px 0" }} />
              {balance <= 0 ? (
                <div style={{ color: C.green, fontWeight: 700, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>Status</span><span>✓ FULLY SETTLED</span>
                </div>
              ) : (
                <Row label="Balance Outstanding" value={inr(balance)} big />
              )}
            </div>
          </div>

          {receipt.notes && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: C.muted, fontFamily: F.mono, fontSize: 11 }}>NOTES</div>
              <div style={{ fontSize: 13 }}>{receipt.notes}</div>
            </div>
          )}

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 14 }}>
            <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.muted, letterSpacing: 1, marginBottom: 10 }}>PAYMENT PARTS / INSTALLMENTS HISTORY</div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr style={{ background: C.surfaceAlt }}>
                    <th style={{ ...S_th, padding: "6px 8px" }}>Part </th>
                    <th style={{ ...S_th, padding: "6px 8px" }}>Date</th>
                    <th style={{ ...S_th, padding: "6px 8px" }}>Payment Mode</th>
                    <th style={{ ...S_th, padding: "6px 8px" }}>UTR / Txn ID</th>
                    <th style={{ ...S_th, padding: "6px 8px", textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {getPayments(receipt).map((p, idx) => (
                    <tr key={p.id || idx}>
                      <td style={{ ...S_td, padding: "8px" }}>Part {idx + 1}</td>
                      <td style={{ ...S_td, padding: "8px" }}>{fmtDate(p.date)}</td>
                      <td style={{ ...S_td, padding: "8px" }}>{p.method}</td>
                      <td style={{ ...S_td, padding: "8px", fontFamily: F.mono }}>{p.utrId || "—"}</td>
                      <td style={{ ...S_td, padding: "8px", textAlign: "right", fontWeight: 600 }}>{inr(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Live White Print Preview */}
      <div style={{ flex: 1, minWidth: 320, maxWidth: 680, background: "#fff", border: "1px solid #ddd", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.15)", overflow: "hidden" }} className="no-print">
        <div style={{ fontSize: 10, color: "#888", fontWeight: 700, letterSpacing: "1px", background: "#f8fafc", padding: "10px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>LIVE PRINT PREVIEW ({selectedTemplate.toUpperCase()})</span>
          <span style={{ fontSize: 9, background: C.orange, color: "#100C08", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>PREVIEW</span>
        </div>
        <div style={{ background: "#fff" }}>
          {selectedTemplate === "modern" && <PrintModern receipt={receipt} client={client} settings={settings} subtotal={subtotal} discountAmt={discountAmt} total={total} />}
          {selectedTemplate === "minimalist" && <PrintMinimalist receipt={receipt} client={client} settings={settings} subtotal={subtotal} discountAmt={discountAmt} total={total} />}
          {selectedTemplate === "classic" && <PrintClassic receipt={receipt} client={client} settings={settings} subtotal={subtotal} discountAmt={discountAmt} total={total} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- Classic Print Layout ---------- */
function PrintClassic({ receipt, client, settings, subtotal, discountAmt, total }) {
  const { totalPaid, balance } = computeTotals(receipt);
  const statusLabel = balance <= 0 ? "PAID IN FULL" : "PARTIAL PAYMENT";
  const statusColor = balance <= 0 ? "#2e7d32" : "#c62828";

  return (
    <div style={{ background: "#fff", color: "#111", padding: 40, fontFamily: "Georgia, serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "3px double #111", paddingBottom: 16, marginBottom: 24 }}>
        <div>
          {settings.businessName.toLowerCase() === "kolkode" ? (
            <img src={logoUrl} alt="KOLKODE" style={{ height: 120, display: "block", marginBottom: 6 }} />
          ) : (
            <div style={{ fontSize: 26, fontWeight: 700 }}>{settings.businessName}</div>
          )}
          <div style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>{settings.tagline}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 6, whiteSpace: "pre-line" }}>{settings.address}</div>
          <div style={{ fontSize: 11, color: "#555" }}>{settings.email} · {settings.phone}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "inline-block", border: `1px solid ${statusColor}`, color: statusColor, padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: "1px", marginBottom: 10, textTransform: "uppercase" }}>
            {statusLabel}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>PAYMENT RECEIPT</div>
          <div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 4, fontWeight: 700 }}>{receipt.receiptNumber}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>Date Issued: {fmtDate(receipt.receiptDate)}</div>
        </div>
      </div>

      {/* Acknowledgment Statement */}
      <div style={{ background: "#fcfcfc", border: "1px solid #eee", padding: "14px 18px", borderRadius: 4, marginBottom: 24, fontSize: 13, lineHeight: 1.5 }}>
        {balance <= 0 ? (
          <span>This document serves as formal confirmation that payment of <b>{inr(totalPaid)}</b> was received in full from <b>{client?.name}</b> {client?.businessName ? `(${client.businessName})` : ""} as full settlement for the services detailed below.</span>
        ) : (
          <span>This document serves as formal confirmation that a partial payment of <b>{inr(totalPaid)}</b> was received from <b>{client?.name}</b> {client?.businessName ? `(${client.businessName})` : ""}, leaving an outstanding balance of <b>{inr(balance)}</b> for the services detailed below.</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 30, marginBottom: 24, fontSize: 12 }}>
        <div>
          <div style={{ fontSize: 9, color: "#777", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>RECEIVED FROM</div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{client?.name}</div>
          {client?.businessName && <div style={{ fontSize: 12.5, fontWeight: 600 }}>{client?.businessName}</div>}
          <div style={{ color: "#555", marginTop: 2, whiteSpace: "pre-line" }}>{client?.address}</div>
          <div style={{ color: "#555" }}>{client?.email}</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #111", borderTop: "1px solid #111" }}>
            <th style={{ textAlign: "left", padding: "8px 0", fontSize: 11 }}>DESCRIPTION</th>
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: 11, width: 50 }}>QTY</th>
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: 11, width: 100 }}>RATE</th>
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: 11, width: 120 }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((it) => (
            <tr key={it.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "10px 0", fontSize: 12.5 }}>{it.description}</td>
              <td style={{ padding: "10px 0", fontSize: 12.5, textAlign: "right" }}>{it.qty}</td>
              <td style={{ padding: "10px 0", fontSize: 12.5, textAlign: "right" }}>{inr(it.rate)}</td>
              <td style={{ padding: "10px 0", fontSize: 12.5, textAlign: "right" }}>{inr(it.qty * it.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
        <div style={{ width: 240, fontSize: 12.5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Subtotal</span><span>{inr(subtotal)}</span></div>
          {discountAmt > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Discount</span><span>– {inr(discountAmt)}</span></div>}
          <div style={{ borderTop: "1px solid #111", margin: "6px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 13 }}><span>Total Charges</span><span>{inr(total)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#2e7d32", fontWeight: 700, marginTop: 4 }}><span>Total Paid to Date</span><span>{inr(totalPaid)}</span></div>
          <div style={{ borderTop: "2px double #111", margin: "6px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 13 }}><span>Outstanding Balance</span><span>{inr(balance)}</span></div>
        </div>
      </div>

      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#777", letterSpacing: "0.5px", borderBottom: "1px solid #111", paddingBottom: 4, marginBottom: 8, textTransform: "uppercase" }}>Payment Installments Ledger</div>
        <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #ccc" }}>
              <th style={{ textAlign: "left", padding: "4px 0", fontSize: 10.5, color: "#555" }}>PART</th>
              <th style={{ textAlign: "left", padding: "4px 0", fontSize: 10.5, color: "#555" }}>DATE</th>
              <th style={{ textAlign: "left", padding: "4px 0", fontSize: 10.5, color: "#555" }}>METHOD</th>
              <th style={{ textAlign: "left", padding: "4px 0", fontSize: 10.5, color: "#555" }}>UTR / TRANSACTION ID</th>
              <th style={{ textAlign: "right", padding: "4px 0", fontSize: 10.5, color: "#555" }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {getPayments(receipt).map((p, idx) => (
              <tr key={p.id || idx} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 0" }}>Part {idx + 1}</td>
                <td style={{ padding: "6px 0" }}>{fmtDate(p.date)}</td>
                <td style={{ padding: "6px 0" }}>{p.method}</td>
                <td style={{ padding: "6px 0", fontFamily: "monospace" }}>{p.utrId || "—"}</td>
                <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700 }}>{inr(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receipt.notes && (
        <div style={{ fontSize: 11.5, marginBottom: 20, borderLeft: "2px solid #ccc", paddingLeft: 10, fontStyle: "italic" }}>
          <b>Notes:</b> {receipt.notes}
        </div>
      )}
    </div>
  );
}

/* ---------- Modern Print Layout ---------- */
function PrintModern({ receipt, client, settings, subtotal, discountAmt, total }) {
  const { totalPaid, balance } = computeTotals(receipt);
  const statusLabel = balance <= 0 ? "PAID IN FULL" : "PARTIAL PAYMENT";
  const statusBg = balance <= 0 ? "#3d7e5a1f" : "#c628281f";
  const statusColor = balance <= 0 ? "#2e7d32" : "#c62828";

  return (
    <div style={{ background: "#fff", color: "#1e293b", padding: 40, fontFamily: "'Space Grotesk', 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          {settings.businessName.toLowerCase() === "kolkode" ? (
            <img src={logoUrl} alt="KOLKODE" style={{ height: 120, display: "block", marginBottom: 6 }} />
          ) : (
            <div style={{ display: "inline-block", background: "#FF6A1F", color: "#fff", padding: "6px 12px", borderRadius: "6px", fontWeight: 700, fontSize: 24, letterSpacing: "0.5px" }}>
              {settings.businessName}
            </div>
          )}
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, fontWeight: 500 }}>{settings.tagline}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, fontWeight: 700, background: statusBg, color: statusColor, padding: "4px 10px", borderRadius: 20, display: "inline-block", marginBottom: 8, letterSpacing: "0.5px" }}>
            {statusLabel}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" }}>PAYMENT RECEIPT</div>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "#FF6A1F", fontWeight: 700, marginTop: 4 }}>{receipt.receiptNumber}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0", padding: "16px 0", marginBottom: 24, fontSize: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>RECEIVED FROM</div>
          <div style={{ fontWeight: 700, color: "#0f172a" }}>{client?.name}</div>
          {client?.businessName && <div style={{ color: "#475569" }}>{client?.businessName}</div>}
          <div style={{ color: "#64748b", marginTop: 2, whiteSpace: "pre-line" }}>{client?.address}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>ISSUED BY</div>
          <div style={{ fontWeight: 700, color: "#0f172a" }}>{settings.businessName}</div>
          <div style={{ color: "#64748b", marginTop: 2, whiteSpace: "pre-line" }}>{settings.address}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 4 }}>RECEIPT DETAILS</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
            <span style={{ color: "#94a3b8" }}>Date:</span><span style={{ fontWeight: 600 }}>{fmtDate(receipt.receiptDate)}</span>
            <span style={{ color: "#94a3b8" }}>Status:</span><span style={{ fontWeight: 600, color: balance <= 0 ? "#2e7d32" : "#FF6A1F" }}>{balance <= 0 ? "Fully Settled" : "Partially Paid"}</span>
          </div>
        </div>
      </div>

      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 18px", marginBottom: 24, fontSize: 13, color: "#334155" }}>
        {balance <= 0 ? (
          <span>This document serves as formal confirmation that payment of <b>{inr(totalPaid)}</b> was received in full from <b>{client?.name}</b> {client?.businessName ? `(${client.businessName})` : ""} as full settlement for the services detailed below.</span>
        ) : (
          <span>This document serves as formal confirmation that a partial payment of <b>{inr(totalPaid)}</b> was received from <b>{client?.name}</b> {client?.businessName ? `(${client.businessName})` : ""}, leaving an outstanding balance of <b>{inr(balance)}</b> for the services detailed below.</span>
        )}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, color: "#475569", borderRadius: "6px 0 0 6px" }}>ITEM DESCRIPTION</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, color: "#475569", width: 60 }}>QTY</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, color: "#475569", width: 110 }}>RATE</th>
            <th style={{ textAlign: "right", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, color: "#475569", width: 130, borderRadius: "0 6px 6px 0" }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((it) => (
            <tr key={it.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "12px 14px", fontSize: 12.5, fontWeight: 500, color: "#334155" }}>{it.description}</td>
              <td style={{ padding: "12px 14px", fontSize: 12.5, textAlign: "right", color: "#475569" }}>{it.qty}</td>
              <td style={{ padding: "12px 14px", fontSize: 12.5, textAlign: "right", color: "#475569" }}>{inr(it.rate)}</td>
              <td style={{ padding: "12px 14px", fontSize: 12.5, textAlign: "right", fontWeight: 600, color: "#0f172a", fontFamily: "monospace" }}>{inr(it.qty * it.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
        <div style={{ width: 260, fontSize: 12.5, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#475569", padding: "14px 14px 0" }}><span>Subtotal</span><span>{inr(subtotal)}</span></div>
          {discountAmt > 0 && <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", padding: "0 14px" }}><span>Discount</span><span>– {inr(discountAmt)}</span></div>}
          <div style={{ borderTop: "1px solid #e2e8f0", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "#0f172a", padding: "0 14px" }}><span>Total Charges</span><span>{inr(total)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#2e7d32", padding: "4px 14px" }}><span>Total Paid to Date</span><span>{inr(totalPaid)}</span></div>
          <div style={{ borderTop: "1px solid #e2e8f0", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, color: "#0f172a", padding: "0 14px 14px" }}><span>Outstanding Balance</span><span>{inr(balance)}</span></div>
        </div>
      </div>

      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.5px", marginBottom: 8, textTransform: "uppercase" }}>Payment Installments Ledger</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ textAlign: "left", padding: "8px 12px", color: "#475569" }}>PART #</th>
              <th style={{ textAlign: "left", padding: "8px 12px", color: "#475569" }}>DATE</th>
              <th style={{ textAlign: "left", padding: "8px 12px", color: "#475569" }}>PAYMENT MODE</th>
              <th style={{ textAlign: "left", padding: "8px 12px", color: "#475569" }}>UTR / TRANSACTION ID</th>
              <th style={{ textAlign: "right", padding: "8px 12px", color: "#475569" }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {getPayments(receipt).map((p, idx) => (
              <tr key={p.id || idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 12px", fontWeight: 600, color: "#334155" }}>Part {idx + 1}</td>
                <td style={{ padding: "10px 12px", color: "#475569" }}>{fmtDate(p.date)}</td>
                <td style={{ padding: "10px 12px", color: "#475569" }}>{p.method}</td>
                <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#334155" }}>{p.utrId || "—"}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{inr(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receipt.notes && (
        <div style={{ fontSize: 11.5, background: "#f8fafc", padding: 12, borderRadius: 8, borderLeft: "3px solid #FF6A1F" }}>
          <span style={{ fontWeight: 700, color: "#475569" }}>Notes:</span> <span style={{ color: "#334155" }}>{receipt.notes}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Minimalist Print Layout ---------- */
function PrintMinimalist({ receipt, client, settings, subtotal, discountAmt, total }) {
  const { totalPaid, balance } = computeTotals(receipt);
  const statusLabel = balance <= 0 ? "PAID IN FULL" : "PARTIAL PAYMENT";
  const statusColor = balance <= 0 ? "#2e7d32" : "#c62828";

  return (
    <div style={{ background: "#fff", color: "#222", padding: 40, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 35 }}>
        <div>
          {settings.businessName.toLowerCase() === "kolkode" ? (
            <img src={logoUrl} alt="KOLKODE" style={{ height: 100, display: "block", marginBottom: 6 }} />
          ) : (
            <div style={{ fontSize: 22, fontWeight: 300, color: "#111", letterSpacing: "1px" }}>{settings.businessName.toUpperCase()}</div>
          )}
          <div style={{ fontSize: 10, color: "#888", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{settings.tagline}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: statusColor, letterSpacing: "1.5px", marginBottom: 4 }}>{statusLabel}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{receipt.receiptNumber}</div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid #111", borderBottom: "1px solid #111", padding: "16px 0", marginBottom: 28, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 30, fontSize: 12 }}>
        <div>
          <div style={{ fontSize: 9, color: "#999", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 6 }}>RECEIVED FROM</div>
          <div style={{ fontWeight: 600, color: "#111" }}>{client?.name}</div>
          {client?.businessName && <div style={{ color: "#444" }}>{client?.businessName}</div>}
          <div style={{ color: "#666", marginTop: 4, whiteSpace: "pre-line" }}>{client?.address}</div>
          <div style={{ color: "#666", marginTop: 2 }}>{client?.email}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#999", fontWeight: 700, letterSpacing: "0.5px", marginBottom: 6 }}>RECEIPT DETAILS</div>
          <div style={{ display: "inline-grid", gridTemplateColumns: "auto auto", gap: "4px 14px", textAlign: "right" }}>
            <span style={{ color: "#888" }}>Date Issued:</span><span>{fmtDate(receipt.receiptDate)}</span>
            <span style={{ color: "#888" }}>Status:</span><span>{balance <= 0 ? "Fully Settled" : "Partially Paid"}</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 13, color: "#333", marginBottom: 28, lineHeight: 1.5 }}>
        {balance <= 0 ? (
          <span>This document serves as formal confirmation that payment of <b>{inr(totalPaid)}</b> was received in full from <b>{client?.name}</b> {client?.businessName ? `(${client.businessName})` : ""} as full settlement for the services detailed below.</span>
        ) : (
          <span>This document serves as formal confirmation that a partial payment of <b>{inr(totalPaid)}</b> was received from <b>{client?.name}</b> {client?.businessName ? `(${client.businessName})` : ""}, leaving an outstanding balance of <b>{inr(balance)}</b> for the services detailed below.</span>
        )}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 30 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #111" }}>
            <th style={{ textAlign: "left", padding: "8px 0", fontSize: 10, fontWeight: 700, color: "#666" }}>DESCRIPTION</th>
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: 10, fontWeight: 700, color: "#666", width: 50 }}>QTY</th>
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: 10, fontWeight: 700, color: "#666", width: 100 }}>RATE</th>
            <th style={{ textAlign: "right", padding: "8px 0", fontSize: 10, fontWeight: 700, color: "#666", width: 120 }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((it) => (
            <tr key={it.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "10px 0", fontSize: 12, color: "#333" }}>{it.description}</td>
              <td style={{ padding: "10px 0", fontSize: 12, textAlign: "right", color: "#555" }}>{it.qty}</td>
              <td style={{ padding: "10px 0", fontSize: 12, textAlign: "right", color: "#555" }}>{inr(it.rate)}</td>
              <td style={{ padding: "10px 0", fontSize: 12, textAlign: "right", fontWeight: 600, color: "#111" }}>{inr(it.qty * it.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 35 }}>
        <div style={{ width: 220, fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, color: "#666" }}><span>Subtotal</span><span>{inr(subtotal)}</span></div>
          {discountAmt > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, color: "#888" }}><span>Discount</span><span>– {inr(discountAmt)}</span></div>}
          <div style={{ borderTop: "1px solid #eee", margin: "6px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: "#666" }}><span>Total Charges</span><span>{inr(total)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "#2e7d32" }}><span>Total Paid to Date</span><span>{inr(totalPaid)}</span></div>
          <div style={{ borderTop: "1px solid #111", margin: "6px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#111" }}><span>Outstanding Balance</span><span>{inr(balance)}</span></div>
        </div>
      </div>

      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#999", letterSpacing: "1px", marginBottom: 8, borderBottom: "1px solid #111", paddingBottom: 4, textTransform: "uppercase" }}>Payment Installments Ledger</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #eee" }}>
              <th style={{ textAlign: "left", padding: "6px 0", color: "#666", fontSize: 10 }}>PART</th>
              <th style={{ textAlign: "left", padding: "6px 0", color: "#666", fontSize: 10 }}>DATE</th>
              <th style={{ textAlign: "left", padding: "6px 0", color: "#666", fontSize: 10 }}>METHOD</th>
              <th style={{ textAlign: "left", padding: "6px 0", color: "#666", fontSize: 10 }}>UTR / TRANSACTION ID</th>
              <th style={{ textAlign: "right", padding: "6px 0", color: "#666", fontSize: 10 }}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {getPayments(receipt).map((p, idx) => (
              <tr key={p.id || idx} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 0", color: "#222" }}>Part {idx + 1}</td>
                <td style={{ padding: "8px 0", color: "#555" }}>{fmtDate(p.date)}</td>
                <td style={{ padding: "8px 0", color: "#555" }}>{p.method}</td>
                <td style={{ padding: "8px 0", fontFamily: "monospace", color: "#222" }}>{p.utrId || "—"}</td>
                <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600, color: "#111" }}>{inr(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receipt.notes && (
        <div style={{ fontSize: 11, color: "#555", marginBottom: 8, lineHeight: "1.4", borderLeft: "1px solid #111", paddingLeft: 8 }}>
          <b>Notes:</b> {receipt.notes}
        </div>
      )}
    </div>
  );
}

/* ---------- Print-friendly receipt (used by window.print) ---------- */
function PrintReceipt({ receipt, client, settings, template }) {
  if (!receipt) return null;
  const { subtotal, discountAmt, total } = computeTotals(receipt);

  let content;
  switch (template) {
    case "modern":
      content = <PrintModern receipt={receipt} client={client} settings={settings} subtotal={subtotal} discountAmt={discountAmt} total={total} />;
      break;
    case "minimalist":
      content = <PrintMinimalist receipt={receipt} client={client} settings={settings} subtotal={subtotal} discountAmt={discountAmt} total={total} />;
      break;
    case "classic":
    default:
      content = <PrintClassic receipt={receipt} client={client} settings={settings} subtotal={subtotal} discountAmt={discountAmt} total={total} />;
      break;
  }
  return <div className="print-only">{content}</div>;
}

/* ---------- Settings ---------- */
function SettingsView({ settings, onSave }) {
  const [form, setForm] = useState(settings);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div style={{ maxWidth: 560 }}>
      <Header title="Business Settings" subtitle="Appears on every receipt" />
      <Field label="Business Name"><input value={form.businessName} onChange={set("businessName")} /></Field>
      <Field label="Tagline"><input value={form.tagline} onChange={set("tagline")} /></Field>
      <Field label="Address"><textarea rows={2} value={form.address} onChange={set("address")} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Email"><input value={form.email} onChange={set("email")} /></Field>
        <Field label="Phone"><input value={form.phone} onChange={set("phone")} /></Field>
      </div>

      <Field label="Default Notes"><textarea rows={2} value={form.defaultNotes} onChange={set("defaultNotes")} /></Field>
      <Field label="Default Receipt Template">
        <select value={form.defaultTemplate || "classic"} onChange={set("defaultTemplate")}>
          <option value="classic">Classic (Serif Accent)</option>
          <option value="modern">Modern (Sleek Space Grotesk)</option>
          <option value="minimalist">Minimalist (Subtle spacing & typography)</option>
        </select>
      </Field>
      <button className="btn" onClick={() => onSave(form)}>Save Settings</button>
    </div>
  );
}

/* ---------- Reports View ---------- */
function ReportsView({ receipts, clients }) {
  const [mode, setMode] = useState("list"); // "list" | "calendar"
  const [expandedMonths, setExpandedMonths] = useState({});
  const [calDate, setCalDate] = useState(new Date());
  const [selectedDayDetails, setSelectedDayDetails] = useState(null);

  const toggleMonth = (monthKey) => {
    setExpandedMonths((prev) => ({
      ...prev,
      [monthKey]: !prev[monthKey],
    }));
  };

  // Compile all payments/installments
  const allPayments = useMemo(() => {
    const list = [];
    receipts.forEach((rcpt) => {
      const client = clients.find((c) => c.id === rcpt.clientId);
      const pmts = getPayments(rcpt);
      pmts.forEach((p) => {
        list.push({
          ...p,
          receiptNumber: rcpt.receiptNumber,
          receiptId: rcpt.id,
          clientName: client?.name || "—",
          clientBusiness: client?.businessName || "",
        });
      });
    });
    return list;
  }, [receipts, clients]);

  // Totals calculations
  const stats = useMemo(() => {
    let totalServiceCharges = 0;
    let totalOutstanding = 0;

    receipts.forEach((rcpt) => {
      const { total, balance } = computeTotals(rcpt);
      totalServiceCharges += total;
      totalOutstanding += balance;
    });

    const totalDuesSettled = allPayments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    return { totalDuesSettled, totalServiceCharges, totalOutstanding };
  }, [receipts, allPayments]);

  // Group payments by Month Year
  const monthlyGroups = useMemo(() => {
    const groups = {};
    allPayments.forEach((p) => {
      if (!p.date) return;
      const d = new Date(p.date);
      if (isNaN(d.getTime())) return;
      const year = d.getFullYear();
      const month = d.getMonth();
      const key = `${year}-${String(month + 1).padStart(2, "0")}`;

      if (!groups[key]) {
        groups[key] = {
          key,
          year,
          month,
          monthLabel: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
          totalReceived: 0,
          paymentsList: [],
        };
      }
      groups[key].totalReceived += Number(p.amount) || 0;
      groups[key].paymentsList.push(p);
    });

    const sorted = Object.values(groups).sort((a, b) => b.key.localeCompare(a.key));
    sorted.forEach((m) => {
      m.paymentsList.sort((a, b) => (b.date > a.date ? 1 : -1));
    });
    return sorted;
  }, [allPayments]);

  // Calendar calculations
  const calendarData = useMemo(() => {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells = [];
    // Empty cells before the 1st of the month
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({ day: null, dateStr: null });
    }
    // Days of the month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, dateStr });
    }

    return cells;
  }, [calDate]);

  const prevMonth = () => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1));
  const nextMonth = () => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1));

  const getDayPayments = (dateStr) => {
    if (!dateStr) return [];
    return allPayments.filter((p) => p.date === dateStr);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: F.display, fontSize: 24, fontWeight: 700 }}>Financial Reports</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Grouped breakdown of payments received</div>
        </div>
        <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, gap: 4 }}>
          <button
            onClick={() => setMode("list")}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              background: mode === "list" ? C.orange : "transparent",
              color: mode === "list" ? "#100C08" : C.muted,
              transition: "all 0.2s ease",
            }}
          >
            List View
          </button>
          <button
            onClick={() => setMode("calendar")}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              background: mode === "calendar" ? C.orange : "transparent",
              color: mode === "calendar" ? "#100C08" : C.muted,
              transition: "all 0.2s ease",
            }}
          >
            Calendar View
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 28 }} className="dashboard-grid">
        <StatCard label="Total Dues Settled" value={inr(stats.totalDuesSettled)} accent={C.green} />
        <StatCard label="Pending Receivables" value={inr(stats.totalOutstanding)} accent={C.orange} />
        <StatCard label="Total Service Charges" value={inr(stats.totalServiceCharges)} accent={C.text} />
      </div>

      {mode === "list" ? (
        <div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, letterSpacing: 1, marginBottom: 16 }}>
            MONTHLY BREAKDOWN
          </div>

          {monthlyGroups.length === 0 ? (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 28, textAlign: "center", color: C.muted }}>
              No recorded payments found.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {monthlyGroups.map((group) => {
                const isExpanded = !!expandedMonths[group.key];
                return (
                  <div
                    key={group.key}
                    style={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      overflow: "hidden",
                    }}
                  >
                    {/* Header Row */}
                    <div
                      onClick={() => toggleMonth(group.key)}
                      style={{
                        padding: "16px 20px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                        background: isExpanded ? C.surfaceAlt : "transparent",
                        transition: "background 0.2s ease",
                      }}
                      className="flex-responsive"
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 12, color: C.orange }}>{isExpanded ? "▼" : "▶"}</span>
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{group.monthLabel}</span>
                        <span
                          style={{
                            background: C.orangeDim,
                            color: C.orange,
                            padding: "2px 8px",
                            borderRadius: 12,
                            fontSize: 10.5,
                            fontWeight: 700,
                            fontFamily: F.mono,
                          }}
                        >
                          {group.paymentsList.length} {group.paymentsList.length === 1 ? "Payment" : "Payments"}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }} className="align-responsive">
                        <span style={{ fontSize: 12, color: C.muted }}>Total Settled:</span>
                        <span style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{inr(group.totalReceived)}</span>
                      </div>
                    </div>

                    {/* Expanded Details List */}
                    {isExpanded && (
                      <div style={{ padding: "8px 20px 20px", borderTop: `1px solid ${C.border}` }}>
                        <div className="table-wrapper">
                          <table style={{ width: "100%", fontSize: 13 }}>
                            <thead>
                              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                                <th style={{ ...S_th, padding: "8px 0" }}>Date</th>
                                <th style={{ ...S_th, padding: "8px 0" }}>Receipt #</th>
                                <th style={{ ...S_th, padding: "8px 0" }}>Client</th>
                                <th style={{ ...S_th, padding: "8px 0" }}>Mode</th>
                                <th style={{ ...S_th, padding: "8px 0" }}>UTR / Txn ID</th>
                                <th style={{ ...S_th, padding: "8px 0", textAlign: "right" }}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.paymentsList.map((p, idx) => (
                                <tr key={p.id || idx} style={{ borderBottom: `1px solid ${C.border}` }} className="row-hover">
                                  <td style={{ ...S_td, padding: "10px 0" }}>{fmtDate(p.date)}</td>
                                  <td style={{ ...S_td, padding: "10px 0", fontFamily: F.mono }}>{p.receiptNumber}</td>
                                  <td style={{ ...S_td, padding: "10px 0" }}>
                                    <div style={{ fontWeight: 600 }}>{p.clientName}</div>
                                    {p.clientBusiness && <div style={{ fontSize: 11, color: C.muted }}>{p.clientBusiness}</div>}
                                  </td>
                                  <td style={{ ...S_td, padding: "10px 0" }}>{p.method}</td>
                                  <td style={{ ...S_td, padding: "10px 0", fontFamily: F.mono }}>{p.utrId || "—"}</td>
                                  <td style={{ ...S_td, padding: "10px 0", textAlign: "right", fontWeight: 700, color: C.text }}>{inr(p.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Calendar View Mode */
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 18px", marginBottom: 18 }}>
            <button className="btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={prevMonth}>← Previous</button>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: F.display }}>
              {calDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
            <button className="btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={nextMonth}>Next →</button>
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", padding: 10 }}>
            {/* Days of week header */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 8, textAlign: "center" }}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} style={{ fontSize: 11.5, fontFamily: F.mono, fontWeight: 700, color: C.muted, padding: "6px 0", textTransform: "uppercase" }}>
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar cells grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {calendarData.map((cell, idx) => {
                const dayPayments = getDayPayments(cell.dateStr);
                const dayTotal = dayPayments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                const isToday = cell.dateStr === todayISO();

                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (dayPayments.length > 0) {
                        setSelectedDayDetails({ date: cell.dateStr, payments: dayPayments });
                      }
                    }}
                    style={{
                      minHeight: 90,
                      background: cell.day ? C.surfaceAlt : "transparent",
                      border: `1px solid ${isToday ? C.orange : cell.day ? C.border : "transparent"}`,
                      borderRadius: 8,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      cursor: dayPayments.length > 0 ? "pointer" : "default",
                      transition: "all 0.15s ease",
                    }}
                    className={dayPayments.length > 0 ? "row-hover" : ""}
                  >
                    {cell.day ? (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 500, color: isToday ? C.orange : C.text }}>
                          {cell.day}
                        </span>
                        {dayPayments.length > 0 && (
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green }} />
                        )}
                      </div>
                    ) : (
                      <div />
                    )}

                    {dayTotal > 0 && (
                      <div style={{ textAlign: "right", marginTop: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: C.green, background: `${C.green}1a`, padding: "2px 6px", borderRadius: 4, display: "inline-block" }}>
                          + {inr(dayTotal)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Selected Day Payments Modal details popup */}
      {selectedDayDetails && (
        <div style={S.modalOverlay}>
          <div style={{ ...S.modalContent, maxWidth: 640 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Payments Settled</div>
                <div style={{ fontSize: 13, color: C.muted }}>{fmtDate(selectedDayDetails.date)}</div>
              </div>
              <button className="btn-ghost" style={{ padding: "6px 12px" }} onClick={() => setSelectedDayDetails(null)}>✕ Close</button>
            </div>

            <div style={{ maxHeight: 300, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.surfaceAlt, borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ ...S_th, padding: "8px 12px" }}>RECEIPT #</th>
                    <th style={{ ...S_th, padding: "8px 12px" }}>CLIENT</th>
                    <th style={{ ...S_th, padding: "8px 12px" }}>PAYMENT MODE</th>
                    <th style={{ ...S_th, padding: "8px 12px", textAlign: "right" }}>AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDayDetails.payments.map((p, idx) => (
                    <tr key={p.id || idx} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ ...S_td, padding: "10px 12px", fontFamily: F.mono }}>{p.receiptNumber}</td>
                      <td style={{ ...S_td, padding: "10px 12px" }}>
                        <div style={{ fontWeight: 600 }}>{p.clientName}</div>
                        {p.clientBusiness && <div style={{ fontSize: 11, color: C.muted }}>{p.clientBusiness}</div>}
                      </td>
                      <td style={{ ...S_td, padding: "10px 12px" }}>{p.method}</td>
                      <td style={{ ...S_td, padding: "10px 12px", textAlign: "right", fontWeight: 700, color: C.green }}>{inr(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Login View ---------- */
function LoginView({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        sessionStorage.setItem("kolkode_auth_token", data.token);
        onLoginSuccess();
      } else {
        setError(data.error || "Invalid username or password.");
      }
    } catch (err) {
      console.error("Login request failed:", err);
      // local fallback for network errors or offline mode
      if (username === "admin" && password === "kolkodeadmin") {
        sessionStorage.setItem("kolkode_auth_token", "kolkode-session-authorized");
        onLoginSuccess();
      } else {
        setError("Network error or invalid credentials.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#080604",
        color: C.text,
        fontFamily: F.body,
        padding: 20,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background Watermark */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.04, color: C.orange, pointerEvents: "none" }}>
        <div style={{ width: "100%", height: "100%", background: "url(#truss)" }} />
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: "40px 32px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 26, letterSpacing: 0.5, color: C.text }}>
            KOL<span style={{ color: C.orange }}>KODE</span>
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.muted, letterSpacing: 2, marginTop: 4 }}>
            RECEIPT_SYSTEM_ADMIN
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {error && (
            <div
              style={{
                background: C.orangeDim,
                color: C.orange,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 12.5,
                textAlign: "center",
              }}
            >
              {error}
            </div>
          )}

          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, fontFamily: F.mono, letterSpacing: 0.3 }}>USERNAME</div>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              style={{
                width: "100%",
                background: C.surfaceAlt,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "10px 14px",
                color: C.text,
                fontSize: 13.5,
                outline: "none",
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, fontFamily: F.mono, letterSpacing: 0.3 }}>PASSWORD</div>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                style={{
                  width: "100%",
                  background: C.surfaceAlt,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "10px 40px 10px 14px",
                  color: C.text,
                  fontSize: 13.5,
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: C.muted,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn"
            disabled={loading}
            style={{
              width: "100%",
              height: 42,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              marginTop: 10,
            }}
          >
            {loading ? "Authenticating..." : "Login to System"}
          </button>
        </form>
      </div>
    </div>
  );
}
