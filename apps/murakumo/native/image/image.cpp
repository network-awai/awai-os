#include "stable-diffusion.h"
#include <jni.h>
#include <android/log.h>
#include <mutex>
#include <atomic>
#include <string>
#include <vector>
namespace {
std::mutex mutex,ctxMutex;
std::atomic<bool>cancelled{false};
sd_ctx_t *ctx=nullptr;
std::atomic<int> progress{0};
void fail(JNIEnv*e,const char*c){__android_log_print(ANDROID_LOG_ERROR,"AwaiImage","%s",c);e->ThrowNew(e->FindClass("java/lang/IllegalStateException"),c);}
struct Opt {sd_opt_t*p;~Opt(){sd_opt_free(p);}};
struct Result {sd_result_t*p=nullptr;~Result(){sd_result_free(p);}};
std::string str(JNIEnv*e,jstring s){const char*p=e->GetStringUTFChars(s,nullptr);std::string x(p);e->ReleaseStringUTFChars(s,p);return x;}
bool ok(sd_status_t s){return s==SD_STATUS_OK;}
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_network_awai_murakumo_ImageEngine_generate(JNIEnv*e,jclass,jstring root,jbyteArray raw){
 std::unique_lock<std::mutex> guard(mutex,std::try_to_lock);if(!guard.owns_lock()){fail(e,"busy");return nullptr;}
 const int n=e->GetArrayLength(raw);if(n<1||n>8192){fail(e,"prompt-limit");return nullptr;}
 std::string prompt(n,'\0');e->GetByteArrayRegion(raw,0,n,reinterpret_cast<jbyte*>(prompt.data()));
 if(prompt.find('\0')!=std::string::npos){fail(e,"invalid-prompt");return nullptr;}
 auto path=str(e,root);Opt c{sd_ctx_opt_create()};progress=0;
 sd_set_log_callback([](sd_log_level_t level,const char*text,void*){if(level>=SD_LOG_INFO)__android_log_print(ANDROID_LOG_INFO,"AwaiImage","%s",text);},nullptr);
 sd_set_progress_callback([](int step,int total,float,void*){progress=total?step*100/total:0;__android_log_print(ANDROID_LOG_INFO,"AwaiImage","step %d/%d",step,total);},nullptr);
 bool valid=c.p&&ok(sd_opt_set_string(c.p,"diffusion_model_path",(path+"/denoiser.gguf").c_str()))&&ok(sd_opt_set_string(c.p,"llm_path",(path+"/encoder.gguf").c_str()))&&ok(sd_opt_set_string(c.p,"vae_path",(path+"/vae.safetensors").c_str()))&&ok(sd_opt_set_string(c.p,"backend","Vulkan0"))&&ok(sd_opt_set_string(c.p,"params_backend","CPU"))&&ok(sd_opt_set_int(c.p,"n_threads",6))&&ok(sd_opt_set_bool(c.p,"diffusion_flash_attn",true))&&ok(sd_opt_set_bool(c.p,"enable_mmap",true));
 if(!valid){fail(e,"image-options-rejected");return nullptr;}
 sd_ctx_t*created=nullptr;if(!ok(sd_ctx_create(c.p,&created))){fail(e,"image-model-load-failed");return nullptr;}
 {std::lock_guard<std::mutex> state(ctxMutex);ctx=created;if(cancelled)sd_cancel_generation(ctx,SD_CANCEL_ALL);}
 // Prompt-bearing generation logs must not enter Android logcat.
 sd_set_log_callback([](sd_log_level_t,const char*,void*){},nullptr);
 Opt g{sd_img_gen_opt_create()};Result result;
 float sigmas[]={1.f,.978453f,.95418f,.926626f,.89508f,.845148f,.704534f,.414568f,0.f};
 valid=g.p&&ok(sd_opt_set_string(g.p,"prompt",prompt.c_str()))&&ok(sd_opt_set_int(g.p,"width",512))&&ok(sd_opt_set_int(g.p,"height",512))&&ok(sd_opt_set_int(g.p,"seed",42))&&ok(sd_opt_set_string(g.p,"sample.method","euler"))&&ok(sd_opt_set_int(g.p,"sample.steps",8))&&ok(sd_opt_set_float(g.p,"sample.guidance.txt_cfg",1.))&&ok(sd_opt_set_floats(g.p,"sample.sigmas",sigmas,9));
 auto status=valid?sd_generate_image(ctx,g.p,&result.p):SD_STATUS_INVALID_ARGUMENT;
 {std::lock_guard<std::mutex>state(ctxMutex);sd_ctx_free(ctx);ctx=nullptr;}
 if(!ok(status)||!result.p||sd_result_get_kind(result.p)!=SD_RESULT_IMAGE||sd_result_get_image_count(result.p)!=1){fail(e,"image-generation-failed");return nullptr;}
 auto t=sd_result_get_image(result.p,0);if(t)__android_log_print(ANDROID_LOG_INFO,"AwaiImage","output type=%d rank=%zu C=%lld W=%lld H=%lld bytes=%zu",sd_tensor_type(t),sd_tensor_rank(t),(long long)sd_tensor_dim(t,0),(long long)sd_tensor_dim(t,1),(long long)sd_tensor_dim(t,2),sd_tensor_byte_size(t));
 if(!t||sd_tensor_type(t)!=SD_TENSOR_U8||sd_tensor_rank(t)!=3||(sd_tensor_dim(t,0)!=3&&sd_tensor_dim(t,0)!=4)||sd_tensor_dim(t,1)!=512||sd_tensor_dim(t,2)!=512||sd_tensor_byte_size(t)!=512*512*sd_tensor_dim(t,0)){fail(e,"invalid-image-output");return nullptr;}
 // The pinned engine emits RGBA for this model; preserve alpha. RGB is promoted explicitly.
 const auto channels=sd_tensor_dim(t,0);const auto*data=static_cast<const unsigned char*>(sd_tensor_data(t));
 std::vector<unsigned char> rgba(512*512*4);for(int i=0;i<512*512;i++){for(int j=0;j<3;j++)rgba[i*4+j]=data[i*channels+j];rgba[i*4+3]=channels==4?data[i*4+3]:255;}
 auto b=e->NewByteArray(rgba.size());if(b)e->SetByteArrayRegion(b,0,rgba.size(),reinterpret_cast<const jbyte*>(rgba.data()));progress=100;return b;
}
extern "C" JNIEXPORT jint JNICALL Java_network_awai_murakumo_ImageEngine_progress(JNIEnv*,jclass){return progress.load();}
// Cancellation is cooperative; never free a running context from the UI thread.
extern "C" JNIEXPORT void JNICALL Java_network_awai_murakumo_ImageEngine_cancel(JNIEnv*,jclass){cancelled=true;std::lock_guard<std::mutex>g(ctxMutex);if(ctx)sd_cancel_generation(ctx,SD_CANCEL_ALL);}

extern "C" JNIEXPORT void JNICALL Java_network_awai_murakumo_ImageEngine_prepare(JNIEnv*,jclass){cancelled=false;progress=0;}
