### System Requirement Prompt: 4POS-Style Purchase Order Module

**Role & Objective:**  
lets make changes to the purchaser order process. Your task is to design the technical architecture and functional requirements for a robust **Purchase Order (PO) and Goods Received Voucher (Voucher/GRV) module**. This system must replicate the efficient, database-driven workflows found in the 4POS retail management suite.

Please detail the system architecture, database relationships, and user interfaces across the following four core phases:

#### 1. Data Foundations & Supplier Linking
*   **Supplier Profiles:** Define fields for vendor profiles including unique ID, account terms (e.g., 30 days), custom discount matrix templates, and tax codes.
*   **Stock-to-Supplier Mapping:** Detail a relational database structure where inventory items map to a primary supplier, storing historical cost prices, supplier-specific item codes, and standard delivery lead times.

#### 2. Order Generation Engines
*   **Automated Re-Ordering Wizard:** Outline the logic for a smart wizard. It must calculate current stock against user-defined minimum/maximum thresholds and past sales velocity to auto-generate recommended order quantities per supplier.


#### 3. Order Management Interface (The Order Form)
*   **UI Grid Capabilities:** Describe a back-office grid view allowing users to manually add, edit, or delete line items. The grid must display real-time calculations for line totals, tax weightings, and supplier discounts.
*   **Status Workflows:** Map out PO states from `Draft` to `Authorized` and `Sent to Supplier`. Ensure saved orders are safely committed to the database without prematurely altering current in-stock counts.

#### 4. Conversion to Goods Received Voucher (GRV)
*   **The Conversion Trigger:** Provide the technical logic to pull an active, authorized PO and duplicate its contents into a live GRV interface upon stock delivery.
*   **Discrepancy Handling:** Explain how the system handles variances. If the received quantity or cost price differs from the original PO, how does the UI flag this to the user?
*   **Inventory & Ledger Updates:** Specify the exact database actions triggered upon GRV finalization:
    *   Incrementing physical inventory counts.
    *   Recalculating Average Cost (AVC) pricing for the store.
    *   Logging accounts payable entries linked to the supplier profile.
