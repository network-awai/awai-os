# NixOS startup music and Awai Node acoustic linking

The graphical setup language page plays a quiet, original 24-second synthesized ambient
piece. Its waveform peaks below 3.2% full scale; actual loudness depends on the
speaker. A visible BGM button stops or replays it. Changing screens stops playback.
Missing speakers/audio devices never block setup. There is no continuous loop.

The graphical QR approval page can send its same public ten-character, five-minute approval
code as audible FSK (1200/2200 Hz, 50 bits/s, sync/version/CRC16). An explicit
button starts each transmission and stops BGM. Leaving/cancelling the QR page
stops audio and removes temporary QR/audio files. No keys, passwords, cookies,
poll tokens or automatic approval travel in sound. QR and typed URL remain usable.
Playback starts with one second of silence to let the output device settle before
the synchronization preamble. The Mac VM lost initial symbols without this delay;
the delayed recording decoded to the same approval URI as its QR.

`sound-link.html` and `acoustic-code.mjs` form the companion reader. Serve them
side by side over HTTPS (or localhost for QA). Microphone access requires a user
click and browser permission. Decoding opens only the fixed Murakumo approval
origin, after an explicit click; it does not enroll or approve a device. The
existing Passkey sign-in, device/code comparison, expiry and bound receipt checks
remain mandatory. The reader never embeds a test identity or authentication bypass.

The companion is included on the ISO under `/etc/murakumo/`, ready to integrate
into the web portal. It is not yet published as a public smartphone feature.
Physical phone microphone decoding and real Passkey account approval require
separate qualification. A CRC detects corruption, not authenticity; nearby sounds
can carry another person's code, so the approval UI must verify the device identity.
On 2026-10-06 the public registration start route still returned HTTP 404.
Changing the USB does not publish that registration service or the reader.
