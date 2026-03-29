/**
 * ADF Parser - JavaScript wrapper for WASM module
 * Provides high-level API for extracting modules from ADF disk images
 *
 * Copyright (C) 2026
 * SPDX-License-Identifier: ISC
 */

import createADFParserModule from './adf-parser-wasm.js';

let wasmModule = null;
let wasmReady = false;

// Initialize WASM module
async function initWasm() {
    if (wasmReady) return wasmModule;

    wasmModule = await createADFParserModule();
    wasmReady = true;
    return wasmModule;
}

/**
 * Check if a file is an ADF disk image
 * @param {File} file - The file to check
 * @returns {boolean} True if the file is an ADF
 */
export function isADFFile(file) {
    if (!file || !file.name) return false;
    const fileName = file.name.toLowerCase();
    return fileName.endsWith('.adf');
}

/**
 * Extract module files from an ADF disk image
 * @param {File} adfFile - The ADF file to parse
 * @returns {Promise<File[]>} Array of extracted module files
 */
export async function extractModulesFromADF(adfFile) {
    const wasm = await initWasm();
    const extractedModules = [];

    try {
        // Read ADF file into memory
        const arrayBuffer = await adfFile.arrayBuffer();
        const diskData = new Uint8Array(arrayBuffer);

        // Allocate WASM memory for disk image
        const diskPtr = wasm._adf_wasm_alloc(diskData.length);
        if (!diskPtr) {
            console.error('Failed to allocate WASM memory for disk');
            return extractedModules;
        }

        // Copy disk data to WASM memory
        wasm.HEAPU8.set(diskData, diskPtr);

        // Initialize ADF parser
        const initResult = wasm._adf_wasm_init(diskPtr, diskData.length);
        if (!initResult) {
            console.error('Failed to initialize ADF parser');
            wasm._adf_wasm_free(diskPtr);
            return extractedModules;
        }

        // Scan for files
        const fileCount = wasm._adf_wasm_scan_files();
        console.log(`Found ${fileCount} files in ADF`);

        // Extract each module file
        for (let i = 0; i < fileCount; i++) {
            const isModule = wasm._adf_wasm_is_module(i);
            if (!isModule) continue;

            const filenamePtr = wasm._adf_wasm_get_filename(i);
            const filename = wasm.UTF8ToString(filenamePtr);
            const fileSize = wasm._adf_wasm_get_file_size(i);

            // Allocate buffer for file data
            const fileDataPtr = wasm._adf_wasm_alloc(fileSize);
            if (!fileDataPtr) {
                console.error(`Failed to allocate memory for ${filename}`);
                continue;
            }

            // Extract file data
            const extracted = wasm._adf_wasm_extract_file(i, fileDataPtr, fileSize);
            if (extracted !== fileSize) {
                console.error(`Failed to extract ${filename}`);
                wasm._adf_wasm_free(fileDataPtr);
                continue;
            }

            // Copy data from WASM memory to JavaScript
            const fileData = new Uint8Array(fileSize);
            fileData.set(wasm.HEAPU8.subarray(fileDataPtr, fileDataPtr + fileSize));

            // Create File object
            const moduleFile = new File([fileData], filename, {
                type: 'application/octet-stream'
            });

            extractedModules.push(moduleFile);

            // Free file data buffer
            wasm._adf_wasm_free(fileDataPtr);

            console.log(`Extracted: ${filename} (${fileSize} bytes)`);
        }

        // Free disk buffer
        wasm._adf_wasm_free(diskPtr);

    } catch (error) {
        console.error('Error extracting modules from ADF:', error);
    }

    return extractedModules;
}
