# Automated Reordering System - Testing Guide

## Prerequisites

- Node.js installed
- Server running: `node server/index.js` or `start-server.bat`
- Database initialized (tables created automatically on first run)

---

## Getting Started

1. Open browser: `http://localhost:3000/admin.html`
2. Login credentials: `admin` / `admin123`

---

## Feature 1: Supplier Management

### Add a Supplier

1. Click **Suppliers** in the sidebar
2. Click **+ Add Supplier**
3. Fill in the details:
   - Name (required)
   - Contact Person
   - Email
   - Phone
   - Address
4. Click **Save**

### Edit a Supplier

1. In the Suppliers table, click **Edit** on the desired supplier
2. Modify fields and save

---

## Feature 2: Product Reorder Settings

### Add/Edit Product with Reorder Settings

1. Click **Products** in the sidebar
2. Click **+ Add Product** or click **Edit** on an existing product
3. Set the following reorder fields:
   | Field | Description | Example |
   |-------|-------------|---------|
   | **Cost Price** | Purchase cost from supplier | 10.00 |
   | **Stock** | Current inventory quantity | 5 |
   | **Reorder Point** | Trigger level (stock <= this = alert) | 10 |
   | **Reorder Quantity** | Amount to order when triggered | 20 |
   | **Supplier** | Select the supplier | (select supplier) |
4. Click **Save**

---

## Feature 3: Reorder Alerts Dashboard

### View Low Stock Alerts

1. Click **Reorder Alerts** in the sidebar
2. View the dashboard showing:
   - **Low Stock Items** - total items at/below reorder point
   - **Critical (Out of Stock)** - items with stock = 0
   - **Pending POs** - open purchase orders

3. The table shows:
   - Product name
   - Current stock level
   - Reorder point threshold
   - Suggested order quantity
   - Assigned supplier
   - Alert level (CRITICAL/WARNING/LOW)

---

## Feature 4: Auto-Reorder

### Trigger Automatic PO Creation

1. Click **Reorder Alerts**
2. Click **Auto Reorder Now**
3. Confirm the dialog
4. System automatically:
   - Groups low-stock items by supplier
   - Creates Purchase Orders for each supplier
   - Includes items with reorder_quantity × cost_price

### Verify PO Creation

1. Click **Purchase Orders** in sidebar
2. You should see new POs with status "pending"
3. Click action buttons to change status:
   - **Mark Ordered** - when PO is sent to supplier
   - **Mark Received** - when goods arrive

---

## Feature 5: Goods Received Voucher (GRV)

### Receive Goods into Inventory

1. Click **Goods Received** in sidebar
2. Click **+ Create GRV**
3. Select a **Purchase Order** from the dropdown
4. Items from the PO appear with:
   - Product name
   - Ordered quantity
   - Already received quantity
   - Input field for new receipt
5. Enter quantities being received
6. Add optional notes
7. Click **Receive Items**

### What Happens on GRV

- Stock levels are automatically updated
- PO status changes to "received" or "partial"
- GRV record is created for tracking

### Verify Stock Update

1. Click **Products**
2. Check the **Stock** column - quantities should be increased

---

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/suppliers` | GET, POST | List/create suppliers |
| `/api/suppliers/:id` | PUT, DELETE | Update/delete supplier |
| `/api/products` | GET, POST | List/create products |
| `/api/products/:id` | PUT | Update product |
| `/api/purchase-orders` | GET, POST | List/create POs |
| `/api/purchase-orders/:id` | PUT | Update PO status |
| `/api/grv` | GET, POST | List/create GRVs |
| `/api/reorder/alerts` | GET | Get low stock alerts |
| `/api/reorder/low-stock` | GET | Get low stock items |
| `/api/reorder/auto-reorder` | POST | Auto-generate POs |

---

## Database Tables Added

| Table | Purpose |
|-------|---------|
| `suppliers` | Supplier contact information |
| `purchase_orders` | PO header with status tracking |
| `purchase_order_items` | Line items per PO |
| `goods_received_vouchers` | GRV header records |
| `grv_items` | Line items per GRV |

### Products Table Fields Added

- `reorder_point` - Minimum stock level trigger
- `reorder_quantity` - Default quantity to order
- `supplier_id` - Foreign key to suppliers

---

## Troubleshooting

**Server won't start?**
- Check for syntax errors: `node --check server/index.js`
- Ensure all dependencies installed: `npm install`

**Auto-reorder not working?**
- Verify product has `reorder_point > 0`
- Verify product has `supplier_id` set
- Check browser console for errors

**GRV not updating stock?**
- Ensure PO status is "pending" or "partial"
- PO must not already be fully received