# Network onboarding flow

The installation medium opens the network screen before disk selection. The
installed OS opens the same screen before phone registration. No console
switch or command entry is needed for ordinary Wi-Fi or Ethernet onboarding.

1. A managed Ethernet adapter with physical carrier is activated automatically.
   Connected Ethernet or saved Wi-Fi with a usable IP address skips the connection
   chooser and password prompt. Loopback and link-local addresses do not qualify.
   Explicitly opening network settings still shows the controls.
2. Wi-Fi lists nearby networks by signal strength, deduplicating repeated SSIDs.
   Select a network, enter its Wi-Fi password with masked characters, and connect.
   The entered secret is passed to NetworkManager via stdin, not process arguments,
   shell history, service logs, the Nix store, or source control. Persistent profiles
   remain in NetworkManager's private system-connections directory.
3. Ethernet activation waits up to 15 seconds for the connection. Wi-Fi activation
   waits up to 25 seconds. Cancellation and failures return to the available choices.
4. Probes check setup.murakumo.cloud/health, the Murakumo apex and Google's HTTPS
   204 endpoint concurrently, with 5-second limits and no redirects. A valid HTTPS
   response from a Murakumo origin proves external reachability even if that service
   returns 503; it does not prove registration is ready. A usable LAN connection
   without confirmed Internet also skips network setup, returning local-connected
   rather than claiming account registration can proceed. Manual network settings
   display local connection, Internet access and service reachability separately.
5. Offline continuation does not block OS installation. Its saved Wi-Fi profiles
   are copied into the installed OS. At first boot, “register later” displays a
   completed-installation screen with reconnect/register and shutdown choices.
6. Online continuation enters the [QR/Passkey account-linking flow](account-onboarding.md).
   Registration errors return to an actionable screen. The protocol's identity,
   approval binding and public receipt validation remain unchanged. Registration
   completion does not configure a model server or establish fleet inference.

The setup uses arrows and Enter. A framebuffer terminal with bundled Japanese
fonts renders the Japanese UI; framebuffer-less consoles get an English fallback
with identical choices. Alt+F2 remains the local maintenance console. It is
not required for normal onboarding. The framebuffer renderer launches once.
English fallback is allowed only if its child never started; a started installer
is never run a second time automatically.

Enterprise 802.1X networks require advanced maintenance configuration. Hidden
networks accept an explicitly entered SSID and password. If no Wi-Fi adapter is
visible, the UI explains that and offers Ethernet or offline continuation.
Actual adapter/driver compatibility must be checked on the physical PC.

Disk selection, pre-erasure closure checks, explicit whole-disk erase confirmation,
USB exclusion and offline system copying retain their existing safety checks.
No production API deployment is included in this UI change.
