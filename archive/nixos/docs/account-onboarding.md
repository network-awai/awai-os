# Account linking after offline installation

The installed console guides the owner through network selection, account linking,
and subsequent status verification. Wi-Fi and Ethernet are both supported.
OS installation can finish offline; linking requires Internet on the node and phone.

After choosing registration, scan the QR with a phone camera, sign in to Murakumo
with a Passkey, check the device ID and code shown on both screens, and approve.
The node polls automatically and moves to completion only after receiving a receipt
bound to this flow, challenge, device, model and account. No Murakumo password is
entered on the node. The approval lasts five minutes.

The QR screen can be dismissed with Enter or Esc to register later. Cancellation
aborts polling; even an approval response arriving during cancellation is not saved.
Expiry returns to a recovery page; choosing Retry creates a new QR. Temporary disconnections retry within the
approval deadline. Unavailable registration service, revoked registration and expiry
have distinct instructions. None of these conditions triggers disk installation or
identity reset. The existing explicit local relink command remains a maintenance
operation, outside the ordinary setup menu.

The completion screen shows the account DID and device DID. On reboot, the UI
labels the persisted receipt as saved, with online verification pending. Signed
status verification checks that the same device remains linked to the same account.
The UI does not label offline saved state as a newly verified online registration.
Network settings and shutdown remain accessible after linking.

## Ordinary setup needs no maintenance commands

After a successful connection, the guide prepares phone registration. If the
service is unavailable or rejects the flow, a stable page shows that the OS is
already installed, with Retry registration, Wi-Fi / Ethernet settings, Register
later, and Shut down. Retry goes directly to registration without asking for the
Wi-Fi password again. Only an explicit retry starts another registration attempt;
there is no service restart loop for ordinary failures.

Register later, or closing the QR, opens the installation-complete page. From that
page the owner can connect and resume registration or shut down. Network-check
failures and shutdown failures remain actionable in the guide. An unreadable saved
receipt blocks new claims while keeping network settings and shutdown available;
it never resets the saved identity or changes account ownership automatically.

The private identity remains in /var/lib/murakumo with private permissions. The
saved approval projection contains no polling secret, account cookie or password.
QR text is a temporary private file under /run/murakumo-ui; it is removed when the
screen closes. Model setup and fleet inference remain separate acceptance checks.

## Release boundary

On 2026-10-05, a read-only GET of the status route and an empty POST to the start
route both returned HTTP 404 with `unknown devices route` on murakumo.cloud.
The empty POST contains no device identity or proof and creates no registration.
Consequently production linking is not available through these routes yet.

The frozen local registration Worker e8fda133 and Portal app bc21021a were previously
reviewed with fixture approval. They remain unpublished in this handoff. Release
must integrate their authoritative sources and reachable dependency pins, pass the
release gates, deploy the registration routes and phone Portal together, and then
verify a real phone Passkey approval and registered-device visibility. A local
fixture, a reachable landing page, or a generated QR does not meet those conditions.

This source change does not deploy production or overwrite the KIOXIA USB. The
previous network-only ISO does not include these account-screen improvements.
