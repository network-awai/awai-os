{ lib, pkgs, ... }:
let
  # Writes a valid, silent WAV where Piper would write speech.
  silent = pkgs.writers.writePython3 "otehon-silent-piper" { } ''
    import sys
    import wave
    with wave.open(sys.argv[sys.argv.index("-f") + 1], "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(22050)
        out.writeframes(bytes(44100))
  '';
in
{
  # Negative control: the speech step must fail with "silent" when the voice writes silence.
  imports = [ ./desktop-media-gui.nix ];

  system.image.id = lib.mkOverride 30 "awai-otehon-desktop-media-silent";

  systemd.services.otehon-media.environment.OTEHON_PIPER = lib.mkForce "${silent}";
}
