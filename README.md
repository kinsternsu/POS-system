# POS System

## Getting Started

1. **Start the server:**
   ```
   npm start
   ```

2. **Open in browser:**
   - Login: http://localhost:3001/login.html
   - Admin Dashboard: http://localhost:3001/admin.html
   - POS Interface: http://localhost:3001/pos.html

## Default Login
- **Username:** admin
- **Password:** admin123
- **PIN:** 0000

## Features
- Employee registration and management (Admin)
- Product catalog management (Admin)
- Point of Sale terminal with barcode scanning
- Transaction history and reporting
- Settings configuration

## For Local Network Access
Edit `server/.env` to bind to network IP:
```
HOST=0.0.0.0
PORT=3001
```

Then access via `http://YOUR_PC_IP:3001/`