const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Load .env
try { require('dotenv').config(); } catch(e) {}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const CDN_BASE_URL = process.env.CDN_BASE_URL || 'http://localhost:3000/uploads';

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'autopart',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Middleware
app.use(cors());
app.use(express.json());

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Static files for uploads (fallback if no CDN)
app.use('/uploads', express.static(UPLOAD_DIR));

// Multer config
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Token required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}

// ============ AUTH ROUTES ============

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(401).json({ message: 'Invalid login credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: 'Invalid login credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ message: 'Email sudah terdaftar' });
    res.status(500).json({ message: err.message });
  }
});

app.get('/auth/me', auth, async (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

// ============ PRODUCTS ROUTES ============

app.get('/products', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 20;
    const offset = page * limit;

    const { rows: data } = await pool.query(
      'SELECT * FROM products ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM products');
    res.json({ data, count: parseInt(countRows[0].count) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/products/all', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/products/low-stock', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE stock = 0');
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/products/search', auth, async (req, res) => {
  try {
    const { q, category } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);

    // Client-side keyword filtering (same logic as original)
    let filtered = rows;
    if (q && q.trim()) {
      const keywords = q.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0);
      filtered = rows.filter(p => {
        const text = `${p.name} ${p.barcode || ''}`.toLowerCase();
        return keywords.every(kw => text.includes(kw));
      });
    }

    res.json({ data: filtered });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/products/check-barcode', auth, async (req, res) => {
  try {
    const { barcode, excludeId } = req.query;
    let query = 'SELECT id FROM products WHERE barcode = $1';
    const params = [barcode];
    if (excludeId) {
      params.push(excludeId);
      query += ` AND id != $${params.length}`;
    }
    const { rows } = await pool.query(query, params);
    res.json({ exists: rows.length > 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/products', auth, async (req, res) => {
  try {
    const { name, category, price, purchase_price, stock, supplier, barcode } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO products (name, category, price, purchase_price, stock, supplier, barcode, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, category, price, purchase_price, stock || 0, supplier, barcode, req.user.id]
    );
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/products/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    if (keys.length === 0) return res.status(400).json({ message: 'No fields to update' });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`);
    sets.push(`updated_at = NOW()`);
    const values = keys.map(k => fields[k]);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Product not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/products/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/products/:id/image', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image provided' });
    const url = `${CDN_BASE_URL}/${req.file.filename}`;
    await pool.query('UPDATE products SET image_url = $1, updated_at = NOW() WHERE id = $2', [url, req.params.id]);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============ TRANSACTIONS ROUTES ============

app.get('/transactions', auth, async (req, res) => {
  try {
    const { rows: transactions } = await pool.query(
      'SELECT * FROM transactions ORDER BY created_at DESC'
    );

    // Fetch items for each transaction
    const data = await Promise.all(transactions.map(async (t) => {
      const { rows: items } = await pool.query(
        'SELECT * FROM transaction_items WHERE transaction_id = $1', [t.id]
      );
      return {
        id: t.id,
        date: new Date(t.created_at).toISOString().split('T')[0],
        customer_name: t.customer_name,
        total_amount: Number(t.total_amount),
        payment_method: t.payment_method,
        status: t.status,
        technician_fee: Number(t.technician_fee) || 0,
        other_fees: Number(t.other_fees) || 0,
        items: items.map(item => ({
          id: item.id,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          price: Number(item.price),
          total: Number(item.total)
        }))
      };
    }));

    res.json({ data });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/transactions', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { customer_name, payment_method, items, technician_fee = 0, other_fees = 0 } = req.body;
    const totalAmount = items.reduce((sum, i) => sum + i.total, 0) + technician_fee + other_fees;

    // Create transaction
    const { rows: [txn] } = await client.query(
      `INSERT INTO transactions (user_id, customer_name, total_amount, payment_method, status, technician_fee, other_fees)
       VALUES ($1, $2, $3, $4, 'completed', $5, $6) RETURNING *`,
      [req.user.id, customer_name, totalAmount, payment_method, technician_fee, other_fees]
    );

    // Create items and update stock
    for (const item of items) {
      await client.query(
        `INSERT INTO transaction_items (transaction_id, product_id, product_name, quantity, price, total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [txn.id, item.product_id, item.product_name, item.quantity, item.price, item.total]
      );

      // Check and update stock
      const { rows: [product] } = await client.query('SELECT stock FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
      if (!product) throw new Error(`Produk ${item.product_name} tidak ditemukan`);
      if (product.stock < item.quantity) throw new Error(`Stok ${item.product_name} tidak mencukupi. Tersedia: ${product.stock}`);

      await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
    }

    await client.query('COMMIT');
    res.json({ data: txn });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
});

app.put('/transactions/:id', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { customer_name, payment_method, items, technician_fee = 0, other_fees = 0 } = req.body;

    // Restore old stock
    const { rows: oldItems } = await client.query('SELECT * FROM transaction_items WHERE transaction_id = $1', [id]);
    for (const item of oldItems) {
      await client.query('UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
    }

    // Delete old items
    await client.query('DELETE FROM transaction_items WHERE transaction_id = $1', [id]);

    // Update transaction
    const totalAmount = items.reduce((sum, i) => sum + i.total, 0) + technician_fee + other_fees;
    await client.query(
      `UPDATE transactions SET customer_name=$1, total_amount=$2, payment_method=$3, technician_fee=$4, other_fees=$5, updated_at=NOW() WHERE id=$6`,
      [customer_name, totalAmount, payment_method, technician_fee, other_fees, id]
    );

    // Insert new items and deduct stock
    for (const item of items) {
      await client.query(
        `INSERT INTO transaction_items (transaction_id, product_id, product_name, quantity, price, total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, item.product_id, item.product_name, item.quantity, item.price, item.total]
      );

      const { rows: [product] } = await client.query('SELECT stock FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
      if (product.stock < item.quantity) throw new Error(`Stok ${item.product_name} tidak mencukupi`);
      await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
    }

    await client.query('COMMIT');
    res.json({ data: { id } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
});

app.delete('/transactions/:id', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Restore stock
    const { rows: items } = await client.query('SELECT * FROM transaction_items WHERE transaction_id = $1', [id]);
    for (const item of items) {
      await client.query('UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.product_id]);
    }

    await client.query('DELETE FROM transaction_items WHERE transaction_id = $1', [id]);
    await client.query('DELETE FROM transactions WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// ============ INCOME & EXPENSES ROUTES ============

app.get('/income-expenses', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM income_expenses WHERE user_id = $1 ORDER BY date DESC',
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/income-expenses', auth, async (req, res) => {
  try {
    const { type, amount, category, description, date } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO income_expenses (user_id, type, amount, category, description, date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, type, amount, category, description, date]
    );
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/income-expenses/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'user_id');
    if (keys.length === 0) return res.status(400).json({ message: 'No fields to update' });

    const sets = keys.map((k, i) => `${k} = $${i + 1}`);
    sets.push('updated_at = NOW()');
    const values = keys.map(k => fields[k]);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE income_expenses SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/income-expenses/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM income_expenses WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============ START SERVER ============

app.listen(PORT, () => {
  console.log(`🚀 Autopart69 API running on port ${PORT}`);
});
