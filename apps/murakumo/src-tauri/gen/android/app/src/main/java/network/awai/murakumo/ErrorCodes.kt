package network.awai.murakumo

/**
 * The only error text the inference path may hand to a caller, a page or a result Intent (PHI rule).
 * A refusal is one of these fixed codes. An exception's own message is never passed on: it is
 * compared with this list and, unless it equals one of the codes, replaced by the caller's fallback.
 * Prompts, outputs, file paths and exception messages therefore cannot leave through an error.
 * test/phi-path.test.mjs checks that every code thrown in Kotlin, Java and the JNI engines is listed.
 */
internal object ErrorCodes {
 val ALL:Set<String> = setOf(
  // request admission and caller checks
  "caller-denied","unsupported-operation","unsupported","invalid-request","denied","busy","unknown-operation","unsupported-modality","prompt-limit","invalid-prompt",
  // model lifecycle
  "unknown-model","release-required","model-digest-mismatch","model-size-limit","model-store-failed","no-download",
  "model-load-failed","model-not-loaded","model-download-rejected","model-import-rejected","file-picker-unavailable","net-app-unavailable",
  // text engine (native/engine.cpp)
  "context-limit","tokenize-failed","context-failed","allocation-failed","cancelled","timeout","decode-failed","output-limit","empty-result",
  // image engine (native/image/image.cpp, ImageModels.kt)
  "release-text-model-required","image-model-missing","image-engine-unavailable","image-model-digest-mismatch","image-options-rejected",
  "image-model-load-failed","image-generation-failed","invalid-image-output","image-encode-failed","image-size-limit","duplicate-image-id","generated-cleanup-failed",
  // generic fallbacks
  "inference-failed","inference-unavailable")

 /** A fixed code for [e]: the listed code its message equals, otherwise [fallback]. Never the message itself. */
 fun of(e:Throwable,fallback:String):String {
  check(fallback in ALL)
  val message=e.message
  return ALL.firstOrNull{it==message}?:fallback
 }
}
