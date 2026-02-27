const { Pool } = require('pg');
require('dotenv/config');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'autopart',
  user: process.env.DB_USER || 'khoirulanam69',
  password: process.env.DB_PASSWORD,
});

async function setup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        supplier VARCHAR(255),
        barcode VARCHAR(255),
        image_url TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        customer_name VARCHAR(255) NOT NULL,
        total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
        status VARCHAR(20) NOT NULL DEFAULT 'completed',
        technician_fee NUMERIC(12,2) DEFAULT 0,
        other_fees NUMERIC(12,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Transaction items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transaction_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        price NUMERIC(12,2) NOT NULL,
        total NUMERIC(12,2) NOT NULL
      );
    `);

    // Income & Expenses table
    await client.query(`
      CREATE TABLE IF NOT EXISTS income_expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
        amount NUMERIC(12,2) NOT NULL,
        category VARCHAR(100) NOT NULL,
        description TEXT,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transaction_items_txn ON transaction_items(transaction_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_income_expenses_user ON income_expenses(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_income_expenses_date ON income_expenses(date);`);

    await client.query('COMMIT');
    console.log('✅ Database setup complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Setup failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
