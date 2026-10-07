/* HalalCheck analysis engine. Plain script; exposes global HalalCheck (and module.exports for Node).
 * Depends on HALAL_DB (db.js, db_ok.js, db_codes.js loaded before this file).
 * Contract: see HalalCheck_Blueprint_2026-10-04.md section 2.
 */
var HalalCheck = (function () {
  'use strict';

  var STATUS = { haram: 6, likely: 5, doubtful: 4, meat: 4, school: 3, caution: 2, review: 1, seafood: 0, note: 0, ok: 0, positive: 0, veg: 0 };
  var LABEL = { haram: 'Not halal', likely: 'Likely not halal', doubtful: 'Doubtful — verify source', meat: 'Halal species — slaughter unverified',
    school: 'Depends on school of law', caution: 'Minor caution', review: 'Check sub-ingredients', seafood: 'Seafood (non-fish)', note: 'Note',
    ok: 'OK', positive: 'Halal indicator', veg: 'Vegetarian indicator' };
  var COLOR = { haram: '#c62828', likely: '#c62828', doubtful: '#ef6c00', caution: '#f9a825', clean: '#2e7d32', unknown: '#616161' };
  var APP_VERSION = '1.0.0';

  var CJK = /[㐀-鿿豈-﫿]/;
  function isCJK(ch) { return !!ch && CJK.test(ch); }

  // ------------------------------------------------------------------ index
  var index = null;
  function getIndex() {
    if (index) return index;
    var groups = {}, maxLen = 1, entries = [];
    for (var i = 0; i < HALAL_DB.entries.length; i++) {
      var r = HALAL_DB.entries[i];
      if (!r || !r[0]) continue;
      var e = { t: r[0], s: r[1] || 'ok', en: r[2] || '', py: r[3] || '', c: r[4] || '', n: r[5] || '' };
      entries.push(e);
      var key = e.t.charAt(0);
      var ascii = /^[\x00-\x7f]/.test(key);
      if (ascii) key = key.toLowerCase();
      (groups[key] = groups[key] || []).push(e);
      if (e.t.length > maxLen) maxLen = e.t.length;
    }
    Object.keys(groups).forEach(function (k) { groups[k].sort(function (a, b) { return b.t.length - a.t.length; }); });
    index = { groups: groups, maxLen: maxLen, entries: entries };
    return index;
  }

  // ------------------------------------------------------------------ normalisation
  function normalize(text) {
    if (!text) return '';
    var s = String(text);
    // full-width ASCII → half-width
    s = s.replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); });
    s = s.replace(/　/g, ' ').replace(/\r\n?/g, '\n');
    // common OCR / typographic variants
    s = s.replace(/[‘’]/g, '\'').replace(/[“”]/g, '"');
    // drop whitespace (including newlines) that sits next to a CJK character — OCR splits words with spaces
    s = s.replace(/([㐀-鿿豈-﫿、，。：；（）])[ \t\n]+(?=[㐀-鿿豈-﫿、，。：；（）])/g, '$1');
    s = s.replace(/([㐀-鿿豈-﫿])[ \t]+/g, '$1').replace(/[ \t]+([㐀-鿿豈-﫿])/g, '$1');
    s = s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
    return s;
  }

  // ------------------------------------------------------------------ ingredient section
  function findSection(text) {
    var starts = HALAL_DB.sectionStart, best = -1, bestLen = 0;
    for (var i = 0; i < starts.length; i++) {
      var m = starts[i], pos = text.indexOf(m);
      while (pos !== -1) {
        // require a colon or line end shortly after, or the marker itself ends with 表
        var after = text.substr(pos + m.length, 2);
        var prevCh = pos > 0 ? text.charAt(pos - 1) : '\n';
        if (/营养|營養/.test(text.substr(Math.max(0, pos - 2), 2))) { pos = text.indexOf(m, pos + 1); continue; }   // 营养成份表 / 营养成分 is the nutrition table, never the list
        // a header needs a colon, a 表 suffix, or line-start position followed by an ingredient word (OCR often drops the colon);
        // never accept a marker that is merely the prefix of a longer phrase such as 主要原料来源地
        var okMarker = /^[:：]/.test(after) || /^表/.test(after) || /表$/.test(m) || /^[A-Za-z]/.test(m) ||
          /^[】\]）)]/.test(after) ||                                      // bracketed headers: 【配料】生牛乳
          (/^[\n ]?$/.test(prevCh) && isCJK(after.charAt(0)) && !/^(来源|产地|说明|标准|信息|含量|比例|中的|均|为)/.test(after));
        if (okMarker && (best === -1 || pos < best || (pos === best && m.length > bestLen))) { best = pos; bestLen = m.length; }
        pos = text.indexOf(m, pos + 1);
      }
    }
    if (best === -1) return { found: false, text: text, start: 0, end: text.length };
    var start = best + bestLen;
    while (start < text.length && /[:：\s】\]）)]/.test(text.charAt(start))) start++;
    var end = text.length, ends = HALAL_DB.sectionEnd;
    for (var j = 0; j < ends.length; j++) {
      var p = text.indexOf(ends[j], start);   // a terminator right at the start means the list itself was not captured
      if (p !== -1 && p < end) end = p;
    }
    var body = text.substring(start, end);
    var cjk = (body.match(/[\u4e00-\u9fff]/g) || []).length;
    if (end - start < 1 || cjk < 1) return { found: false, text: text, start: 0, end: text.length }; // list not captured
    if (cjk < 4) {
      // a one-ingredient list is legitimate (配料:生牛乳) but a 3-character fragment of noise is not:
      // accept only if the fragment is made of known words
      var segs = segment(body), known = 0, total = 0;
      segs.forEach(function (sg) { var n = (sg.zh.match(/[\u4e00-\u9fff]/g) || []).length; total += n; known += Math.round(n * (sg.coverage || 0)); });
      if (!total || known / total < 0.8) return { found: false, text: text, start: 0, end: text.length };
    }
    return { found: true, text: body, start: start, end: end };
  }

  // ------------------------------------------------------------------ dictionary scan (longest match)
  function scanDictionary(text) {
    var idx = getIndex(), matches = [], consumed = new Array(text.length), i = 0, n = text.length;
    while (i < n) {
      var ch = text.charAt(i), key = /^[\x00-\x7f]$/.test(ch) ? ch.toLowerCase() : ch;
      var group = idx.groups[key], hit = null;
      if (group) {
        for (var g = 0; g < group.length; g++) {
          var e = group[g], L = e.t.length;
          if (i + L > n) continue;
          var sub = text.substr(i, L);
          var ascii = /^[\x00-\x7f]+$/.test(e.t);
          if (sub === e.t || (ascii && sub.toLowerCase() === e.t.toLowerCase())) {
            // ASCII terms must be whole words
            if (ascii) {
              var before = text.charAt(i - 1), afterCh = text.charAt(i + L);
              if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(afterCh)) continue;
            }
            hit = e; break;
          }
        }
      }
      if (hit) {
        matches.push({ entry: hit, start: i, end: i + hit.t.length });
        for (var k = i; k < i + hit.t.length; k++) consumed[k] = true;
        i += hit.t.length;
      } else { i++; }
    }
    return { matches: matches, consumed: consumed };
  }

  // ------------------------------------------------------------------ generic character rules on unconsumed text
  function wordAround(text, consumed, i, back, fwd) {
    var s = i, e = i + 1, sep = HALAL_DB.rules.separators;
    while (s > 0 && back > 0 && isCJK(text.charAt(s - 1)) && !consumed[s - 1] && sep.indexOf(text.charAt(s - 1)) === -1) { s--; back--; }
    while (e < text.length && fwd > 0 && isCJK(text.charAt(e)) && !consumed[e] && sep.indexOf(text.charAt(e)) === -1) { e++; fwd--; }
    return { start: s, end: e, word: text.substring(s, e) };
  }

  function genericRules(text, consumed) {
    var R = HALAL_DB.rules, out = [];
    var exclusions = ['蛇果', '驴打滚'];
    for (var i = 0; i < text.length; i++) {
      if (consumed[i]) continue;
      var ch = text.charAt(i), prev = text.charAt(i - 1), next = text.charAt(i + 1);
      var excl = false;
      for (var x = 0; x < exclusions.length; x++) { var ex = exclusions[x], p = ex.indexOf(ch); if (p !== -1 && text.substr(i - p, ex.length) === ex) { excl = true; break; } }
      if (excl) continue;
      var w, f = null;
      if (R.pork.indexOf(ch) !== -1) {
        w = wordAround(text, consumed, i, 1, 4);
        f = { term: w.word, en: 'pork-derived (' + ch + ')', status: 'haram', category: 'pork', note: 'Any 猪 ingredient is pork.' };
      } else if (R.haramAnimals[ch]) {
        w = wordAround(text, consumed, i, 1, 3);
        f = { term: w.word, en: R.haramAnimals[ch], status: 'haram', category: 'animal', note: 'Impermissible animal.' };
      } else if (ch === '肉') {
        if (R.rouPlantPrefix.indexOf(prev) !== -1 || R.rouPlantSuffix.indexOf(next) !== -1 || prev === '素') continue;
        w = wordAround(text, consumed, i, 2, 2);
        if (R.species[prev]) f = { term: w.word, en: R.species[prev] + ' meat', status: 'meat', category: 'meat', note: 'Halal species — needs Islamic slaughter (清真).' };
        else f = { term: w.word, en: 'meat (species not stated)', status: 'likely', category: 'meat', note: 'Unspecified meat in China normally means pork.' };
      } else if (ch === '血') {
        if (['糯', '橙', '糖', '藤', '压', '脂', '管'].indexOf(next) !== -1) continue;
        w = wordAround(text, consumed, i, 1, 2);
        if (R.bloodPrefix.indexOf(prev) !== -1) f = { term: w.word, en: 'blood', status: 'haram', category: 'blood', note: 'Blood is impermissible.' };
        else f = { term: w.word, en: 'blood? (血)', status: 'review', category: 'blood', note: 'Contains the character for blood — check what it refers to.' };
      } else if (ch === '骨') {
        if (['质', '骼', '密', '架', '干', '气', '感', '子'].indexOf(next) !== -1 || prev === '鱼' || prev === '魚' || prev === '软') continue; // 骨干 backbone, 骨气, 骨感, 骨子 are idioms
        w = wordAround(text, consumed, i, 2, 2);
        if (R.species[prev]) f = { term: w.word, en: R.species[prev] + ' bone', status: 'meat', category: 'meat', note: 'Halal species — needs Islamic slaughter.' };
        else f = { term: w.word, en: 'bone (species not stated)', status: 'likely', category: 'meat', note: 'Unspecified bone/broth in China is normally pork.' };
      } else if (ch === '酒') {
        if (['石', '店', '精'].indexOf(next) !== -1) continue;
        w = wordAround(text, consumed, i, 2, 2);
        f = { term: w.word, en: 'alcohol-related term (酒)', status: 'review', category: 'alcohol', note: 'Contains the character for liquor — check whether an alcoholic ingredient is meant.' };
      } else if (ch === '胶') {
        if (next === '囊') { w = wordAround(text, consumed, i, 1, 1); f = { term: w.word, en: 'capsule (shell usually gelatin)', status: 'doubtful', category: 'gelatin', note: 'Capsule shells are gelatin unless stated 植物胶囊 / 羟丙基甲基纤维素.' }; }
        else { w = wordAround(text, consumed, i, 2, 1); f = { term: w.word, en: 'gum / gel (胶) — unrecognised', status: 'review', category: 'gelatin', note: 'Could be a plant gum or gelatin — check the full name.' }; }
      } else if (R.species[ch]) {
        if (['蛋', '奶', '乳', '梨', '蒡', '至', '膝', '磺', '角', '轧'].indexOf(next) !== -1) continue;
        w = wordAround(text, consumed, i, 1, 3);
        f = { term: w.word, en: R.species[ch] + ' (animal term)', status: 'meat', category: 'meat', note: 'Animal-derived term — halal species, slaughter unverified.' };
      }
      if (f && f.category !== 'pork' && /[省市区县镇乡路街村号巷弄楼室园]/.test(text.substr(Math.max(0, w.start - 2), w.end - w.start + 4))) f = null; // address context
      if (f) {
        f.index = w.start; f.source = 'rule';
        for (var k = w.start; k < w.end; k++) consumed[k] = true;
        out.push(f);
        i = w.end - 1;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ INS / E codes
  var UNIT_AFTER = /^\s*(?:年|月|日|克|g|G|mg|毫克|微克|μg|ug|kJ|千焦|kcal|千卡|%|％|ml|mL|毫升|L|升|mm|cm|kg|千克|斤|个|包|袋|片|粒|℃|度|元|天|小时|分钟)/;
  function parseCodes(text) {
    var found = {}, order = [];
    function add(code, pos, explicit) {
      var c = code.toLowerCase();
      var def = HALAL_DB.codes[c] || HALAL_DB.codes[c.replace(/[a-z]$/, '')];
      if (!def && !explicit) return;
      var key = c;
      if (found[key]) return;
      found[key] = { code: c.toUpperCase(), name_zh: def ? def[0] : '', name_en: def ? def[1] : 'unrecognised additive code', status: def ? def[2] : 'review', note: def ? def[3] : 'Code not in the HalalCheck table.', index: pos, source: 'code' };
      order.push(key);
    }
    // explicit E / INS prefixes
    var re = /(?:^|[^A-Za-z])(?:E|INS)[-\s]?(\d{3,4}[a-z]?)(?![\dA-Za-z])/g, m;
    while ((m = re.exec(text)) !== null) {
      var tail = text.substr(m.index + m[0].length);
      if (UNIT_AFTER.test(tail)) continue;
      add(m[1], m.index, true);
    }
    // bracketed numeric lists after additive names: 乳化剂(471,322) / 增稠剂(INS 407、412)
    var br = /\(([^()]{1,80})\)/g;
    while ((m = br.exec(text)) !== null) {
      var inner = m[1];
      var before = text.substr(Math.max(0, m.index - 10), Math.min(10, m.index)).replace(/\s+$/, '');
      if (/GB|\/T|Q\//.test(before)) continue;
      if (!/^\s*(?:(?:INS|E)?\s*\d{3,4}[a-z]?\s*[,，、;；\/和及]?\s*)+$/i.test(inner)) continue;
      var hasPrefix = /(?:INS|E)\s*\d/i.test(inner);
      // bare digit lists are codes only in additive context: 乳化剂(471,322); never after pack sizes or weights: 规格(428,441)克
      if (!hasPrefix && !/(剂|色素|添加|香料|INS|E)$/.test(before)) continue;
      if (!hasPrefix && (/净含量|规格|克|毫升|ml|kg/i.test(before) || UNIT_AFTER.test(text.substr(m.index + m[0].length)))) continue;
      var nums = inner.match(/\d{3,4}[a-z]?/gi) || [];
      for (var i = 0; i < nums.length; i++) add(nums[i], m.index, false);
    }
    return order.map(function (k) { return found[k]; });
  }

  // ------------------------------------------------------------------ segments (translation view)
  function segment(text) {
    var sep = HALAL_DB.rules.separators;
    var chunks = [], cur = '', curStart = 0;
    for (var i = 0; i <= text.length; i++) {
      var ch = text.charAt(i);
      if (i === text.length || sep.indexOf(ch) !== -1) {
        var tr = cur.trim();
        if (tr && !/^[\d\s.%,\-+:/]+$/.test(tr)) chunks.push({ zh: tr, start: curStart });
        cur = ''; curStart = i + 1;
      } else { cur += ch; }
    }
    var out = [];
    for (var c = 0; c < chunks.length && out.length < 150; c++) {
      var zh = chunks[c].zh, scan = scanDictionary(zh), parts = [], pos = 0, sev = 0, status = 'ok', known = 0;
      var cjkInChunk = (zh.match(/[\u4e00-\u9fff]/g) || []).length;   // coverage counts Chinese characters only: "100%椰子水" is fully known
      for (var m = 0; m < scan.matches.length; m++) {
        var mm = scan.matches[m];
        if (mm.start > pos) parts.push(zh.substring(pos, mm.start));
        parts.push(mm.entry.en || mm.entry.t);
        known += (mm.entry.t.match(/[\u4e00-\u9fff]/g) || []).length;
        var s = STATUS[mm.entry.s] || 0;
        if (s > sev || (sev === 0 && mm.entry.s !== 'ok' && status === 'ok')) { sev = s; status = mm.entry.s; }
        pos = mm.end;
      }
      if (pos < zh.length) parts.push(zh.substring(pos));
      var en = parts.join(' ').replace(/\s+/g, ' ').trim();
      out.push({ zh: zh, en: en, status: status, coverage: cjkInChunk ? Math.min(1, known / cjkInChunk) : (scan.matches.length ? 1 : 0) });
    }
    return out;
  }

  // ------------------------------------------------------------------ judgement by product type (no ingredient list on the pack)
  var LEVEL_SEV = { haram: 6, likely: 5, doubtful: 4, meat: 4, caution: 2, clean: 0 };
  function productGuess(text) {
    var best = null;
    (HALAL_DB.products || []).forEach(function (row) {
      var names = row[0].split('|');
      for (var i = 0; i < names.length; i++) {
        var n = names[i], pos = text.indexOf(n);
        if (pos === -1) continue;
        var sev = LEVEL_SEV[row[1]] || 0;
        // Chinese product names end with the head noun (巧克力味云石切片面包 is a 面包, not a 巧克力): a name that ends
        // where the Chinese run ends is a head match and beats modifiers; then the longer name (牛肉干 beats 肉干), then severity
        var head = !isCJK(text.charAt(pos + n.length));
        if (!best || (head && !best.head) || (head === best.head && (n.length > best.name.length || (n.length === best.name.length && sev > best.sev)))) best = { name: n, head: head, level: row[1], sev: sev, en: row[2], typical: row[3], note: row[4], index: pos };
      }
    });
    return best;
  }

  // ------------------------------------------------------------------ verdict (shared by analyze and analyzeMany)
  function buildVerdict(F) {
    var findings = F.findings, positives = F.positives, section = F.section, alcoholic = F.alcoholic, unreadable = F.unreadable, coverage = F.coverage, ocrConf = F.ocrConf, hadChinese = F.hadChinese;
    var hasHalalMark = positives.some(function (p) { return p.kind === 'halal'; });
    var hasVeg = positives.some(function (p) { return p.kind === 'veg'; });
    var maxSev = findings.length ? findings[0].severity : 0;
    var label = function (f) { return f.term + ' (' + f.en + ')' + (f.fromPhoto ? ' [photo ' + f.fromPhoto + ']' : ''); };
    var top = function (sev, n) { return findings.filter(function (f) { return f.severity === sev; }).slice(0, n || 3).map(label).join(', '); };

    var verdict;
    var dictHaram = maxSev >= 6 && findings[0].source === 'dict';
    if (unreadable && !(alcoholic || dictHaram)) {
      verdict = { level: 'unknown', title: 'TEXT UNREADABLE — RETAKE', summary: 'The OCR output looks like noise (' + Math.round(coverage * 100) + '% of the characters form known words' + (ocrConf !== null ? ', OCR confidence ' + ocrConf + '%' : '') + '). Any flags below are unreliable. ' + (F.noServer ? 'Retake closer and flatter, drag a box around just the 配料 text, or use the phone\'s own text extraction and the Paste tab.' : 'Retake closer and flatter, use the GB10 engine, or paste the text from the phone\'s own text extraction.') + '' };
    } else if (alcoholic || maxSev >= 6) {
      verdict = { level: 'haram', title: 'NOT HALAL', summary: (alcoholic && maxSev < 6 ? 'The label states an alcohol content — this is an alcoholic product.' : 'Contains ' + top(6) + '.') + (unreadable ? ' The rest of the OCR text is noise — retake to confirm.' : '') };
    } else if (maxSev === 5) {
      verdict = hasHalalMark
        ? { level: 'doubtful', title: 'MARKED 清真 — BUT CHECK', summary: 'Carries a halal mark, yet lists ' + top(5) + ', which in China is normally pork or non-halal. Rely on the certifier only if you trust it.' }
        : { level: 'likely', title: 'VERY LIKELY NOT HALAL', summary: 'Lists ' + top(5) + '. In China these are pork or from non-halal slaughter unless the pack is 清真-certified or names a halal species.' };
    } else if (maxSev >= 3) {
      var terms = findings.filter(function (f) { return f.severity >= 3; }).slice(0, 3).map(label).join(', ');
      verdict = hasHalalMark
        ? { level: 'caution', title: 'MARKED 清真 — doubtful items should be covered', summary: 'Contains ' + terms + '; the halal mark should cover slaughter and sourcing if the certifier is credible.' }
        : { level: 'doubtful', title: 'DOUBTFUL — VERIFY', summary: 'Contains ' + terms + ' whose halal status depends on source or slaughter. No 清真 mark found.' };
    } else if (maxSev >= 1) {
      var ct = findings.filter(function (f) { return f.severity >= 1; }).slice(0, 4).map(label).join(', ');
      verdict = { level: 'caution', title: 'LIKELY OK — minor cautions', summary: 'No pork, alcohol or meat found. Minor points: ' + ct + '.' + (hasHalalMark ? ' Pack is marked 清真.' : '') };
    } else if (section.found) {
      verdict = { level: 'clean', title: 'NO NON-HALAL INGREDIENTS DETECTED', summary: 'Ingredient list read. OCR can miss text — check the photo shows the whole 配料 list.' + (hasHalalMark ? ' Pack is marked 清真.' : '') + (hasVeg ? ' Marked vegetarian.' : '') };
    } else if (!hadChinese) {
      verdict = { level: 'unknown', title: 'NO CHINESE TEXT FOUND', summary: 'Nothing to analyse. Photograph the 配料 (ingredients) panel or paste its text.' };
    } else if (F.product) {
      var pg = F.product, lv = pg.level === 'clean' ? 'caution' : (pg.level === 'meat' ? 'doubtful' : pg.level);
      var ttl = { haram: 'NOT HALAL — by product type', likely: 'VERY LIKELY NOT HALAL — by product type', doubtful: 'DOUBTFUL — by product type', caution: 'USUALLY OK — by product type' }[lv] || 'JUDGED BY PRODUCT TYPE';
      verdict = { level: lv, title: ttl, summary: 'No ingredient list on this pack. Judged from the name "' + pg.name + '" (' + pg.en + '). Typical ingredients: ' + pg.typical + '. ' + pg.note + ' If possible, read the big pack it came from.' };
    } else {
      verdict = { level: 'unknown', title: 'NO INGREDIENT LIST FOUND', summary: 'Could not find 配料 / 原料 in the text and nothing was flagged. Photograph the ingredients panel.' };
    }
    if (F.webSource) {
      var webNote = 'Ingredient list found online (' + F.webSource + ') for this product name; it may belong to a different variant, size or batch, or be wrong. ';
      var pl = F.product && F.product.level, rank = { haram: 5, likely: 4, doubtful: 3, caution: 2, clean: 1, unknown: 0 };
      if ((pl === 'haram' || pl === 'likely') && (rank[pl] || 0) > (rank[verdict.level] || 0)) {   // the name is worse than the web list says
        verdict = { level: pl, title: (pl === 'haram' ? 'NOT HALAL' : 'VERY LIKELY NOT HALAL') + ' — by product type (web list disagrees)',
          summary: 'The product name says ' + F.product.en + ' (' + F.product.name + '), which in China normally means ' + (F.product.typical || 'non-halal ingredients') + '. The list found online (' + F.webSource + ') does not show that, so it may be a different product. Trust the pack, not the web.' };
      } else if (verdict.level === 'clean' || verdict.level === 'caution') {
        verdict = { level: 'caution', title: 'WEB LIST SHOWS NO FLAGS — CONFIRM ON THE PACK', summary: webNote + 'Nothing non-halal in that list' + (verdict.level === 'caution' ? ' beyond minor points' : '') + ', but a web page is not the pack: find the printed 配料 before eating.' };
      } else { verdict.title += ' (web list — verify)'; verdict.summary = webNote + verdict.summary; }
    }
    if (F.aiRead) {
      if (F.aiPartial && verdict.level !== 'haram') {
        verdict = { level: 'unknown', title: 'LIST PARTLY UNREADABLE (AI) — RETAKE', summary: 'AI vision could not read part of the ingredient list (marked [unreadable]); an unread slot could hide anything. Flags found in the readable part are listed below. Retake closer and flatter.' };
      } else {
        verdict.title += ' (AI-read — verify)';
        verdict.summary = 'Transcribed by AI vision (Qwen3-VL on GB10) because the OCR engine could not read the list; such reads can contain guessed words — compare with the pack. ' + verdict.summary;
      }
    }
    verdict.color = COLOR[verdict.level] || COLOR.unknown;
    if (/^USUALLY OK/.test(verdict.title)) verdict.color = '#558b2f';   // olive: fine by product type, not a warning
    return verdict;
  }

  // Cylindrical packs: every line wraps round the curve, so photo A holds the left part of a line and photo B
  // the right part. Join line fragments whose edges overlap by >= 3 characters (allowing 2 noisy characters
  // at the start of the continuing fragment), repeatedly, across all photos.
  function lineOverlap(a, b) {
    // the next photo usually starts LEFT of where the previous one ended, so the shared stretch may sit deep
    // inside b: accept a long overlap (>= 5) anywhere, a short one (3-4) only at the very start of b
    for (var k = Math.min(a.length, b.length, 40); k >= 3; k--) {
      var suf = a.slice(-k);
      if ((suf.match(/[\u4e00-\u9fff]/g) || []).length < 2) continue;   // at least two Chinese characters in the overlap
      var pos = b.indexOf(suf);
      if (pos === -1) continue;
      if (k >= 5 || pos <= 2) return { k: k, pos: pos };
    }
    return null;
  }
  function stitchTexts(texts) {
    var sets = texts.map(function (t) { return String(t || '').split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length >= 2; }); });
    var used = sets.map(function (ls) { return ls.map(function () { return false; }); });
    var out = [], joins = 0;
    for (var i = 0; i < sets.length; i++) {
      for (var a = 0; a < sets[i].length; a++) {
        if (used[i][a]) continue;
        var cur = sets[i][a]; used[i][a] = true;
        var extended = true, guard = 0;
        while (extended && guard++ < 20) {
          extended = false;
          for (var j = 0; j < sets.length && !extended; j++) {
            if (j === i) continue;
            for (var b = 0; b < sets[j].length; b++) {
              if (used[j][b]) continue;
              var ov = lineOverlap(cur, sets[j][b]);
              if (ov) { cur = cur + sets[j][b].slice(ov.pos + ov.k); used[j][b] = true; joins++; extended = true; break; }
            }
          }
        }
        out.push(cur);
      }
    }
    return { text: out.join('\n'), joins: joins };
  }

  // Several photos of the SAME pack: the best-read list is primary; in-section findings from the other photos
  // (the half of the list the seam hid) and halal marks anywhere are merged in before the verdict.
  // Product name from the label text: an explicit 产品名称/品名 field, else the first short Chinese line of a structured
  // label (one that has an ingredient section), else a short single-line paste (a sub-packet name). Latin line after it = English name.
  var FIELD_START = /^(配料|主要成分|主要原料|原料|原材料|成份|营养|致敏|过敏|产地|规格|保质期|生产|净含量|储存|贮存|食用|执行|产品标准|地址|电话|价格|等级|计价|供应商|监督|物价|星星)/;
  function detectName(raw, sectionFound, productName) {
    raw = String(raw || '').replace(/\r/g, '');
    var m = raw.match(/(?:产品名称|食品名称|商品名称|品名)\s*[:：]?\s*([^\n:：]{2,40})/);
    var zh = '', en = '';
    if (m) { zh = m[1].split(/\s{2,}|净含量|规格|配料|主要成分|产地|价格|保质期|生产|储存|贮存/)[0].trim(); }
    var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var isLatin = function (l) { return /^[A-Za-z][A-Za-z0-9 &'’.,\-]{2,40}$/.test(l); };
    if (!zh && productName) {   // a line naming the product type (…可颂, …橡皮糖) beats a brand-only first line
      for (var li = 0; li < lines.length; li++) {
        var L = lines[li], c2 = (L.match(/[\u4e00-\u9fff]/g) || []).length;
        if (L.indexOf(productName) >= 0 && c2 >= 2 && L.length <= 24 && !/[:：]/.test(L) && !FIELD_START.test(L)) { zh = L; break; }
      }
    }
    if (!zh && lines.length) {
      var first = lines[0], cjk = (first.match(/[\u4e00-\u9fff]/g) || []).length;
      var looksName = cjk >= 2 && first.length <= 24 && cjk / first.replace(/\s/g, '').length >= 0.6 && !/[:：\d]/.test(first) && !FIELD_START.test(first);
      var structured = /过敏原|致敏|产地|净含量|价格|保质期|供应商|生产许可/.test(raw);   // shelf tags and QR pages: name on top, fields below
      if (looksName && (sectionFound || structured || lines.length === 1)) zh = first;
    }
    if (zh) {
      var idx = lines.indexOf(zh); var nxt = idx >= 0 ? lines[idx + 1] : '';
      if (nxt && isLatin(nxt)) en = nxt;
    }
    return zh ? { zh: zh, en: en } : null;
  }
  function analyzeMany(texts, settings) {
    var results = (texts || []).map(function (t) { return analyze(t, settings); });
    if (!results.length) return analyze('', settings);
    if (results.length === 1) return results[0];
    var scoreOf = function (r) { return (r.ingredientSection.found ? 2 : 0) + (r.quality ? r.quality.coverage : 0) + (r.findings.some(function (f) { return f.severity >= 5; }) ? 1 : 0); };
    var best = 0;
    results.forEach(function (r, i) { if (scoreOf(r) > scoreOf(results[best])) best = i; });
    var primary = results[best], stitched = null;
    // try joining wrapped lines across photos; if that reads better than any single photo it becomes the primary
    var st = stitchTexts(texts);
    if (st.joins > 0) {
      var sr = analyze(st.text, settings);
      if (scoreOf(sr) > scoreOf(primary) || (sr.ingredientSection.found && primary.ingredientSection.found && sr.ingredientSection.text.length > primary.ingredientSection.text.length)) {
        stitched = { joins: st.joins, text: st.text };
        primary = sr;
      }
    }
    var seen = {}, findings = [], positives = [], elsewhere = [];
    function add(f) { var k = f.term + '|' + f.status; if (seen[k]) return; seen[k] = true; findings.push(f); }
    primary.findings.forEach(add);
    var usable = function (r) { return !(r.quality && r.quality.unreadable); };   // OCR-noise photos contribute nothing
    results.forEach(function (r, i) {
      if (i === best || !usable(r)) return;
      r.findings.forEach(function (f) { if (f.inSection || (f.source === 'dict' && f.status === 'haram' && f.term.length >= 2)) { f.fromPhoto = i + 1; add(f); } });
      r.elsewhere.forEach(function (f) { elsewhere.push(f); });
    });
    var pseen = {};
    results.forEach(function (r, i) { if (i !== best && !usable(r)) return; r.positives.forEach(function (p) { var k = p.term; if (!pseen[k]) { pseen[k] = true; positives.push(p); } }); });
    findings.sort(function (a, b) { return (b.severity - a.severity) || (a.index - b.index); });
    var anyReadable = results.some(function (r) { return r.ingredientSection.found && !(r.quality && r.quality.unreadable); });
    var verdict = buildVerdict({ noServer: !!settings.noServer, findings: findings, positives: settings.webSource ? [] : positives, section: primary.ingredientSection, alcoholic: results.some(function (r) { return r.alcoholic; }),
      unreadable: anyReadable ? false : (primary.quality ? primary.quality.unreadable : false), coverage: primary.quality ? primary.quality.coverage : 0,
      ocrConf: primary.quality ? primary.quality.ocrConfidence : null, hadChinese: results.some(function (r) { return r.meta.hadChinese; }) });
    return { verdict: verdict, findings: findings, elsewhere: primary.elsewhere.concat(elsewhere), positives: positives, codes: primary.codes, ingredientSection: primary.ingredientSection,
      segments: primary.segments, name: primary.name || (results.filter(function (r) { return r.name; })[0] || {}).name || null, alcoholic: results.some(function (r) { return r.alcoholic; }), quality: primary.quality, meta: primary.meta, photos: results.length, primaryIndex: stitched ? -1 : best, perPhoto: results, stitched: stitched };
  }

  // ------------------------------------------------------------------ main
  function snippet(text, start, len) {
    var a = Math.max(0, start - 14), b = Math.min(text.length, start + len + 14);
    return { text: (a > 0 ? '…' : '') + text.substring(a, b).replace(/\n/g, ' ') + (b < text.length ? '…' : ''), offset: start - a + (a > 0 ? 1 : 0), length: len };
  }

  function analyze(rawText, settings) {
    settings = settings || {};
    var seafoodStrict = !!settings.seafoodStrict;
    var flagFlavourings = settings.flagFlavourings === true; // default off: nearly every snack lists 食用香精
    var text = normalize(rawText);
    var hadChinese = /[一-鿿]/.test(text);
    var section = findSection(text);
    var scan = scanDictionary(text);
    var rules = genericRules(text, scan.consumed);
    var codes = parseCodes(text);

    var findings = [], positives = [], seen = {};
    function pushFinding(f) {
      var key = f.term + '|' + f.status;
      if (seen[key]) { seen[key].count++; return; }
      f.count = 1; seen[key] = f; findings.push(f);
    }
    for (var i = 0; i < scan.matches.length; i++) {
      var m = scan.matches[i], e = m.entry, st = e.s;
      if (st === 'ok') continue;
      // greedy tokenizer guard: a generic meat compound (肉松, 肉丸, 肉末 …) glued to a preceding seafood / fish / species word
      // belongs to that word: 鱿鱼肉松 = squid floss, 鱼肉丸 = fish balls, 鸭肉松 = duck floss
      if (st === 'likely' && e.c === 'meat' && e.t.charAt(0) === '肉' && i > 0) {
        var pm = scan.matches[i - 1];
        if (pm.end === m.start) {
          if (pm.entry.c === 'seafood' && pm.entry.s === 'ok') { continue; }
          if (pm.entry.c === 'seafood') { st = 'seafood'; }
          else if (HALAL_DB.rules.species[pm.entry.t.charAt(pm.entry.t.length - 1)]) { st = 'meat'; }
        }
      }
      if (st === 'positive' || st === 'veg') {
        positives.push({ term: e.t, en: e.en, note: e.n, index: m.start, kind: st === 'positive' ? 'halal' : 'veg' });
        continue;
      }
      var note = e.n;
      if (st === 'seafood' && seafoodStrict) { st = 'school'; note = (note ? note + ' ' : '') + 'Hanafi setting: non-fish seafood flagged.'; }
      if (st === 'caution' && e.c === 'flavour' && !flagFlavourings) st = 'note';
      pushFinding({ term: e.t, en: e.en, py: e.py, status: st, category: e.c, note: note, index: m.start, source: 'dict', inSection: section.found && m.start >= section.start && m.start < section.end });
    }
    for (var r = 0; r < rules.length; r++) {
      var f = rules[r];
      pushFinding({ term: f.term, en: f.en, py: '', status: f.status, category: f.category, note: f.note, index: f.index, source: 'rule', inSection: section.found && f.index >= section.start && f.index < section.end });
    }
    for (var c = 0; c < codes.length; c++) {
      var cd = codes[c];
      if (cd.status === 'ok') continue;
      pushFinding({ term: (cd.code.match(/^\d/) ? 'INS ' : '') + cd.code + (cd.name_zh ? ' ' + cd.name_zh : ''), en: cd.name_en, py: '', status: cd.status, category: 'additive', note: cd.note, index: cd.index, source: 'code', inSection: section.found && cd.index >= section.start && cd.index < section.end });
    }
    findings.forEach(function (f) { f.severity = STATUS[f.status] || 0; f.label = LABEL[f.status] || f.status; f.snippet = snippet(text, f.index, f.term.length); });
    // Only the ingredient list decides the verdict. Text elsewhere on the pack (maker's address 酒仙桥路, slogans such as
    // 骨干企业, usage tips) is kept as 'elsewhere' for display but never drives the verdict — except an explicit haram
    // dictionary term such as a product name 猪肉脯, which still counts.
    var elsewhere = [];
    if (section.found) {
      findings = findings.filter(function (f) {
        if (f.inSection || (f.source === 'dict' && f.status === 'haram')) return true;
        elsewhere.push(f); return false;
      });
    }
    findings.sort(function (a, b) { return (b.severity - a.severity) || (a.index - b.index); });
    elsewhere.sort(function (a, b) { return (b.severity - a.severity) || (a.index - b.index); });

    // OCR-noise gate: how much of the Chinese text is made of recognisable ingredient / label words?
    var segs = segment(section.found ? section.text : text);
    var cjkTotal = 0, cjkKnown = 0;
    segs.forEach(function (sg) { var n = (sg.zh.match(/[\u4e00-\u9fff]/g) || []).length; cjkTotal += n; cjkKnown += Math.round(n * (sg.coverage || 0)); });
    var coverage = cjkTotal ? cjkKnown / cjkTotal : 0;
    var ocrConf = typeof settings.ocrConfidence === 'number' ? settings.ocrConfidence : null;
    // a confident read (PP-OCR >= 80) with few food words is a readable label WITHOUT a list (shelf tags, QR pages), not noise
    var confident = ocrConf !== null && ocrConf >= 80;
    var unreadable = (ocrConf !== null && ocrConf < 40 && coverage < 0.6) || (!confident && !section.found && cjkTotal >= 20 && coverage < 0.25) ||
      (section.found && cjkTotal >= 8 && coverage < 0.3);   // a "list" made of unrecognised words is OCR noise, not a clean list

    var alcoholic = /酒精度|%\s*vol|vol\s*%|ABV|alc\.?\s*\d|酒精含量/i.test(text);
    var product = ((!section.found || settings.webSource) && hadChinese) ? productGuess(text) : null;   // with a web list the name still decides when it is worse
    if (product && product.sev >= 5) { /* a haram/likely product name also appears as a finding so the user sees it */
      pushFinding({ term: product.name, en: product.en, py: '', status: product.level, category: 'product', note: product.note, index: product.index, source: 'product', inSection: false });
      findings.forEach(function (f) { if (!f.severity) { f.severity = STATUS[f.status] || 0; f.label = LABEL[f.status] || f.status; f.snippet = snippet(text, f.index, f.term.length); } });
      findings.sort(function (a, b) { return (b.severity - a.severity) || (a.index - b.index); });
    }
    var verdict = buildVerdict({ findings: findings, positives: positives, section: section, alcoholic: alcoholic, unreadable: unreadable && !product, coverage: coverage, ocrConf: ocrConf, hadChinese: hadChinese, aiRead: !!settings.aiRead, aiPartial: !!settings.aiRead && /\[?unreadable\]?/i.test(text), product: product, webSource: settings.webSource || '' });

    return {
      verdict: verdict,
      findings: findings,
      elsewhere: elsewhere,
      positives: positives,
      codes: codes,
      ingredientSection: section,
      segments: segs,
      product: product,
      name: detectName(rawText, section.found, product && product.name),
      alcoholic: alcoholic,
      quality: { coverage: coverage, cjkChars: cjkTotal, ocrConfidence: ocrConf, unreadable: unreadable },
      meta: { normalizedText: text, hadChinese: hadChinese, dbVersion: HALAL_DB.version, appVersion: APP_VERSION, entryCount: getIndex().entries.length }
    };
  }

  function lookup(query) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return getIndex().entries.filter(function (e) {
      return e.t.toLowerCase().indexOf(q) !== -1 || e.en.toLowerCase().indexOf(q) !== -1 || (e.py && e.py.toLowerCase().replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e').replace(/[īíǐì]/g, 'i').replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u').replace(/[üǖǘǚǜ]/g, 'v').indexOf(q) !== -1);
    });
  }

  return { analyze: analyze, analyzeMany: analyzeMany, detectName: detectName, stitchTexts: stitchTexts, normalize: normalize, segment: segment, findSection: findSection, parseCodes: parseCodes, lookup: lookup, STATUS: STATUS, LABEL: LABEL, COLOR: COLOR, VERSION: APP_VERSION };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = HalalCheck; }
