/* ppocr.js — PP-OCRv4 (det + cls + rec, ONNX) in the browser for Label Lens / HalalCheck.
 *
 * Port of the RapidOCR 1.4.4 pipeline that the GB10 server runs (server/ocr_server.py), so the public copy
 * (no server behind it) reads packaging with the same engine, entirely on the phone.
 *
 *   HCPpocr.isSupported()            -> boolean
 *   HCPpocr.prefetch(onProgress)     -> Promise; downloads the heavy files with byte progress {loaded,total,file}
 *                                       into Cache Storage 'hc-assets' (the service worker serves them from there)
 *   HCPpocr.ready(onProgress)        -> Promise; ONNX sessions (det, rec, cls) created once and reused
 *   HCPpocr.recognize(source, opts)  -> Promise<{ text, confidence, lines:[{text,conf,box:[x0,y0,x1,y1]}], ms, engine:'ppocr-web',
 *                                                rotated, zoomed, width, height }>
 *        source: HTMLImageElement | HTMLCanvasElement | ImageBitmap | Blob
 *        opts:   { maxSide: 2000, onProgress: fn({status, progress}), zoomPass: true, autoRotate: true }
 *                maxSide 2000 = RapidOCR's max_side_len, i.e. what the GB10 server feeds its detector (1600 is ~25% faster
 *                and measurably less faithful on photos where the pack is small in the frame).
 *        Box coordinates are source pixels; if `rotated` is 90/270 they are in the source turned by that many
 *        degrees counter-clockwise (the engine found the text running sideways and turned the picture).
 *   HCPpocr.dispose()                -> Promise; releases sessions and the worker
 *
 * Inference runs in a dedicated Worker built from a Blob URL (no extra file), falling back to the page when
 * Workers are unavailable. ES5 only (Samsung Internet / Safari 16): no arrows, let/const, optional chaining.
 * No network traffic other than same-origin ./vendor/ppocr/ fetches; no image data is logged.
 */
(function (root) {
  'use strict';

  var FILES = {
    det: 'ch_PP-OCRv4_det_infer.onnx',
    rec: 'ch_PP-OCRv4_rec_infer.onnx',
    cls: 'ch_ppocr_mobile_v2.0_cls_infer.onnx',
    wasm: 'ort-wasm-simd-threaded.wasm',
    keys: 'ppocr_keys_v1.txt',
    mjs: 'ort-wasm-simd-threaded.mjs',
    ort: 'ort.wasm.min.js'
  };
  var PREFETCH_ORDER = ['det', 'rec', 'cls', 'wasm', 'keys', 'mjs', 'ort'];
  var ASSET_CACHE = 'hc-assets';

  var BASE = (function () {
    var src = '';
    try { src = (document.currentScript && document.currentScript.src) || ''; } catch (e) { /* no document */ }
    try { return new URL('vendor/ppocr/', src || root.location.href).href; } catch (e2) { return 'vendor/ppocr/'; }
  })();
  function url(key) { return BASE + FILES[key]; }

  // =====================================================================================================
  // ENGINE — runs inside the Worker (stringified) or, as a fallback, on the page. Must not reference
  // anything outside its own body. Mirrors rapidocr_onnxruntime: ch_ppocr_det (DBPostProcess),
  // ch_ppocr_cls, ch_ppocr_rec (CTCLabelDecode) and main.RapidOCR (letterbox, sorted_boxes, crops).
  // =====================================================================================================
  function PPOCR_ENGINE(scope, post, loadOrt) {
    var ort = null, S = null, KEYS = null, BASEURL = '';
    var DET = { limit: 736, thresh: 0.3, boxThresh: 0.5, maxCand: 1000, unclip: 1.6, minSize: 3 };
    var CLS = { h: 48, w: 192, batch: 6, thresh: 0.9 };
    var REC = { h: 48, w: 320, batch: 6, maxW: 3200, textScore: 0.5 };

    function getBuf(u) {
      var fromCache;
      try {
        fromCache = (typeof scope.caches !== 'undefined' && scope.caches && scope.caches.open) ?
          scope.caches.open('hc-assets').then(function (c) { return c.match(u); }).catch(function () { return null; }) :
          Promise.resolve(null);
      } catch (e) { fromCache = Promise.resolve(null); }   // SecurityError (private mode / blocked storage)
      return fromCache.then(function (resp) {
        if (resp) return resp.arrayBuffer();
        return scope.fetch(u).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + u.split('/').pop());
          return r.arrayBuffer();
        });
      });
    }

    function init(msg) {
      if (S) return Promise.resolve();
      BASEURL = msg.base;
      return loadOrt(BASEURL + 'ort.wasm.min.js').then(function (o) {
        ort = o;
        ort.env.wasm.wasmPaths = BASEURL;
        ort.env.wasm.numThreads = msg.numThreads || 1;
        ort.env.wasm.proxy = false;
        return getBuf(BASEURL + 'ort-wasm-simd-threaded.wasm');
      }).then(function (wasm) {
        ort.env.wasm.wasmBinary = wasm;
        return getBuf(BASEURL + 'ppocr_keys_v1.txt');
      }).then(function (kb) {
        var txt = new TextDecoder('utf-8').decode(kb).split('\n');
        if (txt.length && txt[txt.length - 1] === '') txt.pop();
        // index 0 = CTC blank, 1..6623 = dictionary, 6624 = space (CTCLabelDecode.insert_special_char)
        KEYS = [''].concat(txt.map(function (s) { return s.replace(/\r$/, ''); })).concat([' ']);
        var opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
        var out = {};
        function mk(name, file) {
          return getBuf(BASEURL + file).then(function (b) {
            return ort.InferenceSession.create(new Uint8Array(b), opt);
          }).then(function (s) { out[name] = s; });
        }
        // sequential: keeps peak memory low on phones
        return mk('det', 'ch_PP-OCRv4_det_infer.onnx')
          .then(function () { return mk('cls', 'ch_ppocr_mobile_v2.0_cls_infer.onnx'); })
          .then(function () { return mk('rec', 'ch_PP-OCRv4_rec_infer.onnx'); })
          .then(function () { S = out; });
      });
    }

    function run(sess, data, dims) {
      var feeds = {};
      feeds[sess.inputNames[0]] = new ort.Tensor('float32', data, dims);
      return sess.run(feeds).then(function (res) {
        var t = res[sess.outputNames[0]];
        var o = { data: t.data, dims: t.dims.slice() };
        for (var k in res) { if (res.hasOwnProperty(k) && res[k] && res[k].dispose && res[k] !== t) res[k].dispose(); }
        return o;
      });
    }

    // ---------------------------------------------------------------- image helpers (RGB, 3 bytes/pixel)
    function fromRGBA(w, h, rgba) {
      var d = new Uint8Array(w * h * 3), n = w * h;
      for (var i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) { d[k] = rgba[j]; d[k + 1] = rgba[j + 1]; d[k + 2] = rgba[j + 2]; }
      return { w: w, h: h, d: d };
    }
    function rot90(img, ccw) {           // ccw: np.rot90 / PIL rotate(90); else clockwise
      var w = img.w, h = img.h, s = img.d, d = new Uint8Array(s.length), x, y, si, di;
      for (y = 0; y < w; y++) {          // new height = old width
        for (x = 0; x < h; x++) {        // new width = old height
          si = ccw ? ((x) * w + (w - 1 - y)) * 3 : ((h - 1 - x) * w + y) * 3;
          di = (y * h + x) * 3;
          d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2];
        }
      }
      return { w: h, h: w, d: d };
    }
    function rot180(img) {
      var s = img.d, n = img.w * img.h, d = new Uint8Array(s.length);
      for (var i = 0; i < n; i++) { var a = i * 3, b = (n - 1 - i) * 3; d[a] = s[b]; d[a + 1] = s[b + 1]; d[a + 2] = s[b + 2]; }
      return { w: img.w, h: img.h, d: d };
    }
    function padTopBottom(img, p) {      // cv2.copyMakeBorder BORDER_CONSTANT 0 (add_round_letterbox)
      var d = new Uint8Array(img.w * (img.h + 2 * p) * 3);
      d.set(img.d, p * img.w * 3);
      return { w: img.w, h: img.h + 2 * p, d: d };
    }
    function roundEven(v) {              // numpy round / cvRound (lrint): half to even
      var f = Math.floor(v), r = v - f;
      if (r > 0.5) return f + 1; if (r < 0.5) return f;
      return f % 2 === 0 ? f : f + 1;
    }
    // cv2.resize INTER_LINEAR on 8-bit images, bit-exact: float32 source positions, 11-bit coefficients,
    // horizontal pass in integers, vertical pass rounded like OpenCV's SIMD path (verified against cv2 5.0)
    function lin(dst, src) {
      var i0 = new Int32Array(dst), i1 = new Int32Array(dst), a0 = new Int32Array(dst), a1 = new Int32Array(dst);
      var sc = 1 / (dst / src), F = Math.fround;
      for (var i = 0; i < dst; i++) {
        var f = F((i + 0.5) * sc - 0.5), x0 = Math.floor(f);
        f = F(f - x0);
        if (x0 < 0) { x0 = 0; f = 0; }
        if (x0 >= src - 1) { x0 = src - 1; f = 0; }
        i0[i] = x0; i1[i] = Math.min(x0 + 1, src - 1);
        a1[i] = roundEven(F(f * 2048)); a0[i] = roundEven(F(F(1 - f) * 2048));
      }
      return { i0: i0, i1: i1, a0: a0, a1: a1 };
    }
    // resize img -> (dw, dh) and write normalised BGR CHW into out at offset, row stride ow (padding stays 0)
    function resizeNorm(img, dw, dh, out, off, ow, oh) {
      var X = lin(dw, img.w), Y = lin(dh, img.h), s = img.d, sw = img.w * 3, plane = ow * oh;
      var cacheRow = [-1, -1], cacheBuf = [new Int32Array(dw * 3), new Int32Array(dw * 3)], slot = 0;
      function hrow(r) {
        if (cacheRow[0] === r) return cacheBuf[0];
        if (cacheRow[1] === r) return cacheBuf[1];
        slot ^= 1;
        var hb = cacheBuf[slot], base = r * sw;
        for (var x = 0; x < dw; x++) {
          var c0 = base + X.i0[x] * 3, c1 = base + X.i1[x] * 3, k0 = X.a0[x], k1 = X.a1[x], o = x * 3;
          hb[o] = s[c0] * k0 + s[c1] * k1; hb[o + 1] = s[c0 + 1] * k0 + s[c1 + 1] * k1; hb[o + 2] = s[c0 + 2] * k0 + s[c1 + 2] * k1;
        }
        cacheRow[slot] = r;
        return hb;
      }
      for (var y = 0; y < dh; y++) {
        var b0 = Y.a0[y], b1 = Y.a1[y], ro = off + y * ow;
        var H0 = hrow(Y.i0[y]), H1 = hrow(Y.i1[y]);
        for (var x = 0; x < dw; x++) {
          for (var c = 0; c < 3; c++) {
            var v = (((b0 * (H0[x * 3 + c] >> 4)) >> 16) + ((b1 * (H1[x * 3 + c] >> 4)) >> 16) + 2) >> 2;
            if (v > 255) v = 255;
            out[ro + (2 - c) * plane + x] = v / 127.5 - 1;   // (v/255 - 0.5)/0.5, channel 0 = B
          }
        }
      }
    }

    // ---------------------------------------------------------------- geometry
    function dist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
    function hull(pts) {                 // Andrew monotone chain, pts [[x,y]...]
      pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      if (pts.length < 3) return pts.slice();
      function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
      var lo = [], up = [], i;
      for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
      for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
      lo.pop(); up.pop();
      return lo.concat(up);
    }
    function minAreaRect(h) {            // rotating calipers -> {pts:[4], w, h}
      if (h.length === 1) return { pts: [h[0], h[0], h[0], h[0]], w: 0, h: 0 };
      var best = null, n = h.length;
      for (var i = 0; i < n; i++) {
        var p = h[i], q = h[(i + 1) % n], ex = q[0] - p[0], ey = q[1] - p[1], L = Math.sqrt(ex * ex + ey * ey);
        if (L === 0) continue;
        var ux = ex / L, uy = ey / L, vx = -uy, vy = ux;
        var mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
        for (var j = 0; j < n; j++) {
          var pu = h[j][0] * ux + h[j][1] * uy, pv = h[j][0] * vx + h[j][1] * vy;
          if (pu < mnu) mnu = pu; if (pu > mxu) mxu = pu; if (pv < mnv) mnv = pv; if (pv > mxv) mxv = pv;
        }
        var area = (mxu - mnu) * (mxv - mnv);
        if (!best || area < best.area) best = { area: area, ux: ux, uy: uy, vx: vx, vy: vy, a: mnu, b: mxu, c: mnv, d: mxv };
      }
      if (!best) return { pts: [h[0], h[0], h[0], h[0]], w: 0, h: 0 };
      function P(u, v) { return [u * best.ux + v * best.vx, u * best.uy + v * best.vy]; }
      return { pts: [P(best.a, best.c), P(best.b, best.c), P(best.b, best.d), P(best.a, best.d)], w: best.b - best.a, h: best.d - best.c };
    }
    function miniBox(r) {                // DBPostProcess.get_mini_boxes ordering
      var p = r.pts.slice().sort(function (a, b) { return a[0] - b[0]; });
      var i1, i2, i3, i4;
      if (p[1][1] > p[0][1]) { i1 = 0; i4 = 1; } else { i1 = 1; i4 = 0; }
      if (p[3][1] > p[2][1]) { i2 = 2; i3 = 3; } else { i2 = 3; i3 = 2; }
      return { box: [p[i1], p[i2], p[i3], p[i4]], sside: Math.min(r.w, r.h) };
    }
    function insideConvex(poly, x, y) {  // inclusive point-in-convex-polygon
      var s = 0;
      for (var i = 0; i < poly.length; i++) {
        var a = poly[i], b = poly[(i + 1) % poly.length];
        var c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        if (c > 1e-9) { if (s < 0) return false; s = 1; } else if (c < -1e-9) { if (s > 0) return false; s = -1; }
      }
      return true;
    }
    function boxScoreFast(pred, W, H, box) {
      var xs = box.map(function (p) { return p[0]; }), ys = box.map(function (p) { return p[1]; });
      var xmin = Math.min(Math.max(Math.floor(Math.min.apply(null, xs)), 0), W - 1);
      var xmax = Math.min(Math.max(Math.ceil(Math.max.apply(null, xs)), 0), W - 1);
      var ymin = Math.min(Math.max(Math.floor(Math.min.apply(null, ys)), 0), H - 1);
      var ymax = Math.min(Math.max(Math.ceil(Math.max.apply(null, ys)), 0), H - 1);
      // cv2.fillPoly(mask, box.astype(int32), 1): interior pixels plus the 8-connected outline of every edge
      var poly = box.map(function (p) { return [(p[0] | 0) - xmin, (p[1] | 0) - ymin]; });
      var mw = xmax - xmin + 1, mh = ymax - ymin + 1, m = new Uint8Array(mw * mh), x, y;
      for (y = 0; y < mh; y++) for (x = 0; x < mw; x++) if (insideConvex(poly, x, y)) m[y * mw + x] = 1;
      for (var e = 0; e < poly.length; e++) {
        var x0 = poly[e][0], y0 = poly[e][1], x1 = poly[(e + 1) % poly.length][0], y1 = poly[(e + 1) % poly.length][1];
        var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
        for (;;) {
          if (x0 >= 0 && x0 < mw && y0 >= 0 && y0 < mh) m[y0 * mw + x0] = 1;
          if (x0 === x1 && y0 === y1) break;
          var e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      }
      var sum = 0, cnt = 0;
      for (y = 0; y < mh; y++) for (x = 0; x < mw; x++) if (m[y * mw + x]) { sum += pred[(y + ymin) * W + x + xmin]; cnt++; }
      return cnt ? sum / cnt : 0;
    }
    function rint(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }     // Clipper Round(): half away from zero
    // DBPostProcess.unclip: distance = area * ratio / perimeter (shapely, float box), then pyclipper
    // PyclipperOffset(JT_ROUND, ET_CLOSEDPOLYGON).Execute(distance) — reproduced here: vertices truncated to
    // integers (pyclipper's conversion), Clipper 6.4 arc stepping (ArcTolerance 0.25), outputs rounded.
    function unclip(box, ratio) {
      var n = box.length, area = 0, per = 0, i;
      for (i = 0; i < n; i++) {
        var p = box[i], q = box[(i + 1) % n];
        area += p[0] * q[1] - q[0] * p[1];
        per += dist(p, q);
      }
      area = Math.abs(area) / 2;
      if (!per) return null;
      var delta = area * ratio / per;
      var src = box.map(function (pt) { return [pt[0] < 0 ? Math.ceil(pt[0]) : Math.floor(pt[0]), pt[1] < 0 ? Math.ceil(pt[1]) : Math.floor(pt[1])]; });
      // drop repeated vertices, fix orientation (Clipper reverses negative-area paths so delta > 0 grows them)
      src = src.filter(function (pt, k) { var pr = src[(k + n - 1) % n]; return k === 0 ? (pt[0] !== src[n - 1][0] || pt[1] !== src[n - 1][1]) : (pt[0] !== pr[0] || pt[1] !== pr[1]); });
      n = src.length;
      if (n < 2) return null;
      var a2 = 0;
      for (i = 0; i < n; i++) a2 += src[i][0] * src[(i + 1) % n][1] - src[(i + 1) % n][0] * src[i][1];
      if (a2 < 0) src.reverse();
      var steps = Math.PI / Math.acos(1 - 0.25 / Math.abs(delta));
      if (steps > Math.abs(delta) * Math.PI) steps = Math.abs(delta) * Math.PI;
      var sn = Math.sin(2 * Math.PI / steps), cs = Math.cos(2 * Math.PI / steps), stepsPerRad = steps / (2 * Math.PI);
      var nx = [], ny = [];
      for (i = 0; i < n; i++) {
        var j2 = (i + 1) % n, dx = src[j2][0] - src[i][0], dy = src[j2][1] - src[i][1], f = 1 / Math.sqrt(dx * dx + dy * dy);
        nx.push(dy * f); ny.push(-dx * f);
      }
      var out = [], k = n - 1;
      for (var j = 0; j < n; j++) {
        var sinA = nx[k] * ny[j] - nx[j] * ny[k];
        var cosA = nx[k] * nx[j] + ny[j] * ny[k];
        if (Math.abs(sinA * delta) < 1.0 && cosA > 0) {
          out.push([rint(src[j][0] + nx[k] * delta), rint(src[j][1] + ny[k] * delta)]);
        } else {
          if (sinA > 1) sinA = 1; else if (sinA < -1) sinA = -1;
          if (sinA * delta < 0) {
            out.push([rint(src[j][0] + nx[k] * delta), rint(src[j][1] + ny[k] * delta)]);
            out.push([src[j][0], src[j][1]]);
            out.push([rint(src[j][0] + nx[j] * delta), rint(src[j][1] + ny[j] * delta)]);
          } else {
            var ang = Math.atan2(sinA, nx[k] * nx[j] + ny[k] * ny[j]);
            var st = Math.max(rint(stepsPerRad * Math.abs(ang)), 1), X = nx[k], Y = ny[k];
            for (var t = 0; t < st; t++) {
              out.push([rint(src[j][0] + X * delta), rint(src[j][1] + Y * delta)]);
              var X2 = X; X = X * cs - sn * Y; Y = X2 * sn + Y * cs;
            }
            out.push([rint(src[j][0] + nx[j] * delta), rint(src[j][1] + ny[j] * delta)]);
          }
        }
        k = j;
      }
      return minAreaRect(hull(out));
    }

    // ---------------------------------------------------------------- detection (TextDetector + DBPostProcess)
    function detect(img, maxDetSide) {
      var h = img.h, w = img.w, ratio = 1;
      if (Math.min(h, w) < DET.limit) ratio = DET.limit / Math.min(h, w);
      var rh = Math.floor(h * ratio), rw = Math.floor(w * ratio);
      var cap = maxDetSide || 2400;
      if (Math.max(rh, rw) > cap) { var r2 = cap / Math.max(rh, rw); rh = Math.floor(rh * r2); rw = Math.floor(rw * r2); }
      rh = Math.max(32, roundEven(rh / 32) * 32); rw = Math.max(32, roundEven(rw / 32) * 32);   // python round(): half to even
      var input = new Float32Array(3 * rh * rw);
      resizeNorm(img, rw, rh, input, 0, rw, rh);
      return run(S.det, input, [1, 3, rh, rw]).then(function (o) {
        var H = o.dims[2], W = o.dims[3], pred = o.data;
        return dbPost(pred, W, H, w, h);
      });
    }
    function dbPost(pred, W, H, destW, destH) {
      var n = W * H, seg = new Uint8Array(n), mask = new Uint8Array(n), i, x, y;
      for (i = 0; i < n; i++) seg[i] = pred[i] > DET.thresh ? 1 : 0;
      // cv2.dilate with the 2x2 ones kernel (anchor 1,1): dst(x,y) = max src over (x-1..x, y-1..y)
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          i = y * W + x;
          mask[i] = seg[i] | (x > 0 ? seg[i - 1] : 0) | (y > 0 ? seg[i - W] : 0) | (x > 0 && y > 0 ? seg[i - W - 1] : 0);
        }
      }
      // connected components (8-connectivity, like findContours' outer boundaries)
      var label = new Uint8Array(n), stack = new Int32Array(n), pix = new Int32Array(n), comps = 0, boxes = [];
      for (var start = 0; start < n && comps < DET.maxCand; start++) {
        if (!mask[start] || label[start]) continue;
        comps++;
        var sp = 0, np = 0;
        stack[sp++] = start; label[start] = 1;
        var ymn = H, ymx = -1;
        while (sp) {
          var p = stack[--sp]; pix[np++] = p;
          var py = (p / W) | 0, px = p - py * W;
          if (py < ymn) ymn = py; if (py > ymx) ymx = py;
          for (var dy = -1; dy <= 1; dy++) {
            var qy = py + dy; if (qy < 0 || qy >= H) continue;
            for (var dx = -1; dx <= 1; dx++) {
              var qx = px + dx; if (qx < 0 || qx >= W) continue;
              var q = qy * W + qx;
              if (mask[q] && !label[q]) { label[q] = 1; stack[sp++] = q; }
            }
          }
        }
        var rows = ymx - ymn + 1, rmin = new Int32Array(rows), rmax = new Int32Array(rows);
        for (i = 0; i < rows; i++) { rmin[i] = W; rmax[i] = -1; }
        for (i = 0; i < np; i++) {
          var yy = (pix[i] / W) | 0, xx = pix[i] - yy * W, r = yy - ymn;
          if (xx < rmin[r]) rmin[r] = xx; if (xx > rmax[r]) rmax[r] = xx;
        }
        var pts = [];
        for (i = 0; i < rows; i++) { if (rmax[i] >= 0) { pts.push([rmin[i], ymn + i]); if (rmax[i] !== rmin[i]) pts.push([rmax[i], ymn + i]); } }
        var mb = miniBox(minAreaRect(hull(pts)));
        if (mb.sside < DET.minSize) continue;
        var score = boxScoreFast(pred, W, H, mb.box);
        if (DET.boxThresh > score) continue;
        var ex = unclip(mb.box, DET.unclip);
        if (!ex) continue;
        var mb2 = miniBox(ex);
        if (mb2.sside < DET.minSize + 2) continue;
        var bx = mb2.box.map(function (pt) {
          return [Math.min(Math.max(roundEven(pt[0] / W * destW), 0), destW) | 0,
                  Math.min(Math.max(roundEven(pt[1] / H * destH), 0), destH) | 0];
        });
        boxes.push(bx);
      }
      // TextDetector.filter_tag_det_res
      var outB = [];
      for (i = 0; i < boxes.length; i++) {
        var b = orderClockwise(boxes[i]);
        for (var k = 0; k < 4; k++) {
          b[k][0] = Math.min(Math.max(b[k][0], 0), destW - 1) | 0;
          b[k][1] = Math.min(Math.max(b[k][1], 0), destH - 1) | 0;
        }
        if ((dist(b[0], b[1]) | 0) <= 3 || (dist(b[0], b[3]) | 0) <= 3) continue;
        outB.push(b);
      }
      return outB;
    }
    function orderClockwise(pts) {
      var xs = pts.slice().sort(function (a, b) { return a[0] - b[0]; });
      var L = xs.slice(0, 2).sort(function (a, b) { return a[1] - b[1]; });
      var R = xs.slice(2).sort(function (a, b) { return a[1] - b[1]; });
      return [[L[0][0], L[0][1]], [R[0][0], R[0][1]], [R[1][0], R[1][1]], [L[1][0], L[1][1]]];
    }
    function sortedBoxes(b) {            // RapidOCR.sorted_boxes
      var s = b.slice().sort(function (p, q) { return (p[0][1] - q[0][1]) || (p[0][0] - q[0][0]); });
      for (var i = 0; i < s.length - 1; i++) {
        for (var j = i; j >= 0; j--) {
          if (Math.abs(s[j + 1][0][1] - s[j][0][1]) < 10 && s[j + 1][0][0] < s[j][0][0]) {
            var t = s[j]; s[j] = s[j + 1]; s[j + 1] = t;
          } else break;
        }
      }
      return s;
    }

    // ---------------------------------------------------------------- crops (get_rotate_crop_image)
    function homography(src, dst) {      // maps src -> dst points (4 pairs); returns 3x3 row-major
      var A = [], B = [], i;
      for (i = 0; i < 4; i++) {
        var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
      }
      for (var c = 0; c < 8; c++) {      // Gaussian elimination with partial pivoting
        var piv = c;
        for (var r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
        var tA = A[c]; A[c] = A[piv]; A[piv] = tA; var tB = B[c]; B[c] = B[piv]; B[piv] = tB;
        if (Math.abs(A[c][c]) < 1e-12) return null;
        for (r = 0; r < 8; r++) {
          if (r === c) continue;
          var f = A[r][c] / A[c][c];
          if (!f) continue;
          for (var k = c; k < 8; k++) A[r][k] -= f * A[c][k];
          B[r] -= f * B[c];
        }
      }
      var hm = [];
      for (i = 0; i < 8; i++) hm.push(B[i] / A[i][i]);
      hm.push(1);
      return hm;
    }
    // cv2.warpPerspective(INTER_CUBIC, BORDER_REPLICATE) as OpenCV 5.0 computes it: unquantised source coordinates,
    // Keys bicubic (A = -0.75), rounded to uint8 (measured: ~97% of pixels identical, the rest +-1 at .5 ties)
    function cubicW(t, w) {
      var A = -0.75, u = 1 - t;
      w[0] = ((A * (t + 1) - 5 * A) * (t + 1) + 8 * A) * (t + 1) - 4 * A;
      w[1] = ((A + 2) * t - (A + 3)) * t * t + 1;
      w[2] = ((A + 2) * u - (A + 3)) * u * u + 1;
      w[3] = 1 - w[0] - w[1] - w[2];
    }
    function cropQuad(img, pts) {
      var cw = Math.floor(Math.max(dist(pts[0], pts[1]), dist(pts[2], pts[3])));
      var ch = Math.floor(Math.max(dist(pts[0], pts[3]), dist(pts[1], pts[2])));
      if (cw < 1 || ch < 1) return null;
      var Hm = homography([[0, 0], [cw, 0], [cw, ch], [0, ch]], pts);   // dst -> src (inverse map, like warpPerspective)
      if (!Hm) return null;
      var out = new Uint8Array(cw * ch * 3), s = img.d, W = img.w, Hh = img.h;
      var xs = new Int32Array(4), ys = new Int32Array(4), wx = new Float64Array(4), wy = new Float64Array(4);
      for (var y = 0; y < ch; y++) {
        for (var x = 0; x < cw; x++) {
          var den = Hm[6] * x + Hm[7] * y + Hm[8];
          var fx = (Hm[0] * x + Hm[1] * y + Hm[2]) / den, fy = (Hm[3] * x + Hm[4] * y + Hm[5]) / den;
          var x0 = Math.floor(fx), y0 = Math.floor(fy), o = (y * cw + x) * 3, i;
          cubicW(fx - x0, wx); cubicW(fy - y0, wy);
          for (i = 0; i < 4; i++) {
            xs[i] = Math.min(Math.max(x0 - 1 + i, 0), W - 1) * 3;
            ys[i] = Math.min(Math.max(y0 - 1 + i, 0), Hh - 1) * W * 3;
          }
          for (var c = 0; c < 3; c++) {
            var acc = 0;
            for (var j = 0; j < 4; j++) {
              var rb = ys[j] + c;
              acc += wy[j] * (s[rb + xs[0]] * wx[0] + s[rb + xs[1]] * wx[1] + s[rb + xs[2]] * wx[2] + s[rb + xs[3]] * wx[3]);
            }
            acc = roundEven(acc);
            out[o + c] = acc < 0 ? 0 : (acc > 255 ? 255 : acc);
          }
        }
      }
      var crop = { w: cw, h: ch, d: out };
      if (ch / cw >= 1.5) { crop = rot90(crop, true); crop.tall = true; }
      return crop;
    }

    // ---------------------------------------------------------------- cls + rec
    function argsortRatio(crops) {
      var idx = crops.map(function (c, i) { return i; });
      idx.sort(function (a, b) { return (crops[a].w / crops[a].h) - (crops[b].w / crops[b].h) || a - b; });
      return idx;
    }
    function classify(crops) {           // TextClassifier: rotates crops labelled '180' with score > 0.9
      var idx = argsortRatio(crops), res = new Array(crops.length);
      var b = 0;
      function next() {
        if (b >= idx.length) return Promise.resolve(res);
        var end = Math.min(idx.length, b + CLS.batch), N = end - b, plane = CLS.h * CLS.w;
        var data = new Float32Array(N * 3 * plane);
        for (var k = 0; k < N; k++) {
          var c = crops[idx[b + k]], r = c.w / c.h, rw = Math.ceil(CLS.h * r) > CLS.w ? CLS.w : Math.ceil(CLS.h * r);
          resizeNorm(c, Math.max(1, rw), CLS.h, data, k * 3 * plane, CLS.w, CLS.h);
        }
        var base = b;
        return run(S.cls, data, [N, 3, CLS.h, CLS.w]).then(function (o) {
          for (var k = 0; k < N; k++) {
            var p0 = o.data[k * 2], p1 = o.data[k * 2 + 1], i = idx[base + k];
            res[i] = p1 > p0 ? { label: '180', score: p1 } : { label: '0', score: p0 };
            if (res[i].label === '180' && res[i].score > CLS.thresh) { var tl = crops[i].tall; crops[i] = rot180(crops[i]); crops[i].tall = tl; }
          }
          b = end;
          return next();
        });
      }
      return next();
    }
    function recognize(crops, progress) {
      var idx = argsortRatio(crops), res = new Array(crops.length), b = 0;
      function next() {
        if (b >= idx.length) return Promise.resolve(res);
        progress(Math.min(1, b / Math.max(1, idx.length)));
        var end = Math.min(idx.length, b + REC.batch), N = end - b, maxR = REC.w / REC.h, k;
        for (k = b; k < end; k++) maxR = Math.max(maxR, crops[idx[k]].w / crops[idx[k]].h);
        var W = Math.min(REC.maxW, Math.floor(REC.h * maxR)), plane = REC.h * W;
        var data = new Float32Array(N * 3 * plane);
        for (k = 0; k < N; k++) {
          var c = crops[idx[b + k]], r = c.w / c.h, rw = Math.ceil(REC.h * r) > W ? W : Math.ceil(REC.h * r);
          resizeNorm(c, Math.max(1, rw), REC.h, data, k * 3 * plane, W, REC.h);
        }
        var base = b;
        return run(S.rec, data, [N, 3, REC.h, W]).then(function (o) {
          var T = o.dims[1], C = o.dims[2], d = o.data;
          for (var k = 0; k < N; k++) {
            var txt = '', sum = 0, cnt = 0, prev = -1;
            for (var t = 0; t < T; t++) {
              var off = (k * T + t) * C, bi = 0, bv = d[off];
              for (var ci = 1; ci < C; ci++) { if (d[off + ci] > bv) { bv = d[off + ci]; bi = ci; } }
              if (bi !== prev && bi !== 0) { txt += KEYS[bi] || ''; sum += bv; cnt++; }
              prev = bi;
            }
            res[idx[base + k]] = { text: txt, conf: cnt ? sum / cnt : 0 };
          }
          b = end;
          return next();
        });
      }
      return next();
    }

    // ---------------------------------------------------------------- one read of an image (RapidOCR.__call__)
    function letterbox(im) {             // maybe_add_letterbox (min_height 30, width_height_ratio 8)
      if (im.h <= 30 || im.w / im.h > 8) {
        var newH = Math.max(Math.floor(im.w / 8), 30) * 2, p = Math.floor(Math.abs(newH - im.h) / 2);
        return { img: padTopBottom(im, p), top: p };
      }
      return { img: im, top: 0 };
    }
    function readImage(img, detMaxSide, progress, tm) {
      var t0 = Date.now(), lb = letterbox(img);
      progress('Finding text…', 0.15);
      return detect(lb.img, detMaxSide).then(function (boxes) {
        if (tm) tm.det = (tm.det || 0) + Date.now() - t0;
        boxes = sortedBoxes(boxes);
        var crops = [], keep = [];
        boxes.forEach(function (b) { var c = cropQuad(lb.img, b); if (c) { crops.push(c); keep.push(b); } });
        boxes = keep;
        if (!crops.length) return [];
        progress('Reading ' + crops.length + ' lines…', 0.4);
        var t1 = Date.now(), clsRes = null;
        return classify(crops).then(function (cr) {
          clsRes = cr;
          if (tm) tm.cls = (tm.cls || 0) + Date.now() - t1;
          return recognize(crops, function (f) { progress('Reading ' + crops.length + ' lines…', 0.4 + 0.55 * f); });
        }).then(function (rec) {
          if (tm) tm.rec = (tm.rec || 0) + Date.now() - t1;
          var lines = [];
          for (var i = 0; i < rec.length; i++) {
            if (!(rec[i].conf >= REC.textScore)) continue;   // text_score filter
            var pts = boxes[i].map(function (p) { return [p[0], Math.max(0, p[1] - lb.top)]; });
            lines.push({ text: rec[i].text, conf: rec[i].conf, pts: pts, tall: !!crops[i].tall, up: clsRes[i].label === '0' });
          }
          return lines;
        });
      });
    }
    function score(lines) { var s = 0; lines.forEach(function (l) { s += l.conf * l.text.length; }); return s; }
    // Sideways pictures: RapidOCR turns every crop that is 1.5x taller than wide by 90 degrees and lets cls fix
    // 0/180, so pass 1 half-reads sideways text from many small tall crops. When enough of the read text came from
    // such tall crops (an eighth, needing a 1.25x better turned read below a fifth) and no 配料-type anchor was read, the picture is turned (90 if cls found the turned crops
    // upright, else 270) and read again; the turned read is kept if it scores at least as well
    // (score = sum of conf x length, the server's orientation measure).
    function sidewaysAngle(lines) {
      var all = 0, tall = 0, vote = 0;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i], w = l.conf * l.text.length;
        if (/配料|原料|成份|主要成分/.test(l.text)) return 0;
        all += w;
        if (l.tall) { tall += w; vote += l.up ? w : -w; }
      }
      // measured on 13 real photos (with the half-to-even det rounding): upright <= 0.08, sideways 0.15 and 0.36
      if (!all || tall < 0.12 * all) return 0;
      return vote >= 0 ? 90 : 270;
    }
    function ocr(msg, progress) {
      var tm = {}, t0 = Date.now();
      var img = fromRGBA(msg.w, msg.h, new Uint8Array(msg.buf));
      var rotated = 0;
      return readImage(img, msg.detMaxSide, progress, tm).then(function (lines) {
        var all = 0, tall = 0;
        lines.forEach(function (l) { all += l.conf * l.text.length; if (l.tall) tall += l.conf * l.text.length; });
        tm.tallShare = all ? Math.round(100 * tall / all) / 100 : 0;
        var ang = msg.autoRotate ? sidewaysAngle(lines) : 0;
        if (!ang) return lines;
        var turned = rot90(img, ang === 90), s0 = score(lines);
        return readImage(turned, msg.detMaxSide, function (st, p) { progress(st, 0.5 + 0.5 * p); }, null).then(function (l2) {
          tm.orient = { ang: ang, s0: Math.round(s0), s1: Math.round(score(l2)) };
          // weak evidence (tall share 0.12-0.2): the turned read must be clearly better, not merely as good
          if (score(l2) < (tm.tallShare >= 0.2 ? 1 : 1.25) * s0) return lines;
          rotated = ang; img = turned;
          return l2;
        });
      }).then(function (lines) {
        tm.total = Date.now() - t0;
        lines.forEach(function (l) { delete l.tall; delete l.up; });
        return { lines: lines, rotated: rotated, w: img.w, h: img.h, t: tm };
      });
    }

    return function onMessage(msg) {
      var id = msg.id;
      function progress(status, p) { post({ id: id, type: 'progress', status: status, progress: p }); }
      var job;
      if (msg.cmd === 'init') job = init(msg).then(function () { return { ok: true }; });
      else if (msg.cmd === 'ocr') job = (S ? Promise.resolve() : Promise.reject(new Error('engine not ready'))).then(function () { return ocr(msg, progress); });
      else if (msg.cmd === 'dispose') {
        job = Promise.all(S ? ['det', 'cls', 'rec'].map(function (k) { return S[k] && S[k].release ? S[k].release() : null; }) : []).then(function () { S = null; return { ok: true }; });
      } else job = Promise.reject(new Error('unknown command'));
      job.then(function (r) { post({ id: id, type: 'done', result: r }); },
               function (e) { post({ id: id, type: 'error', error: String((e && e.message) || e) }); });
    };
  }

  // =====================================================================================================
  // PAGE SIDE
  // =====================================================================================================
  var worker = null, inPage = null, readyP = null, seq = 0, pending = {}, queue = Promise.resolve();
  var workerOk = false, workerBroken = false;
  // a call that never answers (wasm hang, killed worker) must still reject so the app can fall back to Tesseract
  var TIMEOUT = { init: 90000, ocr: 150000, dispose: 10000 };

  function failAll(msg) {
    for (var k in pending) { if (pending.hasOwnProperty(k)) { var p = pending[k]; delete pending[k]; if (p.timer) clearTimeout(p.timer); p.reject(new Error('ppocr: ' + msg)); } }
  }
  // drop the engine so the next call starts a fresh one (sessions are re-created by ready())
  function resetEngine(msg) {
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
    worker = null; inPage = null; readyP = null; workerOk = false;
    failAll(msg);
  }

  // smallest module using a v128 op (wasm-feature-detect 'simd'); ort-web 1.23 ships only SIMD builds
  var SIMD_PROBE = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
  function isSupported() {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') return false;
    try { if (!WebAssembly.validate(new Uint8Array(SIMD_PROBE))) return false; } catch (e) { return false; }
    if (typeof Promise === 'undefined' || typeof fetch !== 'function') return false;
    if (typeof OffscreenCanvas !== 'undefined') return true;
    try { var c = document.createElement('canvas'); return !!(c.getContext && c.getContext('2d')); } catch (e) { return false; }
  }

  function onEngineMessage(m) {
    var p = pending[m.id];
    if (!p) return;
    if (m.type === 'progress') { if (p.onProgress) p.onProgress({ status: m.status, progress: m.progress }); return; }
    delete pending[m.id];
    if (p.timer) clearTimeout(p.timer);
    if (m.type === 'done') { if (p.cmd === 'init' && worker) workerOk = true; p.resolve(m.result); }
    else p.reject(new Error('ppocr: ' + m.error));
  }

  function loadOrtInPage(src) {
    if (root.ort && root.ort.InferenceSession) return Promise.resolve(root.ort);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { root.ort ? resolve(root.ort) : reject(new Error('ort missing after load')); };
      s.onerror = function () { reject(new Error('could not load ort.wasm.min.js')); };
      document.head.appendChild(s);
    });
  }

  function startEngine() {
    if (worker || inPage) return;
    if (!workerBroken && typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && root.URL && URL.createObjectURL) {
      try {
        var src = '"use strict";\nvar __h = (' + PPOCR_ENGINE.toString() + ')(self, function (m, t) { self.postMessage(m, t || []); },' +
          ' function (u) { if (!self.ort) importScripts(u); return Promise.resolve(self.ort); });\n' +
          'self.onmessage = function (e) { __h(e.data); };\n';
        var blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        worker = new Worker(blobUrl);
        worker.onmessage = function (e) { onEngineMessage(e.data); };
        worker.onerror = function (e) {
          // a worker that never initialised (e.g. CSP without blob: workers) is not tried again: run in the page
          if (!workerOk) workerBroken = true;
          resetEngine('worker error: ' + ((e && e.message) || 'unknown'));
        };
        setTimeout(function () { try { URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ } }, 30000);
        return;
      } catch (e) { worker = null; }
    }
    inPage = PPOCR_ENGINE(root, function (m) { setTimeout(function () { onEngineMessage(m); }, 0); }, loadOrtInPage);
  }

  function call(cmd, payload, transfer, onProgress) {
    startEngine();
    var id = ++seq;
    payload.id = id; payload.cmd = cmd;
    return new Promise(function (resolve, reject) {
      var ent = pending[id] = { resolve: resolve, reject: reject, onProgress: onProgress, cmd: cmd };
      ent.timer = setTimeout(function () {
        if (pending[id] !== ent) return;
        delete pending[id];
        reject(new Error('ppocr: ' + cmd + ' timed out'));
        if (cmd !== 'dispose') resetEngine('engine restarted after a timeout');
      }, TIMEOUT[cmd] || TIMEOUT.ocr);
      try {
        if (worker) worker.postMessage(payload, transfer || []);
        else inPage(payload);
      } catch (e) {
        delete pending[id]; clearTimeout(ent.timer);
        reject(new Error('ppocr: ' + ((e && e.message) || e)));
      }
    });
  }

  // a download that stops delivering bytes (flaky mobile data) must reject, not leave the UI on 'Loading…'
  var STALL_MS = 60000;
  function withTimeout(p, ms, msg, onTimeout) {
    var t;
    return Promise.race([p, new Promise(function (resolve, reject) {
      t = setTimeout(function () { if (onTimeout) { try { onTimeout(); } catch (e) { /* ignore */ } } reject(new Error(msg)); }, ms);
    })]).then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
  }

  function prefetch(onProgress) {
    var keys = PREFETCH_ORDER, totals = {}, loaded = {};
    var hasCache = typeof caches !== 'undefined' && caches.open;
    function report(file) {
      var t = 0, l = 0;
      keys.forEach(function (k) { t += totals[k] || 0; l += loaded[k] || 0; });
      if (onProgress) { try { onProgress({ loaded: l, total: t, file: file }); } catch (e) { /* UI callback error */ } }
    }
    var cacheP = hasCache ? caches.open(ASSET_CACHE).catch(function () { return null; }) : Promise.resolve(null);
    return cacheP.then(function (cache) {
      return Promise.all(keys.map(function (k) {
        var u = url(k);
        var hit = cache ? cache.match(u).catch(function () { return null; }) : Promise.resolve(null);
        return hit.then(function (resp) {
          if (resp) {
            var n = parseInt(resp.headers.get('Content-Length') || '0', 10);
            totals[k] = loaded[k] = n; report(FILES[k]);
            return;
          }
          return withTimeout(fetch(u), STALL_MS, 'ppocr: no response for ' + FILES[k]).then(function (r) {
            if (!r.ok) throw new Error('ppocr: HTTP ' + r.status + ' while downloading ' + FILES[k]);
            totals[k] = parseInt(r.headers.get('Content-Length') || '0', 10); loaded[k] = 0;
            var ctype = r.headers.get('Content-Type') || 'application/octet-stream';
            function store(blob) {
              if (!cache) return;
              return cache.put(new Request(u), new Response(blob, { status: 200, headers: { 'Content-Type': ctype, 'Content-Length': String(blob.size) } }))
                .catch(function () { /* quota / private mode: the HTTP cache still helps */ });
            }
            if (!r.body || !r.body.getReader) {
              return withTimeout(r.blob(), 10 * STALL_MS, 'ppocr: download stalled (' + FILES[k] + ')').then(function (b) { loaded[k] = totals[k] = b.size; report(FILES[k]); return store(b); });
            }
            var reader = r.body.getReader(), chunks = [];
            function pump() {
              return withTimeout(reader.read(), STALL_MS, 'ppocr: download stalled (' + FILES[k] + ')',
                function () { try { var c = reader.cancel(); if (c && c.catch) c.catch(function () {}); } catch (e) { /* ignore */ } }).then(function (x) {
                if (x.done) {
                  if (!totals[k]) totals[k] = loaded[k];
                  report(FILES[k]);
                  return store(new Blob(chunks, { type: ctype }));
                }
                chunks.push(x.value); loaded[k] += x.value.length; report(FILES[k]);
                return pump();
              });
            }
            return pump();
          });
        });
      }));
    }).then(function () {
      var t = 0; keys.forEach(function (k) { t += totals[k] || 0; });
      return { files: keys.length, bytes: t };
    });
  }

  function ready(onProgress) {
    if (readyP) return readyP;
    if (!isSupported()) return Promise.reject(new Error('ppocr: WebAssembly or canvas not available'));
    var status = 'Loading PP-OCR engine…';
    function prog(p) { if (onProgress) { try { onProgress(p); } catch (e) { /* ignore */ } } }
    prog({ status: status, progress: 0 });
    var nThreads = 1;
    try { if (root.crossOriginIsolated) nThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)); } catch (e) { /* ignore */ }
    readyP = prefetch(function (p) { prog({ status: status, progress: p.total ? 0.9 * p.loaded / p.total : 0, loaded: p.loaded, total: p.total, file: p.file }); })
      .then(function () { return call('init', { base: BASE, numThreads: nThreads }, null, null); })
      .then(function () { prog({ status: status, progress: 1 }); return true; });
    var mine = readyP;
    mine.catch(function () { if (readyP === mine) readyP = null; });
    return readyP;
  }

  function dispose() {
    var p = (worker || inPage) && readyP ? call('dispose', {}, null, null).catch(function () {}) : Promise.resolve();
    return p.then(function () { resetEngine('disposed'); });
  }

  // ---------------------------------------------------------------- source handling
  function toDrawable(source) {
    if (!source) return Promise.reject(new Error('ppocr: no image'));
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
      var viaImg = function () {
        return new Promise(function (resolve, reject) {
          var u = URL.createObjectURL(source), im = new Image();
          im.onload = function () { resolve({ img: im, w: im.naturalWidth, h: im.naturalHeight, close: function () { URL.revokeObjectURL(u); } }); };
          im.onerror = function () { URL.revokeObjectURL(u); reject(new Error('ppocr: image could not be decoded')); };
          im.src = u;
        });
      };
      if (typeof createImageBitmap === 'function') {
        // colorSpaceConversion 'none': decode the raw pixel values and ignore the ICC profile (phone photos are
        // Display-P3), as the server's PIL/OpenCV path does; the models were trained on unconverted pixels
        var bp;
        try { bp = createImageBitmap(source, { imageOrientation: 'from-image', colorSpaceConversion: 'none' }); } catch (e) { bp = Promise.reject(e); }
        return bp.then(function (b) {
          return { img: b, w: b.width, h: b.height, close: function () { if (b.close) b.close(); } };
        }, viaImg);
      }
      return viaImg();
    }
    var w = source.naturalWidth || source.videoWidth || source.width, h = source.naturalHeight || source.videoHeight || source.height;
    if (!w || !h) return Promise.reject(new Error('ppocr: image has no size'));
    return Promise.resolve({ img: source, w: w, h: h, close: function () {} });
  }

  function makeCanvas(w, h) {             // -> { c, ctx }; OffscreenCanvas when it has a 2d context, else a DOM canvas
    var c = null, ctx = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      try { c = new OffscreenCanvas(w, h); ctx = c.getContext('2d', { willReadFrequently: true }); } catch (e) { ctx = null; }
    }
    if (!ctx) {
      c = document.createElement('canvas'); c.width = w; c.height = h;
      ctx = c.getContext('2d', { willReadFrequently: true }) || c.getContext('2d');
    }
    if (!ctx) throw new Error('ppocr: no 2d canvas');
    return { c: c, ctx: ctx };
  }

  // Draw the region (rx, ry, rw, rh) of the source turned `rot` degrees counter-clockwise, scaled by s, into RGBA.
  function grab(src, rot, rx, ry, rw, rh, s) {
    var ow = Math.max(1, Math.round(rw * s)), oh = Math.max(1, Math.round(rh * s));
    var cc = makeCanvas(ow, oh), c = cc.c, ctx = cc.ctx;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ow, oh);
    ctx.imageSmoothingEnabled = true;
    try { ctx.imageSmoothingQuality = 'high'; } catch (e) { /* ignore */ }
    ctx.setTransform(ow / rw, 0, 0, oh / rh, -rx * ow / rw, -ry * oh / rh);
    if (rot === 90) ctx.transform(0, -1, 1, 0, 0, src.w);
    else if (rot === 270) ctx.transform(0, 1, -1, 0, src.h, 0);
    ctx.drawImage(src.img, 0, 0, src.w, src.h);
    var data = ctx.getImageData(0, 0, ow, oh).data;
    c.width = c.height = 1;              // release the backing store early (iOS canvas memory cap)
    return { w: ow, h: oh, buf: data.buffer };
  }

  function lineGeom(l, sx, sy, ox, oy) {
    var xs = l.pts.map(function (p) { return p[0] / sx + ox; }), ys = l.pts.map(function (p) { return p[1] / sy + oy; });
    var top = Math.min.apply(null, ys), bot = Math.max.apply(null, ys);
    return { text: l.text, conf: l.conf, x: Math.min.apply(null, xs), x2: Math.max.apply(null, xs), top: top, bot: bot,
             y: (ys[0] + ys[1] + ys[2] + ys[3]) / 4, h: bot - top, sc: (sx + sy) / 2 };
  }
  function goodChars(lines) { var n = 0; lines.forEach(function (l) { if (l.conf >= 0.7) n += l.text.length; }); return n; }
  var ANCHOR = /配料|原料|成份|主要成分/;

  // Re-read the region (x0..x1, y0..y1) of the turned source at scale cs; lines come back in source coordinates.
  function readRegion(src, rot, x0, y0, x1, y1, cs, onP) {
    var g = grab(src, rot, x0, y0, x1 - x0, y1 - y0, cs), gsx = g.w / (x1 - x0), gsy = g.h / (y1 - y0);
    return call('ocr', { w: g.w, h: g.h, buf: g.buf, autoRotate: false }, [g.buf], onP).then(function (r) {
      return r.lines.map(function (l) { return lineGeom(l, gsx, gsy, x0, y0); });
    });
  }
  // Swap the lines inside a region for a re-read of it, unless the re-read has fewer confidently read characters.
  function merge(lines, fresh, inside) {
    var keep = lines.filter(function (l) { return !inside(l); }), old = lines.filter(inside);
    if (!fresh.length || goodChars(fresh) < goodChars(old)) return null;
    return keep.concat(fresh);
  }

  function recognize(source, opts) {
    opts = opts || {};
    var maxSide = opts.maxSide || 2000, onProgress = opts.onProgress;
    var zoomPass = opts.zoomPass !== false, autoRotate = opts.autoRotate !== false;
    function prog(status, p) { if (onProgress) { try { onProgress({ status: status, progress: p }); } catch (e) { /* ignore */ } } }
    var job = queue.then(function () {
      var t0 = Date.now(), src = null, dbg = opts.debug ? {} : null;
      return toDrawable(source).then(function (s) {
        src = s;
        return ready(onProgress);
      }).then(function () {
        // ---- pass 1: the whole picture at <= maxSide (the worker also tries 90/270 when nothing label-like is read)
        var sc = Math.min(1, maxSide / Math.max(src.w, src.h));
        if (Math.min(src.w, src.h) * sc < 30) sc = 30 / Math.min(src.w, src.h);       // increase_min_side
        var g = grab(src, 0, 0, 0, src.w, src.h, sc);
        return call('ocr', { w: g.w, h: g.h, buf: g.buf, autoRotate: autoRotate }, [g.buf],
          function (p) { prog(p.status, 0.05 + 0.5 * p.progress); });
      }).then(function (r) {
        var rot = r.rotated || 0, RW = rot ? src.h : src.w, RH = rot ? src.w : src.h;   // source turned by rot
        var sx = r.w / RW, sy = r.h / RH;
        var res = { lines: r.lines.map(function (l) { return lineGeom(l, sx, sy, 0, 0); }), rot: rot, RW: RW, RH: RH, zoomed: false };
        if (dbg) dbg.pass1 = { t: r.t, sx: sx, n: res.lines.length };
        if (!zoomPass || !res.lines.length) return res;

        var step = Promise.resolve();
        return step.then(function () {
          // ---- pass 2 (ingredients block, as server/ocr_server.py): re-read the block around 配料 sharper
          var anchor = null;
          res.lines.forEach(function (l) { if (ANCHOR.test(l.text) && (!anchor || l.top < anchor.top)) anchor = l; });
          if (!anchor) return res;
          var lh = Math.max(12, Math.min(anchor.h, 0.04 * RH));
          var blockW = Math.max(anchor.x2 - anchor.x, 28 * lh);
          var x0 = Math.max(0, Math.floor(anchor.x - 2 * lh)), x1 = Math.min(RW, Math.floor(x0 + blockW + 4 * lh));
          var y0 = Math.max(0, Math.floor(anchor.top - 1.5 * lh)), y1 = Math.min(RH, Math.floor(anchor.top + 10 * lh));
          // lines in the band that straddle a side of the crop would be cut in half: widen to take them in
          res.lines.forEach(function (l) {
            if (l.y < y0 || l.y > y1) return;
            if (l.x < x0 && l.x2 > x0 + lh) x0 = Math.max(0, Math.floor(l.x - 0.5 * lh));
            if (l.x2 > x1 && l.x < x1 - lh) x1 = Math.min(RW, Math.ceil(l.x2 + 0.5 * lh));
          });
          var k = Math.min(1, RW / 1400);
          if (!(x1 - x0 > 200 * k && y1 - y0 > 60 * k)) return res;
          var cs = Math.min(1, maxSide / Math.max(x1 - x0, y1 - y0));
          if (lh * cs < 22) cs = Math.min(2, maxSide / Math.max(x1 - x0, y1 - y0), 32 / lh);   // tiny print: upscale up to x2
          if (dbg) dbg.block = { anchor: anchor.text, box: [x0, y0, x1, y1], gain: cs / anchor.sc };
          if (!(cs / anchor.sc >= 1.25 || anchor.h * anchor.sc < 22)) return res;
          return readRegion(src, rot, x0, y0, x1, y1, cs, function (p) { prog('Second pass on small print…', 0.75 + 0.22 * p.progress); })
            .then(function (zl) {
              // lines above/below the block stay, as on the server; lines entirely beside it stay too
              var m = merge(res.lines, zl, function (l) {
                return !(l.bot <= y0 + 0.3 * lh || l.top >= y1 - 0.3 * lh || l.x2 <= x0 + 0.3 * lh || l.x >= x1 - 0.3 * lh);
              });
              if (dbg) dbg.block.used = !!m;
              if (m) { res.lines = m; res.zoomed = true; }
              return res;
            });
        });
      }).then(function (res) {
        // reading order (server): by centre y, rows of boxes within 0.3 x the smaller height read left-to-right
        var ls = res.lines.slice().sort(function (a, b) { return a.y - b.y; }), ordered = [], band = [];
        ls.forEach(function (l) {
          if (band.length && Math.abs(l.y - band[band.length - 1].y) > 0.3 * Math.max(8, Math.min(l.h, band[band.length - 1].h))) {
            ordered = ordered.concat(band.sort(function (a, b) { return a.x - b.x; })); band = [];
          }
          band.push(l);
        });
        ordered = ordered.concat(band.sort(function (a, b) { return a.x - b.x; }));
        var sum = 0;
        ordered.forEach(function (l) { sum += l.conf; });
        if (src && src.close) src.close();
        var out = {
          text: ordered.map(function (l) { return l.text; }).join('\n'),
          confidence: ordered.length ? Math.round(100 * sum / ordered.length) : 0,
          lines: ordered.map(function (l) {
            return { text: l.text, conf: Math.round(l.conf * 1000) / 1000, box: [Math.round(l.x), Math.round(l.top), Math.round(l.x2), Math.round(l.bot)] };
          }),
          ms: Date.now() - t0,
          engine: 'ppocr-web',
          rotated: res.rot,
          zoomed: res.zoomed,
          width: res.RW,
          height: res.RH
        };
        if (dbg) out.debug = dbg;
        return out;
      }, function (e) {
        if (src && src.close) src.close();
        var m = String((e && e.message) || e);
        throw new Error(/^ppocr:/.test(m) ? m : 'ppocr: ' + m);
      });
    });
    queue = job.catch(function () {});
    return job;
  }

  root.HCPpocr = {
    isSupported: isSupported,
    prefetch: prefetch,
    ready: ready,
    recognize: recognize,
    dispose: dispose,
    _base: BASE
  };
})(typeof window !== 'undefined' ? window : self);
