# Đồ án Microservices CI/CD trên K3s

Đây là đồ án xây dựng và triển khai một ứng dụng microservices hoàn chỉnh trên cụm K3s on-premises. Trọng tâm của đồ án là mô phỏng quy trình DevOps thực tế từ source code đến môi trường chạy:

```text
Code → Test → Build image → Security scan → GHCR → Deploy K3s → Validation
```

Ứng dụng đang hoạt động tại **https://app1.onprem.site**.

> `auth-service` chỉ mô phỏng đăng nhập để minh họa kiến trúc. Đây không phải hệ thống xác thực production.

## 1. Đồ án làm gì?

Đồ án gồm ba phần chính:

1. **Ứng dụng microservices**
   - Một frontend hiển thị sức khỏe hệ thống, user profile và danh sách sản phẩm.
   - Ba backend độc lập: Auth, User và Product.
   - Người dùng truy cập toàn bộ hệ thống qua một hostname duy nhất.

2. **Đóng gói và vận hành trên Kubernetes**
   - Mỗi component có container image riêng.
   - Traefik định tuyến request theo URL path.
   - Kubernetes quản lý health check, rolling update và tài nguyên.
   - Workload chạy non-root, read-only filesystem và bị giới hạn quyền.

3. **Tự động hóa CI/CD**
   - GitHub Actions test từng component.
   - Build và quét từng image bằng Trivy.
   - Image được gắn bằng full Git SHA, không dùng `latest`.
   - Self-hosted runner triển khai đúng image đã build vào K3s.

## 2. Chức năng ứng dụng

### Frontend dashboard

Frontend có các chức năng:

- kiểm tra trạng thái Auth, User và Product service;
- hiển thị `HEALTHY` hoặc `UNAVAILABLE` cho từng service;
- hiển thị thông tin người dùng mẫu;
- hiển thị danh mục sản phẩm mẫu;
- kiểm tra lại trạng thái bằng nút **Kiểm tra lại**;
- hiển thị trạng thái tổng thể `ALL SYSTEMS HEALTHY` hoặc `DEGRADED`.

Frontend dùng các URL tương đối như `/api/users/profile`. Browser không cần biết ClusterIP hoặc DNS nội bộ của Kubernetes và không phát sinh bài toán CORS giữa nhiều domain.

### Backend APIs

| Service | Method | Endpoint | Chức năng |
| --- | --- | --- | --- |
| Auth | `GET` | `/health` | Health probe nội bộ |
| Auth | `GET` | `/api/auth/health` | Health check qua Ingress |
| Auth | `GET` | `/api/auth/session` | Trả session demo |
| Auth | `POST` | `/api/auth/login` | Mô phỏng login bằng username |
| User | `GET` | `/health` | Health probe nội bộ |
| User | `GET` | `/api/users/health` | Health check qua Ingress |
| User | `GET` | `/api/users/profile` | Trả user profile mẫu |
| Product | `GET` | `/health` | Health probe nội bộ |
| Product | `GET` | `/api/products/health` | Health check qua Ingress |
| Product | `GET` | `/api/products` | Trả danh sách sản phẩm mẫu |
| Tất cả backend | `GET` | `/metrics` | Metrics dạng Prometheus |

## 3. Kiến trúc hệ thống

### Luồng request

```text
Người dùng
    │ HTTPS
    ▼
Cloudflare Edge
    │ Cloudflare Tunnel
    ▼
cloudflared - server-tang3
    │
    ▼
HAProxy - server-tang3
    │
    ▼
Traefik Ingress - K3s
    ├── /                  → frontend
    ├── /api/auth/*        → auth-service
    ├── /api/users/*       → user-service
    └── /api/products/*    → product-service
```

Ba backend chỉ dùng `ClusterIP`, không expose trực tiếp ra Internet. Traefik là điểm route duy nhất của ứng dụng trong cluster.

### Vai trò từng server

| Server | Vai trò |
| --- | --- |
| `server-tang2` | K3s control plane và Kubernetes API |
| `server-tang3` | HAProxy, cloudflared, self-hosted GitHub runner và deploy kubeconfig |
| `server-tang4` | K3s worker chạy frontend, backend và Traefik |

### Luồng CI/CD

```text
Push / Pull Request
        │
        ▼
GitHub-hosted runners
        ├── Test 4 component song song
        ├── Build 4 container image
        └── Trivy scan từng image
                    │
                    ▼
                  GHCR
        image:<full-git-sha>
                    │
                    ▼
Self-hosted runner - server-tang3
        ├── Render manifest bằng exact Git SHA
        ├── kubectl apply
        ├── Chờ rollout
        └── Kiểm tra route qua HAProxy và Traefik
```

## 4. Công nghệ sử dụng

| Thành phần | Công nghệ | Lý do |
| --- | --- | --- |
| Frontend | HTML, CSS, JavaScript, NGINX unprivileged | Nhẹ và ít dependency |
| Backend | Node.js 24 built-in HTTP | Không có dependency runtime bên thứ ba |
| Container registry | GHCR | Tích hợp trực tiếp GitHub Actions |
| CI/CD | GitHub Actions | CI managed, CD qua runner nội bộ |
| Orchestrator | K3s | Kubernetes nhẹ, phù hợp homelab |
| Ingress | Traefik | Có sẵn trong K3s, route theo path |
| Public access | Cloudflare Tunnel | Không mở inbound port trực tiếp |
| Security scan | Trivy | Chặn lỗ hổng `CRITICAL` đã có bản vá |

## 5. Cấu trúc repository

```text
.
├── .github/workflows/ci-cd.yml
├── docs/github-bootstrap.md
├── frontend/
│   ├── app.js
│   ├── Dockerfile
│   ├── frontend.test.js
│   ├── index.html
│   ├── nginx.conf
│   ├── package.json
│   └── styles.css
├── k8s/
│   ├── base/
│   │   ├── auth-service.yaml
│   │   ├── frontend.yaml
│   │   ├── ingress.yaml
│   │   ├── kustomization.yaml
│   │   ├── network-policy.yaml
│   │   ├── product-service.yaml
│   │   └── user-service.yaml
│   └── bootstrap/namespace-rbac.yaml
├── scripts/
│   ├── bootstrap-rbac.sh
│   └── render-manifests.sh
├── services/
│   ├── common/http-service.js
│   ├── auth-service/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── server.js
│   │   └── server.test.js
│   ├── product-service/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── server.js
│   │   └── server.test.js
│   └── user-service/
│       ├── Dockerfile
│       ├── package.json
│       ├── server.js
│       └── server.test.js
├── .dockerignore
├── .gitattributes
├── .gitignore
└── README.md
```

### `.github/` và `docs/`

| File | Chức năng |
| --- | --- |
| `.github/workflows/ci-cd.yml` | Pipeline test, build, Trivy scan, push GHCR và deploy K3s. Các Action được pin bằng commit SHA. |
| `docs/github-bootstrap.md` | Hướng dẫn tạo GitHub repository, GHCR, production environment và self-hosted runner. |

### `frontend/`

| File | Chức năng |
| --- | --- |
| `index.html` | Cấu trúc dashboard và các khu vực hiển thị dữ liệu. |
| `styles.css` | Giao diện responsive và màu trạng thái. |
| `app.js` | Gọi API, cập nhật trạng thái service, profile và sản phẩm. |
| `nginx.conf` | Serve static files trên port `8080`, cung cấp `/health` và security headers. |
| `Dockerfile` | Tạo image từ `nginx-unprivileged`, chạy bằng UID `101`. |
| `frontend.test.js` | Kiểm tra các thành phần và hành vi quan trọng của frontend. |
| `package.json` | Khai báo Node.js version và lệnh test. |

NGINX frontend chỉ serve static files. Việc route `/api/...` đến backend do Traefik Ingress đảm nhiệm.

### `services/`

| File/thư mục | Chức năng |
| --- | --- |
| `common/http-service.js` | HTTP module dùng chung: JSON body, giới hạn 16 KiB, request ID, structured log, health, metrics và graceful shutdown. |
| `auth-service/server.js` | API session và login demo. |
| `user-service/server.js` | API profile người dùng mẫu. |
| `product-service/server.js` | API danh mục sản phẩm mẫu. |
| `*/server.test.js` | Unit/API test của từng backend bằng Node.js test runner. |
| `*/Dockerfile` | Đóng gói từng backend, chạy bằng UID/GID `1000`. |
| `*/package.json` | Khai báo `npm start`, `npm test` và Node.js 24+. |

### `k8s/base/`

| File | Chức năng |
| --- | --- |
| `frontend.yaml` | Deployment 2 replicas và ClusterIP Service cho frontend. |
| `auth-service.yaml` | Deployment và Service cho Auth API. |
| `user-service.yaml` | Deployment và Service cho User API. |
| `product-service.yaml` | Deployment và Service cho Product API. |
| `ingress.yaml` | Route hostname và API path đến đúng Service. |
| `network-policy.yaml` | Default deny và chỉ cho traffic tin cậy từ `kube-system`. |
| `kustomization.yaml` | Gom manifest, đặt namespace và common labels. |

Các Deployment đều có readiness/liveness probe, resource requests/limits, RollingUpdate, non-root user, seccomp, read-only root filesystem và drop Linux capabilities.

### `k8s/bootstrap/` và `scripts/`

| File | Chức năng |
| --- | --- |
| `k8s/bootstrap/namespace-rbac.yaml` | Tạo namespace, `ci-deployer`, token, Role và RoleBinding giới hạn trong namespace ứng dụng. |
| `scripts/bootstrap-rbac.sh` | Dùng admin kubeconfig để bootstrap RBAC và tạo deploy kubeconfig permission `0600`. |
| `scripts/render-manifests.sh` | Thay image registry/tag placeholder bằng image reference cụ thể trước khi deploy. |

Deploy identity không được đọc Secrets, quản lý RBAC hoặc truy cập workload namespace khác.

### Các file ở root

| File | Chức năng |
| --- | --- |
| `.dockerignore` | Giới hạn Docker build context vào frontend và services. |
| `.gitignore` | Chặn credentials, `server.txt`, kubeconfig, `.env` và artifacts local. |
| `.gitattributes` | Chuẩn hóa Git line endings. |
| `README.md` | Tài liệu kiến trúc, setup và vận hành đồ án. |

## 6. Yêu cầu trước khi setup

### Phát triển local

- Git
- Node.js 24+
- npm
- Docker nếu cần build container

### Triển khai

- K3s cluster và `kubectl` tương thích.
- Traefik Ingress Controller.
- Linux self-hosted runner truy cập được Kubernetes API.
- GitHub repository có Actions và GHCR.
- Domain hoặc tunnel chuyển traffic đến Traefik.

Thông số của môi trường hiện tại:

| Thành phần | Giá trị |
| --- | --- |
| Namespace | `microservices-demo` |
| Hostname | `app1.onprem.site` |
| K3s API qua HAProxy | `https://192.168.30.45:6443` |
| Worker | `server-tang4` |
| Runner label | `k3s-deploy` |

## 7. Setup và chạy local

### Clone repository

```bash
git clone https://github.com/Kien-devops/app1.git
cd app1
```

### Chạy test

Project hiện không có package dependency bên thứ ba nên không cần `npm install`.

```bash
npm test --prefix frontend
npm test --prefix services/auth-service
npm test --prefix services/user-service
npm test --prefix services/product-service
```

### Chạy ba backend

Mở ba PowerShell terminal:

```powershell
# Terminal 1
$env:PORT=8081
npm.cmd start --prefix services/auth-service

# Terminal 2
$env:PORT=8082
npm.cmd start --prefix services/user-service

# Terminal 3
$env:PORT=8083
npm.cmd start --prefix services/product-service
```

Kiểm tra API:

```powershell
curl.exe http://localhost:8081/api/auth/health
curl.exe http://localhost:8082/api/users/profile
curl.exe http://localhost:8083/api/products
```

Trên Windows, dùng `npm.cmd` nếu PowerShell Execution Policy chặn `npm.ps1`.

### Build container images

Docker build context phải là repository root vì backend dùng `services/common/`.

```bash
docker build -f frontend/Dockerfile -t local/frontend:dev .
docker build -f services/auth-service/Dockerfile -t local/auth-service:dev .
docker build -f services/user-service/Dockerfile -t local/user-service:dev .
docker build -f services/product-service/Dockerfile -t local/product-service:dev .
```

Smoke test một container:

```bash
docker run --rm -p 8080:8080 local/frontend:dev
docker run --rm -p 8081:8080 local/auth-service:dev
```

> Frontend chạy riêng chỉ kiểm tra giao diện và `/health`. Dashboard cần route `/api/...` của Traefik để hoạt động đầy đủ.

## 8. Setup Kubernetes và deploy identity

Chạy một lần trên `server-tang3` bằng admin kubeconfig:

```bash
cd /path/to/app1
ADMIN_KUBECONFIG=/home/monitor/.kube/config \
  sh scripts/bootstrap-rbac.sh
```

Script tạo kubeconfig riêng cho CI/CD:

```text
/home/monitor/.kube/microservices-demo-deployer.config
```

Xác minh quyền:

```bash
export KUBECONFIG=/home/monitor/.kube/microservices-demo-deployer.config

kubectl auth can-i patch deployments -n microservices-demo
# yes

kubectl auth can-i get secrets -n microservices-demo
# no

kubectl auth can-i get pods -n default
# no
```

Không cho runner sử dụng admin kubeconfig.

## 9. Setup GitHub Actions, GHCR và runner

### GitHub

1. Bật GitHub Actions.
2. Tạo GitHub Environment tên `production`.
3. Nên bảo vệ branch `main` và yêu cầu CI pass trước merge.
4. Không cho pull request không tin cậy chạy trên self-hosted runner.

### GHCR images

```text
ghcr.io/<owner>/<repo>/frontend:<git-sha>
ghcr.io/<owner>/<repo>/auth-service:<git-sha>
ghcr.io/<owner>/<repo>/user-service:<git-sha>
ghcr.io/<owner>/<repo>/product-service:<git-sha>
```

Nên đặt package là `public` để K3s pull image mà không lưu PAT dài hạn. Nếu package private, dùng pull-only credential trong Kubernetes Secret và rotate định kỳ.

### Self-hosted runner

Vào `Settings → Actions → Runners → New self-hosted runner` và cài runner trên `server-tang3`:

| Thuộc tính | Giá trị |
| --- | --- |
| Name | `server-tang3-k3s-deploy` |
| Labels | `self-hosted`, `Linux`, `X64`, `k3s-deploy` |
| Service user | `monitor` |
| Work directory | `_work` |

Runner chỉ cần outbound HTTPS đến GitHub. Hướng dẫn chi tiết: [`docs/github-bootstrap.md`](docs/github-bootstrap.md).

### Public hostname

Cloudflare Tunnel map:

```text
app1.onprem.site → http://localhost:80
```

Không expose Kubernetes API `:6443` ra Internet và không tạo NodePort riêng cho backend.

## 10. Deploy

### Tự động

Push `main` sẽ kích hoạt pipeline:

```bash
git push origin main
```

Deploy chỉ chạy sau khi toàn bộ test, build, scan và push image thành công.

### Thủ công có kiểm soát

```bash
export KUBECONFIG=/home/monitor/.kube/microservices-demo-deployer.config
export IMAGE_REGISTRY=ghcr.io/kien-devops/app1
export IMAGE_TAG=<full-git-sha>

sh scripts/render-manifests.sh rendered
kubectl apply -k rendered

for app in frontend auth-service user-service product-service; do
  kubectl rollout status deployment/$app -n microservices-demo --timeout=180s
done
```

Không dùng `latest`. `IMAGE_TAG` phải là full Git SHA đã tồn tại trên GHCR.

## 11. Kiểm tra sau deploy

### Kubernetes resources

```bash
kubectl get deployments,pods,services,endpointslices,ingress \
  -n microservices-demo -o wide
```

Kết quả mong đợi:

- frontend `2/2` Ready;
- ba backend `1/1` Ready;
- tất cả Pod `Running`;
- mỗi Service có EndpointSlice;
- Ingress nhận host `app1.onprem.site`.

### Internal route

```bash
curl -H 'Host: app1.onprem.site' http://192.168.30.45/
curl -H 'Host: app1.onprem.site' http://192.168.30.45/api/auth/health
curl -H 'Host: app1.onprem.site' http://192.168.30.45/api/users/health
curl -H 'Host: app1.onprem.site' http://192.168.30.45/api/products/health
```

### Public route

```bash
curl --fail https://app1.onprem.site/
curl --fail https://app1.onprem.site/api/auth/health
curl --fail https://app1.onprem.site/api/users/health
curl --fail https://app1.onprem.site/api/products/health
```

Chỉ coi release thành công khi rollout hoàn tất và cả bốn route trả HTTP `200`.

## 12. Logging, metrics và vận hành

- Backend ghi JSON log gồm timestamp, service, path, status, latency và request ID.
- NGINX ghi access/error log ra stdout/stderr.
- Kubernetes dùng `/health` làm readiness/liveness probe.
- Backend expose `/metrics` theo Prometheus text format.

```bash
kubectl logs -n microservices-demo deployment/auth-service --tail=100
kubectl logs -n microservices-demo deployment/user-service --tail=100
kubectl logs -n microservices-demo deployment/product-service --tail=100
```

NetworkPolicy chưa cho Prometheus scrape trực tiếp. Khi tích hợp Prometheus cần thêm allow rule rõ ràng.

## 13. Rollback

Rollback nhanh một Deployment:

```bash
kubectl rollout history deployment/frontend -n microservices-demo
kubectl rollout undo deployment/frontend -n microservices-demo
kubectl rollout status deployment/frontend -n microservices-demo --timeout=180s
```

Rollback đồng bộ nên revert commit lỗi rồi chạy lại pipeline:

```bash
git revert <bad-commit-sha>
git push origin main
```

Cách này giữ lịch sử thay đổi rõ ràng và đảm bảo cả bốn component dùng một known-good Git SHA.

## 14. Troubleshooting

Kiểm tra theo đúng luồng request:

```text
DNS / Cloudflare Tunnel
  → HAProxy
  → Traefik Ingress
  → ClusterIP Service
  → EndpointSlice
  → Pod readiness
  → Application logs
```

| Hiện tượng | Nguyên nhân thường gặp | Kiểm tra |
| --- | --- | --- |
| `404` | Hostname hoặc Ingress path sai | `kubectl describe ingress` |
| `502/503` | Service không có ready endpoint | Selector, EndpointSlice, probes |
| `ImagePullBackOff` | Image private hoặc SHA sai | Pod events và GHCR package |
| Rollout timeout | Container crash hoặc probe fail | `kubectl describe pod`, logs |
| Internal chạy, public lỗi | Cloudflare hostname/tunnel sai | cloudflared logs và mapping |
| Runner không deploy | Runner offline, label/RBAC sai | Runner service và `auth can-i` |

```bash
kubectl describe ingress microservices-demo -n microservices-demo
kubectl get endpointslices -n microservices-demo
kubectl get events -n microservices-demo --sort-by=.lastTimestamp
kubectl logs -n microservices-demo deployment/auth-service --tail=100
```

## 15. Bảo mật và giới hạn

Đã áp dụng:

- không commit `server.txt`, token, password, kubeconfig hoặc private key;
- container non-root, read-only filesystem và không privilege escalation;
- application Pod không mount ServiceAccount token;
- default-deny NetworkPolicy;
- namespace-scoped RBAC cho CI/CD;
- self-hosted runner không chạy pull request job;
- image được version bằng immutable Git SHA.

Giới hạn hiện tại:

- Auth chỉ là demo, không dùng cho danh tính thật.
- User và Product dùng dữ liệu tĩnh, chưa có database.
- Một control plane và một worker nên chưa high availability.
- Hai frontend replica vẫn cùng nằm trên `server-tang4`.
- Deploy kubeconfig dùng long-lived token và cần rotate định kỳ.
- Chưa có autoscaling, distributed tracing hoặc automated backup.

Nếu phát triển thành production, cần bổ sung IdP/OIDC, database, secret management, rate limiting/WAF, centralized observability, nhiều control plane/worker, backup và disaster recovery.
