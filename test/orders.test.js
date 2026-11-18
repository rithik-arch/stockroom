import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { app, pool } from '../server.js';

let server;
let baseUrl;
const prefix = 'test-' + randomUUID();
const productIds = [];

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  try {
    if (productIds.length) {
      await pool.execute('DELETE i FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.customer LIKE ?', [prefix + '%']);
      await pool.execute('DELETE FROM orders WHERE customer LIKE ?', [prefix + '%']);
      for (const id of productIds) await pool.execute('DELETE FROM products WHERE id = ?', [id]);
    }
  } finally {
    server?.close();
    await pool.end();
  }
});

async function addProduct(stock) {
  const [product] = await pool.execute(
    'INSERT INTO products (sku, name, category, price_cents, stock, reorder_level) VALUES (?, ?, ?, ?, ?, ?)',
    [prefix.slice(5, 29) + '-' + productIds.length, 'Integration test product', 'Test', 450, stock, 1],
  );
  productIds.push(product.insertId);
  return product.insertId;
}

function placeOrder(customer, items) {
  return fetch(baseUrl + '/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer, items }),
  });
}

async function stockOf(id) {
  const [[product]] = await pool.execute('SELECT stock FROM products WHERE id = ?', [id]);
  return product.stock;
}

test('only one concurrent order can purchase the last unit', async () => {
  const id = await addProduct(1);
  const items = [{ product_id: id, quantity: 1 }];
  const responses = await Promise.all([placeOrder(prefix + '-a', items), placeOrder(prefix + '-b', items)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);

  const { id: orderId } = await responses.find(response => response.status === 201).json();
  await responses.find(response => response.status === 409).json();
  assert.equal(await stockOf(id), 0);
  const [[{ count }]] = await pool.execute('SELECT COUNT(*) AS count FROM orders WHERE customer LIKE ?', [prefix + '%']);
  assert.equal(count, 1);
  const [[line]] = await pool.execute('SELECT quantity, unit_price_cents FROM order_items WHERE order_id = ?', [orderId]);
  assert.deepEqual(line, { quantity: 1, unit_price_cents: 450 });
});

test('a shortage on a later line rolls back earlier stock changes and the order', async () => {
  const available = await addProduct(4);
  const unavailable = await addProduct(0);
  const customer = prefix + '-rollback';
  const response = await placeOrder(customer, [
    { product_id: available, quantity: 2 },
    { product_id: unavailable, quantity: 1 },
  ]);

  assert.equal(response.status, 409);
  await response.json();
  assert.equal(await stockOf(available), 4);
  assert.equal(await stockOf(unavailable), 0);
  const [[{ count }]] = await pool.execute('SELECT COUNT(*) AS count FROM orders WHERE customer = ?', [customer]);
  assert.equal(count, 0);
});
