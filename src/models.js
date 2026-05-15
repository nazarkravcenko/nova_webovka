import crypto from 'node:crypto';
import { sanitizeText, validateEmail } from './security.js';

const BANK_ACCOUNT = '4875022083 / 0800';

export class UserModel {
  constructor(database, passwordService) {
    this.database = database;
    this.passwordService = passwordService;
  }

  ensureAdmin(email, password) {
    const existing = this.database.get('SELECT id FROM users WHERE email = :email', { email });
    if (existing) return;
    this.database.run(
      'INSERT INTO users (email, password_hash, role) VALUES (:email, :passwordHash, :role)',
      { email, passwordHash: this.passwordService.hash(password), role: 'admin' }
    );
  }

  authenticate(email, password) {
    const user = this.database.get('SELECT * FROM users WHERE email = :email', { email });
    if (!user || !this.passwordService.verify(password, user.password_hash)) return null;
    return { id: user.id, email: user.email, role: user.role };
  }
}

export class ProductModel {
  constructor(database) {
    this.database = database;
  }

  list() {
    return this.database.all('SELECT * FROM products ORDER BY featured DESC, created_at DESC');
  }

  create(input) {
    const product = this.normalize(input);
    const result = this.database.run(
      `INSERT INTO products (name, description, price_cents, stock, category, accent, image_path, featured)
       VALUES (:name, :description, :priceCents, :stock, :category, :accent, :imagePath, :featured)`,
      product
    );
    return this.find(result.lastInsertRowid);
  }

  update(id, input) {
    const product = this.normalize(input);
    this.database.run(
      `UPDATE products
       SET name = :name, description = :description, price_cents = :priceCents,
           stock = :stock, category = :category, accent = :accent, image_path = :imagePath, featured = :featured
       WHERE id = :id`,
      { ...product, id }
    );
    return this.find(id);
  }

  delete(id) {
    this.database.run('DELETE FROM products WHERE id = :id', { id });
  }

  find(id) {
    return this.database.get('SELECT * FROM products WHERE id = :id', { id });
  }

  seedDefaults() {
    const count = this.database.get('SELECT COUNT(*) AS total FROM products').total;
    if (count) return;
    [
      ['Neonová mikina', 'Těžší mikina s reflexním potiskem Kalianko.', 189900, 18, 'Oblečení', '#35f2b7', '', 1],
      ['Kalianko deck', 'Limitovaná skateboard deska s chromovým finišem.', 249900, 9, 'Vybavení', '#ff4d8d', '', 1],
      ['Signal kšiltovka', 'Pevná kšiltovka s vyšívaným logem.', 79900, 34, 'Oblečení', '#7c5cff', '', 0],
      ['Pulse láhev', 'Izolovaná ocelová láhev s matným povrchem.', 59900, 42, 'Doplňky', '#19a7ff', '', 0]
    ].forEach(([name, description, priceCents, stock, category, accent, imagePath, featured]) => {
      this.database.run(
        `INSERT INTO products (name, description, price_cents, stock, category, accent, image_path, featured)
         VALUES (:name, :description, :priceCents, :stock, :category, :accent, :imagePath, :featured)`,
        { name, description, priceCents, stock, category, accent, imagePath, featured }
      );
    });
  }

  normalize(input) {
    const name = sanitizeText(input.name, 80);
    const description = sanitizeText(input.description, 280);
    const category = sanitizeText(input.category, 40);
    const accent = /^#[0-9a-fA-F]{6}$/.test(input.accent) ? input.accent : '#35f2b7';
    const imagePath = this.normalizeImagePath(input.imagePath || input.image_path);
    const priceCents = Math.max(0, Math.round(Number(input.priceCents || input.price_cents || 0)));
    const stock = Math.max(0, Math.round(Number(input.stock || 0)));
    const featured = input.featured ? 1 : 0;
    if (!name || !description || !category) {
      throw new Error('Vyplň název, popis a kategorii produktu.');
    }
    return { name, description, priceCents, stock, category, accent, imagePath, featured };
  }

  normalizeImagePath(value) {
    const path = String(value || '').trim();
    if (!path) return '';
    return /^\/uploads\/[a-zA-Z0-9._-]+$/.test(path) ? path : '';
  }
}

export class OrderModel {
  constructor(database) {
    this.database = database;
  }

  list() {
    return this.database.all(`
      SELECT orders.*,
        COALESCE(group_concat(products.name || ' x ' || order_items.quantity || ' @ ' || order_items.price_cents, ' | '), '') AS items
      FROM orders
      LEFT JOIN order_items ON order_items.order_id = orders.id
      LEFT JOIN products ON products.id = order_items.product_id
      GROUP BY orders.id
      ORDER BY orders.created_at DESC
      LIMIT 50
    `);
  }

  create(input, productModel) {
    const customerName = sanitizeText(input.customerName, 90);
    const email = sanitizeText(input.email, 120).toLowerCase();
    const items = Array.isArray(input.items) ? input.items : [];
    if (!customerName || !validateEmail(email) || !items.length) {
      throw new Error('Vyplň jméno, platný email a alespoň jednu položku v košíku.');
    }

    return this.database.transaction(() => {
      let totalCents = 0;
      const preparedItems = items.map((item) => {
        const product = productModel.find(Number(item.productId));
        const quantity = Math.max(1, Math.min(20, Math.round(Number(item.quantity || 1))));
        if (!product || product.stock < quantity) throw new Error('Produkt není dostupný v požadovaném množství.');
        totalCents += product.price_cents * quantity;
        return { product, quantity };
      });

      const variableSymbol = this.generateVariableSymbol();
      const orderResult = this.database.run(
        `INSERT INTO orders (customer_name, email, total_cents, variable_symbol, bank_account)
         VALUES (:customerName, :email, :totalCents, :variableSymbol, :bankAccount)`,
        { customerName, email, totalCents, variableSymbol, bankAccount: BANK_ACCOUNT }
      );

      preparedItems.forEach(({ product, quantity }) => {
        this.database.run(
          'INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES (:orderId, :productId, :quantity, :priceCents)',
          { orderId: orderResult.lastInsertRowid, productId: product.id, quantity, priceCents: product.price_cents }
        );
        this.database.run('UPDATE products SET stock = stock - :quantity WHERE id = :id', { quantity, id: product.id });
      });

      return this.database.get('SELECT * FROM orders WHERE id = :id', { id: orderResult.lastInsertRowid });
    });
  }

  updateStatus(id, status) {
    const allowed = new Set(['new', 'ready', 'shipped', 'cancelled']);
    if (!allowed.has(status)) throw new Error('Neplatný stav objednávky.');
    return this.database.transaction(() => {
      const order = this.database.get('SELECT * FROM orders WHERE id = :id', { id });
      if (!order) throw new Error('Objednávka nebyla nalezena.');
      if (order.status !== 'cancelled' && status === 'cancelled') {
        this.restoreStock(id);
      }
      if (order.status === 'cancelled' && status !== 'cancelled') {
        this.reserveStock(id);
      }
      const timestamps = {
        new: { readyAt: null, shippedAt: null },
        ready: { readyAt: new Date().toISOString(), shippedAt: null },
        shipped: { readyAt: new Date().toISOString(), shippedAt: new Date().toISOString() },
        cancelled: { readyAt: null, shippedAt: null }
      };
      this.database.run(
        `UPDATE orders
         SET status = :status, ready_at = :readyAt, shipped_at = :shippedAt
         WHERE id = :id`,
        { id, status, ...timestamps[status] }
      );
      return this.database.get('SELECT * FROM orders WHERE id = :id', { id });
    });
  }

  restoreStock(orderId) {
    this.database.all('SELECT product_id, quantity FROM order_items WHERE order_id = :orderId', { orderId })
      .forEach((item) => {
        this.database.run(
          'UPDATE products SET stock = stock + :quantity WHERE id = :id',
          { quantity: item.quantity, id: item.product_id }
        );
      });
  }

  reserveStock(orderId) {
    this.database.all('SELECT product_id, quantity FROM order_items WHERE order_id = :orderId', { orderId })
      .forEach((item) => {
        const product = this.database.get('SELECT stock FROM products WHERE id = :id', { id: item.product_id });
        if (!product || product.stock < item.quantity) throw new Error('Na skladě není dost kusů pro obnovení objednávky.');
        this.database.run(
          'UPDATE products SET stock = stock - :quantity WHERE id = :id',
          { quantity: item.quantity, id: item.product_id }
        );
      });
  }

  generateVariableSymbol() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const symbol = String(crypto.randomInt(1000000000, 9999999999));
      const existing = this.database.get('SELECT id FROM orders WHERE variable_symbol = :symbol', { symbol });
      if (!existing) return symbol;
    }
    return `${Date.now()}`.slice(-10);
  }
}
