# Awai Otehon logo — 明ける余白

Owner selected v3①「明ける余白」on 2026-11-14 and requested adoption in the Awai app, awai.network and Awai Otehon OS (AWAI-2899).

`awai-logo.png` is the unchanged 1254-square selected source, SHA-256 `35505dc7b418621ab7a3b11ba4d2085da0cbc265613795d034091a3bd15c533f`, from network-awai/awai-mobile `docs/design/logo-concepts-2026-11-14/v3/01-akatsuki.png` at `ae3b4600c0e2d7ad5b445a7dfe5019a0eea8f3a9`. White morning, blue noon, red dusk and black night gently pass through the form.

## Integration

- Shell sidebar and setup screen use `../shell/assets/awai-logo.png`, an opaque RGB 512-square derivative identical to the app/site web image (SHA-256 `42c7251f26fa038ee38ee05bdb0ce24420d4b664d63d7555dffb78cdf827f857`). The shell builder copies it into both shell and phone-link outputs and uses it as their favicon.
- Shell image CSP permits bundled `file:` assets for the OS kiosk or the exact preview origin (`'self'`) for HTTP. Existing loopback media access is preserved. No external image host or API capability is added.
- Awai Desktop macOS bundle declares `CFBundleIconFile=awai` and packages `../macos-app/awai.icns`, generated at standard 16–1024 pixel representations from the selected source. The builder does not launch or update an OS image.

On macOS with Node, FFmpeg and iconutil, regenerate with `node nixos/otehon/branding/render-icons.mjs` from the repository root. Temporary iconset files are in the task's `.agent-output/`; the tool is never called by the Nix image build or application runtime. Existing native Murakumo profile assets stay separate from Otehon.

## Verification boundary

Shell tests (65/65), preview/file builds, copied image digests, macOS ICNS packaging and plist validation are checked locally. Browser HTTP preview shows the setup logo without errors. The in-app browser blocks file-protocol navigation, so direct file-kiosk rendering is unobserved; the default file build and its CSP were checked as artifacts. NixOS VM boot, an installed desktop image, an installed macOS Dock icon, signed distribution and production publication remain independent checks.
