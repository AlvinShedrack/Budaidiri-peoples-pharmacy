(() => {
  function ensureSaleEditModal() {
    if (document.getElementById("editSaleModal")) return;

    document.body.insertAdjacentHTML("beforeend", `
      <div id="editSaleModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="editSaleModalTitle">
        <div class="modal-card large">
          <div class="modal-header">
            <h2 id="editSaleModalTitle">Edit Sale</h2>
            <button type="button" class="modal-close" data-close="editSaleModal" aria-label="Close">×</button>
          </div>
          <form id="editSaleForm" class="form-grid">
            <input type="hidden" id="editSaleId" />
            <div class="form-grid three">
              <div><label for="editSaleCustomer">Customer</label><input id="editSaleCustomer" /></div>
              <div><label for="editSalePaymentMethod">Payment Method</label>
                <select id="editSalePaymentMethod"><option>Cash</option><option>Mobile Money</option><option>Card</option><option>Credit</option></select>
              </div>
              <div><label for="editSaleType">Sale Type</label>
                <select id="editSaleType"><option value="retail">Retail</option><option value="wholesale">Wholesale</option></select>
              </div>
            </div>
            <div class="form-grid three">
              <div><label for="editSaleAddMedicineSelect">Add Medicine</label><select id="editSaleAddMedicineSelect"></select></div>
              <div><label for="editSaleAddBatchSelect">Batch</label><select id="editSaleAddBatchSelect"></select></div>
              <div class="form-actions"><button type="button" id="editSaleAddItemBtn" class="secondary-btn">Add Item</button></div>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Medicine</th><th>Batch</th><th>Quantity</th><th>Unit Price</th><th>Discount</th><th>Total</th><th>Action</th></tr></thead>
                <tbody id="editSaleLinesTable"></tbody>
              </table>
            </div>
            <div class="form-grid three">
              <div><label for="editSaleAmountPaid">Amount Paid</label><input id="editSaleAmountPaid" type="number" min="0" step="any" /></div>
              <div><label for="editSaleSubtotalDisplay">Subtotal</label><input id="editSaleSubtotalDisplay" readonly /></div>
              <div><label for="editSaleDiscountDisplay">Discount</label><input id="editSaleDiscountDisplay" readonly /></div>
              <div><label for="editSaleTotalDisplay">Total</label><input id="editSaleTotalDisplay" readonly /></div>
              <div><label for="editSaleChangeGiven">Change</label><input id="editSaleChangeGiven" readonly /></div>
            </div>
            <div class="form-actions">
              <button type="button" class="ghost-btn" data-close="editSaleModal">Cancel</button>
              <button type="submit" class="primary-btn">Save Sale Changes</button>
            </div>
          </form>
        </div>
      </div>
    `);

    const modal = document.getElementById("editSaleModal");
    modal.addEventListener("click", event => {
      if (event.target === modal || event.target.closest('[data-close="editSaleModal"]')) {
        if (typeof closeModal === "function") closeModal("editSaleModal");
        else modal.classList.add("hidden");
      }
    });

    document.getElementById("editSaleForm").addEventListener("submit", event => {
      if (typeof saveEditedSale === "function") saveEditedSale(event);
    });
    document.getElementById("editSaleLinesTable").addEventListener("input", () => {
      if (typeof recalcEditSaleModalTotals === "function") recalcEditSaleModalTotals();
    });
    document.getElementById("editSaleAmountPaid").addEventListener("input", () => {
      if (typeof recalcEditSaleModalTotals === "function") recalcEditSaleModalTotals();
    });
    document.getElementById("editSaleAddMedicineSelect").addEventListener("change", () => {
      if (typeof populateEditSaleAddBatchOptions === "function") populateEditSaleAddBatchOptions();
    });
    document.getElementById("editSaleAddItemBtn").addEventListener("click", () => {
      if (typeof addItemToEditSaleModal === "function") addItemToEditSaleModal();
    });
  }

  ensureSaleEditModal();
})();
