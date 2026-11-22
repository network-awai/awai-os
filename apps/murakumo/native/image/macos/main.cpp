#include <CommonCrypto/CommonDigest.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#include <stable-diffusion.h>

#include <array>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>

#include "models.h"

namespace {
constexpr int size = 512;
constexpr size_t maxPng = 4 * 1024 * 1024;

int fail(const char* code) {
    std::cerr << code << '\n';
    return 1;
}

bool fileMatches(const std::filesystem::path& path, const ModelFile& model, bool verify) {
    std::error_code error;
    if (!std::filesystem::is_regular_file(path, error) ||
        std::filesystem::file_size(path, error) != model.bytes || error) return false;
    if (!verify) return true;

    std::ifstream file(path, std::ios::binary);
    auto buffer = std::make_unique<std::array<char, 1024 * 1024>>();
    CC_SHA256_CTX sha;
    CC_SHA256_Init(&sha);
    while (file.read(buffer->data(), buffer->size()) || file.gcount()) {
        CC_SHA256_Update(&sha, buffer->data(), static_cast<CC_LONG>(file.gcount()));
    }
    if (!file.eof() || file.bad()) return false;
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256_Final(digest, &sha);
    char hex[2 * CC_SHA256_DIGEST_LENGTH + 1];
    for (size_t i = 0; i < sizeof(digest); ++i) std::snprintf(hex + 2 * i, 3, "%02x", digest[i]);
    return std::string_view(hex) == model.sha256;
}

bool writePng(const sd_tensor_t* image) {
    if (!image || sd_tensor_type(image) != SD_TENSOR_U8 || sd_tensor_rank(image) != 3 ||
        sd_tensor_dim(image, 1) != size || sd_tensor_dim(image, 2) != size) return false;
    const auto channels = sd_tensor_dim(image, 0);
    if ((channels != 3 && channels != 4) || sd_tensor_byte_size(image) != size * size * channels) return false;
    const auto* pixels = static_cast<const UInt8*>(sd_tensor_data(image));
    if (!pixels) return false;

    auto provider = CGDataProviderCreateWithData(nullptr, pixels, size * size * channels, nullptr);
    auto space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    auto bitmap = CGImageCreate(size, size, 8, 8 * channels, size * channels, space,
        channels == 4 ? kCGImageAlphaLast : kCGImageAlphaNone, provider, nullptr, false, kCGRenderingIntentDefault);
    auto data = CFDataCreateMutable(nullptr, 0);
    auto destination = CGImageDestinationCreateWithData(data, CFSTR("public.png"), 1, nullptr);
    if (bitmap && destination) CGImageDestinationAddImage(destination, bitmap, nullptr);
    const bool encoded = bitmap && destination && CGImageDestinationFinalize(destination);
    const auto count = CFDataGetLength(data);
    const bool written = encoded && count > 0 && static_cast<size_t>(count) <= maxPng &&
        fwrite(CFDataGetBytePtr(data), 1, count, stdout) == static_cast<size_t>(count) && fflush(stdout) == 0;
    if (destination) CFRelease(destination);
    CFRelease(data);
    if (bitmap) CGImageRelease(bitmap);
    CGColorSpaceRelease(space);
    CGDataProviderRelease(provider);
    return written;
}

bool ok(sd_status_t result) { return result == SD_STATUS_OK; }
}

int main(int argc, const char* argv[]) {
    if (argc == 2 && std::string_view(argv[1]) == "version") {
        std::cout << "murakumo-image.v1 " << modelId << '\n';
        return 0;
    }
    if (argc != 3) return fail("invalid-command");
    const std::string_view action = argv[1];
    if (action != "status" && action != "generate") return fail("invalid-command");
    const std::filesystem::path root = argv[2];
    for (const auto& model : models)
        if (!fileMatches(root / model.name, model, action == "generate")) return fail("image-model-unavailable");
    if (action == "status") return 0;

    std::string prompt(8193, '\0');
    std::cin.read(prompt.data(), prompt.size());
    prompt.resize(std::cin.gcount());
    if (prompt.empty() || prompt.size() > 8192 || prompt.find('\0') != std::string::npos || std::cin.bad())
        return fail("invalid-prompt");

    sd_set_log_callback([](sd_log_level_t, const char*, void*) {}, nullptr);
    const std::unique_ptr<sd_opt_t, decltype(&sd_opt_free)> contextOptions(sd_ctx_opt_create(), sd_opt_free);
    auto* c = contextOptions.get();
    if (!c || !ok(sd_opt_set_string(c, "diffusion_model_path", (root / models[1].name).c_str())) ||
        !ok(sd_opt_set_string(c, "llm_path", (root / models[0].name).c_str())) ||
        !ok(sd_opt_set_string(c, "vae_path", (root / models[2].name).c_str())) ||
        !ok(sd_opt_set_string(c, "backend", "Metal")) || !ok(sd_opt_set_string(c, "params_backend", "CPU")) ||
        !ok(sd_opt_set_int(c, "n_threads", 6)) || !ok(sd_opt_set_bool(c, "enable_mmap", true)) ||
        !ok(sd_opt_set_bool(c, "diffusion_flash_attn", true))) return fail("image-options-rejected");

    sd_ctx_t* context = nullptr;
    if (!ok(sd_ctx_create(c, &context))) return fail("image-model-load-failed");
    const std::unique_ptr<sd_ctx_t, decltype(&sd_ctx_free)> contextOwner(context, sd_ctx_free);
    const std::unique_ptr<sd_opt_t, decltype(&sd_opt_free)> options(sd_img_gen_opt_create(), sd_opt_free);
    auto* g = options.get();
    const float sigmas[] = {1.f, .978453f, .95418f, .926626f, .89508f, .845148f, .704534f, .414568f, 0.f};
    if (!g || !ok(sd_opt_set_string(g, "prompt", prompt.c_str())) ||
        !ok(sd_opt_set_int(g, "width", size)) || !ok(sd_opt_set_int(g, "height", size)) ||
        !ok(sd_opt_set_int(g, "seed", 42)) || !ok(sd_opt_set_string(g, "sample.method", "euler")) ||
        !ok(sd_opt_set_int(g, "sample.steps", 8)) || !ok(sd_opt_set_float(g, "sample.guidance.txt_cfg", 1.0)) ||
        !ok(sd_opt_set_floats(g, "sample.sigmas", sigmas, 9))) return fail("image-options-rejected");
    sd_result_t* output = nullptr;
    const auto status = sd_generate_image(context, g, &output);
    const std::unique_ptr<sd_result_t, decltype(&sd_result_free)> outputOwner(output, sd_result_free);
    if (!ok(status) || !output || sd_result_get_kind(output) != SD_RESULT_IMAGE ||
        sd_result_get_image_count(output) != 1 || !writePng(sd_result_get_image(output, 0)))
        return fail("image-generation-failed");
    return 0;
}
