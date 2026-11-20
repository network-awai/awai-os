# Itonami screen controls on Awai Android

Open **画面操作** from Manimani or Itonami Agent. Android asks which screen or
app to share before each recording. The recorder captures video for up to
five minutes and publishes a finished MP4 through Android MediaStore in
**Movies/Awai**. Stop from Itonami, the recording notification, or the Android
screen-sharing indicator. The OS applies its existing protected-content
and capture policies.

Home and Android Settings open after an Android confirmation. Recent Apps
also needs the optional Itonami screen navigation service enabled in Android
accessibility settings. The service has no window-content or gesture capability.

The Manimani composer recognizes exact text commands on Android:

| Command | Action |
| --- | --- |
| `/screen record` | Open the Android screen-sharing prompt |
| `/screen stop` | Stop the recording and finalize the MP4 |
| `/screen home` | Open Home |
| `/screen recents` | Open Recent Apps |
| `/screen settings` | Open Android Settings |

A typed command stays on the device. The latest Bot reply can offer the same
exact command as a button. The reply has no execution authority. The host
accepts a single allowlisted action and handles confirmation locally.
Recordings contain video only and stay on the device. Screen controls do not
expose Android view contents, credential fields, gesture injection, or a
recording attachment to Agent history.

Design: [editable Awai panel](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=337-751).
Tracking: [AWAI-3499](https://linear.app/kotobalabs/issue/AWAI-3499).
