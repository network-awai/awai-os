package network.awai.murakumo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class RunningJobTest {
    private val first = "11111111-1111-4111-a111-111111111111"
    private val second = "22222222-2222-4222-a222-222222222222"
    private val caller = "network.awai.gaka"
    private val otherCaller = "network.itonami.app"

    @Test fun foreignIdAndCallerCannotCancelTheActiveRequest() {
        val job = RunningJob()
        job.start(first, caller, false)
        assertFalse(job.cancel(second, caller) { error("foreign ID reached the engine") })
        assertFalse(job.cancel(first, otherCaller) { error("foreign caller reached the engine") })
        assertEquals("text", job.finish(first, Result.success("text")).getOrThrow())
    }

    @Test fun aRepeatedOrLateCancelIsANoOp() {
        val job = RunningJob()
        job.start(first, caller, true)
        assertTrue(job.cancel(first, caller) { assertTrue(it) })
        assertFalse(job.cancel(first, caller) { error("repeated cancel reached the engine") })
        assertEquals("cancelled", resultCode(job.finish(first, Result.success("image"))))
        assertFalse(job.cancel(first, caller) { error("late cancel reached the engine") })
    }

    @Test fun finishingAnUnrelatedRequestKeepsTheActiveRequest() {
        val job = RunningJob()
        job.start(first, caller, false)
        assertEquals("unrelated", job.finish(second, Result.success("unrelated")).getOrThrow())
        assertTrue(job.cancel(first, null) { assertFalse(it) })
        assertEquals("cancelled", resultCode(job.finish(first, Result.success("text"))))
    }

    @Test fun acceptedCancelOverridesTextSuccess() = assertCancellation(false, Result.success("text"))
    @Test fun acceptedCancelOverridesImageSuccess() = assertCancellation(true, Result.success("image"))

    @Test fun acceptedCancelOverridesTextException() =
        assertCancellation(false, Result.failure(IllegalStateException("decode-failed")))

    @Test fun acceptedCancelOverridesImageException() =
        assertCancellation(true, Result.failure(IllegalStateException("image-generation-failed")))

    private fun assertCancellation(image: Boolean, outcome: Result<String>) {
        val job = RunningJob()
        job.start(first, caller, image)
        assertTrue(job.cancel(first, caller) { assertEquals(image, it) })
        assertEquals("cancelled", resultCode(job.finish(first, outcome)))
    }

    @Test fun aNewRequestCanSucceedAfterCancellationAndRetainsItsOwnErrors() {
        val job = RunningJob()
        job.start(first, caller, true)
        assertTrue(job.cancel(first, caller) { assertTrue(it) })
        val cancelled = job.finish(first, Result.success("discarded image"))
        job.start(second, otherCaller, false)
        assertFalse(job.cancel(first, caller) { error("old cancel reached the new engine") })
        assertEquals("next text", job.finish(second, Result.success("next text")).getOrThrow())
        assertEquals("cancelled", resultCode(cancelled))

        job.start(first, caller, false)
        val failure = IllegalStateException("decode-failed")
        assertSame(failure, job.finish(first, Result.failure<String>(failure)).exceptionOrNull())
    }

    private fun resultCode(result: Result<String>): String =
        ErrorCodes.of(requireNotNull(result.exceptionOrNull()), "inference-unavailable")
}
