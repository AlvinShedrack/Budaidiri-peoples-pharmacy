const BUDADIRI_SUPABASE_URL = "https://dvbbtublihsnmxapdycg.supabase.co";
const BUDADIRI_SUPABASE_PUBLIC_KEY = "sb_publishable_5gqvI9z-WFtiXOMo7GSOPw_AqlBLuDs";

if (!window.supabase) {
  alert("Supabase library is not loaded. Check script order and internet connection.");
  throw new Error("Supabase library is not loaded.");
}

function getBudadiriCloud() {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase library is not loaded correctly.");
  }

  if (!BUDADIRI_SUPABASE_URL || BUDADIRI_SUPABASE_URL.includes("PASTE_")) {
    throw new Error("Supabase URL is missing in sync.js.");
  }

  if (!BUDADIRI_SUPABASE_PUBLIC_KEY || BUDADIRI_SUPABASE_PUBLIC_KEY.includes("PASTE_")) {
    throw new Error("Supabase public key is missing in sync.js.");
  }

  if (!window.cloudClient || typeof window.cloudClient.from !== "function") {
    window.cloudClient = window.supabase.createClient(
      BUDADIRI_SUPABASE_URL,
      BUDADIRI_SUPABASE_PUBLIC_KEY
    );
  }

  return window.cloudClient;
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

const BUDADIRI_DEVICE_ID_KEY = "budadiri_pharmacy_device_id";
const BUDADIRI_LAST_SYNC_KEY = "budadiri_last_supabase_sync_at";

window.__budadiriSyncBusy = false;
window.__budadiriSyncTimer = null;
window.__budadiriAutoSyncReady = false;

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

function setSyncButtonState(isSyncing, text) {
  document.querySelectorAll(".sync-now-btn").forEach(button => {
    button.disabled = false;
    button.style.pointerEvents = "auto";
    button.style.cursor = "pointer";

    if (button.classList.contains("floating-sync-btn")) {
      button.textContent = isSyncing ? "…" : "↻sync";
    } else {
      button.textContent = isSyncing ? "Syncing..." : "🔄 Sync";
    }

    button.title = text;
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
    "Hint:\n" + (error?.hint || "No hint") + "\n\n" +
    "Full Error:\n" + JSON.stringify(error, null, 2)
  );
}

function getRecordTime(record) {
  const value = record?.updatedAt || record?.createdAt || 0;
  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
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

  return {
    ...cloudRecord,
    id: cloudRecord.id ?? Number(row.local_id),
    updatedAt:
      cloudRecord.updatedAt ||
      row.updated_at ||
      row.synced_at ||
      new Date().toISOString()
  };
}

function mergeRecords(localRecords, cloudRecords) {
  const merged = new Map();

  [...localRecords, ...cloudRecords].forEach(record => {
    if (record.id === undefined || record.id === null) return;

    const key = String(record.id);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, record);
      return;
    }

    const existingTime = getRecordTime(existing);
    const recordTime = getRecordTime(record);

    if (recordTime >= existingTime) {
      merged.set(key, record);
    }
  });

  return Array.from(merged.values());
}

async function replaceStoreRecords(storeName, records) {
  await clearStore(storeName);

  for (const record of records) {
    await putRecord(storeName, record);
  }
}

async function pullRecordsFromSupabase(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline. Connect to internet to sync.");

    if (!silent) {
      alert("You are offline. Connect to internet first.");
    }

    return 0;
  }

  try {
    await dbReady;

    setSyncButtonState(true, "Downloading from Supabase...");

    const { data, error } = await getBudadiriCloud()
      .from(BUDADIRI_SYNC_TABLE)
      .select("*")
      .in("store_name", BUDADIRI_SYNC_STORES)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    const groupedCloudRecords = {};

    BUDADIRI_SYNC_STORES.forEach(storeName => {
      groupedCloudRecords[storeName] = [];
    });

    (data || []).forEach(row => {
      if (!groupedCloudRecords[row.store_name]) return;
      groupedCloudRecords[row.store_name].push(recordFromCloud(row));
    });

    let downloadedCount = 0;

    for (const storeName of BUDADIRI_SYNC_STORES) {
      const localRecords = await getAll(storeName);
      const cloudRecords = groupedCloudRecords[storeName] || [];

      downloadedCount += cloudRecords.length;

      const mergedRecords = mergeRecords(localRecords, cloudRecords);
      await replaceStoreRecords(storeName, mergedRecords);
    }

    localStorage.setItem(BUDADIRI_LAST_SYNC_KEY, new Date().toISOString());

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    return downloadedCount;
  } catch (error) {
    setSyncButtonState(false, "Download failed.");

    if (!silent) {
      showRealError("DOWNLOAD FROM SUPABASE", error);
    } else {
      console.error("DOWNLOAD FROM SUPABASE", error);
    }

    throw error;
  }
}

async function syncRecordsToSupabase(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline. Connect to internet to sync.");

    if (!silent) {
      alert("You are offline. Records will sync when internet is available.");
    }

    return 0;
  }

  try {
    await dbReady;

    setSyncButtonState(true, "Uploading to Supabase...");

    const payload = [];

    for (const storeName of BUDADIRI_SYNC_STORES) {
      const localRecords = await getAll(storeName);

      localRecords.forEach(record => {
        if (record.id === undefined || record.id === null) return;
        payload.push(prepareRecordForCloud(storeName, record));
      });
    }

    console.log("UPLOAD PAYLOAD COUNT:", payload.length);
    console.log("UPLOAD PAYLOAD SAMPLE:", payload.slice(0, 3));

    if (!payload.length) {
      setSyncButtonState(false, "No records to sync.");

      if (!silent) {
        alert("There are no records to sync.");
      }

      return 0;
    }

    const { data, error } = await getBudadiriCloud()
      .from(BUDADIRI_SYNC_TABLE)
      .upsert(payload, {
        onConflict: "store_name,local_id"
      })
      .select();

    if (error) {
      throw error;
    }

    console.log("UPLOAD SUCCESS:", data);

    localStorage.setItem(BUDADIRI_LAST_SYNC_KEY, new Date().toISOString());

    return payload.length;
  } catch (error) {
    setSyncButtonState(false, "Upload failed.");

    if (!silent) {
      showRealError("UPLOAD TO SUPABASE", error);
    } else {
      console.error("UPLOAD TO SUPABASE", error);
    }

    throw error;
  }
}

async function syncNow(options = {}) {
  const silent = options.silent === true;

  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline. Connect to internet to sync.");

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

  let downloaded = 0;
  let uploaded = 0;

  try {
    window.__budadiriSyncBusy = true;

    setSyncButtonState(true, "Syncing...");
    showSyncMessage("Sync started...");

    downloaded = await pullRecordsFromSupabase({ silent: false });
    uploaded = await syncRecordsToSupabase({ silent: false });

    if (typeof refreshAll === "function") {
      await refreshAll();
    }

    const now = new Date().toLocaleString();
    const message = `Sync complete. Downloaded ${downloaded}, uploaded ${uploaded}. Last sync: ${now}`;

    setSyncButtonState(false, message);

    if (!silent) {
      alert(message);
    }
  } catch (error) {
    console.error("SYNC STOPPED:", error);

    setSyncButtonState(false, "Retry sync. See error message.");

    if (!silent) {
      alert(
        "Sync stopped.\n\n" +
        "Downloaded before failure: " + downloaded + "\n" +
        "Uploaded before failure: " + uploaded + "\n\n" +
        "The detailed error should have appeared before this message."
      );
    }
  } finally {
    window.__budadiriSyncBusy = false;
  }
}

function queueAutoSync(delay = 1500) {
  if (!navigator.onLine) {
    setSyncButtonState(false, "Offline. Connect to internet to sync.");
    return;
  }

  clearTimeout(window.__budadiriSyncTimer);

  // If delay is very small or zero, run sync immediately (but still respect the busy flag).
  if (delay <= 50) {
    (async () => {
      try {
        await syncNow({ silent: true });
      } catch (e) {
        console.error("Immediate auto-sync failed:", e);
      }
    })();
    return;
  }

  window.__budadiriSyncTimer = setTimeout(async () => {
    await syncNow({ silent: true });
  }, delay);
}

function scheduleAutoSync() {
  queueAutoSync();
}

async function verifyOnline() {
  if (!navigator.onLine) return false;

  try {
    // Lightweight test using the existing Supabase client to ensure real connectivity.
    const client = getBudadiriCloud();
    const { error } = await client.from(BUDADIRI_SYNC_TABLE).select('local_id').limit(1);

    if (error && error.status === 0) return false;
    return true;
  } catch (err) {
    console.warn('verifyOnline failed', err);
    return false;
  }
}

async function deleteEverywhere(storeName, id) {
  if (!navigator.onLine) {
    throw new Error("You are offline. Connect to internet before deleting this record.");
  }

  const { error } = await getBudadiriCloud()
    .from(BUDADIRI_SYNC_TABLE)
    .delete()
    .eq("store_name", storeName)
    .eq("local_id", String(id));

  if (error) {
    throw error;
  }

  await deleteRecord(storeName, id);
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

  if (window.__budadiriAutoSyncReady === true) {
    return;
  }

  window.__budadiriAutoSyncReady = true;

  window.addEventListener("online", () => {
    (async () => {
      setSyncButtonState(false, "Online. Checking connectivity...");

      const ok = await verifyOnline();

      if (ok) {
        setSyncButtonState(false, "Online. Syncing now...");
        // run immediately (minimal debounce)
        queueAutoSync(0);
      } else {
        setSyncButtonState(false, "Online but server unreachable. Will retry shortly.");
        // schedule a retry a bit later
        queueAutoSync(3000);
      }
    })();
  });

  window.addEventListener("offline", () => {
    setSyncButtonState(false, "Offline. Connect to internet to sync.");
  });

  if (navigator.onLine) {
    setSyncButtonState(false, "Online. Ready to sync.");
  } else {
    setSyncButtonState(false, "Offline. Connect to internet to sync.");
  }
}

document.addEventListener(
  "click",
  async event => {
    const button = event.target.closest(".sync-now-btn");

    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    console.log("Sync button clicked.");

    await syncNow({ silent: false });
  },
  true
);

document.addEventListener("DOMContentLoaded", () => {
  bindSyncButtons();
  setSyncButtonState(
    false,
    navigator.onLine ? "Online. Ready to sync." : "Offline. Connect to internet to sync."
  );
});

window.pullRecordsFromSupabase = pullRecordsFromSupabase;
window.syncRecordsToSupabase = syncRecordsToSupabase;
window.queueAutoSync = queueAutoSync;
window.scheduleAutoSync = scheduleAutoSync;
window.syncNow = syncNow;
window.startAutoSync = startAutoSync;
window.deleteEverywhere = deleteEverywhere;