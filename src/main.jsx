import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, ArrowDownRight, Boxes, ChevronRight, CircleCheck, ClipboardList, Package, Plus, Search, X } from 'lucide-react';
import './style.css';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = cents => currency.format(cents / 100);
const tabs = [{ name: 'Products', Icon: Package }, { name: 'Orders', Icon: ClipboardList }, { name: 'Low Stock', Icon: AlertTriangle }];
const pages = {
  Products: ['Products', 'Manage your catalog, track availability, and keep inventory up to date.'],
  Orders: ['Orders', 'Create orders and review the items in each sale.'],
  'Low Stock': ['Low stock', 'Review products at or below their reorder level and add stock.'],
};

async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The request failed.');
  return data;
}

function Metric({ Icon, label, value, note, tone }) {
  return <article className="metric">
    <span className={'metric-icon ' + tone}><Icon size={18} /></span>
    <span className="metric-label">{label}</span>
    <strong>{value}</strong>
    <span className="metric-note">{note}</span>
  </article>;
}

function ProductTable({ products, onRestock }) {
  return <div className="scroll"><table>
    <thead><tr><th>Product</th><th>Category</th><th>Unit price</th><th>In stock</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{products.map(product => {
      const [status, tone] = product.stock === 0 ? ['Out of stock', 'out'] :
        product.stock <= product.reorder_level ? ['Low stock', 'low'] : ['In stock', 'good'];
      return <tr key={product.id}>
        <td><div className="product"><span className="product-icon"><Package size={17} /></span><div><strong>{product.name}</strong><small>{product.sku}</small></div></div></td>
        <td>{product.category}</td><td>{money(product.price_cents)}</td><td>{product.stock} <small>units</small></td>
        <td><span className={'status ' + tone}>{status}</span></td>
        <td><button className="text-button" aria-label={'Restock ' + product.name} onClick={() => onRestock(product)}>Restock <ChevronRight size={14} /></button></td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function OrdersTable({ orders }) {
  return <div className="scroll"><table>
    <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Placed</th><th>Total</th></tr></thead>
    <tbody>{orders.map(order => <tr key={order.id}>
      <td><strong>#{String(order.id).padStart(4, '0')}</strong></td>
      <td>{order.customer}</td>
      <td>{order.items.map(item => <div key={item.product_id}>{item.quantity} × {item.product_name}</div>)}</td>
      <td>{new Date(order.created_at).toLocaleDateString()}</td>
      <td><strong>{money(order.total_cents)}</strong></td>
    </tr>)}</tbody>
  </table></div>;
}

function EditDialog({ mode, products, onClose, onSaved, refresh }) {
  const dialog = useRef(null);
  const [lines, setLines] = useState([{ id: 1, product_id: '', quantity: '1' }]);
  const nextId = useRef(2);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const title = mode === 'product' ? 'Add product' : mode === 'order' ? 'New order' : 'Restock product';

  useEffect(() => { dialog.current.showModal(); }, []);

  function updateLine(id, field, value) {
    setLines(current => current.map(line => line.id === id ? { ...line, [field]: value } : line));
  }

  async function submit(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setPending(true);
    setError('');
    try {
      if (mode === 'product') {
        await api('products', {
          ...fields, price_cents: Math.round(Number(fields.price) * 100),
          stock: Number(fields.stock), reorder_level: Number(fields.reorder_level),
        });
        onSaved('Product added.');
      } else if (mode === 'order') {
        await api('orders', { customer: fields.customer, items: lines.map(line => ({
          product_id: Number(line.product_id), quantity: Number(line.quantity),
        })) });
        onSaved('Order created. Inventory updated.');
      } else {
        await api('products/' + mode.id + '/restock', { quantity: Number(fields.quantity) });
        onSaved('Stock updated.');
      }
    } catch (err) {
      setError(err.message);
      if (mode === 'order') void refresh();
    } finally {
      setPending(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={event => {
    event.preventDefault();
    if (!pending) onClose();
  }}>
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" type="button" aria-label="Close" disabled={pending} onClick={onClose}><X size={22} /></button></div>
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        {mode === 'product' ? <>
          <label>Product name<input name="name" maxLength="100" required /></label>
          <div className="field-grid"><label>SKU<input name="sku" maxLength="40" required /></label><label>Category<input name="category" maxLength="60" required /></label></div>
          <label>Unit price (USD)<input name="price" type="number" min="0.01" max="1000000" step="0.01" required /></label>
          <div className="field-grid"><label>Initial stock<input name="stock" type="number" min="0" max="1000000" defaultValue="0" required /></label><label>Reorder level<input name="reorder_level" type="number" min="0" max="1000000" defaultValue="5" required /></label></div>
        </> : mode === 'order' ? <>
          <label>Customer name<input name="customer" maxLength="100" required /></label>
          {lines.map((line, index) => <div key={line.id} className="order-line">
            <label>Product {index + 1}<select value={line.product_id} required onChange={event => updateLine(line.id, 'product_id', event.target.value)}>
              <option value="">Select a product</option>
              {products.map(product => <option key={product.id} value={product.id} disabled={
                String(product.id) !== line.product_id && (product.stock === 0 || lines.some(other => other.product_id === String(product.id)))
              }>{product.name} ({product.stock} available)</option>)}
            </select></label>
            <label>Quantity<input type="number" min="1" max="10000" required value={line.quantity} onChange={event => updateLine(line.id, 'quantity', event.target.value)} /></label>
            {lines.length > 1 && <button className="icon-button remove" aria-label={'Remove line ' + (index + 1)} type="button" onClick={() => setLines(current => current.filter(item => item.id !== line.id))}><X size={18} /></button>}
          </div>)}
          <button className="text-button add-line" type="button" disabled={lines.length >= Math.min(50, products.filter(product => product.stock > 0).length)} onClick={() => {
            const id = nextId.current++;
            setLines(current => [...current, { id, product_id: '', quantity: '1' }]);
          }}><Plus size={16} /> Add another item</button>
        </> : <>
          <p className="subtle">{mode.name} · {mode.stock} units in stock</p>
          <label>Quantity to add<input name="quantity" type="number" min="1" max="1000000" required /></label>
        </>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">{pending ? 'Saving…' : title}</button></div>
      </fieldset>
    </form>
  </dialog>;
}

function App() {
  const [tab, setTab] = useState('Products');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    setLoading(true);
    setLoadError('');
    try {
      const [catalog, sales] = await Promise.all([api('products'), api('orders')]);
      setProducts(catalog);
      setOrders(sales);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  const [title, description] = pages[tab];
  const lowStock = products.filter(product => product.stock <= product.reorder_level);
  const totalUnits = products.reduce((total, product) => total + product.stock, 0);
  const catalog = tab === 'Low Stock' ? lowStock : products;
  const categories = [...new Set(catalog.map(product => product.category))].sort();
  const selectedCategory = categories.includes(category) ? category : '';
  const search = query.trim().toLowerCase();
  const visibleProducts = catalog.filter(product => (!selectedCategory || selectedCategory === product.category) &&
    [product.sku, product.name, product.category].some(value => value.toLowerCase().includes(search)));
  const visibleOrders = orders.filter(order => [order.customer, '#' + String(order.id).padStart(4, '0'), String(order.id),
    ...order.items.map(item => item.product_name)].some(value => value.toLowerCase().includes(search)));
  const isOrders = tab === 'Orders';
  const visibleCount = isOrders ? visibleOrders.length : visibleProducts.length;

  return <div className="layout">
    <aside>
      <div className="brand"><span className="brand-icon"><Boxes size={23} /></span><div>Stockroom<small>Retail operations</small></div></div>
      <nav aria-label="Dashboard">
        {tabs.map(({ name, Icon }) => <button key={name} className={tab === name ? 'nav-active' : ''} aria-current={tab === name ? 'page' : undefined} onClick={() => {
          setTab(name); setQuery(''); setCategory(''); setNotice('');
        }}><Icon size={19} />{name}{name === 'Low Stock' && lowStock.length > 0 && <span>{lowStock.length}</span>}</button>)}
      </nav>
    </aside>
    <div className="workspace">
      <header><span>Workspace</span><ChevronRight size={14} /><strong>{tab}</strong></header>
      <main>
        <div className="page-head"><div><h1>{title}</h1><p>{description}</p></div>
          {tab !== 'Low Stock' && <button className="primary" disabled={loading || Boolean(loadError) || (isOrders && !products.some(product => product.stock > 0))} onClick={() => { setNotice(''); setMode(isOrders ? 'order' : 'product'); }}><Plus size={19} />{isOrders ? 'New order' : 'Add product'}</button>}
        </div>
        {tab === 'Products' && !loading && !loadError && <section className="metrics" aria-label="Inventory summary">
          <Metric Icon={Package} tone="mint" label="Total products" value={products.length} note={new Set(products.map(product => product.category)).size + ' categories'} />
          <Metric Icon={Boxes} tone="blue" label="Units in stock" value={totalUnits.toLocaleString()} note="Across all products" />
          <Metric Icon={ArrowDownRight} tone="amber" label="Low-stock products" value={lowStock.length} note="At or below reorder level" />
        </section>}
        {notice && <p className="notice" role="status"><CircleCheck size={18} />{notice}</p>}
        {loadError ? <div className="panel empty" role="alert"><p>{loadError}</p><button className="secondary" onClick={refresh}>Try again</button></div> :
          <section className="panel" aria-label={isOrders ? 'Order history' : 'Product inventory'}>
            <div className="toolbar">
              <h2>{isOrders ? 'Order history' : tab === 'Products' ? 'All products' : 'Products to restock'}</h2>
              <div className="filters"><label className="search"><Search size={17} /><input aria-label={isOrders ? 'Search orders' : 'Search products'} placeholder={isOrders ? 'Search orders…' : 'Search products…'} value={query} onChange={event => setQuery(event.target.value)} /></label>
                {!isOrders && <select aria-label="Filter by category" value={selectedCategory} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select>}
              </div>
            </div>
            {loading ? <p className="empty" role="status">Loading {isOrders ? 'orders' : 'products'}…</p> : visibleCount === 0 ?
              <p className="empty">{search || selectedCategory ? 'No results match your filters.' : tab === 'Low Stock' ? 'All products are above their reorder levels.' : isOrders ? 'No orders yet.' : 'No products yet.'}</p> :
              isOrders ? <OrdersTable orders={visibleOrders} /> : <ProductTable products={visibleProducts} onRestock={product => { setNotice(''); setMode(product); }} />}
            {!loading && <footer>{visibleCount} of {isOrders ? orders.length : catalog.length} {isOrders ? 'orders' : 'products'}</footer>}
          </section>}
      </main>
    </div>
    {mode && <EditDialog mode={mode} products={products} onClose={() => setMode(null)} refresh={refresh} onSaved={message => {
      setMode(null); setNotice(message); void refresh();
    }} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
