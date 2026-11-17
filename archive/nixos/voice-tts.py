# Thin adapter to the upstream OpenJTalk runtime; setup policy lives in CLJK.
import sys, wave
import pyopenjtalk
samples, rate = pyopenjtalk.tts(sys.stdin.read())
with wave.open(sys.argv[1], 'wb') as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(rate)
    out.writeframes(samples.clip(-32768, 32767).astype('<i2').tobytes())
