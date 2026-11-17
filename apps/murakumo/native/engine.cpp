#include "llama.h"
#include <jni.h>
#include <mutex>
#include <atomic>
#include <vector>
#include <string>
#include <chrono>
#include <memory>
namespace {
std::mutex lock;
std::once_flag initialized;
llama_model *model=nullptr;
std::atomic<bool> cancelled{false};
std::atomic<int> produced{0};
void fail(JNIEnv *env,const char *code){env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),code);}
struct Context {llama_context*p=nullptr;~Context(){if(p)llama_free(p);}};
struct Batch {llama_batch_ext*p=nullptr;~Batch(){if(p)llama_batch_ext_free(p);}};
struct Sampler {llama_sampler*p=nullptr;~Sampler(){if(p)llama_sampler_free(p);}};
void batch(Batch&b,const llama_token*t,int n,int start){llama_batch_ext_clear(b.p);for(int i=0;i<n;i++){auto index=llama_batch_ext_add_token(b.p,0,t[i]);llama_pos pos=start+i;llama_batch_ext_set_pos(b.p,index,&pos);}llama_batch_ext_set_output_logits(b.p,n-1,true);}
}
extern "C" JNIEXPORT jboolean JNICALL Java_network_awai_murakumo_Engine_load(JNIEnv*env,jclass,jstring file){
 std::unique_lock<std::mutex> guard(lock,std::try_to_lock);if(!guard.owns_lock()){fail(env,"busy");return false;}
 if(model){fail(env,"release-required");return false;}
 std::call_once(initialized,[]{llama_backend_init();llama_log_set([](ggml_log_level,const char*,void*){},nullptr);});
 const char*p=env->GetStringUTFChars(file,nullptr);auto params=llama_model_default_params();params.n_gpu_layers=0;
 model=llama_model_load_from_file(p,params);env->ReleaseStringUTFChars(file,p);
 if(!model){fail(env,"model-load-failed");return false;}return true;
}
extern "C" JNIEXPORT jboolean JNICALL Java_network_awai_murakumo_Engine_loaded(JNIEnv*,jclass){std::unique_lock<std::mutex>g(lock,std::try_to_lock);return g.owns_lock()&&model;}
extern "C" JNIEXPORT void JNICALL Java_network_awai_murakumo_Engine_prepare(JNIEnv*,jclass){cancelled=false;produced=0;}
extern "C" JNIEXPORT jint JNICALL Java_network_awai_murakumo_Engine_tokens(JNIEnv*,jclass){return produced.load();}
extern "C" JNIEXPORT void JNICALL Java_network_awai_murakumo_Engine_cancel(JNIEnv*,jclass){cancelled=true;}
extern "C" JNIEXPORT void JNICALL Java_network_awai_murakumo_Engine_release(JNIEnv*env,jclass){std::unique_lock<std::mutex>g(lock,std::try_to_lock);if(!g.owns_lock()){fail(env,"busy");return;}if(model)llama_model_free(model);model=nullptr;}
extern "C" JNIEXPORT jbyteArray JNICALL Java_network_awai_murakumo_Engine_generate(JNIEnv*env,jclass,jbyteArray raw,jint count){
 std::unique_lock<std::mutex>guard(lock,std::try_to_lock);if(!guard.owns_lock()){fail(env,"busy");return nullptr;}
 const int bytes=env->GetArrayLength(raw);if(!model||bytes<1||bytes>8192||count<1||count>256){fail(env,"invalid-request");return nullptr;}
 std::string prompt(bytes,'\0');env->GetByteArrayRegion(raw,0,bytes,reinterpret_cast<jbyte*>(prompt.data()));
 // Admitted model is the exact Qwen3 artifact; disable its optional thinking mode.
 prompt="<|im_start|>user\n"+prompt+"<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
 auto*vocab=llama_model_get_vocab(model);int needed=-llama_tokenize(vocab,prompt.data(),prompt.size(),nullptr,0,true,true);
 if(needed<1||needed+count>2048){fail(env,"context-limit");return nullptr;}
 std::vector<llama_token>tokens(needed);if(llama_tokenize(vocab,prompt.data(),prompt.size(),tokens.data(),needed,true,true)!=needed){fail(env,"tokenize-failed");return nullptr;}
 auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(90);
 auto params=llama_context_default_params();params.abort_callback=[](void*p){return cancelled.load()||std::chrono::steady_clock::now()>*static_cast<std::chrono::steady_clock::time_point*>(p);};params.abort_callback_data=&deadline;params.n_ctx=2048;params.n_batch=2048;params.n_threads=4;params.n_threads_batch=4;
 Context ctx{llama_init_from_model(model,params)};if(!ctx.p){fail(env,"context-failed");return nullptr;}
 Batch b{llama_batch_ext_init(ctx.p)};Sampler smpl{llama_sampler_chain_init(llama_sampler_chain_default_params())};
 if(!b.p||!smpl.p){fail(env,"allocation-failed");return nullptr;}llama_sampler_chain_add(smpl.p,llama_sampler_init_greedy());
 batch(b,tokens.data(),needed,0);int pos=needed;std::string output;
 for(int i=0;i<count;i++){
  if(cancelled||std::chrono::steady_clock::now()>deadline){fail(env,cancelled?"cancelled":"timeout");return nullptr;}
  if(llama_process(ctx.p,LLAMA_PROCESS_TYPE_DECODE,b.p)){fail(env,"decode-failed");return nullptr;}
  auto token=llama_sampler_sample(smpl.p,ctx.p,-1);if(llama_vocab_is_eog(vocab,token))break;
  char piece[1024];int size=llama_token_to_piece(vocab,token,piece,sizeof(piece),0,false);if(size<0||output.size()+size>65536){fail(env,"output-limit");return nullptr;}
  output.append(piece,size);produced++;batch(b,&token,1,pos++);
 }
 auto result=env->NewByteArray(output.size());if(result)env->SetByteArrayRegion(result,0,output.size(),reinterpret_cast<const jbyte*>(output.data()));return result;
}
