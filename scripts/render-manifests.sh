#!/usr/bin/env sh
set -eu

: "${IMAGE_REGISTRY:?IMAGE_REGISTRY is required, for example ghcr.io/owner/repo}"
: "${IMAGE_TAG:?IMAGE_TAG is required and must be immutable}"

case "$IMAGE_REGISTRY" in
  *[!a-zA-Z0-9._/-]*) echo "IMAGE_REGISTRY contains unsupported characters" >&2; exit 1 ;;
esac
case "$IMAGE_TAG" in
  *[!a-zA-Z0-9._-]*) echo "IMAGE_TAG contains unsupported characters" >&2; exit 1 ;;
esac

output_dir="${1:-rendered}"
rm -rf "$output_dir"
mkdir -p "$output_dir"

for source in k8s/base/*.yaml; do
  destination="$output_dir/$(basename "$source")"
  sed \
    -e "s|__IMAGE_REGISTRY__|$IMAGE_REGISTRY|g" \
    -e "s|__IMAGE_TAG__|$IMAGE_TAG|g" \
    "$source" > "$destination"
done

if grep -R '__IMAGE_' "$output_dir" >/dev/null 2>&1; then
  echo "Unresolved image placeholder in rendered manifests" >&2
  exit 1
fi

echo "Rendered manifests to $output_dir"
