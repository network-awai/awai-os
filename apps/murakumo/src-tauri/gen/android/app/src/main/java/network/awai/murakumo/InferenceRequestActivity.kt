package network.awai.murakumo
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager

/**
 * Explicit, signature-protected per-request handoff. No HTTP endpoint or background grant.
 * The prompt may be PHI (karute): every window this Activity shows is FLAG_SECURE and has no Recents
 * snapshot, so the confirmation text and the progress page stay out of screenshots, screen recording
 * and the Recents thumbnail. Errors leave only as fixed codes (ErrorCodes); nothing is logged.
 */
class InferenceRequestActivity:Activity(){
 private var ownsJob=false
 private var imageJob=false
 override fun onCreate(saved:Bundle?){super.onCreate(saved)
  secure(window);setRecentsScreenshotEnabled(false)
  val caller=callingPackage
  if(!Models.trustedCaller(this,caller)){finishWith("caller-denied");return}
  val requestId=intent.getStringExtra("requestId")?:"";val prompt=intent.getStringExtra("prompt")?:"";val tokens=intent.getIntExtra("maxTokens",128);val modality=intent.getStringExtra("modality")
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
    val page=android.widget.LinearLayout(this).apply{orientation=android.widget.LinearLayout.VERTICAL;setPadding(24,24,24,24)}
    val label=android.widget.TextView(this).apply{text="この端末で生成しています…"};page.addView(label)
    page.addView(android.widget.Button(this).apply{text="キャンセル";setOnClickListener{if(modality=="image")ImageModels.cancel()else Engine.cancel();label.text="キャンセルしています…"}});setContentView(page)
    if(modality=="image")ImageModels.prepare()else Engine.prepare()
    Models.worker.execute{try{if(modality=="image"){
      val image=ImageModels.generate(this,requestId,prompt);val uri=android.net.Uri.parse(image.getString("uri"));grantUriPermission(caller,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)
      runOnUiThread{setResult(RESULT_OK,Intent().setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra("schema","awai.inference.result.v1").putExtra("requestId",requestId).putExtra("modality","image").putExtra("engine","stable-diffusion.cpp").putExtra("image",image.toString()));finish()}
     }else{val text=Models.generate(prompt,tokens);val outputTokens=Engine.tokens();runOnUiThread{setResult(RESULT_OK,Intent().putExtra("schema","awai.inference.result.v1").putExtra("requestId",requestId).putExtra("modality","text").putExtra("engine","llama.cpp").putExtra("text",text).putExtra("outputTokens",outputTokens));finish()}}}catch(e:Exception){val code=ErrorCodes.of(e,"inference-unavailable");runOnUiThread{finishWith(code)}}finally{ownsJob=false;Models.busy.set(false)}}
   }.create().apply{secure(window!!)}.show()
 }
 private fun secure(w:android.view.Window){w.setFlags(WindowManager.LayoutParams.FLAG_SECURE,WindowManager.LayoutParams.FLAG_SECURE)}
 private fun finishWith(code:String){check(code in ErrorCodes.ALL);setResult(RESULT_CANCELED,Intent().putExtra("error",code));finish()}
 override fun onDestroy(){if(ownsJob){if(imageJob)ImageModels.cancel()else Engine.cancel();};super.onDestroy()}
}
