# Murakumo image engine on Apple Silicon

This native helper shares Murakumo's `image-pins.json` and uses the pinned
stable-diffusion.cpp and ggml built with Metal. It checks the length and SHA-256
of all three model files before each generation. Generation reads a bounded
UTF-8 prompt from standard input and writes one bounded 512 × 512 PNG to standard
output. It opens no network service and has no model download command.

On macOS with the Xcode Metal toolchain, CMake and jq, build in a task
output directory.

```sh
bash apps/murakumo/native/image/macos/build.sh "$PWD/.agent-output/murakumo-image"
.agent-output/murakumo-image/build/murakumo-image version
```

Gaka discovers the helper at
`~/Library/Application Support/network.awai.murakumo/bin/murakumo-image`
and the separately provisioned `encoder.gguf`, `denoiser.gguf`, and
`vae.safetensors` under `image-model/` in that same application support directory.
Use the three immutable sources and digests in `apps/murakumo/image-pins.json`.
After provisioning, the helper's `status <model-directory>` checks file presence
and length. Full hash verification runs on `generate`. The native application
never provisions models from inside the generation operation.
