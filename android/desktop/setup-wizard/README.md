# Awai OS Welcome for wide Android setup

[AWAI-3563](https://linear.app/kotobalabs/issue/AWAI-3563) · [Figma Welcome and motion](https://www.figma.com/design/n8RGt7z9Obnn12DvtNFS2z?node-id=1-2)

Apply to the Awai PC source build from [AWAI-3061](https://linear.app/kotobalabs/issue/AWAI-3061).
The patch is based on SetupWizard revision
`d995f1a1949f5988850c9977658e2590efe502b4`. Run on the build host after syncing the pinned Android sources and before the PC product build.

```sh
/path/to/awai-os/android/desktop/setup-wizard/apply.sh /path/to/android/packages/apps/SetupWizard
cd /path/to/android
source build/envsetup.sh
# Select the same Generic_x86_64 lunch target as the AWAI-3061 build.
m SetupWizard
```

Build and sign the resulting Awai product image using the platform release pipeline. Keep the package name, permissions, provisioning state and original wizard script so Start follows the existing language and network flow. The optional language shortcut opens the same native locale picker and returns to Welcome. Accessibility, emergency calling where supported, and device information retain their existing activities. Narrow screens, TV and managed-profile flows retain their existing entry points.

The wide layout uses the existing Awai logo. Its brand group appears once on initial creation with the Figma 600 ms fade and 16 dp lift. Android's animator setting controls whether the brand animates. The setup controls are static from the first frame. Native type uses the platform sans-serif and Japanese fallback. The layout adapts its margins and scrolls when the viewport or font size requires it.

Validate the built image with the PC VM boot check, including Japanese and English, keyboard and pointer, large text, accessibility return, language change, Start and animation disabled. After VM acceptance, verify the same image on the 7735HS using the approved boot and signing path. The current Live image requires user setup before it exposes normal ADB commands.
