(() => {
  const inventoryTableBody = () => document.getElementById("medicineTable");

  function canAdjustInventoryStock() {
    return typeof requireRole === "function" && requireRole(["Administrator", "Director", "Dispenser"]);
  }

  function addStockColumn() {
    const tableBody = inventoryTableBody();
    const table = tableBody?.closest("table");
    const headerRow = table?.querySelector("thead tr");
    if (!tableBody || !headerRow) return;

    if (!headerRow.querySelector("[data-stock-header]")) {
      const header = document.createElement("th");
      header.dataset.stockHeader = "true";
      header.textContent = "Stock Available";
      const actionsHeader = headerRow.lastElementChild;
      headerRow.insertBefore(header, actionsHeader || null);
    }

    for (const row of tableBody.rows) {
      if (row.querySelector("[data-stock-cell]")) continue;

      const emptyCell = row.querySelector("td[colspan]");
      if (emptyCell) {
        emptyCell.colSpan = headerRow.cells.length;
        continue;
      }

      const editButton = row.querySelector('[data-action="edit-medicine"]');
      const medicineId = editButton?.dataset.id;
      if (!medicineId) continue;

      const medicineCell = row.insertCell(Math.max(0, row.cells.length - 1));
      medicineCell.dataset.stockCell = "true";
      medicineCell.innerHTML = canAdjustInventoryStock()
        ? `<div class="inventory-stock-editor">
             <input class="table-input inventory-stock-input" type="number" min="0" step="1" inputmode="numeric" aria-label="Available stock quantity" value="${Number(row.cells[0].querySelector(".muted")?.textContent.match(/Total Qty: (\\d+)/)?.[1] || row.cells[0].querySelector(".muted")?.textContent.match(/Qty: (\\d+)/)?.[1] || 0)}">
             <button type="button" class="table-btn secondary" data-action="save-stock-quantity" data-id="${medicineId}">Save</button>
           </div>`
        : `<strong>${Number(row.cells[0].querySelector(".muted")?.textContent.match(/Total Qty: (\\d+)/)?.[1] || row.cells[0].querySelector(".muted")?.textContent.match(/Qty: (\\d+)/)?.[1] || 0)}</strong>`;
    }
  }

  async function saveStockQuantity(button) {
    if (!canAdjustInventoryStock()) {
      showToast("Only Administrator, Director, or Dispenser can adjust stock.");
      return;
    }

    const row = button.closest("tr");
    const input = row?.querySelector(".inventory-stock-input");
    const targetQuantity = Number(input?.value);
    if (!Number.isSafeInteger(targetQuantity) || targetQuantity < 0) {
      showToast("Enter a whole stock quantity of zero or more.");
      input?.focus();
      return;
    }

    const medicine = await getById(STORE.medicines, button.dataset.id);
    if (!medicine) {
      showToast("Medicine not found.");
      return;
    }

    const previousQuantity = Number(medicine.quantity || 0);
    const batches = getMedicineBatches(medicine).map(batch => ({ ...batch }));

    if (batches.length) {
      const batchQuantity = batches.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity || 0)), 0);
      let difference = targetQuantity - batchQuantity;

      if (difference < 0) {
        let toRemove = Math.abs(difference);
        for (const batch of batches) {
          const removed = Math.min(Math.max(0, Number(batch.quantity || 0)), toRemove);
          batch.quantity = Math.max(0, Number(batch.quantity || 0) - removed);
          toRemove -= removed;
          if (toRemove === 0) break;
        }
      } else if (difference > 0) {
        batches.push({
          batchId: `ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          batchNo: `STOCK-ADJ-${new Date().toISOString().slice(0, 10)}`,
          expiryDate: "",
          quantity: difference,
          unitCost: Number(medicine.buyingPrice || 0),
          createdAt: new Date().toISOString(),
          notes: "Manual stock quantity adjustment"
        });
      }

      medicine.batches = batches;
      recalculateMedicineFromBatches(medicine);
    } else {
      medicine.quantity = targetQuantity;
    }

    medicine.updatedAt = new Date().toISOString();
    await putRecord(STORE.medicines, medicine);
    await writeAudit("medicine_stock_adjusted", {
      medicineId: medicine.id,
      name: medicine.name,
      previousQuantity,
      quantity: Number(medicine.quantity || 0)
    });

    showToast(`Stock updated for ${medicine.name}: ${Number(medicine.quantity || 0)} available.`);
    await refreshAll();
    if (typeof queueAutoSync === "function") queueAutoSync();
  }

  document.addEventListener("click", event => {
    const button = event.target.closest('[data-action="save-stock-quantity"]');
    if (button) saveStockQuantity(button);
  });

  function observeInventory() {
    const tableBody = inventoryTableBody();
    if (!tableBody) return;
    addStockColumn();
    new MutationObserver(addStockColumn).observe(tableBody, { childList: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeInventory, { once: true });
  } else {
    observeInventory();
  }
})();
