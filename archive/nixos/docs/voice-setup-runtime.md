# Conversational setup runtime

NixOS uses the existing Awai Node setup controllers. The GTK window sends
the currently actionable choices over a root-private Unix socket. A local
Whisper recognizer and Qwen dialogue model turn speech into a bounded choice;
the existing controller performs the operation and presents the next screen.
Language selection works before the installer starts. There is no model shell,
privileged HTTP endpoint, or separate voice installer.

The model can answer, choose a current option, go back, continue, and transmit
the existing public approval code by sound. Audio controls use fixed commands.
The dialogue policy is generated from `archive/nixos/src/murakumo/voice_policy.cljk` using
`kbb --backend sci archive/nixos/src/murakumo/voice_policy.cljk`.

Wi-Fi password spelling bypasses the dialogue model and transcript display.
The user speaks explicit phrases such as `小文字のBを入力` and `数字の7を入力`, specifies case and symbols, then says `入力完了` or
`done`. Only the character count is spoken. Temporary audio lives in a private
runtime directory and is removed after recognition. The assembled password is
passed to the original controller, cleared from the voice state, and never
included in the model context. Local ASR necessarily handles the secret audio;
this feature does not make speaking a password private from nearby listeners.

Disk erasure is a separate deterministic confirmation state. The spoken phrase
binds the current disk serial suffix, requires a recent confirmation prompt,
and expires after 45 seconds. Missing serials refuse voice erasure. Changing
the screen, cancelling, or changing audio settings cancels prior consent. The
disk controller still rechecks the selected disk identity and eligibility.

The package pins model revisions and SHA-256 digests and includes Japanese
OpenJTalk and English eSpeak synthesis. Inference runs as `murakumo-voice`,
with no new privileges. Only the GUI/controller retains installer privileges.
The loopback dialogue service uses a per-session API key. The runtime is
included in both the installation medium and retained installed configuration.

This first runtime listens between assistant utterances. It suppresses its own
speech and background music during recognition. Full duplex, acoustic echo
cancellation and interruption while the assistant is speaking are not yet
qualified. When speech fails, the existing screen remains available.

Account ownership continues to require the existing authenticated Passkey
approval and signed receipt. Speaking a command or sending a QR/acoustic code
does not authenticate an owner. Local completion without a smartphone is
available through the existing local setup option. The public registration
and companion sound page need their separate reviewed production release;
this package does not deploy them. Real microphone, speaker, phone permission
and Passkey checks must be reported separately from synthetic audio fixtures.

The package includes pinned upstream runtime/model/voice license notices in
`share/doc/aiueos-local-voice/NOTICE.txt` and retains that notice on the installed system. This
runtime is currently a local candidate, not a published or USB-written release.
