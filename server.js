import express from 'express';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'stockroom',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'stockroom',
  timezone: 'Z',
  connectionLimit: 10,
});

const app = express();
app.use(express.json({ limit: '32kb' }));

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requiredText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function integer(value, min, max = 1_000_000) {
  return Number.isInteger(value) && value >= min && value <= max;
}

app.get('/api/products', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM products ORDER BY id');
  res.json(rows);
});

app.post('/api/products', async (req, res) => {
  const { name, sku, category, price_cents, stock, reorder_level } = req.body ?? {};
  if (!requiredText(name, 100) || !requiredText(sku, 40) || !requiredText(category, 60) ||
      !integer(price_cents, 1, 100_000_000) || !integer(stock, 0) || !integer(reorder_level, 0)) {
    throw new RequestError(400, 'Enter valid product details and whole-number stock levels.');
  }

  const [result] = await pool.execute(
    'INSERT INTO products (name, sku, category, price_cents, stock, reorder_level) VALUES (?, ?, ?, ?, ?, ?)',
    [name.trim(), sku.trim(), category.trim(), price_cents, stock, reorder_level],
  );
  res.status(201).json({ id: result.insertId });
});

app.post('/api/products/:id/restock', async (req, res) => {
  const id = Number(req.params.id);
  const quantity = req.body?.quantity;
  if (!integer(id, 1, 4_294_967_295) || !integer(quantity, 1)) {
    throw new RequestError(400, 'Enter a valid product and positive quantity.');
  }
  const [result] = await pool.execute(
    'UPDATE products SET stock = stock + ? WHERE id = ? AND stock <= 1000000 - ?',
    [quantity, id, quantity],
  );
  if (!result.affectedRows) {
    const [[product]] = await pool.execute('SELECT id FROM products WHERE id = ?', [id]);
    if (!product) throw new RequestError(404, 'Product could not be found.');
    throw new RequestError(409, 'Restocking would exceed the stock limit. Refresh and try again.');
  }
  res.status(204).end();
});

app.get('/api/orders', async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT o.id, o.customer, o.created_at, i.product_id, i.product_name, i.quantity, i.unit_price_cents
    FROM orders o JOIN order_items i ON i.order_id = o.id
    ORDER BY o.id DESC, i.product_id
  `);
  const orders = new Map();
  for (const { id, customer, created_at, ...item } of rows) {
    if (!orders.has(id)) orders.set(id, { id, customer, created_at, items: [], total_cents: 0 });
    const order = orders.get(id);
    order.items.push(item);
    order.total_cents += item.quantity * item.unit_price_cents;
  }
  res.json([...orders.values()]);
});

app.post('/api/orders', async (req, res) => {
  const { customer, items } = req.body ?? {};
  if (!requiredText(customer, 100) || !Array.isArray(items) || !items.length || items.length > 50 ||
      items.some(item => !integer(item?.product_id, 1, 4_294_967_295) || !integer(item?.quantity, 1, 10_000))) {
    throw new RequestError(400, 'Enter a customer and between 1 and 50 valid order lines.');
  }
  if (new Set(items.map(item => item.product_id)).size !== items.length) {
    throw new RequestError(400, 'Use one order line per product.');
  }

  // Acquire inventory locks in the same order across checkouts.
  const lines = [...items].sort((a, b) => a.product_id - b.product_id);
  const connection = await pool.getConnection();
  let orderId;
  try {
    await connection.beginTransaction();
    const [order] = await connection.execute('INSERT INTO orders (customer) VALUES (?)', [customer.trim()]);
    orderId = order.insertId;

    for (const { product_id, quantity } of lines) {
      const [[product]] = await connection.execute(
        'SELECT name, price_cents, stock FROM products WHERE id = ? FOR UPDATE', [product_id],
      );
      if (!product) throw new RequestError(404, 'An order product could not be found.');
      if (product.stock < quantity) {
        throw new RequestError(409, `Only ${product.stock} units of ${product.name} are available.`);
      }
      await connection.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, product_id]);
      await connection.execute(
        'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)',
        [orderId, product_id, product.name, quantity, product.price_cents],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(201).json({ id: orderId });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use(express.static(fileURLToPath(new URL('./dist', import.meta.url))));
app.use((error, _req, res, _next) => {
  if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That SKU already exists.' });
  if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
    return res.status(409).json({ error: 'Inventory is busy. Please retry.' });
  }
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
});

export { app, pool };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`Stockroom listening on port ${port}`));
}
