package network.awai.murakumo

import java.util.concurrent.CancellationException

/** The provider's active request, from publication through final result selection. */
internal class RunningJob {
    private class Request(val id: String, val caller: String, val image: Boolean) {
        var cancelled = false
    }

    private var active: Request? = null

    @Synchronized
    fun start(requestId: String, caller: String, imageJob: Boolean) {
        check(active == null)
        active = Request(requestId, caller, imageJob)
    }

    @Synchronized
    fun cancel(requestId: String, caller: String?, signalEngine: (Boolean) -> Unit): Boolean {
        val job = active ?: return false
        if (job.id != requestId || (caller != null && job.caller != caller) || job.cancelled) return false
        job.cancelled = true
        // Signal before completion can retire this job and let the next one prepare its engine.
        signalEngine(job.image)
        return true
    }

    @Synchronized
    fun <T> finish(requestId: String, outcome: Result<T>): Result<T> {
        val job = active ?: return outcome
        if (job.id != requestId) return outcome
        active = null
        return if (job.cancelled) Result.failure(CancellationException("cancelled")) else outcome
    }
}
