# Autopart69 Express Backend API

Backend API untuk aplikasi Autopart69. Deploy di VPS Anda.

## Setup

```bash
# Install dependencies
npm install

# Copy dan edit konfigurasi
cp .env.example .env
# Edit .env sesuai konfigurasi VPS Anda

# Setup database (buat tabel)
node setup-db.js

# Jalankan server
node server.js

# Atau gunakan PM2 untuk production
pm2 start server.js --name autopart-api
```

## Environment Variables

```
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=autopart
DB_USER=khoirulanam69
DB_PASSWORD=PASSWORD_DB_ANDA
JWT_SECRET=your-super-secret-jwt-key-change-this
PORT=3000
UPLOAD_DIR=/var/www/cdn.mkaindo.com/autopart-products
CDN_BASE_URL=https://cdn.mkaindo.com/autopart-products
```

## API Endpoints

### Auth
- `POST /auth/login` - Login
- `POST /auth/register` - Register  
- `GET /auth/me` - Get current user

### Products
- `GET /products?page=0&limit=20` - Get products (paginated)
- `GET /products/all` - Get all products
- `GET /products/low-stock` - Get low stock products
- `GET /products/search?q=&category=` - Search products
- `GET /products/check-barcode?barcode=&excludeId=` - Check barcode uniqueness
- `POST /products` - Create product
- `PUT /products/:id` - Update product
- `DELETE /products/:id` - Delete product
- `POST /products/:id/image` - Upload product image

### Transactions
- `GET /transactions` - Get all transactions
- `POST /transactions` - Create transaction
- `PUT /transactions/:id` - Update transaction
- `DELETE /transactions/:id` - Delete transaction

### Income & Expenses
- `GET /income-expenses` - Get all
- `POST /income-expenses` - Create
- `PUT /income-expenses/:id` - Update
- `DELETE /income-expenses/:id` - Delete
