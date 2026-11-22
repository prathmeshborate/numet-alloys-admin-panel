"use client";

import { useState, useEffect, useMemo } from "react";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseClient";

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // Stock Management State
  const [items, setItems] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loadingStock, setLoadingStock] = useState(false);
  const [saving, setSaving] = useState(false);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState("all"); // "all" | "inStock" | "outOfStock"

  // Bulk Paste Modal State
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkMode, setBulkMode] = useState("append"); // "append" | "replace"

  // Notification State
  const [sendPush, setSendPush] = useState(true);
  const [notifTitle, setNotifTitle] = useState("Numet Alloys — Ready Stock Updated");
  const [notifBody, setNotifBody] = useState("Fresh ready stock has been updated. Open the app to check availability.");
  const [status, setStatus] = useState({ type: "", message: "" });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) fetchStock();
    });
    return () => unsub();
  }, []);

  const fetchStock = async () => {
    setLoadingStock(true);
    try {
      const snap = await getDoc(doc(db, "inventory", "ready_stock"));
      if (snap.exists()) {
        const data = snap.data();
        if (data.lastUpdated) setLastUpdated(data.lastUpdated);
        if (Array.isArray(data.items)) {
          const cleanItems = data.items
            .filter((entry) => entry !== "" && entry !== null)
            .map((entry, idx) =>
              typeof entry === "object"
                ? {
                    id: entry.id || `${Date.now()}-${idx}`,
                    productName: entry.productName || "",
                    grade: entry.grade || "",
                    size: entry.size || "",
                    quantity: entry.quantity || "",
                    inStock: Boolean(entry.inStock),
                  }
                : {
                    id: `${Date.now()}-${idx}`,
                    productName: String(entry),
                    grade: "",
                    size: "",
                    quantity: "",
                    inStock: true,
                  }
            );
          setItems(cleanItems);
        }
      }
    } catch (err) {
      setStatus({ type: "error", message: "Error loading stock: " + err.message });
    }
    setLoadingStock(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setLoginError("Invalid email or password.");
    }
  };

  const addRow = () => {
    setSearchQuery("");
    setStockFilter("all");
    setItems((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productName: "",
        grade: "",
        size: "",
        quantity: "",
        inStock: true,
      },
      ...prev,
    ]);
  };

  const updateRowById = (id, field, value) => {
    setItems((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const removeRowById = (id) => {
    setItems((prev) => prev.filter((row) => row.id !== id));
  };

  // Parse Tab-Separated (Excel/Sheets) or Comma-Separated rows
  const handleBulkImport = () => {
    const lines = bulkText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return;

    const parsedRows = lines.map((line, idx) => {
      const cols = line.includes("\t") ? line.split("\t") : line.split(",");
      const [productName = "", grade = "", size = "", quantity = "", availRaw = "yes"] = cols.map((c) => c.trim());
      const isAvailable = !["no", "false", "0", "out", "out of stock"].includes(availRaw.toLowerCase());

      return {
        id: `${Date.now()}-bulk-${idx}`,
        productName,
        grade,
        size,
        quantity,
        inStock: isAvailable,
      };
    });

    if (bulkMode === "replace") {
      setItems(parsedRows);
    } else {
      setItems((prev) => [...parsedRows, ...prev]);
    }

    setBulkText("");
    setShowBulkModal(false);
    setStatus({
      type: "info",
      message: `Imported ${parsedRows.length} item(s) into table. Click "Save & Publish Stock" to sync live.`,
    });
  };

  // Filtered view (preserves original IDs so editing while filtering is 100% safe)
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return items.filter((item) => {
      const matchesFilter =
        stockFilter === "all" ||
        (stockFilter === "inStock" && item.inStock) ||
        (stockFilter === "outOfStock" && !item.inStock);

      if (!matchesFilter) return false;
      if (!q) return true;

      return (
        (item.productName || "").toLowerCase().includes(q) ||
        (item.grade || "").toLowerCase().includes(q) ||
        (item.size || "").toLowerCase().includes(q) ||
        (item.quantity || "").toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, stockFilter]);

  const inStockCount = useMemo(() => items.filter((i) => i.inStock).length, [items]);

  const handleSaveAndPublish = async () => {
    setSaving(true);
    setStatus({ type: "", message: "" });
    try {
      // Filter out completely blank rows before saving
      const validItems = items.filter(
        (item) =>
          (item.productName || "").trim() !== "" ||
          (item.grade || "").trim() !== "" ||
          (item.size || "").trim() !== ""
      );

      const nowISO = new Date().toISOString();

      await setDoc(doc(db, "inventory", "ready_stock"), {
        lastUpdated: nowISO,
        updatedBy: user.email,
        items: validItems,
      });

      setItems(validItems);
      setLastUpdated(nowISO);

      if (sendPush) {
        const token = await user.getIdToken();
        const res = await fetch("/api/notify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title: notifTitle, body: notifBody }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Notification failed");
        setStatus({
          type: "success",
          message: `Published ${validItems.length} item(s) & sent push notifications!`,
        });
      } else {
        setStatus({
          type: "success",
          message: `Saved ${validItems.length} item(s) silently (no push sent).`,
        });
      }
    } catch (err) {
      setStatus({ type: "error", message: "Error: " + err.message });
    }
    setSaving(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-600 font-medium">
        Loading workspace...
      </div>
    );
  }

  // LOGIN SCREEN
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm space-y-5">
          <div className="border-b pb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600">Inventory Portal</span>
            <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Numet Alloys</h1>
          </div>

          {loginError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
              {loginError}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Admin Email</label>
              <input
                type="email"
                placeholder="admin@numetalloys.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-slate-300 px-3 py-2.5 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full border border-slate-300 px-3 py-2.5 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition shadow-sm"
          >
            Sign In to Dashboard
          </button>
        </form>
      </div>
    );
  }

  // ADMIN STOCK DASHBOARD
  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 pb-12">
      {/* Top Navbar */}
      <header className="bg-slate-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap justify-between items-center gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">Numet Alloys — Ready Stock Manager</h1>
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium px-2 py-0.5 rounded-full">
                Live Sync
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Signed in as {user.email}
              {lastUpdated && ` • Last published: ${new Date(lastUpdated).toLocaleString()}`}
            </p>
          </div>
          <button
            onClick={() => signOut(auth)}
            className="text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-lg border border-slate-700 transition"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 mt-6 space-y-6">
        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">Total Listed Items</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{items.length}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase">In Stock (Ready)</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{inStockCount}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm col-span-2 sm:col-span-1">
            <p className="text-xs font-medium text-slate-500 uppercase">Out of Stock</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{items.length - inStockCount}</p>
          </div>
        </div>

        {/* Toolbar & Stock Table Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Controls Toolbar */}
          <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/60">
            {/* Search & Status Filter */}
            <div className="flex flex-col sm:flex-row gap-3 flex-1">
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search product, grade (e.g. 304), size..."
                  className="w-full bg-white border border-slate-300 rounded-lg pl-3.5 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 self-start">
                {[
                  { key: "all", label: "All" },
                  { key: "inStock", label: "In Stock" },
                  { key: "outOfStock", label: "Out of Stock" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setStockFilter(tab.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                      stockFilter === tab.key
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => setShowBulkModal(true)}
                className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-sm font-medium px-3.5 py-2 rounded-lg transition"
              >
                Bulk Paste (Excel)
              </button>
              <button
                onClick={addRow}
                className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition shadow-sm"
              >
                + Add Item
              </button>
            </div>
          </div>

          {/* Stock Table */}
          {loadingStock ? (
            <div className="p-10 text-center text-sm text-slate-500">Fetching current ready stock...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Product / Item Name</th>
                    <th className="py-3 px-4">Grade / Material</th>
                    <th className="py-3 px-4">Size / Specs</th>
                    <th className="py-3 px-4">Ready Qty</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-2.5 pl-4 min-w-[210px]">
                        <input
                          value={item.productName || ""}
                          onChange={(e) => updateRowById(item.id, "productName", e.target.value)}
                          placeholder="e.g. SS Seamless Pipe"
                          className="border border-slate-200 focus:border-blue-500 focus:outline-none rounded-md px-2.5 py-1.5 w-full bg-white"
                        />
                      </td>
                      <td className="p-2.5 min-w-[160px]">
                        <input
                          value={item.grade || ""}
                          onChange={(e) => updateRowById(item.id, "grade", e.target.value)}
                          placeholder="e.g. ASTM A312 TP304"
                          className="border border-slate-200 focus:border-blue-500 focus:outline-none rounded-md px-2.5 py-1.5 w-full bg-white"
                        />
                      </td>
                      <td className="p-2.5 min-w-[160px]">
                        <input
                          value={item.size || ""}
                          onChange={(e) => updateRowById(item.id, "size", e.target.value)}
                          placeholder="e.g. 2 Inch Sch 40"
                          className="border border-slate-200 focus:border-blue-500 focus:outline-none rounded-md px-2.5 py-1.5 w-full bg-white"
                        />
                      </td>
                      <td className="p-2.5 min-w-[130px]">
                        <input
                          value={item.quantity || ""}
                          onChange={(e) => updateRowById(item.id, "quantity", e.target.value)}
                          placeholder="e.g. 250 Mtrs"
                          className="border border-slate-200 focus:border-blue-500 focus:outline-none rounded-md px-2.5 py-1.5 w-full bg-white"
                        />
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => updateRowById(item.id, "inStock", !item.inStock)}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                            item.inStock
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                              : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                          }`}
                        >
                          {item.inStock ? "In Stock" : "Out of Stock"}
                        </button>
                      </td>
                      <td className="p-2.5 pr-4 text-right">
                        <button
                          type="button"
                          onClick={() => removeRowById(item.id)}
                          className="text-slate-400 hover:text-red-600 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan="6" className="py-12 px-4 text-center text-slate-400">
                        {items.length === 0
                          ? 'No stock items yet. Click "+ Add Item" or "Bulk Paste (Excel)" to get started.'
                          : "No items match your current search or filter."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Publish & Push Notification Panel */}
        <div className="bg-white p-5 sm:p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <label className="flex items-center gap-2.5 font-semibold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={sendPush}
                onChange={(e) => setSendPush(e.target.checked)}
                className="h-4 w-4 rounded accent-blue-600"
              />
              Send Push Notification to App Users upon Publishing
            </label>
            <span className="text-xs text-slate-500">
              Uncheck if fixing minor typos silently
            </span>
          </div>

          {sendPush && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Notification Title</label>
                <input
                  value={notifTitle}
                  onChange={(e) => setNotifTitle(e.target.value)}
                  placeholder="Notification Title"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Notification Message</label>
                <input
                  value={notifBody}
                  onChange={(e) => setNotifBody(e.target.value)}
                  placeholder="Notification Message"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <button
              onClick={handleSaveAndPublish}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition shadow-sm"
            >
              {saving ? "Publishing..." : "Save & Publish Stock"}
            </button>

            {status.message && (
              <span
                className={`text-sm font-medium px-3 py-1.5 rounded-lg ${
                  status.type === "error"
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : status.type === "info"
                    ? "bg-blue-50 text-blue-700 border border-blue-200"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                }`}
              >
                {status.message}
              </span>
            )}
          </div>
        </div>
      </main>

      {/* BULK PASTE MODAL */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Bulk Paste from Excel / Google Sheets</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Copy rows directly from Excel in column order:{" "}
                  <span className="font-semibold text-slate-700">
                    Product Name | Grade | Size | Quantity | Available (Yes/No)
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <textarea
              rows={7}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={`SS 304 Seamless Pipe\tASTM A312 TP304\t2 Inch Sch 40\t250 Mtrs\tYes\nSS 316L Round Bar\tASTM A276\t25mm Dia\t1200 Kgs\tYes`}
              className="w-full border border-slate-300 rounded-xl p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="bulkMode"
                    checked={bulkMode === "append"}
                    onChange={() => setBulkMode("append")}
                  />
                  Add to top of existing list
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-amber-700 font-medium">
                  <input
                    type="radio"
                    name="bulkMode"
                    checked={bulkMode === "replace"}
                    onChange={() => setBulkMode("replace")}
                  />
                  Replace entire list
                </label>
              </div>

              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkImport}
                  className="px-5 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Import Rows
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}