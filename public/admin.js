class AdminApi {
  async request(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Požadavek se nepodařilo zpracovat.');
    return data;
  }
}

class AdminPanel {
  constructor() {
    this.api = new AdminApi();
    this.products = [];
    this.orders = [];
    this.loginPanel = document.querySelector('#loginPanel');
    this.dashboard = document.querySelector('#dashboard');
    this.productForm = document.querySelector('#productForm');
    this.title = document.querySelector('#adminTitle');
  }

  async start() {
    this.bind();
    await this.bootstrap();
  }

  bind() {
    document.querySelector('#loginForm').addEventListener('submit', (event) => this.login(event));
    document.querySelector('#logoutButton').addEventListener('click', () => this.logout());
    this.productForm.addEventListener('submit', (event) => this.saveProduct(event));
    this.productForm.image.addEventListener('change', () => this.previewLocalImage());
    document.querySelector('#resetForm').addEventListener('click', () => this.resetProductForm());
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => this.showView(button.dataset.view));
    });
  }

  async bootstrap() {
    try {
      await this.api.request('/api/admin/me');
      this.showDashboard();
    } catch {
      this.showLogin();
    }
  }

  async login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await this.api.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
      });
      document.querySelector('#loginMessage').textContent = '';
      this.showDashboard();
    } catch (error) {
      document.querySelector('#loginMessage').textContent = error.message;
    }
  }

  async logout() {
    await this.api.request('/api/auth/logout', { method: 'POST' });
    this.showLogin();
  }

  async showDashboard() {
    this.loginPanel.classList.add('hidden');
    this.dashboard.classList.remove('hidden');
    await Promise.all([this.loadProducts(), this.loadOrders()]);
    this.connectRealtime();
  }

  showLogin() {
    this.dashboard.classList.add('hidden');
    this.loginPanel.classList.remove('hidden');
  }

  async loadProducts() {
    const data = await this.api.request('/api/products');
    this.products = data.products;
    this.renderProducts();
    this.renderMetrics();
  }

  async loadOrders() {
    const data = await this.api.request('/api/admin/orders');
    this.orders = data.orders;
    document.querySelector('#ordersList').innerHTML = this.renderOrderCards(this.orders);
    document.querySelector('#overviewOrders').innerHTML = this.renderOrderCards(this.orders.slice(0, 5), true);
    this.bindOrderButtons();
    this.renderMetrics();
  }

  renderOrderCards(orders, compact = false) {
    return orders.length ? orders.map((order) => `
      <div class="admin-item order-item ${this.escape(order.status)}">
        <div class="order-top">
          <strong>#${order.id} ${this.escape(order.customer_name)}</strong>
          <span class="status-pill small">${this.escape(this.statusLabel(order.status))}</span>
        </div>
        <span>${this.escape(order.email)} · ${this.format(order.total_cents)}</span>
        <div class="order-lines">${this.renderOrderItems(order.items)}</div>
        <span class="payment-line">VS ${this.escape(order.variable_symbol)} · ${this.escape(order.bank_account)}</span>
        <div class="admin-actions ${compact ? 'hidden' : ''}">
          <button class="ghost-button" data-status="${order.id}:new" type="button">Nová</button>
          <button class="ghost-button" data-status="${order.id}:ready" type="button">Připravená</button>
          <button class="ghost-button" data-status="${order.id}:shipped" type="button">Odeslaná</button>
          <button class="ghost-button danger-button" data-status="${order.id}:cancelled" type="button">Stornovat</button>
        </div>
      </div>
    `).join('') : '<p class="form-message">Zatím nejsou žádné objednávky.</p>';
  }

  renderOrderItems(items) {
    if (!items) return '<span>Žádné položky</span>';
    return items.split(' | ').map((item) => {
      const [label, cents] = item.split(' @ ');
      return `<span>${this.escape(label)} <strong>${this.format(Number(cents || 0))}</strong></span>`;
    }).join('');
  }

  bindOrderButtons() {
    document.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', () => {
        const [id, status] = button.dataset.status.split(':');
        this.updateOrderStatus(Number(id), status);
      });
    });
  }

  renderMetrics() {
    if (!document.querySelector('#metricOrders')) return;
    const activeOrders = this.orders.filter((order) => order.status !== 'cancelled');
    document.querySelector('#metricOrders').textContent = this.orders.length;
    document.querySelector('#metricProducts').textContent = this.products.length;
    document.querySelector('#metricRevenue').textContent = this.format(activeOrders.reduce((sum, order) => sum + order.total_cents, 0));
    document.querySelector('#metricOpen').textContent = this.orders.filter((order) => ['new', 'ready'].includes(order.status)).length;
  }

  showView(view) {
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.panel !== view);
    });
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    this.title.textContent = this.viewLabel(view);
  }

  renderProducts() {
    document.querySelector('#adminProducts').innerHTML = this.products.map((product) => `
      <div class="admin-item">
        ${product.image_path ? `<img class="admin-thumb" src="${this.escape(product.image_path)}" alt="${this.escape(product.name)}">` : ''}
        <strong>${this.escape(product.name)}</strong>
        <span>${this.format(product.price_cents)} · ${product.stock} ks · ${this.escape(product.category)}</span>
        <div class="admin-actions">
          <button class="ghost-button" data-edit="${product.id}" type="button">Upravit</button>
          <button class="ghost-button danger-button" data-delete="${product.id}" type="button">Smazat</button>
        </div>
      </div>
    `).join('');
    document.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => this.editProduct(Number(button.dataset.edit))));
    document.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => this.deleteProduct(Number(button.dataset.delete))));
  }

  editProduct(id) {
    const product = this.products.find((item) => item.id === id);
    this.productForm.productId.value = product.id;
    this.productForm.name.value = product.name;
    this.productForm.description.value = product.description;
    this.productForm.priceCents.value = product.price_cents;
    this.productForm.stock.value = product.stock;
    this.productForm.category.value = product.category;
    this.productForm.accent.value = product.accent;
    this.productForm.imagePath.value = product.image_path || '';
    this.productForm.featured.checked = Boolean(product.featured);
    this.renderPreview(product.image_path);
  }

  async saveProduct(event) {
    event.preventDefault();
    const form = new FormData(this.productForm);
    const id = form.get('productId');
    try {
      const uploadedPath = await this.uploadImageIfNeeded(form);
      const body = {
        name: form.get('name'),
        description: form.get('description'),
        priceCents: Number(form.get('priceCents')),
        stock: Number(form.get('stock')),
        category: form.get('category'),
        accent: form.get('accent'),
        imagePath: uploadedPath || form.get('imagePath'),
        featured: form.get('featured') === 'on'
      };
      await this.api.request(id ? `/api/admin/products/${id}` : '/api/admin/products', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      this.resetProductForm();
      document.querySelector('#productMessage').textContent = 'Produkt byl uložen.';
      await this.loadProducts();
    } catch (error) {
      document.querySelector('#productMessage').textContent = error.message;
    }
  }

  async deleteProduct(id) {
    await this.api.request(`/api/admin/products/${id}`, { method: 'DELETE' });
    await this.loadProducts();
  }

  async updateOrderStatus(id, status) {
    await this.api.request(`/api/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await this.loadOrders();
  }

  async uploadImageIfNeeded(form) {
    const file = form.get('image');
    if (!file || !file.size) return '';
    const uploadForm = new FormData();
    uploadForm.append('image', file);
    const response = await fetch('/api/admin/uploads', { method: 'POST', body: uploadForm });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nahrání obrázku selhalo.');
    return data.imagePath;
  }

  previewLocalImage() {
    const file = this.productForm.image.files[0];
    if (!file) return;
    this.renderPreview(URL.createObjectURL(file));
  }

  renderPreview(path) {
    const preview = document.querySelector('#imagePreview');
    if (!path) {
      preview.className = 'image-preview empty';
      preview.textContent = 'Není vybraný žádný obrázek';
      return;
    }
    preview.className = 'image-preview';
    preview.innerHTML = `<img src="${this.escape(path)}" alt="">`;
  }

  resetProductForm() {
    this.productForm.reset();
    this.productForm.productId.value = '';
    this.productForm.imagePath.value = '';
    this.renderPreview('');
  }

  connectRealtime() {
    if (this.socket) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.socket.addEventListener('open', () => document.querySelector('#adminSocket').textContent = 'připojeno');
    this.socket.addEventListener('close', () => document.querySelector('#adminSocket').textContent = 'odpojeno');
    this.socket.addEventListener('message', async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'products:update') {
        this.products = message.products;
        this.renderProducts();
      }
      if (message.type === 'order:new') await this.loadOrders();
      if (message.type === 'orders:update') await this.loadOrders();
    });
  }

  format(cents) {
    return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(cents / 100);
  }

  statusLabel(status) {
    return {
      new: 'Nová',
      ready: 'Připravená',
      shipped: 'Odeslaná',
      cancelled: 'Stornovaná'
    }[status] || status;
  }

  viewLabel(view) {
    return {
      overview: 'Přehled',
      orders: 'Objednávky',
      products: 'Produkty'
    }[view] || view;
  }

  escape(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
}

new AdminPanel().start();
