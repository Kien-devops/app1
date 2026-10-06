# Đồ án Microservices CI/CD trên K3s

Đây là đồ án xây dựng và triển khai một ứng dụng microservices hoàn chỉnh trên cụm K3s on-premises. Cụm K3s, HAProxy, Traefik và ServiceLB bên dưới được dựng và quản lý bằng repository [`Kien-devops/k3s-onprem`](https://github.com/Kien-devops/k3s-onprem); repository `app1` quản lý source code và vòng đời release của ứng dụng. Trọng tâm của đồ án là mô phỏng quy trình DevOps thực tế từ source code đến môi trường chạy:

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
   - GitHub Actions phát hiện path thay đổi và chỉ test component liên quan.
   - Chỉ build và quét các image bị ảnh hưởng bằng Trivy.
   - Image được gắn bằng full Git SHA, không dùng `latest`.
   - Self-hosted runner chỉ triển khai Deployment hoặc cấu hình K3s đã thay đổi.

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
| `server-tang2` | K3s control plane, Kubernetes API và SQLite datastore |
| `server-tang3` | Ansible controller, HAProxy, cloudflared, monitoring, self-hosted GitHub runner và deploy kubeconfig |
| `server-tang4` | K3s ingress/application worker chạy Traefik, ServiceLB và một replica của mỗi Deployment |
| `server-tang1` | K3s ingress/application worker chạy Traefik, ServiceLB và một replica của mỗi Deployment |

Đây chưa phải Kubernetes High Availability hoàn chỉnh: tang2 là control plane duy nhất và tang3 là edge/HAProxy duy nhất. Ingress và application Pods được phân tán trên tang1/tang4 để tiếp tục phục vụ khi một worker lỗi.

### Quan hệ với repository `k3s-onprem`

Ứng dụng không tự cài K3s hoặc tạo hạ tầng cluster. Nền tảng phải được dựng và kiểm tra trước bằng repository [`k3s-onprem`](https://github.com/Kien-devops/k3s-onprem):

```text
k3s-onprem
  -> quản lý server-tang1 / tang2 / tang3 / tang4
  -> cài K3s control plane trên tang2 và workers trên tang1/tang4
  -> cấu hình HAProxy, ServiceLB và Traefik
  -> kiểm tra cluster và ingress data path
                    |
                    v
app1
  -> phát hiện component thay đổi
  -> test, build và push đúng image bị ảnh hưởng
  -> deploy chọn lọc vào namespace microservices-demo
  -> kiểm tra ứng dụng qua hạ tầng có sẵn
```

| Repository | Trách nhiệm |
| --- | --- |
| [`k3s-onprem`](https://github.com/Kien-devops/k3s-onprem) | Ansible inventory/playbooks, K3s nodes, Kubernetes API endpoint, HAProxy, Traefik, ServiceLB và platform validation |
| [`app1`](https://github.com/Kien-devops/app1) | Source code, tests, Dockerfiles, GHCR images, application manifests, namespace-scoped RBAC và CI/CD release |

`playbooks/site.yml` của `k3s-onprem` không deploy hoặc rollback `app1`. Ngược lại, pipeline `app1` không cài lại K3s, không sửa HAProxy và không quản lý workload của ứng dụng khác. Tài liệu nhìn từ phía cluster nằm tại [`k3s-onprem/docs/app1-microservices.md`](https://github.com/Kien-devops/k3s-onprem/blob/main/docs/app1-microservices.md).

### Luồng CI/CD

```text
Pull Request
    │
    ▼
Change Detection
    │
    ▼
Changed Services
    │
    └── Test → Build → Trivy

Không push image và không sử dụng self-hosted deploy runner.
```

```text
Push / merge vào main
    │
    ▼
Change Detection
    │
    ▼
Changed Services
    │
    └── Test → Build → Trivy → GHCR → K3s
                                      │
                                      ├── apply resource đã đổi
                                      ├── chờ rollout đã đổi
                                      └── kiểm tra route liên quan
```

Pipeline gồm một workflow điều phối và bốn reusable workflow. Mỗi nhánh component
chạy độc lập với `fail-fast` không làm mất kết quả của component khác. Job không liên
quan xuất hiện ở trạng thái `skipped`, không phải `failed`. Image được push theo dạng
`ghcr.io/<owner>/<repo>/<component>:<full-git-sha>`; pipeline không tạo tag `latest`.

#### Quy tắc path filter

| Path thay đổi | Test/build/scan image | Deploy |
| --- | --- | --- |
| `frontend/**` | frontend | frontend với image SHA mới |
| `services/auth-service/**` | auth-service | auth-service với image SHA mới |
| `services/user-service/**` | user-service | user-service với image SHA mới |
| `services/product-service/**` | product-service | product-service với image SHA mới |
| `services/common/**` | auth, user, product | ba backend với image SHA mới |
| `.dockerignore` | cả bốn component | cả bốn component với image SHA mới |
| `k8s/base/<component>.yaml` | không build image | chỉ apply component đó, giữ nguyên image đang chạy |
| `k8s/base/ingress.yaml`, `network-policy.yaml` hoặc file shared mới trong `k8s/base/` | không build image | apply shared base với image hiện tại; kiểm tra toàn bộ route |
| `k8s/base/kustomization.yaml` | không build image | apply toàn bộ base và chờ cả bốn Deployment vì label/selector có thể đổi |
| `.github/workflows/**`, `scripts/**`, `k8s/bootstrap/**`, `docs/**`, `README.md` | không build image | không tự động deploy production |

`.dockerignore` ảnh hưởng Docker context dùng chung nên phải rebuild cả bốn image.
Ngược lại, các file workflow hoặc tài liệu được GitHub parse/chạy ở lớp orchestration
nhưng không làm thay đổi nội dung image. `k8s/bootstrap/**` vẫn là thao tác quản trị
thủ công vì deploy identity cố ý không có quyền sửa Namespace, Role hoặc RoleBinding.

Khi chỉ manifest của một component thay đổi, workflow đọc image hiện đang chạy từ
Deployment, render một Kustomize bundle chỉ chứa component đó và apply bundle này.
Vì vậy thay đổi `auth-service.yaml` không tạo SHA image không tồn tại và không chạm
vào Pod template của frontend, user-service hoặc product-service. Với shared manifest,
workflow render toàn bộ base bằng chính image hiện tại của component không rebuild;
`kubectl apply` không rollout Deployment nếu Pod template không thay đổi.

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
├── .github/workflows/
│   ├── build-publish-service.yml
│   ├── ci-cd.yml
│   ├── deploy-service.yml
│   ├── detect-changes.yml
│   └── test-service.yml
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
| `.github/workflows/ci-cd.yml` | Điều phối các reusable workflow cho pull request và `main`; giữ concurrency production không hủy job đang chạy. |
| `.github/workflows/detect-changes.yml` | So sánh base/head commit và xuất cờ build/deploy theo path. |
| `.github/workflows/test-service.yml` | Chạy test Node.js 24 cho component được truyền vào. |
| `.github/workflows/build-publish-service.yml` | Build từ root context, quét Trivy và chỉ push GHCR trên `main`. |
| `.github/workflows/deploy-service.yml` | Render/apply chọn lọc trên runner `k3s-deploy`, kiểm tra RBAC, rollout, replica và route liên quan. |
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
| `frontend.yaml` | Deployment 2 replicas phân tán theo node và ClusterIP Service cho frontend. |
| `auth-service.yaml` | Deployment 2 replicas phân tán theo node và Service cho Auth API. |
| `user-service.yaml` | Deployment 2 replicas phân tán theo node và Service cho User API. |
| `product-service.yaml` | Deployment 2 replicas phân tán theo node và Service cho Product API. |
| `ingress.yaml` | Route hostname và API path đến đúng Service. |
| `network-policy.yaml` | Default deny và chỉ cho traffic tin cậy từ `kube-system`. |
| `kustomization.yaml` | Gom manifest, đặt namespace và common labels. |

Các Deployment đều có readiness/liveness probe, resource requests/limits, RollingUpdate, non-root user, seccomp, read-only root filesystem và drop Linux capabilities. `topologySpreadConstraints` với `DoNotSchedule` bắt buộc cân bằng một replica trên mỗi worker; `maxSurge: 0` và `maxUnavailable: 1` ngăn Pod cũ làm sai lệch topology khi rollout. Khi chỉ còn một worker khả dụng, replica thứ hai có thể ở trạng thái `Pending` thay vì phá vỡ failure-domain isolation.

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
| K3s control plane | `server-tang2` |
| K3s application workers | `server-tang1`, `server-tang4` |
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

Deploy chỉ chạy sau khi test, build, scan và push của mọi component bị ảnh hưởng
thành công. Component không đổi không bị build, retag hoặc rollout. Thay đổi chỉ ở
manifest Kubernetes dùng image hiện đang chạy và không push image mới.

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

Cách này giữ lịch sử thay đổi rõ ràng. Pipeline chọn lọc sẽ chỉ đưa component bị
ảnh hưởng về image SHA của commit revert; các component không liên quan tiếp tục
chạy image immutable đã được xác nhận trước đó.

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
- Một control plane và một edge node vẫn là các single point of failure. Nếu tang2 lỗi thì API/SQLite và khả năng reconcile mất; nếu tang3 lỗi thì public edge và HAProxy mất.
- Nếu tang3 lỗi, cluster vẫn chạy nội bộ nhưng stable API endpoint, Cloudflare Tunnel và public application route bị gián đoạn.
- Mỗi Deployment có hai replica và bắt buộc phân tán một Pod trên tang1, một Pod trên tang4; cùng với hai Traefik/ServiceLB replica, thiết kế này chịu được lỗi một worker nhưng không thay thế control-plane/edge HA.
- Deploy kubeconfig dùng long-lived token và cần rotate định kỳ.
- Chưa có autoscaling, distributed tracing hoặc automated backup.

Nếu phát triển thành production, cần bổ sung IdP/OIDC, database, secret management, rate limiting/WAF, centralized observability, nhiều control plane/worker, backup và disaster recovery.
