# K3s Microservices CI/CD Demo

Ứng dụng microservices nhỏ nhưng có đầy đủ chuỗi delivery thực tế cho homelab K3s:

- một frontend tĩnh chạy bằng NGINX non-root;
- ba backend Node.js độc lập: `auth-service`, `user-service`, `product-service`;
- bốn immutable container image trên GHCR;
- GitHub-hosted runner chạy test, build và security scan;
- self-hosted runner trên `server-tang3` chỉ thực hiện CD;
- Kubernetes namespace/RBAC riêng và public route cố định `https://app1.onprem.site`.

Đây là demo kỹ thuật. `auth-service` chỉ mô phỏng login, không phải hệ thống xác thực production.

## 1. Tổng quan kiến trúc

```text
Developer
   |
   v
GitHub
   |
   +----------------------------+
   |                            |
   v                            v
CI                             CD
GitHub-hosted                  Self-hosted tang3
Test -> Build -> Trivy         Kubeconfig giới hạn RBAC
   |                            |
   v                            v
GHCR                       HAProxy :6443
                                |
                                v
                          K3s API tang2
                                |
                                v
                          Worker tang4
                                |
                  +-------------+-------------+
                  |             |      |      |
                  v             v      v      v
                 FE           Auth    User  Product
```

Luồng public traffic:

```text
Internet
   |
Cloudflare Edge
   |
Cloudflare Tunnel (outbound từ tang3)
   |
cloudflared tang3 -> http://localhost:80
   |
HAProxy tang3 :80
   |
ServiceLB / Traefik tang4
   |
   +-- /api/auth*     -> auth-service:80
   +-- /api/users*    -> user-service:80
   +-- /api/products* -> product-service:80
   `-- /*             -> frontend:80
```

HAProxy chỉ forward `:80/:443` tới Traefik. Mỗi ứng dụng mới chỉ cần Ingress rule, không cần thêm HAProxy backend.

## 2. Cấu trúc repository

```text
.
|-- .github/workflows/ci-cd.yml
|-- frontend/
|   |-- index.html
|   |-- app.js
|   |-- styles.css
|   |-- nginx.conf
|   `-- Dockerfile
|-- services/
|   |-- common/http-service.js
|   |-- auth-service/
|   |-- user-service/
|   `-- product-service/
|-- k8s/
|   |-- bootstrap/namespace-rbac.yaml
|   `-- base/
|-- scripts/
|   |-- bootstrap-rbac.sh
|   `-- render-manifests.sh
`-- docs/github-bootstrap.md
```

## 3. Technology stack và lý do lựa chọn

| Thành phần | Lựa chọn | Lý do |
| --- | --- | --- |
| Frontend | HTML/CSS/JavaScript + NGINX unprivileged | RAM thấp, không cần runtime framework |
| Backend | Node.js built-in HTTP | Không có dependency production, build nhanh, attack surface nhỏ |
| Container | Alpine-based, non-root | Image nhỏ, phù hợp worker homelab |
| Orchestrator | K3s | Tận dụng cluster hiện hữu |
| Ingress | Traefik bundled with K3s | Không thêm controller hoặc HAProxy rule theo app |
| Registry | GHCR | Tích hợp trực tiếp với GitHub Actions |
| CI/CD | GitHub Actions | CI managed; CD có network path nội bộ tới K3s API |

Trade-off chính: cluster chỉ có một control plane, một worker và một HAProxy endpoint. Hai frontend replicas bảo vệ khỏi process/pod failure nhưng không bảo vệ khỏi mất tang4. Đây không phải HA production.

## 4. Trách nhiệm microservices

### Auth service

- `GET /health`: probe nội bộ.
- `GET /api/auth/health`: health qua Ingress.
- `GET /api/auth/session`: demo session.
- `POST /api/auth/login`: demo login, không kiểm tra mật khẩu thật.
- `GET /metrics`: Prometheus text format nội bộ.

### User service

- `GET /health` và `GET /api/users/health`.
- `GET /api/users/profile` trả profile mẫu.
- `GET /metrics`.

### Product service

- `GET /health` và `GET /api/products/health`.
- `GET /api/products` trả catalogue mẫu.
- `GET /metrics`.

Frontend không gọi Kubernetes DNS hoặc IP nội bộ. Tất cả request browser dùng relative URL `/api/...`, do đó không cần CORS và cùng đi qua một security boundary.

## 5. Local development và test

Yêu cầu Node.js 24+; project không cần `npm install` vì không có third-party dependency.

```bash
npm test --prefix frontend
npm test --prefix services/auth-service
npm test --prefix services/user-service
npm test --prefix services/product-service

PORT=8081 node services/auth-service/server.js
PORT=8082 node services/user-service/server.js
PORT=8083 node services/product-service/server.js
```

Frontend có thể được serve bằng NGINX container; khi chạy độc lập, API path vẫn cần reverse proxy hoặc services tương ứng.

## 6. Docker architecture

Build context là repository root để backend dùng chung module HTTP:

```bash
docker build -f frontend/Dockerfile -t local/frontend:test .
docker build -f services/auth-service/Dockerfile -t local/auth-service:test .
docker build -f services/user-service/Dockerfile -t local/user-service:test .
docker build -f services/product-service/Dockerfile -t local/product-service:test .
```

Các runtime đều:

- chạy non-root;
- không chứa source secret hoặc credentials;
- không có package production bên thứ ba;
- lắng nghe port `8080`;
- dùng Kubernetes probe làm nguồn health chính.

CI gắn image bằng Git SHA:

```text
ghcr.io/<owner>/<repo>/frontend:<git-sha>
ghcr.io/<owner>/<repo>/auth-service:<git-sha>
ghcr.io/<owner>/<repo>/user-service:<git-sha>
ghcr.io/<owner>/<repo>/product-service:<git-sha>
```

Không deploy tag `latest`.

## 7. Kubernetes architecture và manifests

Namespace duy nhất: `microservices-demo`.

| Workload | Replicas | Service | Scheduling |
| --- | ---: | --- | --- |
| frontend | 2 | ClusterIP | `server-tang4` |
| auth-service | 1 | ClusterIP | `server-tang4` |
| user-service | 1 | ClusterIP | `server-tang4` |
| product-service | 1 | ClusterIP | `server-tang4` |

Mỗi Deployment có readiness/liveness probe, CPU/memory requests và limits, `RollingUpdate`, `runAsNonRoot`, `seccompProfile: RuntimeDefault`, drop Linux capabilities và read-only root filesystem.

Render manifest bằng image registry/tag cụ thể:

```bash
export IMAGE_REGISTRY=ghcr.io/<owner>/<repo>
export IMAGE_TAG=<full-git-sha>
sh scripts/render-manifests.sh rendered
kubectl apply -k rendered
```

## 8. CI flow

```text
push / pull request
   -> 4 test jobs song song
   -> 4 Docker build jobs song song
   -> Trivy scan từng image
   -> push GHCR chỉ khi push main
```

Security gate fail khi có vulnerability `CRITICAL` đã có bản vá. `HIGH` vẫn cần được review nhưng không block homelab để tránh pipeline bị treo do base-image issue chưa thể xử lý. Có thể nâng gate lên `HIGH,CRITICAL` khi image baseline sạch.

Source artifact là Git commit được checkout. Build artifact là bốn container image. Deployment artifact là cùng bốn image immutable theo Git SHA cộng với manifest đã render.

## 9. CD flow

Deploy job chỉ chạy sau khi cả bốn image đã test, scan và push thành công:

```text
GitHub main push
   -> self-hosted runner tang3
   -> render exact SHA
   -> kubectl apply qua 192.168.30.45:6443
   -> Deployment tạo ReplicaSet mới
   -> readiness probe PASS
   -> Service chuyển traffic
   -> Pod cũ terminate
   -> internal HTTP acceptance test
```

Job chạy trên labels `[self-hosted, Linux, X64, k3s-deploy]`, không chạy với pull request và không SSH vào tang2.

## 10. GitHub-hosted và self-hosted runner

GitHub-hosted runner thực thi code build/test có thể thay đổi theo commit. Self-hosted runner chỉ chạy deploy từ protected `main`, vì nó có đường mạng tới cluster và kubeconfig giới hạn quyền.

Không mở inbound port cho runner. Runner chủ động kết nối outbound HTTPS tới GitHub. Hướng dẫn bootstrap ở [docs/github-bootstrap.md](docs/github-bootstrap.md).

## 11. GHCR

Workflow dùng `GITHUB_TOKEN` với `packages: write`, chỉ trong build job. Package nên đặt visibility `public` để K3s pull mà không lưu PAT dài hạn. Nếu bắt buộc private, dùng một read-only pull credential được quản lý như Kubernetes Secret và có quy trình rotation; không commit secret.

## 12. RBAC và kubeconfig

Bootstrap bằng admin identity trên tang3:

```bash
cd /home/monitor/k3s-microservices-demo
ADMIN_KUBECONFIG=/home/monitor/.kube/config sh scripts/bootstrap-rbac.sh
```

Script tạo ServiceAccount `ci-deployer`, namespace-scoped Role/RoleBinding và kubeconfig `/home/monitor/.kube/microservices-demo-deployer.config` mode `0600`.

CI identity được create/update/patch Deployments, Services, ConfigMaps, Ingresses và NetworkPolicies trong namespace của app; được đọc Pods/logs/Events để chẩn đoán. Identity không được tạo RBAC, đọc Secrets, quản lý Namespace hoặc truy cập workload namespace khác.

```bash
export KUBECONFIG=/home/monitor/.kube/microservices-demo-deployer.config
kubectl auth can-i patch deployments -n microservices-demo  # yes
kubectl auth can-i get pods -n default                      # no
kubectl auth can-i get secrets -n microservices-demo        # no
```

Token kubeconfig cần được rotate định kỳ. Với production thật, ưu tiên short-lived workload identity/OIDC thay vì long-lived ServiceAccount token.

## 13. Networking, Traefik và Cloudflare Tunnel

Ingress dùng `ingressClassName: traefik` và duy nhất hostname `app1.onprem.site`. Cloudflare Tunnel public hostname phải map:

```text
app1.onprem.site -> http://localhost:80
```

TLS client kết thúc tại Cloudflare; tunnel gọi HTTP localhost trên tang3, rồi HAProxy chuyển sang Traefik. Backend không có NodePort/LoadBalancer riêng.

NetworkPolicy mặc định deny ingress/egress cho namespace app và chỉ cho workload trong trusted namespace `kube-system` gọi port `8080` (Traefik là consumer hiện tại). Nếu Prometheus cần scrape `/metrics`, phải thêm policy rõ ràng cho Prometheus.

## 14. Deployment

Sau khi hoàn tất GitHub bootstrap, push `main` kích hoạt pipeline tự động. Có thể deploy có kiểm soát từ tang3:

```bash
export KUBECONFIG=/home/monitor/.kube/microservices-demo-deployer.config
export IMAGE_REGISTRY=ghcr.io/<owner>/<repo>
export IMAGE_TAG=<full-git-sha>
sh scripts/render-manifests.sh rendered
kubectl apply -k rendered

for app in frontend auth-service user-service product-service; do
  kubectl rollout status deployment/$app -n microservices-demo --timeout=180s
done
```

## 15. Validation

```bash
kubectl get pods -n microservices-demo -o wide
kubectl get deployments,svc,ingress -n microservices-demo
kubectl get endpointslices -n microservices-demo

curl -H 'Host: app1.onprem.site' http://192.168.30.45/
curl -H 'Host: app1.onprem.site' http://192.168.30.45/api/auth/health
curl -H 'Host: app1.onprem.site' http://192.168.30.45/api/users/health
curl -H 'Host: app1.onprem.site' http://192.168.30.45/api/products/health

curl --fail https://app1.onprem.site/
curl --fail https://app1.onprem.site/api/auth/health
curl --fail https://app1.onprem.site/api/users/health
curl --fail https://app1.onprem.site/api/products/health
```

Chỉ coi public deployment là VERIFIED khi cả bốn request trả đúng nội dung.

## 16. Observability

- Backend ghi JSON log gồm timestamp, service, path, status, latency và request ID.
- NGINX ghi access/error log ra stdout/stderr.
- Mỗi workload có health probes.
- Backend có `/metrics` kiểu Prometheus trên Service nội bộ.

Không tự động sửa Prometheus/Grafana hiện hữu. Khi tích hợp, dùng ServiceMonitor/PodMonitor nếu có operator hoặc thêm scrape config được review cùng NetworkPolicy allow rule.

## 17. Rollback

Rollback ReplicaSet gần nhất:

```bash
kubectl rollout history deployment/frontend -n microservices-demo
kubectl rollout undo deployment/frontend -n microservices-demo
kubectl rollout status deployment/frontend -n microservices-demo --timeout=180s
```

Rollback đồng bộ bốn service nên redeploy một Git SHA cũ đã tồn tại trên GHCR:

```bash
export IMAGE_TAG=<known-good-full-git-sha>
sh scripts/render-manifests.sh rendered
kubectl apply -k rendered
```

Không tự động rollback để tránh che giấu lỗi deploy. Pipeline dừng và giữ bằng chứng khi rollout fail.

## 18. Failure scenarios

| Failure | Biểu hiện | Hành động |
| --- | --- | --- |
| ImagePullBackOff | GHCR private/tag sai/network lỗi | kiểm tra image visibility, exact SHA và event |
| Readiness fail | rollout timeout, old pods còn traffic | đọc pod logs/describe, sửa nhỏ nhất rồi redeploy |
| 404 qua hostname | Ingress/Host mismatch | kiểm tra host `app1.onprem.site` và Traefik route |
| 502/503 | Service không có ready endpoint | kiểm tra selector, EndpointSlice, probes |
| API unavailable | runner không tới `:6443` | kiểm tra HAProxy rồi K3s API; không bypass bằng SSH tang2 |
| Public 404 nhưng internal PASS | Cloudflare hostname route thiếu/sai | cấu hình tunnel `app1.onprem.site -> localhost:80` |

## 19. Troubleshooting order

```text
Public DNS/Tunnel
   -> HAProxy listener
   -> Traefik Ingress
   -> ClusterIP Service/EndpointSlice
   -> Pod readiness
   -> application logs
```

```bash
kubectl describe ingress microservices-demo -n microservices-demo
kubectl get endpointslices -n microservices-demo
kubectl get events -n microservices-demo --sort-by=.lastTimestamp
kubectl logs -n microservices-demo deployment/auth-service --tail=100
```

Không sửa APT/filesystem trên tang2 và không reset/reinstall K3s để xử lý lỗi application.

## 20. Security considerations

- Không commit kubeconfig, token, password, PAT hoặc `server.txt`.
- Containers non-root, drop all capabilities, read-only root filesystem.
- ServiceAccount token không mount vào application Pods.
- CI permissions mặc định `contents: read`; chỉ image job có `packages: write`.
- Self-hosted runner không chạy untrusted PR job.
- Namespace-scoped RBAC tách deploy identity khỏi admin kubeconfig.
- Same-origin API giảm CORS exposure; frontend bật CSP và response security headers.
- Demo auth không phù hợp production; production cần IdP/OIDC, session protection, rate limiting và audit.

## 21. Cost và operational complexity

Project tái sử dụng K3s, Traefik, HAProxy và Cloudflare Tunnel hiện hữu. Chi phí cloud bổ sung gần như bằng không trong giới hạn GitHub/GHCR/Cloudflare phù hợp tài khoản. Đổi lại, single-node failure domains, runner patching, token rotation và image lifecycle là trách nhiệm vận hành của homelab owner.
