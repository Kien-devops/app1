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

function setServiceState(service, healthy) {
  const card = document.querySelector(`[data-service="${service}"]`);
  card.classList.toggle('healthy', healthy);
  card.classList.toggle('failed', !healthy);
  card.querySelector('.status').textContent = healthy ? 'HEALTHY' : 'UNAVAILABLE';
}

async function refresh() {
  const refreshButton = document.querySelector('#refresh');
  refreshButton.disabled = true;

  const checks = await Promise.allSettled(
    Object.entries(endpoints).map(async ([service, path]) => {
      const result = await getJson(path);
      const healthy = result.status === 'healthy';
      setServiceState(service, healthy);
      return healthy;
    }),
  );

  const allHealthy = checks.every((result) => result.status === 'fulfilled' && result.value);
  for (const [index, service] of Object.keys(endpoints).entries()) {
    if (checks[index].status === 'rejected') setServiceState(service, false);
  }

  try {
    const [profile, catalogue] = await Promise.all([
      getJson('/api/users/profile'),
      getJson('/api/products'),
    ]);
    document.querySelector('#user-name').textContent = profile.displayName;
    document.querySelector('#user-meta').textContent = `${profile.email} · ${profile.roles.join(', ')}`;
    document.querySelector('#products').replaceChildren(...catalogue.items.map((product) => {
      const item = document.createElement('div');
      item.className = 'product';
      const name = document.createElement('strong');
      name.textContent = product.name;
      const price = document.createElement('span');
      price.textContent = `${product.price} ${product.currency}`;
      item.append(name, price);
      return item;
    }));
  } catch {
    document.querySelector('#user-name').textContent = 'Không khả dụng';
    document.querySelector('#products').textContent = 'Không thể tải dữ liệu.';
  }

  const overall = document.querySelector('#overall');
  overall.textContent = allHealthy ? 'ALL SYSTEMS HEALTHY' : 'DEGRADED';
  overall.classList.toggle('failed', !allHealthy);
  document.querySelector('#checked-at').textContent = `Cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
  refreshButton.disabled = false;
}

document.querySelector('#refresh').addEventListener('click', refresh);
refresh();
