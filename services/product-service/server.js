'use strict';

const { createHttpService, startServer } = require('../common/http-service');

const serviceName = 'product-service';
const products = Object.freeze([
  {
    id: 'prd-001',
    name: 'K3s Core Bundle',
    category: 'Hạ tầng (K8s)',
    description: 'Control plane & worker container runtime, ServiceLB và Traefik ingress controller.',
    version: 'v1.31',
    status: 'Ready',
    price: 19,
    currency: 'USD',
  },
  {
    id: 'prd-002',
    name: 'CI/CD Pipeline Engine',
    category: 'Tự động hóa',
    description: 'Pipeline GitHub Actions test, Trivy scan, GHCR container registry và deploy tự động.',
    version: 'v2.4',
    status: 'Active',
    price: 39,
    currency: 'USD',
  },
  {
    id: 'prd-003',
    name: 'Observability & Telemetry',
    category: 'Giám sát',
    description: 'Prometheus metrics endpoint (/metrics), health probes và structured logging.',
    version: 'v1.8',
    status: 'Ready',
    price: 29,
    currency: 'USD',
  },
]);
const healthy = () => ({ body: { status: 'healthy', service: serviceName } });

const handler = createHttpService({
  name: serviceName,
  routes: {
    'GET /api/products/health': healthy,
    'GET /api/products': async () => ({ body: { items: products, count: products.length } }),
  },
});

if (require.main === module) startServer(handler, serviceName);

module.exports = { handler };

