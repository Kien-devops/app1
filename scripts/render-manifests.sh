#!/usr/bin/env sh
set -eu

output_dir="${1:-rendered}"
deploy_target="${DEPLOY_TARGET:-all}"

case "$output_dir" in
  ''|.|..|/|../*|*/../*|*/..)
    echo "Refusing unsafe output directory: $output_dir" >&2
    exit 1
    ;;
esac

validate_image_ref() {
  image_ref="$1"
  case "$image_ref" in
    ''|*[!a-zA-Z0-9._/@:-]*)
      echo "Image reference contains unsupported characters: $image_ref" >&2
      exit 1
      ;;
  esac
}

replace_component_image() {
  component="$1"
  image_ref="$2"
  file="$3"

  validate_image_ref "$image_ref"
  sed \
    -e "s|__IMAGE_REGISTRY__/$component:__IMAGE_TAG__|$image_ref|g" \
    "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

write_selective_kustomization() {
  component="$1"
  {
    printf '%s\n' 'apiVersion: kustomize.config.k8s.io/v1beta1'
    printf '%s\n' 'kind: Kustomization'
    printf '%s\n' 'namespace: microservices-demo'
    printf '%s\n' 'resources:'
    printf '  - %s.yaml\n' "$component"
    printf '%s\n' 'labels:'
    printf '%s\n' '  - pairs:'
    printf '%s\n' '      app.kubernetes.io/part-of: k3s-microservices-demo'
    printf '%s\n' '    includeSelectors: true'
  } > "$output_dir/kustomization.yaml"
}

rm -rf "$output_dir"
mkdir -p "$output_dir"

case "$deploy_target" in
  all)
    : "${IMAGE_REGISTRY:?IMAGE_REGISTRY is required for a full render}"
    : "${IMAGE_TAG:?IMAGE_TAG is required and must be immutable}"

    case "$IMAGE_REGISTRY" in
      *[!a-zA-Z0-9._/-]*)
        echo "IMAGE_REGISTRY contains unsupported characters" >&2
        exit 1
        ;;
    esac
    case "$IMAGE_TAG" in
      *[!a-zA-Z0-9._-]*)
        echo "IMAGE_TAG contains unsupported characters" >&2
        exit 1
        ;;
    esac

    for source in k8s/base/*.yaml; do
      destination="$output_dir/$(basename "$source")"
      sed \
        -e "s|__IMAGE_REGISTRY__|$IMAGE_REGISTRY|g" \
        -e "s|__IMAGE_TAG__|$IMAGE_TAG|g" \
        "$source" > "$destination"
    done
    ;;

  frontend|auth-service|user-service|product-service)
    : "${IMAGE_REF:?IMAGE_REF is required for a selective render}"
    cp "k8s/base/$deploy_target.yaml" "$output_dir/$deploy_target.yaml"
    replace_component_image \
      "$deploy_target" "$IMAGE_REF" "$output_dir/$deploy_target.yaml"
    write_selective_kustomization "$deploy_target"
    ;;

  platform)
    : "${FRONTEND_IMAGE:?FRONTEND_IMAGE is required for a platform render}"
    : "${AUTH_SERVICE_IMAGE:?AUTH_SERVICE_IMAGE is required for a platform render}"
    : "${USER_SERVICE_IMAGE:?USER_SERVICE_IMAGE is required for a platform render}"
    : "${PRODUCT_SERVICE_IMAGE:?PRODUCT_SERVICE_IMAGE is required for a platform render}"

    for source in k8s/base/*.yaml; do
      cp "$source" "$output_dir/$(basename "$source")"
    done

    replace_component_image frontend \
      "$FRONTEND_IMAGE" "$output_dir/frontend.yaml"
    replace_component_image auth-service \
      "$AUTH_SERVICE_IMAGE" "$output_dir/auth-service.yaml"
    replace_component_image user-service \
      "$USER_SERVICE_IMAGE" "$output_dir/user-service.yaml"
    replace_component_image product-service \
      "$PRODUCT_SERVICE_IMAGE" "$output_dir/product-service.yaml"
    ;;

  *)
    echo "Unsupported DEPLOY_TARGET: $deploy_target" >&2
    exit 1
    ;;
esac

if grep -R '__IMAGE_' "$output_dir" >/dev/null 2>&1; then
  echo "Unresolved image placeholder in rendered manifests" >&2
  exit 1
fi

echo "Rendered $deploy_target manifests to $output_dir"
