#!/usr/bin/env sh
set -eu

admin_kubeconfig="${ADMIN_KUBECONFIG:-/home/monitor/.kube/config}"
target_kubeconfig="${DEPLOYER_KUBECONFIG:-/home/monitor/.kube/microservices-demo-deployer.config}"
api_server="${KUBERNETES_API_SERVER:-https://192.168.30.45:6443}"
namespace="microservices-demo"
service_account="ci-deployer"
token_secret="ci-deployer-token"

umask 077
kubectl --kubeconfig "$admin_kubeconfig" apply -f k8s/bootstrap/namespace-rbac.yaml

token=''
attempt=0
while [ -z "$token" ] && [ "$attempt" -lt 30 ]; do
  token="$(kubectl --kubeconfig "$admin_kubeconfig" -n "$namespace" \
    get secret "$token_secret" -o jsonpath='{.data.token}' 2>/dev/null | base64 -d || true)"
  attempt=$((attempt + 1))
  [ -n "$token" ] || sleep 2
done

if [ -z "$token" ]; then
  echo "ServiceAccount token was not populated" >&2
  exit 1
fi

ca_file="$(mktemp)"
trap 'rm -f "$ca_file"' EXIT
kubectl --kubeconfig "$admin_kubeconfig" -n "$namespace" \
  get secret "$token_secret" -o jsonpath='{.data.ca\.crt}' | base64 -d > "$ca_file"

rm -f "$target_kubeconfig"
kubectl config --kubeconfig "$target_kubeconfig" set-cluster k3s-homelab \
  --server="$api_server" --certificate-authority="$ca_file" --embed-certs=true >/dev/null
kubectl config --kubeconfig "$target_kubeconfig" set-credentials "$service_account" \
  --token="$token" >/dev/null
kubectl config --kubeconfig "$target_kubeconfig" set-context microservices-demo \
  --cluster=k3s-homelab --user="$service_account" --namespace="$namespace" >/dev/null
kubectl config --kubeconfig "$target_kubeconfig" use-context microservices-demo >/dev/null
chmod 600 "$target_kubeconfig"

test "$(kubectl --kubeconfig "$target_kubeconfig" auth can-i patch deployments -n "$namespace")" = "yes"
test "$(kubectl --kubeconfig "$target_kubeconfig" auth can-i get pods -n default)" = "no"
echo "Created least-privilege kubeconfig at $target_kubeconfig"
