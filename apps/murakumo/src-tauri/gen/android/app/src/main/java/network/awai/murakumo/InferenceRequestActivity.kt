package network.awai.murakumo
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher

/**
 * Explicit, signature-protected per-request handoff. No HTTP endpoint or background grant.
 * The prompt may be PHI (karute): every window this Activity shows is FLAG_SECURE and has no Recents
 * snapshot, so the confirmation text and the progress page stay out of screenshots, screen recording
 * and the Recents thumbnail. Errors leave only as fixed codes (ErrorCodes); nothing is logged.
 *
 * Three paths stop a running job and all end at RESULT_CANCELED + error=cancelled: the page's キャンセル
 * button, the back key, and the caller's signature-protected "cancel" for this requestId
 * (Models.cancelJob). A cancel that arrives before the job starts, for another requestId, or after it
 * ended changes nothing, and only one result is ever set.
 */
class InferenceRequestActivity:Activity(){
 private var ownsJob=false
 private var imageJob=false
 private var requestId=""
 private var backCallback:OnBackInvokedCallback?=null
 private val resultSet=java.util.concurrent.atomic.AtomicBoolean(false)
 override fun onCreate(saved:Bundle?){super.onCreate(saved)
  secure(window);setRecentsScreenshotEnabled(false)
  val caller=callingPackage
  if(!Models.trustedCaller(this,caller)){finishWith("caller-denied");return}
  val prompt=intent.getStringExtra("prompt")?:"";val tokens=intent.getIntExtra("maxTokens",128);val modality=intent.getStringExtra("modality")
  requestId=intent.getStringExtra("requestId")?:""
  if(!requestId.matches(Regex("[a-f0-9-]{36}"))||intent.getStringExtra("schema")!="awai.inference.request.v1"||modality !in setOf("text","image")||prompt.isBlank()||prompt.toByteArray(Charsets.UTF_8).size>8192||tokens !in 1..256){finishWith("invalid-request");return}
  val phi=caller in Models.phiCallers
  if(phi&&modality!="text"){finishWith("unsupported-modality");return}
  imageJob=modality=="image"
  val label=packageManager.getApplicationLabel(packageManager.getApplicationInfo(caller!!,0)).toString().take(60)
  AlertDialog.Builder(this).setTitle("${label} からの生成")
   .setMessage((if(modality=="image")"この端末の Qwen Image 2.1 Turbo (AD-Q2_K / Vulkan) で画像を生成します。"else "この端末の Qwen3 でテキストを生成します。")+"外部へ送信しません。\n\n"+(if(phi)"健康の情報を含む ${"%,d".format(prompt.codePointCount(0,prompt.length))} 文字のテキスト（内容はこの画面に出しません）" else prompt.take(240)))
   .setNegativeButton("キャンセル"){_,_->finishWith("denied")}.setOnCancelListener{finishWith("denied")}
   .setPositiveButton("生成する"){_,_->
    if(!Models.busy.compareAndSet(false,true)){finishWith("busy");return@setPositiveButton}
    ownsJob=true
    // The engine flag is reset before the requestId is published, so a cancel taken from here on is not
    // wiped by prepare().
    if(imageJob)ImageModels.prepare()else Engine.prepare()
    Models.running.start(requestId,caller,imageJob)
    val page=android.widget.LinearLayout(this).apply{orientation=android.widget.LinearLayout.VERTICAL;setPadding(24,24,24,24)}
    val label=android.widget.TextView(this).apply{text="この端末で生成しています…"};page.addView(label)
    val cancel=OnBackInvokedCallback{Models.cancelJob(requestId);label.text="キャンセルしています…"}
    page.addView(android.widget.Button(this).apply{text="キャンセル";setOnClickListener{cancel.onBackInvoked()}});setContentView(page)
    backCallback=cancel
    onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,cancel)
    Models.worker.execute{
     val outcome=runCatching{
      val data=if(imageJob){
       val image=ImageModels.generate(this,requestId,prompt)
       val uri=android.net.Uri.parse(image.getString("uri"))
       Intent().setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        .putExtra("modality","image").putExtra("engine","stable-diffusion.cpp").putExtra("image",image.toString())
      }else{
       val text=Models.generate(prompt,tokens)
       Intent().putExtra("modality","text").putExtra("engine","llama.cpp").putExtra("text",text).putExtra("outputTokens",Engine.tokens())
      }
      data.putExtra("schema","awai.inference.result.v1").putExtra("requestId",requestId)
     }
     runOnUiThread{complete(caller,outcome)}
    }
   }.create().apply{secure(window!!)}.show()
 }
 private fun complete(caller:String,outcome:Result<Intent>){
  // Close cancellation and select the result together, before a new job can reset the engines.
  val result=Models.running.finish(requestId,outcome)
  ownsJob=false
  Models.busy.set(false)
  result.fold(
   onSuccess={data->
    try{
     data.data?.let{grantUriPermission(caller,it,Intent.FLAG_GRANT_READ_URI_PERMISSION)}
     finishOk(data)
    }catch(e:Exception){finishWith(ErrorCodes.of(e,"inference-unavailable"))}
   },
   onFailure={finishWith(ErrorCodes.of(it,"inference-unavailable"))}
  )
 }
 private fun secure(w:android.view.Window){w.setFlags(WindowManager.LayoutParams.FLAG_SECURE,WindowManager.LayoutParams.FLAG_SECURE)}
 private fun finishWith(code:String){if(!resultSet.compareAndSet(false,true))return;check(code in ErrorCodes.ALL);setResult(RESULT_CANCELED,Intent().putExtra("error",code));finish()}
 private fun finishOk(result:Intent){if(!resultSet.compareAndSet(false,true))return;setResult(RESULT_OK,result);finish()}
 override fun onDestroy(){
  backCallback?.let{onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it)}
  if(ownsJob)Models.cancelJob(requestId)
  super.onDestroy()
 }
}
