'use strict';

const endpoints = {
  auth: '/api/auth/health',
  users: '/api/users/health',
  products: '/api/products/health',
};

async function getJson(path) {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

function setServiceState(service, healthy, latencyMs = null) {
  const card = document.querySelector(`[data-service="${service}"]`);
  if (!card) return;
  card.classList.toggle('healthy', healthy);
  card.classList.toggle('failed', !healthy);
  card.querySelector('.status').textContent = healthy ? 'HEALTHY' : 'UNAVAILABLE';

  const latencyElem = card.querySelector(`[data-latency="${service}"]`);
  if (latencyElem) {
    if (healthy && latencyMs !== null) {
      latencyElem.textContent = `${latencyMs}ms`;
      latencyElem.classList.remove('latency-warn');
    } else {
      latencyElem.textContent = 'Lỗi kết nối';
      latencyElem.classList.add('latency-warn');
    }
  }
}

async function refresh() {
  const refreshButton = document.querySelector('#refresh');
  if (refreshButton) refreshButton.disabled = true;

  const checks = await Promise.allSettled(
    Object.entries(endpoints).map(async ([service, path]) => {
      const start = performance.now();
      const result = await getJson(path);
      const latency = Math.round(performance.now() - start);
      const healthy = result.status === 'healthy';
      setServiceState(service, healthy, latency);
      return healthy;
    }),
  );

  const allHealthy = checks.every((result) => result.status === 'fulfilled' && result.value);
  for (const [index, service] of Object.keys(endpoints).entries()) {
    if (checks[index].status === 'rejected') setServiceState(service, false, null);
  }

  try {
    const [profile, catalogue] = await Promise.all([
      getJson('/api/users/profile'),
      getJson('/api/products'),
    ]);

    // Update Profile Information
    const userNameElem = document.querySelector('#user-name');
    if (userNameElem) userNameElem.textContent = profile.displayName || 'Người dùng Demo';

    const userMetaElem = document.querySelector('#user-meta');
    if (userMetaElem) {
      userMetaElem.textContent = `${profile.email} · ${Array.isArray(profile.roles) ? profile.roles.join(', ') : 'viewer'}`;
    }

    const avatarElem = document.querySelector('#user-avatar');
    if (avatarElem && profile.displayName) {
      const initials = profile.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      avatarElem.textContent = initials || 'DU';
    }

    if (profile.namespace && document.querySelector('#attr-namespace')) {
      document.querySelector('#attr-namespace').textContent = profile.namespace;
    }
    if (profile.clusterNode && document.querySelector('#attr-node')) {
      document.querySelector('#attr-node').textContent = profile.clusterNode;
    }

    // Update Product Catalogue
    const productsContainer = document.querySelector('#products');
    if (productsContainer && Array.isArray(catalogue.items)) {
      productsContainer.replaceChildren(
        ...catalogue.items.map((product) => {
          const item = document.createElement('div');
          item.className = 'product-card product';

          const topRow = document.createElement('div');
          topRow.className = 'product-top';

          const name = document.createElement('strong');
          name.className = 'product-title';
          name.textContent = product.name;

          const price = document.createElement('span');
          price.className = 'product-price';
          price.textContent = `${product.price} ${product.currency}`;

          topRow.append(name, price);

          const desc = document.createElement('p');
          desc.className = 'product-desc';
          desc.textContent = product.description || 'Gói dịch vụ cấu hình cho môi trường Kubernetes On-Prem.';

          const footer = document.createElement('div');
          footer.className = 'product-footer';

          const badge = document.createElement('span');
          badge.className = 'category-pill';
          badge.textContent = product.category || 'Platform';

          const version = document.createElement('span');
          version.className = 'version-tag';
          version.textContent = product.version || 'v1.0';

          footer.append(badge, version);
          item.append(topRow, desc, footer);
          return item;
        }),
      );
    }
  } catch {
    const userNameElem = document.querySelector('#user-name');
    if (userNameElem) userNameElem.textContent = 'Không khả dụng';
    const productsContainer = document.querySelector('#products');
    if (productsContainer) productsContainer.textContent = 'Không thể tải dữ liệu từ Product Service.';
  }

  const overall = document.querySelector('#overall');
  if (overall) {
    overall.textContent = allHealthy ? 'ALL SYSTEMS HEALTHY' : 'DEGRADED';
    overall.classList.toggle('failed', !allHealthy);
  }

  const checkedAt = document.querySelector('#checked-at');
  if (checkedAt) {
    checkedAt.textContent = `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN')}`;
  }

  if (refreshButton) refreshButton.disabled = false;
}

// Interactive Auth Login Form Test
const loginForm = document.querySelector('#auth-login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const usernameInput = document.querySelector('#login-username');
    const resultBox = document.querySelector('#auth-result-box');
    const submitBtn = document.querySelector('#btn-login');
    const username = usernameInput ? usernameInput.value.trim() : '';

    if (!username) return;

    if (submitBtn) submitBtn.disabled = true;
    if (resultBox) {
      resultBox.className = 'auth-result auth-result-loading';
      resultBox.textContent = 'Đang gửi yêu cầu xác thực…';
      resultBox.classList.remove('hidden');
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Xác thực thất bại');

      if (resultBox) {
        resultBox.className = 'auth-result auth-result-success';
        resultBox.innerHTML = `
          <strong>Đăng nhập demo thành công!</strong>
          <div>Principal: <code>${data.principal}</code> · Token: <code>${data.sessionToken || data.session}</code></div>
          <small class="muted">${data.warning || ''}</small>
        `;
      }

      // Update avatar & name
      const userNameElem = document.querySelector('#user-name');
      if (userNameElem) userNameElem.textContent = `${data.principal} (Demo Session)`;
      const avatarElem = document.querySelector('#user-avatar');
      if (avatarElem) avatarElem.textContent = data.principal.slice(0, 2).toUpperCase();

    } catch (err) {
      if (resultBox) {
        resultBox.className = 'auth-result auth-result-error';
        resultBox.textContent = `Lỗi: ${err.message}`;
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

document.querySelector('#refresh').addEventListener('click', refresh);
refresh();

