# Dashboard Sections Guide

## Admin Dashboard (`admin.html`)

### 1. Dashboard
Overview of today's performance: total sales amount, number of transactions, total products, total employees, and a table of recent transactions.

### 2. Reorder Alerts
Shows products with low stock or out-of-stock. Displays reorder point, suggested order quantity, and supplier. Includes a button to auto-generate purchase orders for all low-stock items.

### 3. Suppliers
Manage suppliers: add, edit, search. Each supplier has a name, contact person, email, phone, and address.

### 4. Purchase Orders
Create and manage purchase orders (POs). Track status workflow: Pending → Ordered → Received. Filter by status.

### 5. Goods Received (GRV)
Receive stock against purchase orders. For each PO item, enter the quantity actually received. Records the GRV and updates stock levels.

### 6. Employees
Manage employee accounts: add, edit, change roles (admin/cashier). Each employee has a username, password, and 4-digit PIN for login.

### 7. Products
Full product management: add, edit, delete. Supports fixed-price and variable-weight products (per kg/lb). Each product can have a supplier, barcode, SKU, category, reorder point, and reorder quantity.

### 8. Transactions
View completed sales transactions filtered by date. Shows transaction ID, employee, items, subtotal, tax, and total.

### 9. Returns
View processed returns with stats (total returns, total refunds, damaged items count). Filter by date and status (circulated/damaged).

### 10. Settings
Configure store-wide settings: store name, tax rate (percentage), and currency symbol.

### 11. Audit Logs
Searchable history of all inventory actions (sales, GRVs, adjustments, blind counts). Filter by date range and action type.

### 12. Stock Adjustments
View and approve/reject stock adjustment requests. Shows requested change, reason, and current vs requested stock levels.

### 13. Blind Counts
Physical inventory counting tool. Start a blind count to record actual stock levels, view variances between system and physical counts, and adjust stock to match physical counts.

### 14. Cash-Ups
View till reconciliation history. Shows balanced/short/over stats. Each cash-up detail includes expected cash, actual cash, card receipts (individual amounts), cheques (individual amounts), payout records, denomination breakdown, and variance.

---

## POS Terminal (`pos.html`)

### 15. Product Browser
Left panel displaying products in a card grid with category filter tabs. Supports search by name and barcode scanning.

### 16. Cart Panel
Right panel showing items added to cart with quantity adjustment (+/-) and remove buttons. Displays subtotal, tax, and total.

### 17. Payment Modal
Process payments with three methods: Cash (enter amount received, calculates change), Card (immediate), Cheque (immediate).

### 18. Receipt
Post-sale receipt overlay showing order details, items, totals, change given, and payment method.

### 19. Add Product
Quick product creation from the POS terminal (name, price, SKU, barcode, category, stock).

### 20. Edit Product
Edit or delete existing products directly from the POS product grid.

### 21. Return Modal
Process customer returns: search product, set quantity, select reason (defective/wrong item/changed mind/other), and choose disposition (return to stock or damaged).

### 22. Payout Modal
Record cash payouts taken from the till for miscellaneous payments. Requires amount and reason. Generates a payout receipt.

### 23. Cash-Up
Full till reconciliation. On opening, checks for an active shift (prompts for starting float if needed). Two-column layout:
- Left: coin/note denomination counts, card receipts list
- Right: summary (float, expected cash, card total, cheque total, actual cash, payouts total), payout records for the shift, cheques list
- Bottom: variance display (color-coded) and notes
- Submit closes the shift and records all data.
