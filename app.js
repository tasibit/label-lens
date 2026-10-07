/* HalalCheck — app.js (UI logic, history, settings, share-target intake)
 * Plain script (ES2018), no modules, no bundler. Depends on globals:
 *   HALAL_DB (db.js/db_ok.js/db_codes.js), HalalCheck (analyzer.js), HCOcr (ocr.js)
 * If a dependency is missing, the relevant feature degrades with a visible message
 * instead of throwing — this file never assumes analyzer.js/ocr.js are present.
 */
(function () {
  'use strict';

  // ---------- small utils ----------

  if (window.top !== window.self) { try { window.top.location = window.location; } catch (e) { document.documentElement.innerHTML = ''; } }   // never run inside someone else's frame
  var HC_PUBLIC = !!window.HC_PUBLIC || /\.github\.io$/i.test(window.location.hostname);   // static public copy: no GB10, never upload photos anywhere
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function byId(id) { return document.getElementById(id); }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function nowTs() { return Date.now(); }

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return ''; }
  }

  // ---------- status colors (mirrors blueprint section 2 verdict colors,
  // extended per-finding for the chips in the results list) ----------

  var STATUS_COLOR = {
    haram: '#c62828', likely: '#c62828', alcoholic: '#c62828',
    doubtful: '#ef6c00', meat: '#ef6c00', school: '#ef6c00',
    caution: '#f9a825', review: '#f9a825', seafood: '#f9a825',
    ok: '#2e7d32', positive: '#2e7d32', veg: '#2e7d32', note: '#2e7d32', clean: '#2e7d32',
    unknown: '#616161',
    animal: '#c62828', unsure: '#ef6c00', alcohol: '#5c6bc0' };
  function colorForStatus(status) { return STATUS_COLOR[status] || STATUS_COLOR.unknown; }

  var VERDICT_COLOR = {
    haram: '#c62828', likely: '#c62828', doubtful: '#ef6c00',
    caution: '#f9a825', clean: '#2e7d32', unknown: '#616161'
  };

  // ---------- settings ----------

  var SETTINGS_KEY = 'hc.settings';
  var DEFAULT_SETTINGS = {
    seafoodStrict: false,
    flagFlavourings: false,
    traditional: false,
    ocrLangDefault: 'chi_sim',
    ocrEngine: 'auto',
    phoneEngine: 'ppocr',
    productKind: 'auto',
    savePhotos: true,
    enhanceDefault: false
  };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
      var parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULT_SETTINGS, parsed);
    } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  var settings = loadSettings();

  // ---------- history ----------

  var HISTORY_KEY = 'hc.history';
  var HISTORY_MAX = 50;

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function addHistory(entry) {
    var list = loadHistory();
    list.unshift(entry);
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    saveHistory(list);
  }

  function deleteHistoryAt(idx) {
    var list = loadHistory();
    list.splice(idx, 1);
    saveHistory(list);
  }

  function clearHistory() { saveHistory([]); }

  // ---------- tabs ----------

  function switchTab(name) {
    qsa('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.dataset.tab === name); });
    qsa('#tabBar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    closeOverlay(byId('resultsPanel'));
    closeOverlay(byId('historyPanel'));
  }

  qsa('#tabBar button').forEach(function (btn) {
    btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
  });

  // ---------- overlay helpers ----------

  function openOverlay(el) { el.classList.remove('hidden'); }
  function closeOverlay(el) { el.classList.add('hidden'); }

  // ---------- results rendering ----------

  function buildSnippetHtml(finding) {
    var sn = finding.snippet;
    if (!sn) return '';
    if (typeof sn === 'object') {
      // analyzer contract: { text, offset, length } — highlight exactly the matched span
      var t = String(sn.text || ''), off = sn.offset | 0, len = sn.length | 0;
      if (len > 0 && off >= 0 && off + len <= t.length) {
        return escapeHtml(t.slice(0, off)) + '<mark>' + escapeHtml(t.slice(off, off + len)) + '</mark>' + escapeHtml(t.slice(off + len));
      }
      sn = t;
    }
    var snip = String(sn);
    var term = finding.term ? String(finding.term) : '';
    var html = escapeHtml(snip);
    if (term) {
      // highlight first occurrence of the matched term inside the escaped snippet
      var escTerm = escapeHtml(term);
      var idx = html.indexOf(escTerm);
      if (idx >= 0) {
        html = html.slice(0, idx) + '<mark>' + escTerm + '</mark>' + html.slice(idx + escTerm.length);
      }
    }
    return html;
  }

  function renderFindingRow(item) {
    var color = colorForStatus(item.status);
    var subParts = [];
    if (item.py) subParts.push(escapeHtml(item.py));
    if (item.en) subParts.push(escapeHtml(item.en));
    var snippetHtml = buildSnippetHtml(item);
    return (
      '<div class="finding-row">' +
        '<div class="finding-main">' +
          '<div class="finding-term">' + escapeHtml(item.term || '') +
            ' <span class="status-chip" style="background:' + color + '">' + escapeHtml(item.status || '') + '</span>' +
          '</div>' +
          (subParts.length ? '<div class="finding-sub">' + subParts.join(' · ') + '</div>' : '') +
          (item.note ? '<div class="finding-note">' + escapeHtml(item.note) + '</div>' : '') +
          (snippetHtml ? '<div class="finding-snippet">' + snippetHtml + '</div>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function renderCodeRow(item) {
    var fakeFinding = {
      term: (item.name_zh || '') + (item.code ? ' (' + item.code + ')' : ''),
      en: item.name_en, py: '', status: item.status, note: item.note
    };
    return renderFindingRow(fakeFinding);
  }

  function renderPositiveRow(item) {
    return (
      '<div class="finding-row">' +
        '<div class="finding-main">' +
          '<div class="finding-term">' + escapeHtml(item.term || '') +
            ' <span class="status-chip" style="background:' + colorForStatus(item.kind === 'veg' ? 'veg' : 'positive') + '">' +
            escapeHtml(item.kind || 'positive') + '</span></div>' +
          (item.en ? '<div class="finding-sub">' + escapeHtml(item.en) + '</div>' : '') +
          (item.note ? '<div class="finding-note">' + escapeHtml(item.note) + '</div>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function renderSegmentChips(segments) {
    if (!segments || !segments.length) return '';
    return segments.map(function (seg) {
      var color = colorForStatus(seg.status);
      var isNeutral = !seg.status || seg.status === 'ok' || seg.status === 'note';
      var style = isNeutral ? '' : (' style="border-color:' + color + ';color:' + color + '"');
      return '<span class="gloss-chip"' + style + '>' + escapeHtml(seg.en || seg.zh || '') + '</span>';
    }).join('');
  }

  function translateUrls(text) {
    var enc = encodeURIComponent(text);
    return {
      baidu: 'https://fanyi.baidu.com/#zh/en/' + enc,
      google: 'https://translate.google.com/?sl=zh-CN&tl=en&text=' + enc + '&op=translate'
    };
  }

  var lastAnalyzedText = '';

  function renderResult(result, sourceText, opts) {
    var body = byId('resultsBody');
    if (!result) {
      body.innerHTML = '<div class="card"><p>HalalCheck.analyze is not available yet (analyzer.js missing or failed to load). ' +
        'Your text has not been lost — go back and try again once the analyzer is installed.</p></div>';
      openOverlay(byId('resultsPanel'));
      return;
    }

    var v = result.verdict || { level: 'unknown', title: 'UNKNOWN', summary: '', color: VERDICT_COLOR.unknown };
    var bannerColor = v.color || VERDICT_COLOR[v.level] || VERDICT_COLOR.unknown;

    var findingsHtml = (result.findings || []).map(renderFindingRow).join('');
    var elsewhereHtml = (result.elsewhere || []).map(renderFindingRow).join('');
    var codesHtml = (result.codes || []).map(renderCodeRow).join('');
    var positivesHtml = (result.positives || []).map(renderPositiveRow).join('');
    var segmentsHtml = renderSegmentChips(result.segments);
    var urls = translateUrls(sourceText);

    var html = '';
    var kindTag = result.kind === 'nonfood' ? '<div class="pn-kind" data-test="kind-nonfood">Non-food item (cosmetic / hygiene): alcohol acceptable, animal-derived ingredients flagged</div>' : '';
    if (result.name && result.name.zh) {
      html += '<div class="product-name" data-test="product-name">' + kindTag + '<div class="pn-zh">' + escapeHtml(result.name.zh) + '</div>' + (result.name.en ? '<div class="pn-en">' + escapeHtml(result.name.en) + '</div>' : '') +
        (result.product && result.product.en ? '<div class="pn-type muted small">Product type: ' + escapeHtml(result.product.en) + ' (' + escapeHtml(result.product.name) + ')</div>' : '') + '</div>';
    } else if (result.product && result.product.en) {
      html += '<div class="product-name" data-test="product-name">' + kindTag + '<div class="pn-type muted small">Product type: ' + escapeHtml(result.product.en) + ' (' + escapeHtml(result.product.name) + ')</div></div>';
    } else if (kindTag) {
      html += '<div class="product-name" data-test="product-name">' + kindTag + '</div>';
    }
    html += '<div class="verdict-banner" data-test="verdict-banner" data-level="' + escapeHtml(v.level || 'unknown') + '" style="background:' + bannerColor + '">' +
      '<div class="verdict-title">' + escapeHtml(v.title || '') + '</div>' +
      '<div class="verdict-summary">' + escapeHtml(v.summary || '') + '</div>' +
      '</div>';

    if (findingsHtml || codesHtml) {
      html += '<div class="card" data-test="findings"><h2 class="section-title">Findings</h2>' + findingsHtml + codesHtml + '</div>';
    }
    if (elsewhereHtml) {
      html += '<div class="card" data-test="elsewhere"><h2 class="section-title">Elsewhere on the pack</h2>' +
        '<p class="muted small">Found outside the ingredient list (name, address, slogans). Not used for the verdict.</p>' + elsewhereHtml + '</div>';
    }

    // no usable list on the pack -> offer an online lookup of the big pack by product name (GB10 browser search)
    if (!result.ingredientSection.found && !(opts && opts.webSource) && !window.HC_INLINE && !HC_PUBLIC) {
      var txt = (result.meta.normalizedText || '').replace(/\s+/g, ' ').trim(), pname = result.product && result.product.name;
      var guess = (result.name && result.name.zh) ? result.name.zh : (txt.length >= 2 && txt.length <= 24) ? txt : (pname ? (((txt.match(/[\u4e00-\u9fff]{2,14}/g) || []).filter(function (r) { return r.indexOf(pname) >= 0; })[0]) || pname) : ((txt.match(/[\u4e00-\u9fff]{2,12}/g) || []).sort(function (a, b) { return b.length - a.length; })[0] || ''));
      html += '<div class="card" data-test="lookup"><h2 class="section-title">Look up the big pack online</h2>' +
        '<p class="muted small">GB10 searches Chinese sites (百度, 360) for the printed 配料 list of this product. Takes 20–80 s. Results are labelled as web lists and may be another variant.</p>' +
        '<div class="field"><label for="lookupName">Product name (edit if wrong — brand + product works best)</label><input type="text" id="lookupName" value="' + escapeHtml(guess) + '" placeholder="e.g. 茂胜 草莓味橡皮糖"></div>' +
        '<div class="btn-row"><button type="button" class="btn primary" id="btnLookup" data-test="lookup-run">🔎 Search online</button></div>' +
        '<div id="lookupOut"></div></div>';
    }
    if (result.perPhoto && result.perPhoto.length > 1) {
      var ph = result.perPhoto.map(function (r, i) {
        var cjk = ((r.meta && r.meta.normalizedText) || '').match(/[\u4e00-\u9fff]/g) || [];
        var what = r.ingredientSection.found ? '配料 ingredient list found' : (cjk.length >= 60 ? 'no ingredient list on this side (other label text)' : (cjk.length ? 'text not readable' : 'nothing read'));
        var usedTag = (i === result.primaryIndex && r.ingredientSection.found) ? ' — used for the verdict' : '';
        return '<li' + (usedTag ? ' class="primary"' : '') + '><strong>Photo ' + (i + 1) + '</strong>: ' + escapeHtml(what) + usedTag + '</li>';
      }).join('');
      if (result.stitched) ph += '<li class="primary"><strong>Joined</strong>: wrapped lines were stitched across the photos (' + result.stitched.joins + ' joins) — the joined list was used for the verdict</li>';
      html += '<div class="card" data-test="photo-summary"><h2 class="section-title">Photos read</h2><ul class="photo-summary">' + ph + '</ul></div>';
    }
    if (positivesHtml) {
      html += '<div class="card"><h2 class="section-title">Positive indicators</h2>' + positivesHtml + '</div>';
    }

    if (segmentsHtml) {
      html += '<div class="card"><h2 class="section-title">' + (result.ingredientSection && result.ingredientSection.found ? 'Ingredient list in English' : 'Text read from the label (no ingredient list)') + '</h2>' +
        '<div class="chip-row">' + segmentsHtml + '</div></div>';
    }

    html += '<div class="card">' +
      '<details class="raw-text"><summary>Raw text</summary><pre>' + escapeHtml(sourceText || '') + '</pre></details>' +
      '<div class="btn-row">' +
        '<button type="button" class="btn" id="btnCopyText">Copy text</button>' +
        '<a class="btn" href="' + urls.baidu + '" target="_blank" rel="noopener noreferrer">Translate (Baidu)</a>' +
        '<a class="btn" href="' + urls.google + '" target="_blank" rel="noopener noreferrer">Translate (Google)</a>' +
        '<button type="button" class="btn" id="btnSaveResult">Save</button>' +
      '</div>' +
      '</div>';

    html += '<div class="disclaimer">Guide only. OCR can misread; verify against the label. No detection &ne; certification.</div>';

    body.innerHTML = html;
    var lb = byId('btnLookup');
    if (lb) lb.addEventListener('click', function () { runLookup(byId('lookupName').value.trim(), byId('lookupOut'), lb); });
    lastAnalyzedText = sourceText || '';

    var copyBtn = byId('btnCopyText');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(sourceText || '').catch(function () {});
        }
      });
    }
    var saveBtn = byId('btnSaveResult');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        addHistory({ ts: nowTs(), text: sourceText || '', verdictLevel: v.level, title: v.title, name: result.name ? result.name.zh : '' });
        saveBtn.textContent = 'Saved ✓';
        setTimeout(function () { saveBtn.textContent = 'Save'; }, 1500);
      });
    }

    openOverlay(byId('resultsPanel'));
  }

  function analyzeAndShow(text, opts) {
    opts = opts || {};
    text = text == null ? '' : String(text);
    var result = null;
    if (window.HalalCheck && typeof window.HalalCheck.analyze === 'function') {
      var runSettings = Object.assign({}, settings, (opts && typeof opts.ocrConfidence === 'number') ? { ocrConfidence: opts.ocrConfidence } : {}, (opts && opts.aiRead) ? { aiRead: true } : {}, (opts && opts.webSource) ? { webSource: opts.webSource } : {}, HC_PUBLIC ? { noServer: true } : {});
      try { result = (opts && opts.texts && opts.texts.length > 1 && window.HalalCheck.analyzeMany) ? window.HalalCheck.analyzeMany(opts.texts, runSettings) : window.HalalCheck.analyze(text, runSettings); }
      catch (e) { result = null; console.error('HalalCheck.analyze failed', e); }
    }
    renderResult(result, text, opts);
    if (result && !opts.skipHistory) {
      addHistory({ ts: nowTs(), text: text, verdictLevel: result.verdict && result.verdict.level, title: result.verdict && result.verdict.title, name: result.name ? result.name.zh : '' });
    }
  }

  function runLookup(name, outEl, btn) {
    if (!name || name.length < 2) { outEl.innerHTML = '<p class="muted">Enter the product name first.</p>'; return; }
    btn.disabled = true; outEl.innerHTML = '<p class="muted">Searching Chinese sites for "' + escapeHtml(name) + '"… (20–80 s)</p>';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', './ocr/lookup?q=' + encodeURIComponent(name), true);
    xhr.timeout = 130000; xhr.responseType = 'json';
    xhr.onload = function () {
      btn.disabled = false;
      var r = xhr.response;
      if (xhr.status === 404) { outEl.innerHTML = '<p class="muted">Online lookup works only in the GB10-hosted app (this copy has no search server).</p>'; return; }
      if (xhr.status !== 200 || !r || !r.ok) { outEl.innerHTML = '<p class="muted">Lookup failed (' + xhr.status + (r && r.error ? ': ' + escapeHtml(r.error) : '') + ').</p>'; return; }
      if (!r.candidates || !r.candidates.length) {
        if (r.walled && r.walled.length) { outEl.innerHTML = '<p class="muted">The search engines (' + escapeHtml(r.walled.join(', ')) + ') are showing GB10 a bot check right now, so nothing could be searched. Try again in 10–30 minutes.</p>'; return; }
        outEl.innerHTML = '<p class="muted">No printed ingredient list found online for this name (searched ' + escapeHtml((r.searched || []).join(', ')) + '). Try brand + product, or a shorter name.</p>'; return;
      }
      var h = '<p class="muted small">Found ' + r.candidates.length + ' list(s)' + (r.cached ? ' (cached)' : '') + '. Tap "Use this list" to analyse it.</p>';
      r.candidates.forEach(function (c, i) {
        h += '<div class="lookup-item"><div class="lookup-src">' + escapeHtml(c.site || '') + ' — ' + escapeHtml(c.title || '') + (c.matched && c.matched.length ? ' · mentions ' + escapeHtml(c.matched.join(' ')) : '') + (c.source && /^https?:/.test(c.source) ? ' · <a href="' + escapeHtml(c.source) + '" target="_blank" rel="noopener noreferrer">source</a>' : '') + '</div><div class="lookup-text">配料: ' + escapeHtml(c.text) + (c.cut ? ' … <span class="muted">(cut short in the search snippet)</span>' : '') + '</div>' +
          '<button type="button" class="btn" data-use="' + i + '">Use this list</button></div>';
      });
      outEl.innerHTML = h;
      outEl.querySelectorAll('button[data-use]').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = r.candidates[Number(b.getAttribute('data-use'))];
          var pname = (byId('lookupName') && byId('lookupName').value.trim()) || '';
          byId('scanTextarea').value = '[web list — ' + c.site + ']\n' + (pname ? '产品名称: ' + pname + '\n' : '') + '配料: ' + c.text;
          analyzeAndShow((pname ? '产品名称: ' + pname + '\n' : '') + '配料: ' + c.text, { webSource: c.site });
        });
      });
    };
    xhr.onerror = function () { btn.disabled = false; outEl.innerHTML = '<p class="muted">Lookup failed: network error (GB10 not reachable?).</p>'; };
    xhr.ontimeout = function () { btn.disabled = false; outEl.innerHTML = '<p class="muted">Lookup timed out.</p>'; };
    xhr.send();
  }
  byId('resultsBackBtn').addEventListener('click', function () { closeOverlay(byId('resultsPanel')); });

  // ---------- Paste tab ----------

  byId('btnAnalyzePaste').addEventListener('click', function () {
    var text = byId('pasteTextarea').value;
    analyzeAndShow(text);
  });

  // ---------- Scan tab ----------

  var lastOcrConfidence = null;
  var scanState = {
    bitmap: null,
    rotation: 0,
    crop: null, // {x, y, w, h} as fractions of the rotated preview — OCR reads only this box when set
    enhance: !!settings.enhanceDefault,
    photos: [],   // [{bitmap, rotation, crop}] — several shots of the same pack; bitmap/rotation/crop mirror photos[current]
    current: -1
  };
  function saveCurrent() {
    if (scanState.current >= 0 && scanState.photos[scanState.current]) {
      var ph = scanState.photos[scanState.current];
      ph.bitmap = scanState.bitmap; ph.rotation = scanState.rotation; ph.crop = scanState.crop;
    }
  }
  function selectPhoto(i) {
    saveCurrent();
    scanState.current = i;
    var ph = scanState.photos[i];
    scanState.bitmap = ph ? ph.bitmap : null; scanState.rotation = ph ? ph.rotation : 0; scanState.crop = ph ? ph.crop : null;
    if (ph) { drawPreview(); setScanControlsEnabled(true); } else { previewCanvas.classList.add('hidden'); previewPlaceholder.classList.remove('hidden'); setScanControlsEnabled(false); }
    updateCropUi(); renderPhotoStrip();
  }
  function addPhotoBitmap(bmp, file) {
    saveCurrent();
    scanState.photos.push({ bitmap: bmp, rotation: 0, crop: null, file: file || null });   // the original file gives the phone engine untouched pixels
    selectPhoto(scanState.photos.length - 1);
  }
  function removePhoto(i) {
    saveCurrent();
    var viewed = scanState.photos[scanState.current];
    scanState.photos.splice(i, 1);
    if (!scanState.photos.length) { scanState.current = -1; selectPhoto(-1); return; }
    scanState.current = -1; // nothing to save back
    var keep = scanState.photos.indexOf(viewed);
    selectPhoto(keep >= 0 ? keep : Math.min(i, scanState.photos.length - 1));
  }
  function renderPhotoStrip() {
    var strip = byId('photoStrip'); if (!strip) return;
    strip.innerHTML = '';
    strip.classList.toggle('hidden', scanState.photos.length < 1);
    var clearBtn = byId('btnClearPhotos'); if (clearBtn) clearBtn.classList.toggle('hidden', scanState.photos.length < 2);
    var addRow = byId('addPhotoRow'); if (addRow) addRow.classList.toggle('hidden', scanState.photos.length < 1);
    scanState.photos.forEach(function (ph, i) {
      var d = document.createElement('div'); d.className = 'thumb' + (i === scanState.current ? ' current' : ''); d.setAttribute('data-test', 'photo-thumb');
      var c = document.createElement('canvas'); c.width = 64; c.height = 64;
      var ctx = c.getContext('2d'), bw = ph.bitmap.width, bh = ph.bitmap.height, sc = Math.max(64 / bw, 64 / bh);
      ctx.drawImage(ph.bitmap, (64 - bw * sc) / 2, (64 - bh * sc) / 2, bw * sc, bh * sc);
      d.appendChild(c);
      var n = document.createElement('span'); n.className = 'num'; n.textContent = String(i + 1); d.appendChild(n);
      var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×'; rm.setAttribute('aria-label', 'Remove photo ' + (i + 1));
      rm.addEventListener('click', function (ev) { ev.stopPropagation(); removePhoto(i); });
      d.appendChild(rm);
      d.addEventListener('click', function () { selectPhoto(i); });
      strip.appendChild(d);
    });
  }
  byId('btnEnhance').textContent = '✨ Enhance: ' + (scanState.enhance ? 'On' : 'Off');
  byId('btnEnhance').setAttribute('aria-pressed', String(scanState.enhance));

  var previewCanvas = byId('previewCanvas');
  var previewPlaceholder = byId('previewPlaceholder');

  function drawPreview() {
    if (!scanState.bitmap) return;
    var bmp = scanState.bitmap;
    var rot = ((scanState.rotation % 360) + 360) % 360;
    var w = bmp.width, h = bmp.height;
    var swapped = rot === 90 || rot === 270;
    var cw = swapped ? h : w;
    var ch = swapped ? w : h;
    // cap canvas render size for a snappy preview; OCR re-reads from this same canvas
    var maxDim = 1600;
    var scale = Math.min(1, maxDim / Math.max(cw, ch));
    previewCanvas.width = Math.round(cw * scale);
    previewCanvas.height = Math.round(ch * scale);
    var ctx = previewCanvas.getContext('2d');
    ctx.save();
    ctx.translate(previewCanvas.width / 2, previewCanvas.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    var drawScale = scale;
    // ctx.rotate() already turns the image; the bitmap is always drawn centred in its own w x h
    ctx.drawImage(bmp, -w * drawScale / 2, -h * drawScale / 2, w * drawScale, h * drawScale);
    ctx.restore();
    previewCanvas.classList.remove('hidden');
    drawCropOverlay();
    previewPlaceholder.classList.add('hidden');
  }

  function setScanControlsEnabled(enabled) {
    byId('btnRotate').disabled = !enabled;
    byId('btnEnhance').disabled = !enabled;
    byId('btnReadText').disabled = !enabled;
  }

  function loadFileIntoPreview(file) {
    if (!file) return Promise.resolve();
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
        addPhotoBitmap(bmp, file);
      }).catch(function () {
        return fallbackImgPreview(file);
      });
    }
    return fallbackImgPreview(file);
  }

  function fallbackImgPreview(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { addPhotoBitmap(img, file); URL.revokeObjectURL(url); resolve(); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(); };
      img.src = url;
    });
  }
  function loadFilesSequentially(files) {
    var list = Array.prototype.slice.call(files || []);
    return list.reduce(function (p, f) { return p.then(function () { return loadFileIntoPreview(f); }); }, Promise.resolve());
  }

  byId('btnPhotograph').addEventListener('click', function () { byId('fileInputCamera').click(); });
  byId('btnGallery').addEventListener('click', function () { byId('fileInputGallery').click(); });
  // A new selection REPLACES the photo set (a new pack must never inherit the previous pack's photos);
  // "Add another photo" appends to the current set.
  // Photos taken through the app's camera button are temporary files that Android does not add to the Gallery.
  // Save the untouched original (full resolution, EXIF intact) into Downloads, which the Gallery lists as an album.
  function saveCopyToDownloads(file, n) {
    try {
      var d = new Date(), pad = function (x) { return (x < 10 ? '0' : '') + x; };
      var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
      var ext = (file.type === 'image/png') ? 'png' : (file.type === 'image/webp' ? 'webp' : 'jpg');
      var url = URL.createObjectURL(file);
      var a = document.createElement('a'); a.href = url; a.download = 'LabelLens_' + stamp + (n ? '_' + n : '') + '.' + ext;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
    } catch (err) { console.warn('could not save a copy of the photo', err); }
  }
  function takeFiles(e) {
    var files = e.target.files; if (!files || !files.length) return;
    if (e.target.id === 'fileInputCamera' && settings.savePhotos !== false) {
      for (var i = 0; i < files.length; i++) saveCopyToDownloads(files[i], files.length > 1 ? i + 1 : 0);
    }
    if (!scanState.appendNext) { scanState.photos = []; scanState.current = -1; byId('scanTextarea').value = ''; clearOcrError(); }
    scanState.appendNext = false;
    loadFilesSequentially(files).then(function () { e.target.value = ''; });
  }
  byId('fileInputCamera').addEventListener('change', takeFiles);
  byId('fileInputGallery').addEventListener('change', takeFiles);
  byId('btnAddPhoto').addEventListener('click', function () { scanState.appendNext = true; byId('fileInputCamera').click(); });
  byId('btnAddGallery').addEventListener('click', function () { scanState.appendNext = true; byId('fileInputGallery').click(); });
  byId('btnClearPhotos').addEventListener('click', function () { scanState.photos = []; scanState.current = -1; selectPhoto(-1); byId('scanTextarea').value = ''; });

  byId('btnRotate').addEventListener('click', function () {
    scanState.rotation = (scanState.rotation + 90) % 360;
    saveCurrent();
    drawPreview();
  });

  byId('btnEnhance').addEventListener('click', function () {
    scanState.enhance = !scanState.enhance;
    byId('btnEnhance').textContent = '✨ Enhance: ' + (scanState.enhance ? 'On' : 'Off');
    byId('btnEnhance').setAttribute('aria-pressed', String(scanState.enhance));
  });

  function setProgress(pct, label) {
    var wrap = byId('progressWrap');
    wrap.classList.add('active');
    byId('progressFill').style.width = Math.max(0, Math.min(100, pct)) + '%';
    byId('progressLabel').textContent = label || '';
  }

  function hideProgress() { byId('progressWrap').classList.remove('active'); }

  // ---------- crop box, OCR source, diagnostics ----------
  function drawCropOverlay() {
    var c = scanState.crop; if (!c) return;
    var ctx = previewCanvas.getContext('2d'), W = previewCanvas.width, H = previewCanvas.height;
    var x = c.x * W, y = c.y * H, w = c.w * W, h = c.h * H;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, y); ctx.fillRect(0, y + h, W, H - y - h); ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, W - x - w, h);
    ctx.strokeStyle = '#ffd600'; ctx.lineWidth = Math.max(2, W / 300); ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  function updateCropUi() {
    var b = byId('btnClearCrop'); if (b) b.classList.toggle('hidden', !scanState.crop);
    var hint = byId('cropHint');
    if (hint) hint.textContent = scanState.crop ? 'Reading only the yellow box. Drag again to change it, or clear it.' : 'Tip: drag a box around just the ingredient text for a sharper read.';
  }
  (function enableCropDrag() {
    var dragging = false, sx = 0, sy = 0;
    function frac(ev) {
      var r = previewCanvas.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
    }
    previewCanvas.addEventListener('pointerdown', function (ev) {
      if (!scanState.bitmap) return;
      dragging = true; var f = frac(ev); sx = f.x; sy = f.y; scanState.crop = null;
      try { previewCanvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault();
    });
    previewCanvas.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var f = frac(ev);
      scanState.crop = { x: Math.min(sx, f.x), y: Math.min(sy, f.y), w: Math.abs(f.x - sx), h: Math.abs(f.y - sy) };
      drawPreview(); ev.preventDefault();
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      var c = scanState.crop;
      if (!c || c.w < 0.03 || c.h < 0.03) scanState.crop = null;
      saveCurrent();
      drawPreview(); updateCropUi();
    }
    previewCanvas.addEventListener('pointerup', end);
    previewCanvas.addEventListener('pointercancel', end);
  })();
  byId('btnClearCrop').addEventListener('click', function () { scanState.crop = null; saveCurrent(); drawPreview(); updateCropUi(); });

  function buildOcrSource(photo) {
    photo = photo || { bitmap: scanState.bitmap, rotation: scanState.rotation, crop: scanState.crop };
    var bmp = photo.bitmap, rot = ((photo.rotation % 360) + 360) % 360;
    if (!photo.crop) return { source: bmp, rotate: rot, info: bmp.width + 'x' + bmp.height + ' full image, rotate ' + rot };
    var w = bmp.width, h = bmp.height, swapped = rot === 90 || rot === 270, rw = swapped ? h : w, rh = swapped ? w : h;
    var c = photo.crop;
    var cx = Math.round(c.x * rw), cy = Math.round(c.y * rh), cw = Math.max(1, Math.round(c.w * rw)), ch = Math.max(1, Math.round(c.h * rh));
    var out = document.createElement('canvas'); out.width = cw; out.height = ch;
    var ctx = out.getContext('2d');
    // draw the rotated full-resolution bitmap so that the crop box lands at the origin
    ctx.save();
    ctx.translate(-cx + rw / 2, -cy + rh / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    ctx.restore();
    return { source: out, rotate: 0, info: cw + 'x' + ch + ' crop of ' + rw + 'x' + rh };
  }

  function showOcrError(msg) { var el = byId('ocrError'); el.textContent = msg; el.classList.remove('hidden'); }
  function clearOcrError() { byId('ocrError').classList.add('hidden'); }
  function setDebug(obj) {
    var lines = Object.keys(obj).map(function (k) { return k + ': ' + obj[k]; });
    byId('ocrDebugText').textContent = lines.join('\n');
    byId('ocrDebug').classList.remove('hidden');
  }
  byId('btnCopyDebug').addEventListener('click', function () {
    var t = byId('ocrDebugText').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(function () {});
  });


  // ---------- server OCR (PP-OCR on GB10) with on-device fallback ----------
  function makeJpegForServer(src) {
    var source = src.source, rot = ((src.rotate || 0) % 360 + 360) % 360;
    var w = source.width, h = source.height, swapped = rot === 90 || rot === 270;
    var rw = swapped ? h : w, rh = swapped ? w : h;
    var scale = Math.min(1, 2500 / Math.max(rw, rh));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(rw * scale)); c.height = Math.max(1, Math.round(rh * scale));
    var ctx = c.getContext('2d');
    ctx.save(); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(rot * Math.PI / 180); ctx.scale(scale, scale);
    ctx.drawImage(source, -w / 2, -h / 2, w, h); ctx.restore();
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('could not encode the photo')); }, 'image/jpeg', 0.88);
    });
  }
  function serverVlm(src, onProgress) {
    return makeJpegForServer(src).then(function (blob) {
      var attempt = function (n) { return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', './ocr?mode=vlm', true);
        xhr.timeout = 130000; xhr.responseType = 'json';
        xhr.setRequestHeader('Content-Type', 'image/jpeg');
        xhr.upload.onload = function () { if (onProgress) onProgress({ status: 'GB10 AI vision is reading the label (about 5 s)', progress: 0 }); };
        xhr.onload = function () {
          var r = xhr.response;
          if (xhr.status === 200 && r && r.ok) resolve({ text: r.text || '', confidence: null, ms: r.ms, engine: 'ai' });
          else reject(new Error('AI vision HTTP ' + xhr.status + (r && r.error ? ': ' + r.error : '')));
        };
        xhr.onerror = function () { if (n < 1) { if (onProgress) onProgress({ status: 'Connection dropped, retrying AI vision…', progress: 0 }); setTimeout(function () { attempt(n + 1).then(resolve, reject); }, 1500); } else reject(new Error('AI vision network error')); };
        xhr.ontimeout = function () { reject(new Error('AI vision timed out')); };
        xhr.send(blob);
      }); };
      return attempt(0);
    });
  }
  function aiTextUsable(t) { t = (t || '').trim(); var body = t.replace(/^配料[:：]?\s*/, '').replace(/\[?unreadable\]?/gi, '').trim(); return !!body && (body.match(/[\u4e00-\u9fff]/g) || []).length >= 6; }
  function serverOcr(src, onProgress, fast) {
    return makeJpegForServer(src).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', fast ? './ocr?fast=1' : './ocr', true);
        xhr.timeout = 90000;
        xhr.responseType = 'json';
        xhr.setRequestHeader('Content-Type', 'image/jpeg');
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && onProgress) onProgress({ status: 'uploading photo to GB10', progress: e.loaded / e.total, detail: (e.loaded / 1048576).toFixed(2) + ' / ' + (e.total / 1048576).toFixed(2) + ' MB' });
        };
        xhr.upload.onload = function () { if (onProgress) onProgress({ status: 'GB10 is reading the label', progress: 0 }); };
        xhr.onload = function () {
          var r = xhr.response;
          if (xhr.status === 200 && r && r.ok) resolve({ text: r.text || '', confidence: r.confidence, ms: r.ms, engine: 'server' });
          else reject(new Error('server OCR HTTP ' + xhr.status + (r && r.error ? ': ' + r.error : '')));
        };
        xhr.onerror = function () { reject(new Error('server OCR network error')); };
        xhr.ontimeout = function () { reject(new Error('server OCR timed out')); };
        xhr.send(blob);
      });
    });
  }

  function ocrOnePhoto(photo, lang, blockMode, useServer, progressCb, dbgPhoto) {
    var src;
    try { src = buildOcrSource(photo); } catch (e) { return Promise.reject(new Error('Could not prepare the image: ' + (e && e.message ? e.message : e))); }
    dbgPhoto.image = src.info;
    var attempt = useServer
      ? serverOcr(src, progressCb).catch(function (err) {
          dbgPhoto.serverError = String(err && err.message ? err.message : err);
          progressCb({ status: 'GB10 not reachable — reading on the phone instead', progress: 0 });
          return null;
        })
      : Promise.resolve(null);
    var tesseract = function () {
      dbgPhoto.engine = 'phone (Tesseract)';
      return window.HCOcr.recognize(src.source, { lang: lang, enhance: scanState.enhance, rotate: src.rotate, blockMode: blockMode, onProgress: progressCb });
    };
    return attempt.then(function (serverRes) {
      if (serverRes) { dbgPhoto.engine = 'server (PP-OCR on GB10)'; return serverRes; }
      // on-phone PP-OCR (same models as GB10, run by onnxruntime-web) when available; Tesseract only as the last resort
      var pp = window.HCPpocr;
      if (pp && typeof pp.recognize === 'function' && !window.HC_INLINE && pp.isSupported() && settings.phoneEngine !== 'tesseract') {
        var untouched = photo && photo.file && !photo.crop && !((photo.rotation || 0) % 360);
        return (untouched ? Promise.resolve(photo.file) : makeJpegForServer(src)).then(function (blob) {
          return pp.recognize(blob, { onProgress: progressCb, maxSide: 2000 });   // 2000 = the server's max_side_len; measured 0.83 vs 0.78 similarity at 1600
        }).then(function (res) {
          dbgPhoto.engine = 'phone (PP-OCR web)'; dbgPhoto.ppocrMs = res.ms;
          return { text: res.text || '', confidence: res.confidence, ms: res.ms, engine: 'ppocr-web' };
        }, function (err) {
          dbgPhoto.ppocrError = String(err && err.message ? err.message : err);
          progressCb({ status: 'PP-OCR could not run here — trying the basic reader', progress: 0 });
          return tesseract();
        });
      }
      return tesseract();
    });
  }

  // ---------- live scan: keep reading frames from the camera while the user turns the pack ----------
  var live = { stream: null, timer: null, busy: false, stopped: true, texts: [], frames: 0, sent: 0, maxSharp: 0, lastSent: 0, result: null };
  function liveSetStatus(msg) { byId('liveStatus').textContent = msg; }
  function sharpnessOf(ctx, w, h) {
    var d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), i, x, y;
    for (i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    var sum = 0, sum2 = 0, n = 0;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var v = 4 * g[y * w + x] - g[y * w + x - 1] - g[y * w + x + 1] - g[(y - 1) * w + x] - g[(y + 1) * w + x];
      sum += v; sum2 += v * v; n++;
    }
    var mean = sum / n; return sum2 / n - mean * mean;
  }
  function liveRenderFindings() {
    var box = byId('liveFindings');
    if (!live.texts.length) { box.innerHTML = '<div class="lf-verdict">Nothing read yet — hold the ingredient text in view, then turn the pack slowly.</div>'; return; }
    var r = null;
    try { r = window.HalalCheck.analyzeMany(live.texts, settings); } catch (e) { r = null; }
    live.result = r;
    if (!r) { box.innerHTML = ''; return; }
    var html = '<div class="lf-verdict">So far: ' + escapeHtml(r.verdict.title) + (r.ingredientSection.found ? ' · 配料 list found ✓' : ' · 配料 list not seen yet') + (r.stitched ? ' · ' + r.stitched.joins + ' line joins across frames' : '') + '</div>';
    r.findings.slice(0, 12).forEach(function (f) { html += '<span class="lf-item sev' + f.severity + '">' + escapeHtml(f.term) + ' · ' + escapeHtml(f.en) + '</span>'; });
    r.positives.forEach(function (p) { html += '<span class="lf-item">' + escapeHtml(p.term) + ' · ' + escapeHtml(p.en) + '</span>'; });
    box.innerHTML = html;
  }
  function liveTick() {
    if (live.stopped || live.busy) return;
    var video = byId('liveVideo');
    if (!video.videoWidth) return;
    var now = Date.now();
    if (now - live.lastSent < 1200) return;
    var vw = video.videoWidth, vh = video.videoHeight;
    var small = document.createElement('canvas'); small.width = 240; small.height = Math.max(1, Math.round(240 * vh / vw));
    small.getContext('2d').drawImage(video, 0, 0, small.width, small.height);
    var sharp = sharpnessOf(small.getContext('2d'), small.width, small.height);
    live.frames++;
    if (sharp > live.maxSharp) live.maxSharp = sharp;
    if (sharp < Math.max(25, 0.45 * live.maxSharp)) { liveSetStatus('Hold still a moment… (frames ' + live.frames + ', read ' + live.sent + ')'); return; }
    // send only the guide-box area (4%..96% x 20%..80%): the engine then spends its ~2000 px on the label, not the room
    var cx = Math.round(vw * 0.04), cy = Math.round(vh * 0.20), cw = Math.round(vw * 0.92), chh = Math.round(vh * 0.60);
    var full = document.createElement('canvas'); full.width = cw; full.height = chh;
    full.getContext('2d').drawImage(video, cx, cy, cw, chh, 0, 0, cw, chh);
    live.busy = true; live.lastSent = now;
    liveSetStatus('Reading frame ' + (live.sent + 1) + '…');
    serverOcr({ source: full, rotate: 0 }, function () {}, true).then(function (res) {
      live.sent++;
      var text = (res && res.text || '').trim();
      if (text.length >= 6) {
        var norm = text.replace(/\s+/g, '');
        var dup = live.texts.some(function (t) { return t.replace(/\s+/g, '') === norm; });
        if (!dup) { live.texts.push(text); if (live.texts.length > 24) live.texts.shift(); }
      }
      liveRenderFindings();
      liveSetStatus('Frames read: ' + live.sent + ' · text pieces: ' + live.texts.length + ' · camera ' + byId('liveVideo').videoWidth + '×' + byId('liveVideo').videoHeight + ' · turn the pack slowly so each view overlaps the last; tap Finish when the list shows ✓');
    }).catch(function (err) {
      liveSetStatus('GB10 not reachable (' + (err && err.message ? err.message : err) + '). Live scan needs the server engine.');
    }).then(function () { live.busy = false; });
  }
  function liveStop(finish) {
    live.stopped = true;
    if (live.timer) { clearInterval(live.timer); live.timer = null; }
    if (live.stream) { live.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } }); live.stream = null; }
    var video = byId('liveVideo'); try { video.pause(); video.srcObject = null; } catch (e) { /* ignore */ }
    closeOverlay(byId('livePanel'));
    if (finish && live.texts.length) {
      var combined = live.texts[0];
      live.texts.slice(1).forEach(function (t, i) { combined += '\n\n[frame ' + (i + 2) + ']\n' + t; });
      byId('scanTextarea').value = combined;
      lastOcrConfidence = null;
      analyzeAndShow(combined, { texts: live.texts.slice() });
    } else if (finish) {
      showOcrError('Live scan read nothing. Bring the ingredient text closer and hold it still for a second at a time.');
    }
  }
  function liveStart() {
    clearOcrError();
    if (window.HC_INLINE || HC_PUBLIC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showOcrError('Live scan needs the installed (https) app and a camera. Use "Photograph" instead.'); return; }
    if ((settings.ocrEngine || 'auto') === 'device') { showOcrError('Live scan needs the GB10 engine: set Settings → OCR engine to Auto.'); return; }
    live.texts = []; live.frames = 0; live.sent = 0; live.maxSharp = 0; live.lastSent = 0; live.busy = false; live.result = null; live.stopped = false;
    liveRenderFindings();
    openOverlay(byId('livePanel'));
    liveSetStatus('Starting camera…');
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } }).then(function (stream) {
      if (live.stopped) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      live.stream = stream;
      var video = byId('liveVideo'); video.srcObject = stream;
      return video.play().catch(function () {}).then(function () {
        var vw = byId('liveVideo').videoWidth, vh = byId('liveVideo').videoHeight;
        liveSetStatus('Camera ' + vw + '×' + vh + '. Fill the box with the ingredient text — video frames have far fewer pixels than a photo, so come close. Hold still a second per side.');
        live.timer = setInterval(liveTick, 500);
      });
    }).catch(function (err) {
      liveStop(false);
      showOcrError('Camera not available: ' + (err && err.message ? err.message : err) + '. Use "Photograph" instead.');
    });
  }
  if (HC_PUBLIC) {
    byId('btnAiRead').style.display = 'none'; byId('btnLiveScan').style.display = 'none';
    var eng = byId('setOcrEngine'); if (eng) { eng.value = 'device'; eng.disabled = true; Array.prototype.forEach.call(eng.options, function (o) { o.textContent = 'Phone only — this public copy has no server'; }); }
    var ch = byId('cropHint');
    if (ch && ch.parentNode) {
      var guide = document.createElement('div'); guide.className = 'card public-guide'; guide.setAttribute('data-test', 'public-guide');
      guide.innerHTML = '<h2 class="section-title">Reading labels on this copy</h2>' +
        '<p>Photos are read <strong>on your phone</strong> with PP-OCR, the same engine the full version uses. The first read downloads about 30 MB once; after that it works offline, about 5–10 seconds per photo.</p>' +
        '<p class="muted small">Alternative: iPhone Live Text (Camera → text button → Select All → Copy) or Android "Extract text", then the Paste tab.</p>';
      ch.parentNode.insertBefore(guide, ch.parentNode.firstChild);
    }
    var tip = byId('cropHint'); if (tip) tip.textContent = 'Public copy: text is read on the phone. Fill the frame with the 配料 lines, or drag a box around them; for a cleaner read use the phone\'s own text extraction and the Paste tab.';
  }   // style, not the hidden attribute: .btn sets display
  byId('btnAiRead').addEventListener('click', function () {
    saveCurrent();
    var photo = scanState.photos[scanState.current] || (scanState.bitmap ? { bitmap: scanState.bitmap, rotation: scanState.rotation, crop: scanState.crop } : null);
    if (!photo) return;
    clearOcrError(); byId('btnReadText').disabled = true;
    setProgress(0, 'Sending the photo to GB10 AI vision…');
    var t0 = Date.now();
    serverVlm(buildOcrSource(photo), function (info) { setProgress(0, info.status || 'AI vision…'); }).then(function (ai) {
      hideProgress(); byId('btnReadText').disabled = false;
      setDebug({ time: new Date().toISOString(), engine: 'AI vision (Qwen3-VL on GB10)', ms: Date.now() - t0, chars: (ai.text || '').length });
      if (aiTextUsable(ai.text)) { byId('scanTextarea').value = '[AI vision read]\n' + ai.text; analyzeAndShow(ai.text, { aiRead: true }); }
      else showOcrError('AI vision found no readable ingredient list in this photo. Check that the photo shows the side with 配料 (the address and nutrition sides will not read), then use Read text first — it zooms in on the list; AI vision is the fallback.');
    }).catch(function (err) { hideProgress(); byId('btnReadText').disabled = false; showOcrError('AI vision failed: ' + (err && err.message ? err.message : err)); });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && !live.stopped) liveStop(false); });
  window.addEventListener('pagehide', function () { if (!live.stopped) liveStop(false); });
  byId('btnLiveScan').addEventListener('click', liveStart);
  byId('liveCancelBtn').addEventListener('click', function () { liveStop(false); });
  byId('liveFinishBtn').addEventListener('click', function () { liveStop(true); });

  byId('btnReadText').addEventListener('click', function () {
    saveCurrent();
    var photos = scanState.photos.length ? scanState.photos : (scanState.bitmap ? [{ bitmap: scanState.bitmap, rotation: scanState.rotation, crop: scanState.crop }] : []);
    if (!photos.length) return;
    clearOcrError();
    var lang = byId('ocrLang').value;
    var blockMode = byId('blockMode').checked;
    var t0 = Date.now();
    var useServer = (settings.ocrEngine || 'auto') !== 'device' && !window.HC_INLINE && !HC_PUBLIC && navigator.onLine !== false;
    if (!useServer && (!window.HCOcr || typeof window.HCOcr.recognize !== 'function')) {
      showOcrError('OCR engine not available (ocr.js missing). Use the Paste tab instead, or your phone\'s own text extraction.');
      return;
    }
    var dbg = { time: new Date().toISOString(), app: (window.HalalCheck && window.HalalCheck.VERSION) || '?', ua: navigator.userAgent,
      photos: photos.length, enhance: scanState.enhance, lang: lang, blockMode: blockMode, engine: useServer ? 'server first (PP-OCR on GB10), phone fallback' : 'phone (Tesseract)' };
    byId('btnReadText').disabled = true;
    setProgress(0, useServer ? 'Sending the photo to GB10…' : 'Loading Chinese OCR (≈5 MB, first time only)…');
    var results = [];
    var chain = Promise.resolve();
    photos.forEach(function (photo, idx) {
      chain = chain.then(function () {
        var prefix = photos.length > 1 ? 'photo ' + (idx + 1) + ' of ' + photos.length + ': ' : '';
        var progressCb = function (info) {
          info = info || {};
          var pct = typeof info.progress === 'number' ? Math.round(info.progress * 100) : 0;
          var label = prefix + (info.status || 'working') + (pct ? ' ' + pct + '%' : '') + (info.detail ? ' — ' + info.detail : '');
          var secs = Math.round((Date.now() - t0) / 1000);
          if (secs > 40 && /loading|download|initializ/i.test(info.status || '')) label += ' (' + secs + ' s — downloading the OCR engine over your mobile connection, first time only; keep this screen open)';
          setProgress(pct, label);
        };
        var dbgPhoto = {};
        return ocrOnePhoto(photo, lang, blockMode, useServer, progressCb, dbgPhoto).then(function (res) {
          var text = (res && res.text) || '';
          var conf = (res && typeof res.confidence === 'number') ? res.confidence : null;
          var score = 0;
          try {
            if (window.HalalCheck && text.trim()) {
              var a = window.HalalCheck.analyze(text, Object.assign({}, settings, conf !== null ? { ocrConfidence: conf } : {}));
              score = (a.ingredientSection.found ? 2 : 0) + (a.quality ? a.quality.coverage : 0) + (a.findings.some(function (f) { return f.severity >= 5; }) ? 1 : 0);
            }
          } catch (e) { /* scoring is best-effort */ }
          dbg['photo' + (idx + 1)] = dbgPhoto.engine + ' | ' + dbgPhoto.image + ' | conf ' + conf + ' | chars ' + text.length + ' | score ' + score.toFixed(2) + (dbgPhoto.serverError ? ' | server: ' + dbgPhoto.serverError : '');
          results.push({ idx: idx, text: text, confidence: conf, score: score });
        });
      });
    });
    chain.then(function () {
      hideProgress();
      byId('btnReadText').disabled = false;
      var readable = results.filter(function (r) { return r.text.trim(); });
      dbg.ms = Date.now() - t0;
      readable.sort(function (a, b) { return b.score - a.score || a.idx - b.idx; });
      var listFound = readable.length && readable[0].score >= 2;
      if (listFound) {
        var primary = readable[0];
        var combined = primary.text;
        readable.slice(1).forEach(function (r) { combined += '\n\n[photo ' + (r.idx + 1) + ']\n' + r.text; });
        if (window.HalalCheck && window.HalalCheck.stitchTexts && readable.length > 1) {
          var stTry = window.HalalCheck.stitchTexts(readable.map(function (r) { return r.text; }));
          if (stTry.joins > 0) combined = '[joined across photos — ' + stTry.joins + ' line joins]\n' + stTry.text + '\n\n' + combined;
        }
        dbg.primary = 'photo ' + (primary.idx + 1); dbg.confidence = primary.confidence; dbg.chars = combined.length; setDebug(dbg);
        lastOcrConfidence = primary.confidence;
        byId('scanTextarea').value = combined;
        // texts in PHOTO order (empty where nothing was read) so the result can name photos correctly; analyzeMany picks the best itself
        analyzeAndShow(combined, { ocrConfidence: primary.confidence, texts: results.slice().sort(function (a, b) { return a.idx - b.idx; }).map(function (r) { return r.text || ''; }) });
        return;
      }
      // OCR found no readable 配料 list: ask the AI vision model on GB10 (reads through blur/curvature; labelled AI-read)
      if (useServer) {
        var order = readable.map(function (r) { return r.idx; });
        photos.forEach(function (_, i) { if (order.indexOf(i) === -1) order.push(i); });
        byId('btnReadText').disabled = true;
        setProgress(0, 'OCR could not read the list — asking GB10 AI vision…');
        var aiAttempt = Promise.resolve(null), tried = 0;
        order.forEach(function (idx) {
          aiAttempt = aiAttempt.then(function (found) {
            if (found) return found;
            tried++;
            setProgress(0, 'AI vision reading photo ' + (idx + 1) + ' of ' + photos.length + '…');
            return serverVlm(buildOcrSource(photos[idx]), function () {}).then(function (ai) {
              dbg['aiVision' + (idx + 1)] = (ai.ms || '?') + ' ms, ' + (ai.text || '').length + ' chars';
              return aiTextUsable(ai.text) ? { text: ai.text, idx: idx } : null;
            }).catch(function (err) { dbg['aiVision' + (idx + 1)] = 'error: ' + (err && err.message ? err.message : err); return null; });
          });
        });
        return aiAttempt.then(function (ai) {
          hideProgress(); byId('btnReadText').disabled = false;
          dbg.aiVisionTried = tried; setDebug(dbg);
          if (ai) {
            byId('scanTextarea').value = '[AI vision read — photo ' + (ai.idx + 1) + ']\n' + ai.text + (readable.length ? '\n\n[OCR text]\n' + readable[0].text : '');
            analyzeAndShow(ai.text, { aiRead: true });
          } else {
            byId('scanTextarea').value = readable.length ? readable[0].text : '';
            var cjkRead = readable.length ? (readable[0].text.match(/[\u4e00-\u9fff]/g) || []).length : 0;
            if (cjkRead >= 60) showOcrError('This side of the pack has no ingredient list: the text read fine but contains no 配料 line (it looks like the manufacturer / nutrition side). Photograph the side that shows 配料.');
            else showOcrError('Neither the OCR engine nor AI vision could read the ingredient list. Bring the 配料 text closer, pull the seam flat, move the glare off the text, let the camera focus.');
          }
        }).catch(function (err) {
          hideProgress(); byId('btnReadText').disabled = false;
          dbg.aiVisionError = String(err && err.message ? err.message : err); setDebug(dbg);
          byId('scanTextarea').value = readable.length ? readable[0].text : '';
          if (readable.length) analyzeAndShow(readable[0].text, { ocrConfidence: readable[0].confidence });
          else showOcrError('No text recognised. Fill the frame with the ingredient text, flatten the seam, let the camera focus.');
        });
      }
      setDebug(dbg);
      if (!readable.length) { byId('scanTextarea').value = ''; showOcrError('No text recognised in ' + (photos.length > 1 ? 'any of the photos' : 'the photo') + '. Fill the frame with the ingredient text, flatten the seam, let the camera focus — or use the phone\'s own "Extract text" and the Paste tab.'); return; }
      byId('scanTextarea').value = readable[0].text;
      analyzeAndShow(readable[0].text, { ocrConfidence: readable[0].confidence });
    }).catch(function (err) {
      hideProgress();
      byId('btnReadText').disabled = false;
      dbg.ms = Date.now() - t0; dbg.error = String(err && (err.stack || err.message) || err); setDebug(dbg);
      console.error('OCR failed', err);
      showOcrError('OCR failed: ' + (err && err.message ? err.message : err) + ' — use the Paste tab with the phone\'s own text extraction.');
    });
  });

  byId('btnAnalyzeScan').addEventListener('click', function () {
    analyzeAndShow(byId('scanTextarea').value);
  });

  // ---------- Glossary tab ----------

  var GLOSSARY_PAGE = 200;
  var glossaryFilter = 'all';
  var glossaryQuery = '';
  var glossaryShown = GLOSSARY_PAGE;

  var GLOSSARY_STATUSES = ['all', 'haram', 'likely', 'doubtful', 'meat', 'school', 'caution', 'seafood', 'review', 'ok', 'positive', 'veg', 'note'];

  function renderGlossaryFilters() {
    var wrap = byId('glossaryFilters');
    wrap.innerHTML = GLOSSARY_STATUSES.map(function (s) {
      return '<span class="filter-chip' + (s === glossaryFilter ? ' active' : '') + '" data-status="' + s + '">' + s + '</span>';
    }).join('');
    qsa('.filter-chip', wrap).forEach(function (chip) {
      chip.addEventListener('click', function () {
        glossaryFilter = chip.dataset.status;
        glossaryShown = GLOSSARY_PAGE;
        renderGlossaryFilters();
        renderGlossaryList();
      });
    });
  }

  function glossaryEntries() {
    if (!window.HALAL_DB || !Array.isArray(window.HALAL_DB.entries)) return [];
    var q = glossaryQuery.trim().toLowerCase();
    return window.HALAL_DB.entries.filter(function (e) {
      // entry shape: [term, status, english, pinyin, category, note]
      var term = e[0] || '', status = e[1] || '', en = e[2] || '', py = e[3] || '';
      if (glossaryFilter !== 'all' && status !== glossaryFilter) return false;
      if (!q) return true;
      return term.toLowerCase().indexOf(q) >= 0 || en.toLowerCase().indexOf(q) >= 0 || py.toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderGlossaryList() {
    var list = glossaryEntries();
    var slice = list.slice(0, glossaryShown);
    var listEl = byId('glossaryList');
    if (!window.HALAL_DB) {
      listEl.innerHTML = '<p class="empty-state">Knowledge base (db.js) not loaded.</p>';
      byId('glossaryMoreWrap').classList.add('hidden');
      return;
    }
    if (!slice.length) {
      listEl.innerHTML = '<p class="empty-state">No matches.</p>';
    } else {
      listEl.innerHTML = slice.map(function (e) {
        var term = e[0], status = e[1], en = e[2], py = e[3], note = e[5];
        return '<div class="glossary-row">' +
          '<div class="finding-main">' +
            '<div class="finding-term">' + escapeHtml(term) +
              ' <span class="status-chip" style="background:' + colorForStatus(status) + '">' + escapeHtml(status) + '</span></div>' +
            '<div class="finding-sub">' + [py, en].filter(Boolean).map(escapeHtml).join(' · ') + '</div>' +
            (note ? '<div class="finding-note">' + escapeHtml(note) + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    }
    byId('glossaryMoreWrap').classList.toggle('hidden', list.length <= glossaryShown);
  }

  byId('glossarySearch').addEventListener('input', function (e) {
    glossaryQuery = e.target.value;
    glossaryShown = GLOSSARY_PAGE;
    renderGlossaryList();
  });
  byId('glossaryMoreBtn').addEventListener('click', function () {
    glossaryShown += GLOSSARY_PAGE;
    renderGlossaryList();
  });

  // ---------- Phrases tab ----------

  function renderPhrases() {
    var wrap = byId('phrasesList');
    if (!window.HALAL_DB || !Array.isArray(window.HALAL_DB.phrases) || !window.HALAL_DB.phrases.length) {
      wrap.innerHTML = '<p class="empty-state">No phrases loaded.</p>';
      return;
    }
    wrap.innerHTML = window.HALAL_DB.phrases.map(function (p, i) {
      var zh = p[0], py = p[1], en = p[2];
      return '<div class="phrase-row" data-idx="' + i + '">' +
        '<div class="finding-main">' +
          '<div class="finding-term">' + escapeHtml(zh) + '</div>' +
          '<div class="finding-sub">' + escapeHtml(py) + '</div>' +
          '<div class="finding-note">' + escapeHtml(en) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    qsa('.phrase-row', wrap).forEach(function (row) {
      row.addEventListener('click', function () {
        var i = Number(row.dataset.idx);
        var p = window.HALAL_DB.phrases[i];
        if (!p) return;
        byId('phraseCardZh').textContent = p[0];
        byId('phraseCardPy').textContent = p[1];
        byId('phraseCardEn').textContent = p[2];
        openOverlay(byId('phraseCard'));
      });
    });
  }

  byId('phraseCardClose').addEventListener('click', function () { closeOverlay(byId('phraseCard')); });

  // ---------- Settings tab ----------

  function applySettingsToForm() {
    byId('setSeafoodStrict').checked = !!settings.seafoodStrict;
    byId('setFlagFlavourings').checked = !!settings.flagFlavourings;
    byId('setOcrLangDefault').value = settings.ocrLangDefault || 'chi_sim';
    if (byId('setOcrEngine')) byId('setOcrEngine').value = settings.ocrEngine || 'auto';
    if (byId('setPhoneEngine')) byId('setPhoneEngine').value = settings.phoneEngine || 'ppocr';
    if (byId('setProductKind')) byId('setProductKind').value = settings.productKind || 'auto';
    if (byId('setSavePhotos')) byId('setSavePhotos').checked = settings.savePhotos !== false;
    byId('setEnhanceDefault').checked = !!settings.enhanceDefault;
    byId('ocrLang').value = settings.ocrLangDefault || 'chi_sim';
    scanState.enhance = !!settings.enhanceDefault;
    byId('btnEnhance').textContent = '✨ Enhance: ' + (scanState.enhance ? 'On' : 'Off');
    byId('btnEnhance').setAttribute('aria-pressed', String(scanState.enhance));
    byId('btnEnhance').textContent = '✨ Enhance: ' + (scanState.enhance ? 'On' : 'Off');
  }

  function wireSettingsForm() {
    byId('setSeafoodStrict').addEventListener('change', function (e) {
      settings.seafoodStrict = e.target.checked; saveSettings(settings);
    });
    byId('setFlagFlavourings').addEventListener('change', function (e) {
      settings.flagFlavourings = e.target.checked; saveSettings(settings);
    });
    if (byId('setOcrEngine')) byId('setOcrEngine').addEventListener('change', function (e) { settings.ocrEngine = e.target.value; saveSettings(settings); });
    if (byId('setPhoneEngine')) byId('setPhoneEngine').addEventListener('change', function (e) { settings.phoneEngine = e.target.value; saveSettings(settings); });
    if (byId('setProductKind')) byId('setProductKind').addEventListener('change', function (e) { settings.productKind = e.target.value; saveSettings(settings); });
    if (byId('setSavePhotos')) byId('setSavePhotos').addEventListener('change', function (e) { settings.savePhotos = e.target.checked; saveSettings(settings); });
    byId('setOcrLangDefault').addEventListener('change', function (e) {
      settings.ocrLangDefault = e.target.value; saveSettings(settings);
      byId('ocrLang').value = settings.ocrLangDefault;
    });
    byId('setEnhanceDefault').addEventListener('change', function (e) {
      settings.enhanceDefault = e.target.checked; saveSettings(settings);
      scanState.enhance = settings.enhanceDefault;
      byId('btnEnhance').textContent = '✨ Enhance: ' + (scanState.enhance ? 'On' : 'Off');
    });
    byId('btnClearHistory').addEventListener('click', function () {
      clearHistory();
      renderHistoryList();
    });
    byId('aboutBlueprintLink').addEventListener('click', function (e) { e.preventDefault(); switchTab('settings'); });
  }

  function renderAbout() {
    var dbVersion = (window.HALAL_DB && window.HALAL_DB.version) || 'unknown';
    byId('aboutVersions').textContent = 'Knowledge base ' + dbVersion + ' · Label Lens app 1.1';
  }

  // ---------- History panel ----------

  byId('historyBtn').addEventListener('click', function () { renderHistoryList(); openOverlay(byId('historyPanel')); });
  byId('historyBackBtn').addEventListener('click', function () { closeOverlay(byId('historyPanel')); });
  byId('historyClearAllBtn').addEventListener('click', function () { clearHistory(); renderHistoryList(); });

  function renderHistoryList() {
    var list = loadHistory();
    var body = byId('historyBody');
    if (!list.length) {
      body.innerHTML = '<p class="empty-state">No history yet.</p>';
      return;
    }
    body.innerHTML = list.map(function (h, i) {
      return '<div class="history-row" data-idx="' + i + '">' +
        '<div class="history-main">' +
          '<div class="history-title">' + escapeHtml((h.name ? h.name + ' — ' : '') + (h.title || h.verdictLevel || 'Result')) + '</div>' +
          '<div class="history-meta">' + escapeHtml(fmtTime(h.ts)) + '</div>' +
          '<div class="history-text">' + escapeHtml((h.text || '').slice(0, 120)) + '</div>' +
        '</div>' +
        '<button type="button" class="history-del" data-idx="' + i + '" aria-label="Delete">🗑️</button>' +
      '</div>';
    }).join('');
    qsa('.history-main', body).forEach(function (el) {
      el.addEventListener('click', function () {
        var i = Number(el.parentElement.dataset.idx);
        var h = loadHistory()[i];
        if (!h) return;
        closeOverlay(byId('historyPanel'));
        analyzeAndShow(h.text, { skipHistory: true });
      });
    });
    qsa('.history-del', body).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteHistoryAt(Number(btn.dataset.idx));
        renderHistoryList();
      });
    });
  }

  // ---------- share-target intake (?text=, #text=, ?title=) ----------

  function intakeSharedText() {
    var text = '';
    try {
      var params = new URLSearchParams(window.location.search || '');
      if (params.get('text')) text = params.get('text');
      else if (params.get('title') && !text) text = params.get('title');
    } catch (e) { /* ignore */ }
    if (!text && window.location.hash) {
      var hash = window.location.hash.replace(/^#/, '');
      var hp = new URLSearchParams(hash);
      if (hp.get('text')) text = hp.get('text');
    }
    if (text) {   // a shared or crafted link only fills the box; the user taps Analyze (nothing auto-saved to history)
      switchTab('paste');
      byId('pasteTextarea').value = text.slice(0, 5000);
      try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
    }
  }

  // ---------- service worker registration ----------

  function registerServiceWorker() {
    var host = window.location.hostname;
    var isSecureContext = window.location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
    if (isSecureContext && 'serviceWorker' in navigator) {
      var hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        // a NEWER worker took over an already-controlled page: reload once so the page runs the matching files.
        // First install (no previous controller) must not reload — it would interrupt the user's first visit.
        if (!hadController) { hadController = true; return; }
        if (window.__hcReloaded) return;
        window.__hcReloaded = true;
        if (!document.querySelector('#progressWrap.active')) location.reload();
      });
      navigator.serviceWorker.register('./sw.js').then(function (reg) { try { reg.update(); } catch (e) { /* ignore */ } }).catch(function (err) {
        console.warn('Service worker registration failed (sw.js may not exist yet):', err);
      });
    }
  }

  // ---------- init ----------

  function init() {
    renderGlossaryFilters();
    renderGlossaryList();
    renderPhrases();
    applySettingsToForm();
    wireSettingsForm();
    renderAbout();
    registerServiceWorker();
    intakeSharedText();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
