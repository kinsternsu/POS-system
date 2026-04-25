# Point of Sale System

A local network POS system similar to 4POS software.

## Features

- Employee management (Admin)
- Product catalog management
- Point of Sale terminal with barcode scanning
- Transaction processing with cash/card payments
- Change calculation for cash payments
- Transaction history and reporting
- Role-based access (Admin/Cashier)

## Getting Started

### Starting the Server

1. Open a command prompt in the project folder
2. Run:
```
node server\index.js
```
3. Server runs at: http://localhost:3000

### Access Points

- **Login**: http://localhost:3000/
- **Admin Dashboard**: http://localhost:3000/admin.html
- **POS Terminal**: http://localhost:3000/pos.html

### Default Login

| Role | Username | Password | PIN |
|------|----------|----------|-----|
| Admin | admin | admin123 | 0000 |

## Usage

### Admin Dashboard

1. Login with admin credentials
2. **Employees** - Add new employees (cashiers)
3. **Products** - Add products with name, price, SKU, barcode, category, stock
4. **Transactions** - View transaction history
5. **Settings** - Configure store name, tax rate, currency
6. Click **POS Terminal** link in sidebar to access POS

### POS Terminal

1. Login as cashier or admin
2. Search products or scan barcode
3. Click products to add to cart
4. Adjust quantity in cart
5. Click **Checkout**
6. Select payment method:
   - **Cash**: Enter amount received, see change, confirm
   - **Card**: Process immediately
7. Receipt prints with transaction details

### Product Management

- **+ Add Product** button (Admin only)
- Click **Edit** on product cards (Admin only)
- Edit: name, price, SKU, barcode, category, stock, active status
- Delete products

## Tech Stack

- **Backend**: Node.js, Express, SQLite (better-sqlite3)
- **Frontend**: Vanilla HTML/CSS/JS
- **Authentication**: JWT tokens, PIN login

## Project Structure

```
/POINT OF SALE SYSTEM
├── server/
│   ├── index.js         # Main server
│   ├── database.js      # SQLite setup
│   ├── auth.js          # JWT auth middleware
│   ├── routes/
│   │   ├── employees.js
│   │   ├── products.js
│   │   ├── transactions.js
│   │   └── settings.js
│   └── .env             # Environment config
├── login.html           # Login page
├── admin.html          # Admin dashboard
├── pos.html           # POS terminal
├── pos.db             # SQLite database
├── package.json
└── README.md
```

## Local Network Access

Edit `server/index.js` to change port:
```javascript
const PORT = 3000;  // Change to desired port
```

Access from other computers:
```
http://YOUR_COMPUTER_IP:3000/
```

Find your IP:
- Run `ipconfig` in command prompt
- Look for IPv4 Address

## Backing Up to GitHub

### Using VSCode Source Control

1. Open project in VSCode
2. Press `Ctrl + Shift + G` or click Source Control icon
3. Click **Initialize Repository**

4. Create `.gitignore` file:
```
node_modules/
pos.db
*.db
.env
server/output.txt
server/error.txt
.vscode/
*.log
```

5. **Stage Changes**: Click `+` next to files or "Changes"

6. **Commit**: Enter message → Click checkmark

7. **Push to GitHub**:
   - Create new repo on github.com
   - Copy the commands shown (git remote add origin...)
   - Run in VSCode terminal

### Future Updates

1. Make changes
2. Source Control → Stage → Commit
3. Click **Sync Changes** or `git push`

### Command Line Alternative

```bash
git init
git add .
git commit -m "Initial POS System"
git remote add origin https://github.com/YOUR_USERNAME/repo-name.git
git push -u origin main

# For updates:
git add .
git commit -m "Description of changes"
git push
```

## Troubleshooting

### Server Won't Start
- Make sure port 3000 is available
- Check no other node processes running: `taskkill /F /IM node.exe`

### Login Issues
- Clear browser localStorage
- Use correct credentials
- PIN must be 4 digits

### Products Not Showing
- Click **Refresh** button on POS
- Check admin added products in dashboard
- Check browser console for errors (F12)

### Logout Not Working
- Refresh the page
- Clear localStorage manually in browser console:
  ```javascript
  localStorage.clear()
  ```

## License

ISC