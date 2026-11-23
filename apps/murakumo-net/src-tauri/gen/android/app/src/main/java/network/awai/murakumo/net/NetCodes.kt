package network.awai.murakumo.net

/**
 * The only error text Murakumo Net hands to its page (the PHI rules apply here too, Dev review #430).
 * An exception's message is compared with this list and never passed on; URLs, paths and file
 * contents therefore cannot leave through an error. apps/murakumo/scripts/phi-path-lint.mjs checks it.
 */
internal object NetCodes {
 val ALL:Set<String> = setOf(
  "busy","unknown-model","unknown-operation","no-download","release-required","model-digest-mismatch","model-size-limit",
  "model-store-failed","model-import-rejected","caller-denied","unsupported-operation",
  "murakumo-unavailable","model-download-rejected","model-handoff-failed")

 /** A fixed code for [e]: the listed code its message equals, otherwise [fallback]. Never the message itself. */
 fun of(e:Throwable,fallback:String):String {
  check(fallback in ALL)
  val message=e.message
  return ALL.firstOrNull{it==message}?:fallback
 }
}
