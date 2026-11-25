// Host test of the production JNI wrapper with the pinned API and a deterministic engine stub.
#include "stable-diffusion.h"
#include <jni.h>
#include <cassert>
#include <future>
#include <string>

extern "C" jbyteArray Java_network_awai_murakumo_ImageEngine_generate(JNIEnv*, jclass, jstring, jbyteArray);
extern "C" void Java_network_awai_murakumo_ImageEngine_cancel(JNIEnv*, jclass);
extern "C" void Java_network_awai_murakumo_ImageEngine_prepare(JNIEnv*, jclass);

struct sd_opt {};
struct sd_ctx_t {
    bool cancelled = false;
    sd_generation_progress_cb_t onProgress = nullptr;
    void* progressData = nullptr;
};
struct sd_result {};
struct sd_tensor_t {};

namespace {
struct Gate {
    std::promise<void> entered, release;
    void wait() {
        entered.set_value();
        release.get_future().wait();
    }
};
Gate* opening = nullptr;
Gate* cleaning = nullptr;
Gate* generating = nullptr;
bool failLoad = false;
int loads = 0, frees = 0, generates = 0, signals = 0;
constexpr int imageBytes = 512 * 512 * 4;
unsigned char image[imageBytes]{};
thread_local std::string failure;
_jbyteArray prompt, output;
_jstring root;
_jclass exceptionClass;

std::string runImage() {
    JNINativeInterface_ functions{};
    functions.GetArrayLength = [](JNIEnv*, jarray) -> jsize { return 1; };
    functions.GetByteArrayRegion = [](JNIEnv*, jbyteArray, jsize, jsize, jbyte* dest) { *dest = 'x'; };
    functions.GetStringUTFChars = [](JNIEnv*, jstring, jboolean*) { return "/fixtures"; };
    functions.ReleaseStringUTFChars = [](JNIEnv*, jstring, const char*) {};
    functions.FindClass = [](JNIEnv*, const char*) -> jclass { return &exceptionClass; };
    functions.ThrowNew = [](JNIEnv*, jclass, const char* code) -> jint { failure = code; return 0; };
    functions.ExceptionCheck = [](JNIEnv*) -> jboolean { return !failure.empty(); };
    functions.NewByteArray = [](JNIEnv*, jsize size) -> jbyteArray { assert(size == imageBytes); return &output; };
    functions.SetByteArrayRegion = [](JNIEnv*, jbyteArray, jsize, jsize, const jbyte*) {};
    JNIEnv env{&functions};
    failure.clear();
    auto result = Java_network_awai_murakumo_ImageEngine_generate(&env, nullptr, &root, &prompt);
    assert((result == &output) == failure.empty());
    return failure;
}

void testCancelDuringCreate(bool createFails) {
    const int oldFrees = frees, oldGenerates = generates, oldSignals = signals;
    Gate gate, cleanup;
    opening = &gate;
    cleaning = createFails ? nullptr : &cleanup;
    failLoad = createFails;
    Java_network_awai_murakumo_ImageEngine_prepare(nullptr, nullptr);
    auto worker = std::async(std::launch::async, runImage);
    gate.entered.get_future().wait();
    Java_network_awai_murakumo_ImageEngine_cancel(nullptr, nullptr);
    assert(worker.wait_for(std::chrono::seconds(0)) == std::future_status::timeout);
    assert(runImage() == "busy");
    assert(frees == oldFrees && generates == oldGenerates && signals == oldSignals);
    gate.release.set_value();
    if (!createFails) {
        cleanup.entered.get_future().wait();
        assert(worker.wait_for(std::chrono::seconds(0)) == std::future_status::timeout);
        assert(runImage() == "busy");
        cleanup.release.set_value();
    }
    assert(worker.get() == "cancelled");
    assert(generates == oldGenerates && signals == oldSignals);
    assert(frees == oldFrees + (createFails ? 0 : 1));
    opening = nullptr;
    cleaning = nullptr;
    failLoad = false;
    Java_network_awai_murakumo_ImageEngine_prepare(nullptr, nullptr);
    assert(runImage().empty());
    assert(frees == oldFrees + (createFails ? 1 : 2));
    assert(generates == oldGenerates + 1);
}

void testCancelRacingGenerationReset() {
    const int oldFrees = frees;
    Gate gate;
    generating = &gate;
    Java_network_awai_murakumo_ImageEngine_prepare(nullptr, nullptr);
    auto worker = std::async(std::launch::async, runImage);
    gate.entered.get_future().wait();
    Java_network_awai_murakumo_ImageEngine_cancel(nullptr, nullptr);
    gate.release.set_value();
    assert(worker.get() == "cancelled");
    assert(frees == oldFrees + 1);
    generating = nullptr;
    Java_network_awai_murakumo_ImageEngine_prepare(nullptr, nullptr);
    assert(runImage().empty());
}
}

sd_ctx_opt_t* sd_ctx_opt_create() { return new sd_opt; }
sd_img_gen_opt_t* sd_img_gen_opt_create() { return new sd_opt; }
void sd_opt_free(sd_opt_t* opt) { delete opt; }
sd_status_t sd_opt_set_string(sd_opt_t*, const char*, const char*) { return SD_STATUS_OK; }
sd_status_t sd_opt_set_int(sd_opt_t*, const char*, int64_t) { return SD_STATUS_OK; }
sd_status_t sd_opt_set_bool(sd_opt_t*, const char*, bool) { return SD_STATUS_OK; }
sd_status_t sd_opt_set_float(sd_opt_t*, const char*, double) { return SD_STATUS_OK; }
sd_status_t sd_opt_set_floats(sd_opt_t*, const char*, const float*, size_t) { return SD_STATUS_OK; }
void sd_set_log_callback(sd_log_cb_t, void*) {}
void sd_set_progress_callback(sd_progress_cb_t, void*) {}
sd_status_t sd_ctx_create(const sd_ctx_opt_t*, sd_ctx_t** context) {
    ++loads;
    if (opening) opening->wait();
    *context = failLoad ? nullptr : new sd_ctx_t;
    return failLoad ? SD_STATUS_LOAD_FAILED : SD_STATUS_OK;
}
void sd_ctx_free(sd_ctx_t* context) {
    if (cleaning) cleaning->wait();
    ++frees;
    delete context;
}
void sd_cancel_generation(sd_ctx_t* context, sd_cancel_mode_t) {
    ++signals;
    context->cancelled = true;
}
void sd_set_generation_progress_callback(sd_ctx_t* context, sd_generation_progress_cb_t callback, void* data) {
    context->onProgress = callback;
    context->progressData = data;
}
sd_status_t sd_generate_image(sd_ctx_t* context, const sd_img_gen_opt_t*, sd_result_t** result) {
    ++generates;
    if (generating) generating->wait();
    context->cancelled = false;
    if (context->onProgress) context->onProgress(nullptr, context->progressData);
    if (generating) assert(context->cancelled);
    if (context->cancelled) return SD_STATUS_GENERATION_FAILED;
    *result = new sd_result;
    return SD_STATUS_OK;
}
void sd_result_free(sd_result_t* result) { delete result; }
sd_result_kind_t sd_result_get_kind(const sd_result_t*) { return SD_RESULT_IMAGE; }
size_t sd_result_get_image_count(const sd_result_t*) { return 1; }
const sd_tensor_t* sd_result_get_image(const sd_result_t*, size_t) {
    static const sd_tensor_t tensor{};
    return &tensor;
}
sd_tensor_type_t sd_tensor_type(const sd_tensor_t*) { return SD_TENSOR_U8; }
size_t sd_tensor_rank(const sd_tensor_t*) { return 3; }
int64_t sd_tensor_dim(const sd_tensor_t*, size_t axis) { return axis == 0 ? 4 : 512; }
size_t sd_tensor_byte_size(const sd_tensor_t*) { return sizeof image; }
const void* sd_tensor_data(const sd_tensor_t*) { return image; }

int main() {
    Java_network_awai_murakumo_ImageEngine_cancel(nullptr, nullptr);
    assert(runImage() == "cancelled");
    assert(loads == 0 && frees == 0 && generates == 0);
    testCancelDuringCreate(false);
    testCancelDuringCreate(true);
    testCancelRacingGenerationReset();
}
