console.log("BUDADIRI SYNC.JS LOADED OK - MANUAL SYNC ONLY");

const BUDADIRI_SUPABASE_URL = "https://dvbbtublihsnmxapdycg.supabase.co";
const BUDADIRI_SUPABASE_PUBLIC_KEY = "sb_publishable_5gqvI9z-WFtiXOMo7GSOPw_AqlBLuDs";

if (!window.supabase) {
  alert("Supabase library is not loaded. Check script order and internet connection.");
  throw new Error("Supabase library is not loaded.");
}

const BUDADIRI_SYNC_TABLE = "budadiri_records";

const BUDADIRI_SYNC_STORES = [
  "users",
  "suppliers",
  "medicines",
  "sales",
  "purchases",
  "expenses",
  "auditLogs"
];

const BUDADIRI_DEVICE_ID_KEY = "budadiri_device_id";
const BUDADIRI_LAST_SYNC_KEY = "budadiri_last_supabase_sync_at";
const BUDADIRI_LOCAL_CHANGES_KEY = "budadiri_manual_has_changes_v1";
const BUDADIRI_DIRTY_RECORDS_KEY = "budadiri_manual_dirty_records_v1";
const BUDADIRI_PENDING_DELETES_KEY = "budadiri_manual_pending_deletes_v1";

window.__budadiriSyncBusy = false;
window.__budadiriAutoSyncReady = false;
window.__budadiriApplyingRemote = false;
window.__budadiriSuppressWriteTracking = false;

function getBudadiriCloud() {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase library is not loaded correctly.");
  }

  if (!window.cloudClient || typeof window.cloudClient.from !== "function") {
    window.cloudClient = window.supabase.createClient(
      BUDADIRI_SUPABASE_URL,
      BUDADIRI_SUPABASE_PUBLIC_KEY
    );
  }

  return window.cloudClient;
}

function getBudadiriDeviceId() {
  let deviceId = localStorage.getItem(BUDADIRI_DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = crypto.randomUUID
      ? crypto.randomUUID()
      : "device_" + Date.now() + "_" + Math.random().toString(16).slice(2);

    localStorage.setItem(BUDADIRI_DEVICE_ID_KEY, deviceId);
  }

  return deviceId;
}

const budadiriDeviceId = getBudadiriDeviceId();

function markLocalChanges() {
  localStorage.setItem(BUDADIRI_LOCAL_CHANGES_KEY, "true");
}

function clearLocalChanges() {
  localStorage.removeItem(BUDADIRI_LOCAL_CHANGES_KEY);
}

function hasLocalChanges() {
  return localStorage.getItem(BUDADIRI_LOCAL_CHANGES_KEY) === "true";
}

function getJsonArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveJsonArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value || []));
}

function getJsonObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}

function saveJsonObject(key, value) {
  localStorage.setItem(key, JSON.stringify(value || {}));
}

function getDirtyMap() {
  return getJsonObject(BUDADIRI_DIRTY_RECORDS_KEY);
}

function saveDirtyMap(map) {
  saveJsonObject(BUDADIRI_DIRTY_RECORDS_KEY, map);
}

function clearDirtyMap() {
  localStorage.removeItem(BUDADIRI_DIRTY_RECORDS_KEY);
}

function getPendingDeletes() {
  return getJsonArray(BUDADIRI_PENDING_DELETES_KEY);
}

function savePendingDeletes(items) {
  saveJsonArray(BUDADIRI_PENDING_DELETES_KEY, items);
}

function clearPendingDeletes() {
  localStorage.removeItem(BUDADIRI_PENDING_DELETES_KEY);
}

function setSyncButtonState(isSyncing, text) {
  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.disabled = false;
    button.style.pointerEvents = "auto";
    button.style.cursor = "pointer";
    button.title = text;

    if (button.classList.contains("floating-sync-btn")) {
      button.textContent = isSyncing ? "…" : "↻sync";
    } else {
      button.textContent = isSyncing ? "Syncing..." : text;
    }
  });

  const syncStatusText = document.getElementById("syncStatusText");

  if (syncStatusText) {
    syncStatusText.textContent = text;
  }

  console.log("SYNC STATUS:", text);
}

function showSyncMessage(message) {
  console.log("SYNC:", message);

  if (typeof showToast === "function") {
    showToast(message);
  }
}

function showRealError(stage, error) {
  console.error(stage, error);

  alert(
    "STEP FAILED: " + stage + "\n\n" +
    "Message:\n" + (error?.message || "No message") + "\n\n" +
    "Code:\n" + (error?.code || "No code") + "\n\n" +
    "Details:\n" + (error?.details || "No details") + "\n\n" +
    "Hint:\n" + (error?.hint || "No hint")
  );
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getMedicineIdentityKey(record) {
  const name = normalizeText(record?.name);
  const generic = normalizeText(record?.genericName);
  const category = normalizeText(record?.category);
  if (!name && !generic && !category) return null;
  return `medicines:norm:${name}|${generic}|${category}`;
}

function isDeletedRecord(record) {
  return record?._deleted === true || String(record?._deleted).toLowerCase() === "true";
}

function parseTimestamp(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getRecordTime(record) {
  const updated = parseTimestamp(record?.updatedAt);
  const created = parseTimestamp(record?.createdAt);
  return Math.max(updated, created);
}

function getRecordIdentityKey(storeName, record) {
  if (!record) return null;

  if (storeName === "users") {
    const email = normalizeText(record.email);
    if (email) return "users:email:" + email;
  }

  if (storeName === "suppliers") {
    const supplierName = normalizeText(
      record.supplierName ||
      record.companyName ||
      record.name
    );

    if (supplierName) return "suppliers:name:" + supplierName;
  }

  if (storeName === "medicines") {
    const medKey = getMedicineIdentityKey(record);
    if (medKey) return medKey;
  }

  if (record.id !== undefined && record.id !== null) {
    return storeName + ":id:" + String(record.id);
  }

  return null;
}

function getBatchKey(batch, index = 0) {
  if (batch?.batchId) {
    return "batchId:" + normalizeText(batch.batchId);
  }
  const batchNo = normalizeText(batch?.batchNo);
  const expiry = String(batch?.expiryDate || "").trim();
  const cost = Number(batch?.unitCost ?? 0);
  if (batchNo || expiry) {
    return `batchMeta:${batchNo}|${expiry}|${cost}`;
  }
  return `batchIdx:${index}`;
}

function mergeBatches(localMed, remoteMed) {
  const localBatches = typeof getMedicineBatches === "function"
    ? getMedicineBatches(localMed)
    : (Array.isArray(localMed?.batches) ? localMed.batches : []);

  const remoteBatches = typeof getMedicineBatches === "function"
    ? getMedicineBatches(remoteMed)
    : (Array.isArray(remoteMed?.batches) ? remoteMed.batches : []);

  const batchMap = new Map();

  localBatches.forEach((b, idx) => {
    batchMap.set(getBatchKey(b, idx), { ...b });
  });

  remoteBatches.forEach((rb, idx) => {
    const key = getBatchKey(rb, idx);
    const existing = batchMap.get(key);

    if (!existing) {
      batchMap.set(key, { ...rb });
      return;
    }

    const existingTs = getRecordTime(existing);
    const remoteTs = getRecordTime(rb);

    if (remoteTs > existingTs) {
      batchMap.set(key, {
        ...existing,
        ...rb,
        quantity: rb.quantity !== undefined ? Number(rb.quantity) : Number(existing.quantity || 0)
      });
    } else if (remoteTs === existingTs) {
      batchMap.set(key, {
        ...rb,
        ...existing,
        quantity: Math.max(Number(existing.quantity || 0), Number(rb.quantity || 0))
      });
    } else {
      batchMap.set(key, {
        ...rb,
        ...existing
      });
    }
  });

  return Array.from(batchMap.values());
}

function mergeMedicineRecords(existing, incoming) {
  if (!existing) return { ...incoming };
  if (!incoming) return { ...existing };

  const existingTime = getRecordTime(existing);
  const incomingTime = getRecordTime(incoming);

  // Incoming is strictly newer -> incoming wins scalar fields; otherwise existing wins
  const newer = incomingTime > existingTime ? incoming : existing;
  const older = incomingTime > existingTime ? existing : incoming;

  const mergedBatches = mergeBatches(existing, incoming);

  const merged = {
    ...older,
    ...newer,
    id: existing.id ?? incoming.id,
    name: newer.name || older.name,
    genericName: newer.genericName || older.genericName || "",
    category: newer.category || older.category || "",
    buyingPrice: Number(newer.buyingPrice ?? older.buyingPrice ?? 0),
    sellingPrice: Number(newer.sellingPrice ?? older.sellingPrice ?? 0),
    wholesalePrice: Number(newer.wholesalePrice ?? older.wholesalePrice ?? 0),
    reorderLevel: Number(newer.reorderLevel ?? older.reorderLevel ?? 5),
    notes: newer.notes !== undefined && newer.notes !== "" ? newer.notes : (older.notes || ""),
    batches: mergedBatches,
    createdAt: existing.createdAt || incoming.createdAt || new Date().toISOString(),
    updatedAt: new Date(Math.max(existingTime, incomingTime)).toISOString()
  };

  if (mergedBatches.length > 0 && typeof recalculateMedicineFromBatches === "function") {
    recalculateMedicineFromBatches(merged);
  } else {
    merged.quantity = Number(newer.quantity ?? older.quantity ?? 0);
  }

  return merged;
}

function markDirtyRecord(storeName, record, deleted = false) {
  if (window.__budadiriApplyingRemote || window.__budadiriSuppressWriteTracking) return;
  if (!storeName || !record) return;
  if (record.id === undefined || record.id === null || record.id === "") return;

  const now = new Date().toISOString();

  const cleanRecord = {
    ...record,
    _deleted: deleted ? true : record._deleted,
    deletedAt: deleted ? (record.deletedAt || now) : record.deletedAt,
    updatedAt: record.updatedAt || now
  };

  const dirtyMap = getDirtyMap();
  const key = `${storeName}:${String(cleanRecord.id)}`;

  dirtyMap[key] = {
    storeName,
    id: cleanRecord.id,
    deleted,
    record: cleanRecord
  };

  saveDirtyMap(dirtyMap);
  markLocalChanges();
}

function addPendingDelete(storeName, id, record = {}) {
  const now = new Date().toISOString();
  const items = getPendingDeletes();
  const key = `${storeName}:${String(id)}`;

  const filtered = items.filter(item => {
    return `${item.storeName}:${String(item.id)}` !== key;
  });

  filtered.push({
    storeName,
    id,
    record: {
      ...record,
      id,
      _deleted: true,
      deletedAt: record.deletedAt || now,
      updatedAt: now
    }
  });

  savePendingDeletes(filtered);
  markLocalChanges();
}

function normalizeRecordForCloud(record) {
  const now = new Date().toISOString();

  return {
    ...record,
    updatedAt: record.updatedAt || record.createdAt || now
  };
}

function prepareRecordForCloud(storeName, record) {
  const cleanRecord = normalizeRecordForCloud(record);

  return {
    store_name: storeName,
    local_id: String(cleanRecord.id),
    device_id: budadiriDeviceId,
    data: cleanRecord,
    updated_at: cleanRecord.updatedAt,
    synced_at: new Date().toISOString()
  };
}

function recordFromCloud(row) {
  const cloudRecord = row.data || {};
  const fallbackTs = parseTimestamp(cloudRecord.updatedAt)
    || parseTimestamp(cloudRecord.createdAt)
    || parseTimestamp(row.updated_at)
    || parseTimestamp(row.synced_at)
    || 0;

  return {
    ...cloudRecord,
    id: cloudRecord.id ?? Number(row.local_id),
    updatedAt: cloudRecord.updatedAt || row.updated_at || (fallbackTs ? new Date(fallbackTs).toISOString() : undefined)
  };
}

function mergeRecords(storeName, records) {
  const merged = new Map();

  records.forEach(record => {
    if (!record) return;

    const key = getRecordIdentityKey(storeName, record);
    if (!key) return;

    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...record });
      return;
    }

    if (storeName === "medicines") {
      merged.set(key, mergeMedicineRecords(existing, record));
      return;
    }

    if (getRecordTime(record) >= getRecordTime(existing)) {
      merged.set(key, { ...existing, ...record });
    }
  });

  return Array.from(merged.values());
}

async function uploadRecordToCloud(storeName, record) {
  const cloudRecord = prepareRecordForCloud(storeName, record);

  const { error } = await getBudadiriCloud().rpc(
    "sync_budadiri_record_replace",
    {
      p_store_name: cloudRecord.store_name,
      p_local_id: cloudRecord.local_id,
      p_device_id: cloudRecord.device_id,
      p_data: cloudRecord.data,
      p_updated_at: cloudRecord.updated_at || new Date().toISOString()
    }
  );

  if (error) throw error;
}

async function getCloudRows() {
  const { data, error } = await getBudadiriCloud()
    .from(BUDADIRI_SYNC_TABLE)
    .select("*")
    .in("store_name", BUDADIRI_SYNC_STORES)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return data || [];
}

/**
 * Non-destructive merge into IndexedDB store.
 * Never clears the entire store; preserves local records and only applies
 * remote updates when newer or inserts missing records.
 */
async function mergeStoreRecords(storeName, cloudRecords) {
  window.__budadiriApplyingRemote = true;

  try {
    const localRecords = await getAll(storeName);
    const localByKey = new Map();
    const localById = new Map();

    for (const loc of localRecords) {
      if (loc.id !== undefined && loc.id !== null) {
        localById.set(String(loc.id), loc);
      }
      const key = getRecordIdentityKey(storeName, loc);
      if (key) {
        const prev = localByKey.get(key);
        localByKey.set(
          key,
          prev && storeName === "medicines"
            ? mergeMedicineRecords(prev, loc)
            : loc
        );
      }
    }

    const mergedCloud = mergeRecords(storeName, cloudRecords || []);
    let activeCount = 0;

    for (const remote of mergedCloud) {
      const key = getRecordIdentityKey(storeName, remote);
      const localMatch =
        (key ? localByKey.get(key) : null) ||
        (remote.id !== undefined && remote.id !== null ? localById.get(String(remote.id)) : null);

      if (isDeletedRecord(remote)) {
        if (localMatch && getRecordTime(remote) > getRecordTime(localMatch) && localMatch.id !== undefined) {
          await deleteRecord(storeName, localMatch.id);
          if (key) localByKey.delete(key);
          if (localMatch.id !== undefined) localById.delete(String(localMatch.id));
        }
        continue;
      }

      activeCount += 1;

      if (localMatch) {
        if (storeName === "medicines") {
          const mergedMed = mergeMedicineRecords(localMatch, remote);
          await putRecord(storeName, mergedMed);
          if (key) localByKey.set(key, mergedMed);
          if (mergedMed.id !== undefined) localById.set(String(mergedMed.id), mergedMed);
        } else if (getRecordTime(remote) >= getRecordTime(localMatch)) {
          const updated = { ...localMatch, ...remote, id: localMatch.id };
          await putRecord(storeName, updated);
          if (key) localByKey.set(key, updated);
          if (updated.id !== undefined) localById.set(String(updated.id), updated);
        }
      } else {
        const copy = { ...remote };
        delete copy.id;
        if (storeName === "medicines" && Array.isArray(copy.batches) && copy.batches.length > 0 && typeof recalculateMedicineFromBatches === "function") {
          recalculateMedicineFromBatches(copy);
        }
        const newId = await addRecord(storeName, copy);
        const saved = { ...copy, id: newId };
        if (key) localByKey.set(key, saved);
        localById.set(String(newId), saved);
      }
    }

    return activeCount;
  } finally {
    window.__budadiriApplyingRemote = false;
  }
}

function patchLocalWriteTracking() {
  if (window.__budadiriWriteTrackingPatched) return;

  if (
    typeof window.addRecord !== "function" ||
    typeof window.putRecord !== "function" ||
    typeof window.deleteRecord !== "function"
  ) {
    console.warn("Write tracking not ready yet.");
    return;
  }

  const originalAddRecord = window.addRecord;
  const originalPutRecord = window.putRecord;
  const originalDeleteRecord = window.deleteRecord;

  window.addRecord = async function patchedAddRecord(storeName, record) {
    if (!window.__budadiriApplyingRemote && !window.__budadiriSuppressWriteTracking) {
      record.updatedAt = new Date().toISOString();
    }

    const newId = await originalAddRecord.call(this, storeName, record);

    if (!window.__budadiriApplyingRemote && !window.__budadiriSuppressWriteTracking) {
      markDirtyRecord(storeName, { ...(record || {}), id: newId }, false);
    }

    return newId;
  };

  // Preserve existing updatedAt unless missing/invalid so stale devices do not
  // artificially advance timestamps over newer changes from other devices.
  window.putRecord = async function patchedPutRecord(storeName, record) {
    if (
      !window.__budadiriApplyingRemote &&
      !window.__budadiriSuppressWriteTracking &&
      (!record.updatedAt || Number.isNaN(new Date(record.updatedAt).getTime()))
    ) {
      record.updatedAt = new Date().toISOString();
    }

    const result = await originalPutRecord.call(this, storeName, record);

    if (!window.__budadiriApplyingRemote && !window.__budadiriSuppressWriteTracking) {
      markDirtyRecord(storeName, record, isDeletedRecord(record));
    }

    return result;
  };

  window.deleteRecord = async function patchedDeleteRecord(storeName, id) {
    let existingRecord = null;

    if (!window.__budadiriApplyingRemote && !window.__budadiriSuppressWriteTracking) {
      try {
        const records = await getAll(storeName);
        existingRecord = records.find(record => String(record.id) === String(id)) || null;
      } catch (error) {
        existingRecord = null;
      }
    }

    const result = await originalDeleteRecord.call(this, storeName, id);

    if (!window.__budadiriApplyingRemote && !window.__budadiriSuppressWriteTracking) {
      addPendingDelete(storeName, id, existingRecord || {});
    }

    return result;
  };

  window.__budadiriWriteTrackingPatched = true;
}

async function syncRecordsToSupabase(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");

    if (!silent) {
      alert("You are offline. Connect to internet first.");
    }

    return 0;
  }

  try {
    await dbReady;
    patchLocalWriteTracking();

    const dirtyMap = getDirtyMap();
    const dirtyEntries = Object.values(dirtyMap);
    const pendingDeletes = getPendingDeletes();

    if (!dirtyEntries.length && !pendingDeletes.length && !hasLocalChanges()) {
      setSyncButtonState(false, "No local changes");
      return 0;
    }

    setSyncButtonState(true, "Uploading to Supabase...");

    let uploadedCount = 0;
    const uploadedKeys = new Set();

    for (const entry of dirtyEntries) {
      if (!entry || !entry.storeName) continue;

      const uploadKey = `${entry.storeName}:${String(entry.id)}`;
      uploadedKeys.add(uploadKey);

      let record = entry.record || {};

      if (!entry.deleted) {
        try {
          const allRecords = await getAll(entry.storeName);
          const latest = allRecords.find(item => String(item.id) === String(entry.id));
          if (latest) record = latest;
        } catch (error) {}
      }

      await uploadRecordToCloud(entry.storeName, record);
      uploadedCount += 1;
    }

    for (const item of pendingDeletes) {
      if (!item || !item.storeName) continue;

      const uploadKey = `${item.storeName}:${String(item.id)}`;

      if (uploadedKeys.has(uploadKey)) continue;

      const deletedRecord = {
        ...(item.record || {}),
        id: item.id,
        _deleted: true,
        deletedAt: item.record?.deletedAt || new Date().toISOString(),
        updatedAt: item.record?.updatedAt || new Date().toISOString()
      };

      await uploadRecordToCloud(item.storeName, deletedRecord);
      uploadedCount += 1;
    }

    clearDirtyMap();
    clearPendingDeletes();
    clearLocalChanges();

    localStorage.setItem(BUDADIRI_LAST_SYNC_KEY, new Date().toISOString());

    return uploadedCount;
  } catch (error) {
    setSyncButtonState(false, "Upload failed");

    if (!silent) {
      showRealError("UPLOAD TO SUPABASE", error);
    } else {
      console.error("UPLOAD TO SUPABASE", error);
    }

    throw error;
  }
}

async function freshDownloadFromCloud(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");

    if (!silent) {
      alert("You are offline. Connect to internet first.");
    }

    return 0;
  }

  try {
    await dbReady;
    patchLocalWriteTracking();

    setSyncButtonState(true, "Downloading and merging data...");

    const rows = await getCloudRows();
    const groupedRecords = {};

    BUDADIRI_SYNC_STORES.forEach(storeName => {
      groupedRecords[storeName] = [];
    });

    rows.forEach(row => {
      if (!groupedRecords[row.store_name]) return;

      groupedRecords[row.store_name].push(recordFromCloud(row));
    });

    let downloadedCount = 0;

    for (const storeName of BUDADIRI_SYNC_STORES) {
      downloadedCount += await mergeStoreRecords(storeName, groupedRecords[storeName] || []);
    }

    localStorage.setItem(BUDADIRI_LAST_SYNC_KEY, new Date().toISOString());

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    return downloadedCount;
  } catch (error) {
    setSyncButtonState(false, "Download failed");

    if (!silent) {
      showRealError("DOWNLOAD FROM SUPABASE", error);
    } else {
      console.error("DOWNLOAD FROM SUPABASE", error);
    }

    throw error;
  }
}

async function pullRecordsFromSupabase(options = {}) {
  return freshDownloadFromCloud(options);
}

/**
 * Safe cleanup after sync: preserves device ID and last sync timestamp
 * while clearing cookies/caches/session state if needed.
 */
async function clearLoginCookiesAndCacheAfterSync() {
  const savedDeviceId = localStorage.getItem(BUDADIRI_DEVICE_ID_KEY);
  const savedLastSync = localStorage.getItem(BUDADIRI_LAST_SYNC_KEY);

  document.cookie.split(";").forEach(cookie => {
    const name = cookie.split("=")[0].trim();

    if (!name) return;

    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  if ("caches" in window) {
    const cacheNames = await caches.keys();

    for (const cacheName of cacheNames) {
      await caches.delete(cacheName);
    }
  }

  localStorage.clear();
  sessionStorage.clear();

  if (savedDeviceId) localStorage.setItem(BUDADIRI_DEVICE_ID_KEY, savedDeviceId);
  if (savedLastSync) localStorage.setItem(BUDADIRI_LAST_SYNC_KEY, savedLastSync);
}

async function syncNow(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline");

    if (!silent) {
      alert("You are offline. Connect to internet first.");
    }

    return;
  }

  if (window.__budadiriSyncBusy) {
    if (!silent) {
      alert("Sync is already running. Please wait.");
    }

    return;
  }

  let uploaded = 0;
  let downloaded = 0;

  try {
    window.__budadiriSyncBusy = true;

    await dbReady;
    patchLocalWriteTracking();

    setSyncButtonState(true, "Uploading to Supabase...");
    uploaded = await syncRecordsToSupabase({ silent });

    setSyncButtonState(true, "Downloading and merging data...");
    downloaded = await freshDownloadFromCloud({ silent: true });

    setSyncButtonState(true, "Clearing login/cache...");
    await clearLoginCookiesAndCacheAfterSync();

    setSyncButtonState(false, "Synced");

    if (!silent) {
      alert(
        `Sync complete.\n\nThe app will reload. Log in again.`
      );
    }

    window.location.reload();
  } catch (error) {
    console.error("SYNC STOPPED:", error);

    setSyncButtonState(false, "Retry");

    if (!silent) {
      alert("Sync stopped.\n\nMessage: " + (error?.message || "Unknown sync error"));
    }
  } finally {
    window.__budadiriSyncBusy = false;
  }
}

/**
 * Restore missing/deduplicated medicines from a backup JSON object AFTER
 * merge logic is in place.
 */
async function restoreMissingMedicinesFromBackup(backupPayload) {
  await dbReady;
  const meds = backupPayload?.data?.medicines || backupPayload?.medicines || [];
  if (!Array.isArray(meds) || !meds.length) {
    return { restored: 0, merged: 0 };
  }

  const existingMeds = await getAll("medicines");
  const existingByKey = new Map();
  for (const med of existingMeds) {
    const key = getMedicineIdentityKey(med);
    if (key) {
      existingByKey.set(key, existingByKey.has(key) ? mergeMedicineRecords(existingByKey.get(key), med) : med);
    }
  }

  let restored = 0;
  let merged = 0;

  window.__budadiriApplyingRemote = true;
  try {
    for (const bMed of meds) {
      if (!bMed || !bMed.name || isDeletedRecord(bMed)) continue;
      const key = getMedicineIdentityKey(bMed);
      const current = key ? existingByKey.get(key) : null;

      if (!current) {
        const copy = { ...bMed };
        delete copy.id;
        copy.updatedAt = copy.updatedAt || new Date().toISOString();
        const newId = await addRecord("medicines", copy);
        existingByKey.set(key, { ...copy, id: newId });
        restored += 1;
      } else {
        const combined = mergeMedicineRecords(current, bMed);
        await putRecord("medicines", combined);
        existingByKey.set(key, combined);
        merged += 1;
      }
    }
  } finally {
    window.__budadiriApplyingRemote = false;
  }

  if (typeof refreshAll === "function") {
    await refreshAll();
  }

  return { restored, merged };
}

function queueAutoSync() {
  patchLocalWriteTracking();
  markLocalChanges();
  setSyncButtonState(false, "Sync");
}

function scheduleAutoSync() {
  queueAutoSync();
}

async function deleteEverywhere(storeName, id) {
  await dbReady;
  patchLocalWriteTracking();

  const localRecords = await getAll(storeName);
  const recordToDelete = localRecords.find(record => String(record.id) === String(id));

  addPendingDelete(storeName, id, recordToDelete || {});

  window.__budadiriSuppressWriteTracking = true;

  try {
    await deleteRecord(storeName, id);

    const stillThere = await getAll(storeName);

    for (const record of stillThere) {
      if (String(record.id) === String(id)) {
        await deleteRecord(storeName, record.id);
      }
    }
  } finally {
    window.__budadiriSuppressWriteTracking = false;
  }

  markLocalChanges();
  setSyncButtonState(false, "Sync");

  if (typeof refreshAll === "function") {
    await refreshAll();
  }
}

function bindSyncButtons() {
  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.disabled = false;
    button.style.pointerEvents = "auto";
    button.style.cursor = "pointer";
  });
}

function startAutoSync() {
  bindSyncButtons();
  patchLocalWriteTracking();

  if (window.__budadiriAutoSyncReady === true) {
    return;
  }

  window.__budadiriAutoSyncReady = true;

  window.addEventListener("online", () => {
    setSyncButtonState(false, hasLocalChanges() ? "Sync" : "Sync Now");
  });

  window.addEventListener("offline", () => {
    setSyncButtonState(false, "Offline");
  });

  setSyncButtonState(false, navigator.onLine ? (hasLocalChanges() ? "Sync" : "Sync Now") : "Offline");
}

document.addEventListener(
  "click",
  async event => {
    const button = event.target.closest(".sync-now-btn");

    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    await syncNow({ silent: false });
  },
  true
);

document.addEventListener("DOMContentLoaded", () => {
  bindSyncButtons();
  patchLocalWriteTracking();
  setSyncButtonState(false, navigator.onLine ? (hasLocalChanges() ? "Sync" : "Sync Now") : "Offline");
});

window.pullRecordsFromSupabase = pullRecordsFromSupabase;
window.syncRecordsToSupabase = syncRecordsToSupabase;
window.queueAutoSync = queueAutoSync;
window.scheduleAutoSync = scheduleAutoSync;
window.syncNow = syncNow;
window.startAutoSync = startAutoSync;
window.deleteEverywhere = deleteEverywhere;
window.restoreMissingMedicinesFromBackup = restoreMissingMedicinesFromBackup;
