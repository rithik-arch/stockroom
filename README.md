# Stockroom

A single-store order and inventory dashboard built with React, Express, and MySQL. Add products, record stock arrivals, place multi-item orders, and see which products have reached their reorder level.

## Run locally

With Docker and Docker Compose installed:

```sh
docker compose up --build -d
```

Once the database is ready, open http://localhost:3000. The first startup seeds eight products and two orders. The named volume keeps changes across restarts.

- **Products** shows the catalog, stock counts, category filters, and restocking.
- **Orders** shows order history and lets you create orders with multiple items.
- **Low Stock** shows items at or below their reorder level, including products with zero stock.

The Compose setup binds to loopback and uses demo credentials. The single-store app has no authentication. Use synthetic data for any shared demo.

## Inventory consistency

Express validates each order and uses one MySQL transaction for the order header, its lines, and every stock change. A locking read (`SELECT ... FOR UPDATE`) acquires each product row in increasing ID order before checking stock. If competing orders want the last unit, the second transaction waits for the lock and then reads zero stock. It rolls back and returns HTTP 409. A shortage on any line rolls back the whole order. Order lines save the product name and unit price at the time of sale.

## Integration tests

Run against the Compose database after startup. Tests create uniquely named rows and clean them up.

```sh
docker compose exec app npm test
```

The tests exercise the real HTTP API and MySQL. They check that only one competing request gets the last unit and that a shortage on a later line leaves earlier inventory and order history unchanged.
