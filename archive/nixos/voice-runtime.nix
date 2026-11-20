{ pkgs }:
let
  qwen = pkgs.fetchurl {
    url = "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf";
    sha256 = "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a";
  };
  whisper = pkgs.fetchurl {
    url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin";
    sha256 = "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b";
  };
  tts = pkgs.python3.withPackages (p: [ p.pyopenjtalk ]);
in pkgs.runCommand "aiueos-local-voice" { nativeBuildInputs = [ pkgs.makeWrapper ]; } ''
  mkdir -p $out/bin $out/lib
  mkdir -p $out/share/doc/aiueos-local-voice
  cp ${./voice-NOTICES.txt} $out/share/doc/aiueos-local-voice/NOTICE.txt
  cp ${./voice-agent.mjs} $out/lib/voice-agent.mjs
  cp ${./voice-control.mjs} $out/lib/voice-control.mjs
  cp ${./voice-policy.json} $out/lib/voice-policy.json
  cp ${./voice-tts.py} $out/lib/voice-tts.py
  makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/aiueos-voice \
    --add-flags "$out/lib/voice-agent.mjs" \
    --set MURAKUMO_VOICE_MODEL ${qwen} \
    --set MURAKUMO_ASR_MODEL ${whisper} \
    --set MURAKUMO_LLM_SERVER ${pkgs.llama-cpp}/bin/llama-server \
    --set MURAKUMO_ASR_CLI ${pkgs.whisper-cpp}/bin/whisper-cli \
    --set MURAKUMO_TTS_PYTHON ${tts}/bin/python \
    --set MURAKUMO_TTS_SCRIPT "$out/lib/voice-tts.py" \
    --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.alsa-utils pkgs.espeak-ng pkgs.util-linux pkgs.coreutils ]}
''
