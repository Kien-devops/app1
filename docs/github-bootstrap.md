# GitHub và self-hosted runner bootstrap

Các bước này cần quyền owner repository và chỉ thực hiện sau khi code đã được review.

## 1. Tạo repository

Tạo repository mới, ví dụ `Kien-devops/k3s-microservices-demo`, không đặt application trong repo `k3s-onprem`.

```bash
git remote add origin git@github.com:Kien-devops/k3s-microservices-demo.git
git push -u origin main
```

Không push `server.txt`, kubeconfig hoặc token. Xác nhận trước push:

```bash
git status --ignored
git ls-files | grep -E 'server\.txt|kubeconfig|\.env' && exit 1 || true
```

## 2. Bảo vệ main và production

- Require pull request và CI checks trước merge nếu workflow nhóm cho phép.
- Tạo GitHub Environment `production`.
- Có thể yêu cầu manual approval cho environment này.
- Không cho workflow từ fork hoặc pull request chạy trên self-hosted runner.

## 3. GHCR

Lần push main đầu tiên tạo bốn packages. Đặt package visibility thành `public` để tang4 pull image mà không giữ PAT dài hạn. Nếu policy yêu cầu private package, tạo read-only credential riêng, lưu trong Kubernetes Secret và lập lịch rotation.

## 4. Cài runner trên tang3

Trong repository, vào **Settings → Actions → Runners → New self-hosted runner**. Chọn Linux x64 và dùng đúng version/commands GitHub đang hiển thị; không copy token vào Git hoặc shell history.

Thư mục đề xuất:

```text
/home/monitor/actions-runner-k3s-microservices-demo
```

Khi chạy `config.sh`, cấu hình:

- runner name: `server-tang3-k3s-deploy`;
- additional label: `k3s-deploy`;
- work folder: `_work`;
- service user: `monitor`.

Sau đó cài service bằng `svc.sh` theo hướng dẫn chính thức. Runner chỉ cần outbound HTTPS; không mở inbound firewall port.

Xác minh runner version tương thích với `actions/checkout@v7` và `actions/setup-node@v7`, runner online, labels có `self-hosted`, `Linux`, `X64`, `k3s-deploy`.

## 5. Bootstrap deployment identity

Clone repository trên tang3 rồi chạy:

```bash
cd /home/monitor/k3s-microservices-demo
ADMIN_KUBECONFIG=/home/monitor/.kube/config sh scripts/bootstrap-rbac.sh
```

Không cấu hình runner dùng `/home/monitor/.kube/config`; đó là admin credential.

## 6. Cloudflare hostname

Trong tunnel hiện hữu, thêm đúng một public hostname nếu chưa có:

```text
Hostname: app1.onprem.site
Service:  http://localhost:80
```

Không tạo cloudflared service thứ hai và không publish Kubernetes API `:6443`.
