/**
 * Offscreen document.
 *
 * Phase 8 runs pdf.js and mammoth here, because an MV3 service worker has no
 * DOM, no canvas, and blocks dynamic import, which pdf.js needs. The file
 * exists now so the build target resolves; it does nothing yet.
 */

export {};
