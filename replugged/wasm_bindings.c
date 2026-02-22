/*
 * WebAssembly Bindings for Regroove Effects
 * This file provides a clean C interface for JavaScript to call
 */

#include <emscripten.h>

// The actual effect headers are included in the Makefile compilation
// No additional bindings needed - we're using direct exports

// Optional: Helper functions for JavaScript if needed
EMSCRIPTEN_KEEPALIVE
void* create_audio_buffer(int size) {
    return malloc(size * sizeof(float));
}

EMSCRIPTEN_KEEPALIVE
void destroy_audio_buffer(void* buffer) {
    free(buffer);
}
