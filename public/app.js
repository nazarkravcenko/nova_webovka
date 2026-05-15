class ApiClient {
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

class Cart {
  constructor() {
    this.items = new Map();
  }

  add(product) {
    const current = this.items.get(product.id) || { product, quantity: 0 };
    current.quantity += 1;
    this.items.set(product.id, current);
  }

  clear() {
    this.items.clear();
  }

  count() {
    return [...this.items.values()].reduce((sum, item) => sum + item.quantity, 0);
  }

  total() {
    return [...this.items.values()].reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);
  }

  toOrderItems() {
    return [...this.items.values()].map((item) => ({ productId: item.product.id, quantity: item.quantity }));
  }
}

class Storefront {
  constructor() {
    this.api = new ApiClient();
    this.cart = new Cart();
    this.products = [];
    this.grid = document.querySelector('#productGrid');
    this.cartPanel = document.querySelector('#cartPanel');
    this.cartItems = document.querySelector('#cartItems');
    this.cartCount = document.querySelector('#cartCount');
    this.cartTotal = document.querySelector('#cartTotal');
    this.cartMessage = document.querySelector('#cartMessage');
    this.paymentBox = document.querySelector('#paymentBox');
  }

  async start() {
    this.bindUi();
    this.bindReveal();
    this.startCanvas();
    await this.loadProducts();
    this.connectRealtime();
  }

  bindUi() {
    document.querySelector('#cartToggle').addEventListener('click', () => this.cartPanel.classList.add('open'));
    document.querySelector('#cartClose').addEventListener('click', () => this.cartPanel.classList.remove('open'));
    document.querySelector('#checkoutForm').addEventListener('submit', (event) => this.checkout(event));
  }

  bindReveal() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.16 });
    document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
  }

  async loadProducts() {
    const data = await this.api.request('/api/products');
    this.products = data.products;
    this.renderProducts();
  }

  renderProducts() {
    this.grid.innerHTML = this.products.map((product) => `
      <article class="product-card reveal visible" style="--accent: ${product.accent}">
        <div>
          ${product.image_path ? `<img class="product-image" src="${this.escape(product.image_path)}" alt="${this.escape(product.name)}">` : '<div class="product-image product-image-fallback">KS</div>'}
          <div class="product-meta">
            <span>${this.escape(product.category)}</span>
            <span>${product.stock} ks</span>
          </div>
          <h3>${this.escape(product.name)}</h3>
          <p>${this.escape(product.description)}</p>
        </div>
        <div>
          <p class="price">${this.format(product.price_cents)}</p>
          <button class="primary-button" data-add="${product.id}" type="button" ${product.stock < 1 ? 'disabled' : ''}>Přidat do košíku</button>
        </div>
      </article>
    `).join('');
    this.grid.querySelectorAll('[data-add]').forEach((button) => {
      button.addEventListener('click', () => {
        const product = this.products.find((item) => item.id === Number(button.dataset.add));
        this.cart.add(product);
        this.renderCart();
        this.cartPanel.classList.add('open');
      });
    });
  }

  renderCart() {
    this.cartCount.textContent = this.cart.count();
    this.cartTotal.textContent = this.format(this.cart.total());
    const items = [...this.cart.items.values()];
    this.cartItems.innerHTML = items.length ? items.map((item) => `
      <div class="cart-line">
        <span>${this.escape(item.product.name)} x ${item.quantity}</span>
        <strong>${this.format(item.product.price_cents * item.quantity)}</strong>
      </div>
    `).join('') : '<p class="form-message">Košík je prázdný.</p>';
  }

  async checkout(event) {
    event.preventDefault();
    const checkoutForm = event.currentTarget;
    if (!this.cart.count()) return;
    const form = new FormData(checkoutForm);
    try {
      const data = await this.api.request('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName: form.get('customerName'),
          email: form.get('email'),
          items: this.cart.toOrderItems()
        })
      });
      this.renderPayment(data.order);
      this.cart.clear();
      this.renderCart();
      checkoutForm.reset();
      this.cartMessage.textContent = 'Objednávka byla vytvořena. Platební údaje jsou uvedené výše.';
    } catch (error) {
      this.cartMessage.textContent = error.message;
    }
  }

  renderPayment(order) {
    this.paymentBox.classList.remove('hidden');
    this.paymentBox.innerHTML = `
      <strong>Platební údaje</strong>
      <span>Částka: ${this.format(order.total_cents)}</span>
      <span>VS: ${this.escape(order.variable_symbol)}</span>
      <span>Účet: ${this.escape(order.bank_account)}</span>
    `;
  }

  connectRealtime() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    socket.addEventListener('open', () => document.querySelector('#socketStatus').textContent = 'připojeno');
    socket.addEventListener('close', () => document.querySelector('#socketStatus').textContent = 'odpojeno');
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'presence') document.querySelector('#onlineCount').textContent = message.online;
      if (message.type === 'products:update') {
        this.products = message.products;
        this.renderProducts();
      }
    });
  }

  startCanvas() {
    const canvas = document.querySelector('#field');
    const context = canvas.getContext('2d');
    const points = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), vx: Math.random() * 0.001 - 0.0005, vy: Math.random() * 0.001 - 0.0005 }));
    const resize = () => {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
    };
    const frame = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = 'rgba(53, 242, 183, 0.24)';
      context.fillStyle = 'rgba(255, 255, 255, 0.72)';
      points.forEach((point, index) => {
        point.x = (point.x + point.vx + 1) % 1;
        point.y = (point.y + point.vy + 1) % 1;
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        context.beginPath();
        context.arc(x, y, 2 * devicePixelRatio, 0, Math.PI * 2);
        context.fill();
        points.slice(index + 1).forEach((other) => {
          const ox = other.x * canvas.width;
          const oy = other.y * canvas.height;
          const distance = Math.hypot(x - ox, y - oy);
          if (distance < 150 * devicePixelRatio) {
            context.globalAlpha = 1 - distance / (150 * devicePixelRatio);
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(ox, oy);
            context.stroke();
            context.globalAlpha = 1;
          }
        });
      });
      requestAnimationFrame(frame);
    };
    window.addEventListener('resize', resize);
    resize();
    frame();
  }

  format(cents) {
    return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(cents / 100);
  }

  escape(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
}

new Storefront().start();
