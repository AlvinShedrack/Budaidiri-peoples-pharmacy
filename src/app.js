const STORE = {
  users: "users",
  suppliers: "suppliers",
  medicines: "medicines",
  sales: "sales",
  purchases: "purchases",
  expenses: "expenses",
  auditLogs: "auditLogs"
};

const SESSION_KEY = "budadiri_pharm_session_user";
let currentUser = null;
let cart = [];
let purchaseLines = [];
let currentReceiptSale = null;
let editingSaleId = null;
let deferredInstallPrompt = null;

const BRAND = {
  name: "Budadiri People's Pharmacy",
  tagline: "Caring passionately for your health and drug needs",
  receiptTagline: "Thank you for choosing Budadiri People's Pharmacy.",
  logo: "./assets/budadiri-logo.png",
  address: "Located at: Wagagai Hotel, Budadiri Town Council",
  phone: "0704-180 237 / 0786-403 301",
  email: ""
};

const pageMeta = {
  dashboard: ["Dashboard", "Business overview and alerts"],
  inventory: ["Inventory", "Medicine catalog and pricing"],
  sales: ["Sales POS", "Sell medicine and print receipts"],
  purchases: ["Purchases", "Record stock-in and supplier purchases"],
  suppliers: ["Suppliers", "Supplier contacts and purchase source records"],
  reports: ["Reports", "Sales, profit, low stock, expiry, and stock value"],
  users: ["Users", "Manage local app users and roles"],
  backup: ["Backup", "Export and import offline data"]
};

function $(id) {
  return document.getElementById(id);
}

function formatMoney(amount) {
  return "USh " + Number(amount || 0).toLocaleString("en-UG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function sanitizeSignedDecimal(rawValue) {
  let cleaned = String(rawValue ?? "").replace(/[^0-9.-]/g, "");
  const isNegative = cleaned.startsWith("-");
  cleaned = cleaned.replace(/-/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    cleaned = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  return (isNegative ? "-" : "") + cleaned;
}

function parseSignedNumber(rawValue) {
  const cleaned = sanitizeSignedDecimal(rawValue);
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    return NaN;
  }
  return Number(cleaned);
}

function formatDateDisplay(dateString) {
  if (!dateString) return "";
  const raw = String(dateString).trim();

  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) return raw;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [yyyy, mm, dd] = raw.split("-");
    return `${dd}-${mm}-${yyyy}`;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  return raw;
}

function normalizeDateInput(value) {
  if (!value) return "";

  let input = String(value).trim().replaceAll("/", "-");

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [yyyy, mm, dd] = input.split("-");
    return `${dd}-${mm}-${yyyy}`;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(input)) {
    return input;
  }

  const digits = input.replace(/\D/g, "");
  if (digits.length === 8) {
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    return `${dd}-${mm}-${yyyy}`;
  }

  return input;
}

function toIsoDate(dateString) {
  if (!dateString) return "";

  const value = String(dateString).trim().replaceAll("/", "-");

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
    const [dd, mm, yyyy] = value.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

function attachDateMask(id) {
  const input = $(id);
  if (!input) return;

  input.addEventListener("input", event => {
    let value = event.target.value.replace(/\D/g, "").slice(0, 8);

    if (value.length > 4) {
      value = `${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4)}`;
    } else if (value.length > 2) {
      value = `${value.slice(0, 2)}-${value.slice(2)}`;
    }

    event.target.value = value;
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isSameDay(isoDate, dateString) {
  const left = String(isoDate || "").slice(0, 10);
  const right = toIsoDate(dateString) || String(dateString || "").slice(0, 10);

  return left === right;
}

function daysUntil(dateString) {
  if (!dateString) return 999999;

  const isoDate = toIsoDate(dateString);

  if (!isoDate) {
    return 999999;
  }

  const today = new Date(`${todayISO()}T00:00:00`);
  const target = new Date(`${isoDate}T00:00:00`);

  if (Number.isNaN(target.getTime())) {
    return 999999;
  }

  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function simpleHash(text) {
  let hash = 0;
  const input = String(text || "");
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return `h_${Math.abs(hash)}`;
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function requireRole(roles) {
  return currentUser && roles.includes(currentUser.role);
}

function isDispenser() {
  return currentUser?.role === "Dispenser";
}

function isAdministrator() {
  return currentUser?.role === "Administrator";
}

function isDirector() {
  return currentUser?.role === "Director";
}

function supplierName(suppliers, id) {
  const supplier = suppliers.find(item => Number(item.id) === Number(id));
  return supplier ? supplier.name : "Not set";
}

function getMedicineBatches(med) {
  if (Array.isArray(med.batches) && med.batches.length) {
    return med.batches;
  }
  const qty = Number(med.quantity || 0);
  if (qty !== 0 || med.batchNo || med.expiryDate || med.buyingPrice) {
    return [{
      batchId: `legacy-${med.id}`,
      batchNo: med.batchNo || "DEFAULT",
      expiryDate: med.expiryDate || "",
      quantity: qty,
      unitCost: Number(med.buyingPrice || 0),
      createdAt: med.createdAt || new Date().toISOString()
    }];
  }
  return [];
}

function recalculateMedicineFromBatches(med) {
  const batches = Array.isArray(med.batches) ? med.batches : [];
  const totalQty = batches.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
  med.quantity = totalQty;

  const activeBatch = batches.find(b => Number(b.quantity || 0) !== 0) || batches.at(-1);
  if (activeBatch) {
    med.batchNo = activeBatch.batchNo || "";
    med.expiryDate = activeBatch.expiryDate || "";
    med.buyingPrice = Number(activeBatch.unitCost ?? med.buyingPrice ?? 0);
  }
}

async function seedInitialData() {
  const users = await getAll(STORE.users);
  if (!users.length) {
    await addRecord(STORE.users, {
      name: "System Administrator",
      email: "patienceannamuduwa@gmail.com",
      passwordHash: simpleHash("Patience@budadiri"),
      role: "Administrator",
      isActive: true,
      createdAt: new Date().toISOString()
    });

    await addRecord(STORE.users, {
      name: "Main Dispenser",
      email: "justus@peoplespharmacy.com",
      passwordHash: simpleHash("Justus@2024"),
      role: "Dispenser",
      isActive: true,
      createdAt: new Date().toISOString()
    });

    await addRecord(STORE.users, {
      name: "Director",
      email: "nangoliumar6@gmail.com",
      passwordHash: simpleHash("Honourable"),
      role: "Director",
      isActive: true,
      createdAt: new Date().toISOString()
    });
  }

  const suppliers = await getAll(STORE.suppliers);
  if (!suppliers.length) {
    await addRecord(STORE.suppliers, {
      name: "Default Supplier",
      phone: "",
      email: "",
      address: "",
      createdAt: new Date().toISOString()
    });
  }
}

async function writeAudit(action, details = {}) {
  if (!currentUser) return;
  await addRecord(STORE.auditLogs, {
    action,
    details,
    userId: currentUser.id,
    userName: currentUser.name,
    createdAt: new Date().toISOString()
  });
}

async function login(email, password) {
  const users = await getAll(STORE.users);
  const user = users.find(item => item.email.toLowerCase() === email.toLowerCase());

  if (!user || !user.isActive || user.passwordHash !== simpleHash(password)) {
    throw new Error("Invalid email or password.");
  }

  currentUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  await writeAudit("login", { email: user.email });
  showApp();
}

function logout() {
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);

  document.body.classList.remove("is-authenticated");

  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
}

function showApp() {
  document.body.classList.add("is-authenticated");

  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("currentUserText").innerHTML = `<strong>${escapeHtml(currentUser.name)}</strong><br>${escapeHtml(currentUser.role)}`;
  applyRoleAccess();
  showPage("dashboard");
  refreshAll();

  if (typeof startAutoSync === "function") {
    startAutoSync();
  }
}

function applyRoleAccess() {
  const manager = ["Administrator", "Director"].includes(currentUser?.role);
  const directorOnly = currentUser?.role === "Director";

  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !manager);
  });

  document.querySelectorAll(".director-only").forEach(el => {
    el.classList.toggle("hidden", !directorOnly);
  });

  document.querySelectorAll(".pharmacist-admin-only").forEach(el => {
    el.classList.toggle("hidden", !manager);
  });

  const saleType = $("saleType");
  if (saleType) {
    saleType.disabled = false;
    Array.from(saleType.options).forEach(option => {
      option.hidden = false;
    });
  }

  const usersNav = document.querySelector('.nav-link[data-page="users"]');
  if (usersNav) {
    usersNav.classList.toggle("hidden", !manager);
  }
}

function showPage(pageId) {
  if (pageId === "users" && !requireRole(["Administrator", "Director"])) {
    showToast("Only Administrator or Director can open Users.");
    return;
  }

  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(link => link.classList.remove("active"));

  $(pageId)?.classList.add("active");
  const activeNavLink = document.querySelector(`.nav-link[data-page="${pageId}"]`);
  activeNavLink?.classList.add("active");

  if (window.innerWidth <= 768 && activeNavLink) {
    activeNavLink.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest"
    });
  }

  const [title, subtitle] = pageMeta[pageId] || ["My Rx", ""];
  $("pageTitle").textContent = title;
  $("pageSubtitle").textContent = subtitle;

  if (pageId === "reports") renderReports();
  if (pageId === "sales") renderSalesHistory();
  if (pageId === "purchases") renderPurchasesHistory();
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;

  window.__lastModalTrigger = document.activeElement;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  window.requestAnimationFrame(() => {
    const firstField = modal.querySelector(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
    );
    firstField?.focus();
  });
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");

  if (!document.querySelector(".modal:not(.hidden)")) {
    document.body.classList.remove("modal-open");
  }

  if (window.__lastModalTrigger && typeof window.__lastModalTrigger.focus === "function") {
    window.__lastModalTrigger.focus();
  }
}

async function renderDashboard() {
  const medicines = await getAll(STORE.medicines);
  const sales = await getAll(STORE.sales);
  const today = todayISO();
  const todaySales = sales.filter(sale => isSameDay(sale.createdAt, today));
  const lowStock = medicines.filter(med => Number(med.quantity || 0) <= Number(med.reorderLevel || 5));
  const expiring = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) >= 0 && daysUntil(med.expiryDate) <= 90);
  const expired = medicines.filter(med => med.expiryDate && daysUntil(med.expiryDate) < 0);

  const todaySalesTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const todayProfitTotal = todaySales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
  const stockValue = medicines.reduce((sum, med) => {
    const batches = getMedicineBatches(med);
    if (batches.length) {
      return sum + batches.reduce((bSum, b) => bSum + (Number(b.quantity || 0) * Number(b.unitCost || 0)), 0);
    }
    return sum + (Number(med.quantity || 0) * Number(med.buyingPrice || 0));
  }, 0);

  $("dashTotalMedicines").textContent = medicines.length;
  $("dashLowStock").textContent = lowStock.length;
  $("dashExpiring").textContent = expiring.length;
  $("dashTodaySales").textContent = formatMoney(todaySalesTotal);
  $("dashTodayProfit").textContent = formatMoney(todayProfitTotal);
  $("dashStockValue").textContent = formatMoney(stockValue);

  const recent = sales.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  $("recentSalesTable").innerHTML = recent.length ? recent.map(sale => `
    <tr>
      <td>${escapeHtml(sale.receiptNo)}</td>
      <td>${escapeHtml(sale.customerName || "Walk-in")}</td>
      <td>${formatMoney(sale.total)}</td>
      <td>${new Date(sale.createdAt).toLocaleString()}</td>
    </tr>
  `).join("") : `<tr><td colspan="4">No sales yet.</td></tr>`;

  const alerts = [
    ...expired.slice(0, 5).map(med => ({
      type: "danger",
      title: `${med.name} expired`,
      detail: med.batchNo ? `Batch ${med.batchNo} expired on ${med.expiryDate}` : `Expired on ${med.expiryDate}`
    })),
    ...expiring.slice(0, 5).map(med => ({
      type: "warning",
      title: `${med.name} expiring soon`,
      detail: med.batchNo ? `Batch ${med.batchNo} expires on ${med.expiryDate}` : `Expires on ${med.expiryDate}`
    })),
    ...lowStock.slice(0, 5).map(med => ({
      type: "info",
      title: `${med.name} low stock`,
      detail: `${Number(med.quantity || 0)} left. Reorder level is ${med.reorderLevel || 5}.`
    }))
  ];

  $("alertsList").innerHTML = alerts.length ? alerts.slice(0, 8).map(alert => `
    <div class="alert-item">
      <div><strong>${escapeHtml(alert.title)}</strong><br><span class="muted">${escapeHtml(alert.detail)}</span></div>
      <span class="badge ${alert.type}">${alert.type}</span>
    </div>
  `).join("") : `<div class="warning-box">No priority alerts.</div>`;
}

async function renderSalesHistory() {
  const sales = await getAll(STORE.sales);
  const history = [...sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  $("salesHistoryTable").innerHTML = history.length
    ? history.map(sale => {
      const createdAt = sale.createdAt ? new Date(sale.createdAt).toLocaleString() : "";
      const customerName = escapeHtml(sale.customerName || "Walk-in customer");
      const paymentMethod = escapeHtml(sale.paymentMethod || "Cash");
      const saleType = escapeHtml(sale.saleType || "retail");
      const total = Number(sale.total || 0);
      const amountPaid = Number(sale.amountPaid || 0);
      const changeGiven = Number(sale.changeGiven || Math.max(0, amountPaid - total));
      const linesCount = Array.isArray(sale.lines) ? sale.lines.length : 0;

      return `
        <tr data-id="${sale.id}">
          <td>${escapeHtml(sale.receiptNo || String(sale.id))}</td>
          <td>${customerName}<br><span class="muted">${linesCount} item(s)</span></td>
          <td>${paymentMethod}</td>
          <td>${saleType}</td>
          <td>${formatMoney(total)}</td>
          <td>${formatMoney(amountPaid)}</td>
          <td>${formatMoney(changeGiven)}</td>
          <td>${createdAt}</td>
          <td class="actions-cell">
            <button class="table-btn" data-action="view-receipt" data-id="${sale.id}">Receipt / Reprint</button>
            <button class="table-btn secondary" data-action="edit-sale" data-id="${sale.id}">Edit Items</button>
            <button class="table-btn danger" data-action="delete-sale" data-id="${sale.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="9">No sales recorded yet.</td></tr>`;
}

async function openSaleReceiptById(saleId) {
  const sale = await getById(STORE.sales, saleId);
  if (!sale) return showToast("Sale receipt not found.");
  showReceipt(sale);
}

function recalcEditSaleModalTotals() {
  const rows = document.querySelectorAll("#editSaleLinesTable tr");
  let subtotal = 0;
  let totalDiscount = 0;

  rows.forEach(row => {
    const qty = Math.max(0, Number(row.querySelector('[name="saleLineQty"]')?.value || 0));
    const unitPrice = Math.max(0, Number(row.querySelector('[name="saleLinePrice"]')?.value || 0));
    const lineDiscount = Math.max(0, Number(row.querySelector('[name="saleLineDiscount"]')?.value || 0));
    const lineTotal = Math.max(0, (qty * unitPrice) - lineDiscount);

    subtotal += qty * unitPrice;
    total
