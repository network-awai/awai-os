// The browser must explicitly support on-device recognition. Never fall back
// to the browser's default (which may use a remote recognition service).
export function createLocalDictation({ Recognition, mediaDevices, AudioContext, onText, onState, onLevel }) {
  let generation = 0;
  let stream = null;
  let context = null;
  let recognition = null;
  let frame = null;

  function stop(state = "idle") {
    generation++;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      try { recognition.stop(); } catch { /* already stopped */ }
      recognition = null;
    }
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (context) context.close().catch(() => {});
    context = null;
    onLevel(0);
    onState(state);
  }

  async function start() {
    stop();
    const ticket = generation;
    if (!Recognition || typeof Recognition.available !== "function" || !("processLocally" in Recognition.prototype)) {
      onState("unavailable");
      return;
    }
    onState("checking");
    try {
      const available = await Recognition.available({ langs: ["ja-JP"], processLocally: true });
      if (ticket !== generation) return;
      if (available !== "available" || !mediaDevices?.getUserMedia || !AudioContext) {
        onState("unavailable");
        return;
      }
      const acquired = await mediaDevices.getUserMedia({ audio: true });
      if (ticket !== generation) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const measure = () => {
        if (ticket !== generation) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5));
        frame = requestAnimationFrame(measure);
      };
      recognition = new Recognition();
      recognition.processLocally = true;
      recognition.lang = "ja-JP";
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        if (ticket !== generation) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) onText(event.results[i][0].transcript);
        }
      };
      recognition.onerror = () => stop("error");
      recognition.onend = () => stop("idle");
      recognition.start(stream.getAudioTracks()[0]);
      onState("listening");
      measure();
    } catch {
      if (ticket === generation) stop("error");
    }
  }

  return { start, stop };
}
