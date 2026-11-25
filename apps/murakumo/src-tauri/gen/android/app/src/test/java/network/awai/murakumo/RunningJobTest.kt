package network.awai.murakumo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The requestId matching behind the caller-visible "cancel" (InferenceStatusProvider, Models.cancelJob). */
class RunningJobTest {
 private val first="11111111-1111-4111-a111-111111111111"
 private val second="22222222-2222-4222-a222-222222222222"

 @Test fun aForeignRequestIdCannotCancelTheRunningJob(){
  val job=RunningJob();job.start(first,false)
  assertNull("another app's requestId must not match a running text job",job.take(second))
  assertFalse("another app's cancel must not mark this job cancelled",job.wasCancelled(first))
  assertEquals("the running job must still be cancelable by its own id",false,job.take(first))
  assertTrue("the matching cancel is remembered for the result",job.wasCancelled(first))
 }

 @Test fun aJobThatHasFinishedIgnoresALateCancel(){
  val job=RunningJob();job.start(first,true);job.finish(first)
  assertNull("a cancel after the job ended must do nothing",job.take(first))
 }

 @Test fun aRepeatedCancelIsANoOp(){
  val job=RunningJob();job.start(second,true)
  assertEquals("the first cancel takes the image job",true,job.take(second))
  assertNull("the second cancel must not reach the engine again",job.take(second))
  assertTrue("the taken cancel is still reported for this request",job.wasCancelled(second))
 }

 @Test fun finishingAnotherRequestKeepsTheRunningJob(){
  val job=RunningJob();job.start(first,false);job.finish(second)
  assertEquals("an unrelated finish must not clear the running job",false,job.take(first))
 }

 @Test fun theModalityTravelsWithTheMatchingRequest(){
  val job=RunningJob();job.start(second,true)
  assertEquals("image job is reported as image",true,job.take(second))
  job.start(first,false)
  assertFalse("a new job starts uncancelled",job.wasCancelled(first))
  assertEquals("text job is reported as text",false,job.take(first))
 }
}
