package network.awai.murakumo

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageHashTest {
    private val chunkBytes = 1024 * 1024
    private val data = ByteArray(2 * chunkBytes + 1) { 'a'.code.toByte() }
        .apply { this[lastIndex] = 'z'.code.toByte() }
    private val fullDigest = "9a921a636108cc0c8bcd321fb2925eb4f695ceb62e3e86eadbecca5262853a2a"

    @Test fun cancelDuringReadClosesTheStreamBeforeReadingTheRestOfTheFile() {
        var cancelled = false
        var readCalls = 0
        var closed = false
        val stream = object : ByteArrayInputStream(data) {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                assertEquals(chunkBytes, length)
                val count = super.read(buffer, offset, length)
                if (++readCalls == 2) cancelled = true
                return count
            }

            override fun close() {
                closed = true
                super.close()
            }
        }

        val result = runCatching { imageSha256(stream) { cancelled } }
        assertEquals("cancelled", result.exceptionOrNull()?.message)
        assertEquals(2, readCalls)
        assertEquals(1, stream.available())
        assertTrue(closed)

        cancelled = false
        assertEquals(fullDigest, imageSha256(ByteArrayInputStream(data)) { cancelled })
    }

    @Test fun successfulHashIncludesTheFinalPartialChunk() {
        assertEquals(fullDigest, imageSha256(ByteArrayInputStream(data)))
    }
}
