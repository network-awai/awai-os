package network.awai.murakumo
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle

/** Explicit, signature-protected per-request handoff. No HTTP endpoint or background grant. */
class InferenceRequestActivity:Activity(){
 private var ownsJob=false
 override fun onCreate(saved:Bundle?){super.onCreate(saved)
  val caller=callingPackage
  if(!Models.trustedCaller(this,caller)){finishWith("caller-denied");return}
  val requestId=intent.getStringExtra("requestId")?:"";val prompt=intent.getStringExtra("prompt")?:"";val tokens=intent.getIntExtra("maxTokens",128)
  if(!requestId.matches(Regex("[a-f0-9-]{36}"))||intent.getStringExtra("schema")!="awai.inference.request.v1"||intent.getStringExtra("modality")!="text"||prompt.isBlank()||prompt.toByteArray(Charsets.UTF_8).size>8192||tokens !in 1..256){finishWith("invalid-request");return}
  val label=packageManager.getApplicationLabel(packageManager.getApplicationInfo(caller!!,0)).toString().take(60)
  AlertDialog.Builder(this).setTitle("${label} からの生成")
   .setMessage("この端末の Qwen3 でテキストを生成します。外部へ送信しません。\n\n"+prompt.take(240))
   .setNegativeButton("キャンセル"){_,_->finishWith("denied")}.setOnCancelListener{finishWith("denied")}
   .setPositiveButton("生成する"){_,_->
    if(!Models.busy.compareAndSet(false,true)){finishWith("busy");return@setPositiveButton}
    ownsJob=true
    Engine.prepare()
    Models.worker.execute{try{val text=Models.generate(prompt,tokens);runOnUiThread{setResult(RESULT_OK,Intent().putExtra("schema","awai.inference.result.v1").putExtra("requestId",requestId).putExtra("modality","text").putExtra("engine","llama.cpp").putExtra("text",text).putExtra("outputTokens",Engine.tokens()));finish()}}catch(e:Exception){runOnUiThread{finishWith("inference-unavailable")}}finally{ownsJob=false;Models.busy.set(false)}}
   }.show()
 }
 private fun finishWith(code:String){setResult(RESULT_CANCELED,Intent().putExtra("error",code));finish()}
 override fun onDestroy(){if(ownsJob)Engine.cancel();super.onDestroy()}
}
