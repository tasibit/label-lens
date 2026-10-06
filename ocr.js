/* HalalCheck — ocr.js
 * Tesseract.js v7 wrapper + preprocessing.
 * Exposes global HCOcr = { recognize, preprocess, terminate }.
 *
 * Hosted mode: paths are relative to the app root (vendor/tesseract/*, vendor/lang/*).
 * Inline mode (single-file build): window.HC_INLINE = { worker, coreSimd, core, lang: { chi_sim, chi_tra } }
 * (all base64 strings). The worker script blob is prefixed with a self.fetch shim that serves
 * "<lang>.traineddata.gz" fetches from the embedded base64 lang data; cacheMethod is forced to 'none'.
 * The wasm core is picked (SIMD vs plain) on the main thread and handed to the worker via a corePath
 * blob URL whose fragment ends in ".wasm.js" so Tesseract.js's "direct file" code path is used
 * (no core-loading shim needed).
 */
(function (global) {
  'use strict';

  var VENDOR_BASE = './vendor/tesseract/';
  var LANG_BASE = './vendor/lang/';

  // One worker per language-set string, kept alive and reused.
  var workers = {}; // langKey -> Promise<Worker>

  // ---------------------------------------------------------------------
  // base64 <-> bytes
  // ---------------------------------------------------------------------
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Minimal SIMD-support probe (standard wasm-feature-detect test module).
  function wasmSimdSupported() {
    try {
      return WebAssembly.validate(new Uint8Array([
        // wasm-feature-detect "simd" module: (func (result v128) i32.const 0 i8x16.splat i8x16.popcnt) — the old
        // bytes here ended in `drop` and never validated, so every device silently got the slower non-SIMD core
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
        3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
      ]));
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Inline-mode worker construction
  //
  // Two file:// constraints shape this:
  //  1) A worker spawned from (or running inside) a file:// page cannot importScripts/new Worker()
  //     a blob: URL created by a different realm ("NetworkError ... failed to load", opaque origin).
  //     data: URIs work for *spawning* the worker.
  //  2) Chromium caps any single URL (including data:) at ~2,097,152 chars (kMaxURLChars). Our
  //     worker.min.js alone is small enough, but the embedded lang (~2.3 MB base64) and core
  //     (~5.3 MB base64) payloads are each far over that cap, so they cannot be baked into the
  //     worker's own data: URI, nor delivered via a second data:/blob: URL.
  // So: the worker's bootstrap script (data: URI) carries ONLY the shim logic + worker.min.js
  // (no payload, well under the cap). The actual core/lang bytes are sent via postMessage
  // (structured-clone of Uint8Arrays has no such size cap) immediately after the raw Worker is
  // constructed — before Tesseract.js's own first job message, so it's processed first (postMessage
  // delivery to a given target is strictly FIFO). The shim's self.importScripts override serves the
  // core from that in-memory copy (via indirect eval, equivalent to what importScripts would have
  // done); the self.fetch override serves the lang .gz the same way.
  // ---------------------------------------------------------------------
  function buildInlineShimSource() {
    return [
      '/* HalalCheck inline shim: serves embedded core/lang data via postMessage, not a 2nd URL */',
      'self.__HC_CORE__ = {};',
      'self.__HC_LANG__ = {};',
      'self.addEventListener("message", function (e) {',
      '  var d = e && e.data;',
      '  if (d && d.__hcInit) {',
      '    if (d.__hcInit.core) self.__HC_CORE__ = d.__hcInit.core;',
      '    if (d.__hcInit.lang) self.__HC_LANG__ = d.__hcInit.lang;',
      '    e.stopImmediatePropagation(); // keep this out of Tesseract.js\'s own dispatchHandlers,',
      '  }                               // which throws on a message with no recognized "action"',
      '}, false);',
      '(function () {',
      '  var _origFetch = (typeof self.fetch === "function") ? self.fetch.bind(self) : null;',
      '  self.fetch = function (url, opts) {',
      '    var s = String(url);',
      '    var m = /([A-Za-z0-9_]+)\\.traineddata\\.gz(?:[?#].*)?$/.exec(s);',
      '    if (m && self.__HC_LANG__[m[1]]) {',
      '      var bytes = self.__HC_LANG__[m[1]];',
      '      return Promise.resolve(new Response(bytes, { status: 200, statusText: "OK", headers: { "Content-Type": "application/gzip" } }));',
      '    }',
      '    if (_origFetch) return _origFetch(url, opts);',
      '    return Promise.reject(new Error("HalalCheck inline: no fetch shim match for " + s));',
      '  };',
      '  var _origImportScripts = self.importScripts.bind(self);',
      '  self.importScripts = function () {',
      '    var urls = Array.prototype.slice.call(arguments);',
      '    var allHandled = urls.length > 0 && urls.every(function (u) {',
      '      var s = String(u);',
      '      if (!/tesseract-core[\\w-]*\\.wasm\\.js(?:[?#].*)?$/.test(s)) return false;',
      '      var isSimd = /simd/i.test(s);',
      '      var coreBytes = isSimd ? self.__HC_CORE__.simd : self.__HC_CORE__.plain;',
      '      if (!coreBytes) return false;',
      '      var text = new TextDecoder("utf-8").decode(coreBytes);',
      '      (0, eval)(text); // eslint-disable-line no-eval -- equivalent to a normal importScripts',
      '      return true;',
      '    });',
      '    if (allHandled) return undefined;',
      '    return _origImportScripts.apply(self, urls);',
      '  };',
      '})();',
      ''
    ].join('\n');
  }

  // Base64-encode an arbitrary byte sequence (chunked to avoid call-stack limits on huge inputs).
  function bytesToB64(bytes) {
    var CHUNK = 0x8000;
    var binParts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binParts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(binParts.join(''));
  }

  // Decode the worker.min.js base64, prefix with the (payload-free) shim, return a data: URI.
  // (Not a blob: URL — see the file:// constraints noted above.)
  function buildInlineWorkerPath(inline) {
    var shimSrc = buildInlineShimSource();
    var workerSrc = new TextDecoder('utf-8').decode(b64ToBytes(inline.worker));
    var combinedBytes = new TextEncoder().encode(shimSrc + '\n' + workerSrc);
    return 'data:application/javascript;base64,' + bytesToB64(combinedBytes);
  }

  // Decode the embedded core/lang base64 into Uint8Arrays once, ready to postMessage.
  function buildInlineInitPayload(inline) {
    var langs = {};
    var inlineLang = inline.lang || {};
    Object.keys(inlineLang).forEach(function (k) {
      langs[k] = b64ToBytes(inlineLang[k]);
    });
    return {
      core: {
        simd: inline.coreSimd ? b64ToBytes(inline.coreSimd) : null,
        plain: inline.core ? b64ToBytes(inline.core) : null
      },
      lang: langs
    };
  }

  // ---------------------------------------------------------------------
  // Pre-download the core + language files from the main thread WITH byte progress, so a slow
  // mobile link shows "2.3 / 5.7 MB" instead of a silent "loading tesseract core" (phone test 04/10).
  // The service worker (or the HTTP cache) then serves the worker's own importScripts/fetch instantly.
  // ---------------------------------------------------------------------
  function prefetchAssets(urls, onProgress) {
    var totals = {}, loaded = {};
    function report(status) {
      var t = 0, l = 0;
      urls.forEach(function (u) { t += totals[u] || 0; l += loaded[u] || 0; });
      if (onProgress) onProgress({ status: status || 'downloading OCR engine', progress: t ? Math.min(1, l / t) : 0,
        detail: (l / 1048576).toFixed(1) + (t ? ' / ' + (t / 1048576).toFixed(1) : '') + ' MB' });
    }
    report();
    return Promise.all(urls.map(function (u) {
      return fetch(u).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' while downloading ' + u);
        var len = parseInt(resp.headers.get('Content-Length') || '0', 10);
        if (len) totals[u] = len;
        loaded[u] = 0;
        if (!resp.body || !resp.body.getReader) {
          return resp.arrayBuffer().then(function (b) { loaded[u] = b.byteLength; totals[u] = b.byteLength; report(); });
        }
        var reader = resp.body.getReader(), chunks = [];
        var ctype = resp.headers.get('Content-Type') || 'application/octet-stream';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) {
              if (!totals[u]) totals[u] = loaded[u];
              report();
              // store the COMPLETE file so the worker (and future offline runs) get it from the cache
              if (typeof caches !== 'undefined' && caches.open) {
                var blob = new Blob(chunks, { type: ctype });
                return caches.open('hc-assets').then(function (c) {
                  return c.put(new Request(u), new Response(blob, { status: 200, headers: { 'Content-Type': ctype, 'Content-Length': String(blob.size) } }));
                }).catch(function () { /* cache write failed (private mode?) — the HTTP cache still helps */ });
              }
              return;
            }
            chunks.push(r.value); loaded[u] += r.value.length; report();
            return pump();
          });
        }
        return pump();
      });
    })).then(function () { report('OCR engine downloaded'); });
  }

  // ---------------------------------------------------------------------
  // Worker acquisition (reused per language-set key)
  // ---------------------------------------------------------------------
  function getWorker(langKey, onProgress) {
    if (workers[langKey]) return workers[langKey];

    var inline = global.HC_INLINE;
    var createOpts;
    if (inline) {
      createOpts = {
        workerPath: buildInlineWorkerPath(inline),
        workerBlobURL: false, // spawn the Worker directly from the data: URI (no blob wrapper) —
                               // required for this to work under file://, see comments above
        corePath: 'inline-core', // never dereferenced as a real URL; matched by the importScripts shim
        langPath: 'inline-lang', // never dereferenced as a real URL; matched by the fetch shim
        gzip: true,
        cacheMethod: 'none',
        logger: function (m) { if (onProgress) onProgress(m); }
      };
    } else {
      // Point corePath directly at one of the two vendored core files rather than letting
      // Tesseract.js auto-pick a directory file: its own probe tries relaxed-SIMD first, and we
      // only vendor plain-SIMD + non-SIMD LSTM builds (per blueprint section 1/4).
      var coreFile = wasmSimdSupported() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
      createOpts = {
        workerPath: VENDOR_BASE + 'worker.min.js',
        corePath: VENDOR_BASE + coreFile,
        langPath: LANG_BASE.replace(/\/$/, ''),
        gzip: true,
        cacheMethod: 'write',
        logger: function (m) { if (onProgress) onProgress(m); }
      };
    }

    var langsArg = langKey.indexOf('+') >= 0 ? langKey.split('+') : langKey;

    var createPromise;
    if (inline) {
      // Intercept the raw Worker Tesseract.js is about to spawn (synchronously, inside
      // Tesseract.createWorker, before it sends any job message of its own) so we can hand it
      // the core/lang bytes first. See buildInlineShimSource()'s comment block for why this
      // postMessage path exists instead of a second data:/blob: URL.
      var initPayload = buildInlineInitPayload(inline);
      var OrigWorker = global.Worker;
      global.Worker = function (url, opts) {
        var w = new OrigWorker(url, opts);
        w.postMessage({ __hcInit: initPayload });
        return w;
      };
      try {
        createPromise = Tesseract.createWorker(langsArg, 1, createOpts);
      } finally {
        global.Worker = OrigWorker;
      }
    } else {
      var langList = Array.isArray(langsArg) ? langsArg : [langsArg];
      var urls = [VENDOR_BASE + coreFile].concat(langList.map(function (l) { return LANG_BASE.replace(/\/$/, '') + '/' + l + '.traineddata.gz'; }));
      createPromise = prefetchAssets(urls, onProgress).then(function () {
        return Tesseract.createWorker(langsArg, 1 /* LSTM only */, createOpts);
      });
    }

    var p = createPromise.then(function (worker) {
      return worker;
    }).catch(function (err) {
      delete workers[langKey];
      throw err;
    });
    // keep ONE resident worker: switching language on a phone must not pile up WASM runtimes (review finding 04/10)
    Object.keys(workers).forEach(function (k) {
      if (k === langKey) return;
      var old = workers[k]; delete workers[k];
      Promise.resolve(old).then(function (w) { try { w.terminate(); } catch (e) { /* ignore */ } }).catch(function () {});
    });
    workers[langKey] = p;
    return p;
  }

  // ---------------------------------------------------------------------
  // Preprocessing: rotate -> scale -> grayscale -> percentile contrast stretch -> (adaptive threshold)
  // ---------------------------------------------------------------------
  function preprocess(bitmap, opts) {
    opts = opts || {};
    var enhance = opts.enhance !== false;
    var rotate = ((opts.rotate || 0) % 360 + 360) % 360;

    var srcW = bitmap.width, srcH = bitmap.height;

    // 1) Rotate onto an intermediate canvas (0/90/180/270).
    var rotCanvas = document.createElement('canvas');
    var rotW = (rotate === 90 || rotate === 270) ? srcH : srcW;
    var rotH = (rotate === 90 || rotate === 270) ? srcW : srcH;
    rotCanvas.width = rotW;
    rotCanvas.height = rotH;
    var rctx = rotCanvas.getContext('2d');
    rctx.save();
    rctx.translate(rotW / 2, rotH / 2);
    rctx.rotate(rotate * Math.PI / 180);
    rctx.drawImage(bitmap, -srcW / 2, -srcH / 2, srcW, srcH);
    rctx.restore();

    // 2) Scale: longest side -> 2000px, upscale capped at 3x.
    var longest = Math.max(rotW, rotH);
    var targetLongest = 2000;
    var scale = targetLongest / longest;
    if (scale > 3) scale = 3; // small crops of the ingredient block need the extra magnification
    var outW = Math.max(1, Math.round(rotW * scale));
    var outH = Math.max(1, Math.round(rotH * scale));

    var canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rotCanvas, 0, 0, rotW, rotH, 0, 0, outW, outH);

    // 3) Grayscale.
    var imgData = ctx.getImageData(0, 0, outW, outH);
    var data = imgData.data;
    var n = outW * outH;
    var gray = new Uint8ClampedArray(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      gray[i] = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) | 0;
    }

    // 4) Percentile contrast stretch at 2nd/98th percentiles.
    var hist = new Uint32Array(256);
    for (i = 0; i < n; i++) hist[gray[i]]++;
    var lowCount = n * 0.02, highCount = n * 0.98;
    var cum = 0, lo = 0, hi = 255;
    for (i = 0; i < 256; i++) {
      cum += hist[i];
      if (cum >= lowCount) { lo = i; break; }
    }
    cum = 0;
    for (i = 255; i >= 0; i--) {
      cum += hist[i];
      if (cum >= (n - highCount)) { hi = i; break; }
    }
    if (hi <= lo) { lo = 0; hi = 255; }
    var range = hi - lo || 1;
    var stretched = new Uint8ClampedArray(n);
    for (i = 0; i < n; i++) {
      stretched[i] = Math.max(0, Math.min(255, Math.round((gray[i] - lo) * 255 / range)));
    }

    var finalGray = stretched;

    // 5) Optional adaptive threshold via integral image (window 31px, C = 8).
    if (enhance) {
      // light-on-dark labels (white text on red packaging): invert first, otherwise the adaptive threshold erases the text
      var sum = 0;
      for (i = 0; i < n; i++) sum += stretched[i];
      if (sum / n < 128) { for (i = 0; i < n; i++) stretched[i] = 255 - stretched[i]; }
      finalGray = adaptiveThreshold(stretched, outW, outH, 31, 8);
    }

    for (i = 0, p = 0; i < n; i++, p += 4) {
      var v = finalGray[i];
      data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas;
  }

  // Adaptive mean threshold using an integral image for O(n) box-sum lookups.
  function adaptiveThreshold(gray, w, h, windowPx, C) {
    var half = Math.max(1, windowPx >> 1);
    // Integral image with 1px zero border for O(1) box-sum lookups.
    var integral = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        integral[(y + 1) * (w + 1) + (x + 1)] =
          gray[y * w + x] +
          integral[y * (w + 1) + (x + 1)] +
          integral[(y + 1) * (w + 1) + x] -
          integral[y * (w + 1) + x];
      }
    }

    function boxSum(x0, y0, x1, y1) {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0);
      x1 = Math.min(w - 1, x1); y1 = Math.min(h - 1, y1);
      if (x1 < x0 || y1 < y0) return { sum: 0, count: 0 };
      var sum = integral[(y1 + 1) * (w + 1) + (x1 + 1)]
        - integral[y0 * (w + 1) + (x1 + 1)]
        - integral[(y1 + 1) * (w + 1) + x0]
        + integral[y0 * (w + 1) + x0];
      var count = (x1 - x0 + 1) * (y1 - y0 + 1);
      return { sum: sum, count: count };
    }

    var out = new Uint8ClampedArray(w * h);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var r = boxSum(x - half, y - half, x + half, y + half);
        var mean = r.count ? r.sum / r.count : gray[y * w + x];
        var v = gray[y * w + x];
        out[y * w + x] = (v > (mean - C)) ? 255 : 0;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Post-processing
  // ---------------------------------------------------------------------
  function isCJK(ch) {
    var c = ch.codePointAt(0);
    return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) ||
      (c >= 0xF900 && c <= 0xFAFF) || (c >= 0x3000 && c <= 0x303F) ||
      (c >= 0xFF00 && c <= 0xFFEF);
  }

  function fullWidthToHalfWidth(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xFF01 && c <= 0xFF5E) {
        out += String.fromCharCode(c - 0xFEE0);
      } else if (c === 0x3000) {
        out += ' '; // full-width space
      } else {
        out += str[i];
      }
    }
    return out;
  }

  function postProcessText(text) {
    if (!text) return '';
    var s = fullWidthToHalfWidth(text);
    // Drop ASCII spaces that sit between two CJK characters.
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === ' ') {
        var prev = out.length ? out[out.length - 1] : '';
        var next = s[i + 1] || '';
        if (prev && next && isCJK(prev) && isCJK(next)) continue;
      }
      out += ch;
    }
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.trim();
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------
  async function recognize(fileOrCanvas, options) {
    options = options || {};
    var lang = options.lang || 'chi_sim';
    var enhance = options.enhance !== false;
    var rotate = options.rotate || 0;
    var onProgress = options.onProgress;

    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    var canvas = fileOrCanvas;

    if (typeof HTMLCanvasElement !== 'undefined' && fileOrCanvas instanceof HTMLCanvasElement) {
      // a canvas is just another image source: scale and enhance it too, so the Enhance toggle always applies
      canvas = preprocess(fileOrCanvas, { enhance: enhance, rotate: rotate });
    } else {
      var bitmap = fileOrCanvas;
      if (fileOrCanvas instanceof Blob || (typeof File !== 'undefined' && fileOrCanvas instanceof File)) {
        bitmap = await createImageBitmap(fileOrCanvas, { imageOrientation: 'from-image' });
      }
      canvas = preprocess(bitmap, { enhance: enhance, rotate: rotate });
    }

    var worker;
    try {
      worker = await getWorker(lang, onProgress);
    } catch (err) {
      throw new Error('HalalCheck: failed to load the OCR engine (' + (err && err.message ? err.message : err) +
        '). Use the Paste tab with your phone\'s own text extraction instead.');
    }

    var blockMode = options.blockMode !== false;
    await worker.setParameters({
      tessedit_pageseg_mode: blockMode ? '6' : '3',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });

    var result;
    try {
      result = await worker.recognize(canvas);
    } catch (err) {
      throw new Error('HalalCheck: OCR recognition failed (' + (err && err.message ? err.message : err) +
        '). Use the Paste tab with your phone\'s own text extraction instead.');
    }

    var rawText = (result && result.data && result.data.text) || '';
    var text = postProcessText(rawText);
    var confidence = (result && result.data && typeof result.data.confidence === 'number') ? result.data.confidence : null;
    var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    return { text: text, confidence: confidence, ms: Math.round(t1 - t0) };
  }

  async function terminate() {
    var keys = Object.keys(workers);
    for (var i = 0; i < keys.length; i++) {
      try {
        var w = await workers[keys[i]];
        await w.terminate();
      } catch (e) { /* ignore */ }
      delete workers[keys[i]];
    }
  }

  var HCOcr = {
    recognize: recognize,
    preprocess: preprocess,
    terminate: terminate,
    _postProcessText: postProcessText // exposed for tests
  };

  global.HCOcr = HCOcr;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HCOcr;
  }
})(typeof self !== 'undefined' ? self : this);
