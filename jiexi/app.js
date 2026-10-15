// 考研阅读精析检索：读取题库 JSON，在浏览器里本地搜索并按“左原文·右分析”渲染。
// yingyu1/、yingyu2/ 两个页面共用这份代码，各自在 window.JIEXI 里指定题库和示例。
(function () {
  "use strict";

  var CFG = window.JIEXI || {};
  var DATA = CFG.data || "data/yingyu1.json";
  var ROOT = CFG.root || "../";   // 仓库根目录（1reading.json、4tiganxuanxiang.json 所在）

  var MAX_ROWS = 30;
  var $q = document.getElementById("q");
  var $status = document.getElementById("status");
  var $results = document.getElementById("results");
  var $examples = document.getElementById("examples");
  var passages = {};
  var questions = [];
  var hideAnswers = false;
  try { hideAnswers = localStorage.getItem("jiexi-hide") === "1"; } catch (e) {}
  var zhAll = false;   // 再检查：全部显示英汉对照
  try { zhAll = localStorage.getItem("jiexi-zh") === "1"; } catch (e) {}
  var zhRows = {};     // 单题打开了英汉对照的题
  var zh = null;       // 译文：来自仓库根目录的 1reading.json（原文）和 4tiganxuanxiang.json（题干选项）
  var zhFailed = false;
  var showAll = false; // 看分析：全部显示答案与分析
  try { showAll = localStorage.getItem("jiexi-ana") === "1"; } catch (e) {}
  var rowState = {};   // 单题按钮：true = 显示答案与分析，false = 隐藏

  // 这道题现在是否隐藏答案与分析
  function isQuiz(rowId) {
    if (rowId in rowState) return !rowState[rowId];
    return hideAnswers && !showAll;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // ==定位句== → 黄底；**关键词** → 加粗下划线
  function rich(s) {
    return esc(s)
      .replace(/==([\s\S]+?)==/g, "<mark>$1</mark>")
      .replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>");
  }
  function plain(s) { return String(s).replace(/==|\*\*/g, ""); }
  function label(p) { return p.year + " " + p.exam + " Text " + p.text; }

  // ---------- query parsing ----------
  var CN_NUM = { "一": 1, "二": 2, "三": 3, "四": 4 };
  function parse(raw) {
    var s = " " + raw.trim() + " ";
    var f = { exam: null, year: null, num: null, text: null, words: [], zh: [] };
    s = s.replace(/英语\s*([一二12])|英\s*([一二12])/g, function (_, a, b) {
      var v = a || b; f.exam = (v === "一" || v === "1") ? "英语一" : "英语二"; return " ";
    });
    s = s.replace(/text\s*(\d)|第\s*([1-4一二三四])\s*篇/gi, function (_, a, b) {
      f.text = a ? +a : (CN_NUM[b] || +b); return " ";
    });
    // 2023年22题 / 2023-22 / 2023 第22题 / 2023.22
    s = s.replace(/((?:19|20)\d{2})\s*年?\s*(?:[-.\/_,，、]|\s)*(?:第\s*)?(\d{1,2})\s*题?(?!\d)/, function (_, y, n) {
      f.year = +y; f.num = +n; return " ";
    });
    s = s.replace(/((?:19|20)\d{2})\s*年?/, function (_, y) { f.year = +y; return " "; });
    s = s.replace(/第?\s*(\d{1,2})\s*题/, function (_, n) { f.num = +n; return " "; });
    f.words = (s.match(/[A-Za-z][A-Za-z'’-]*/g) || []).map(function (w) { return w.toLowerCase(); });
    f.zh = (s.replace(/[A-Za-z0-9'’-]+/g, " ").match(/[^\s\p{P}]+/gu) || []);
    return f;
  }
  function wordRe(w) {
    return new RegExp("(^|[^A-Za-z])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]"), "i");
  }

  function search(raw) {
    var f = parse(raw);
    var pool = questions.filter(function (q) {
      var p = passages[q.passage];
      return (!f.exam || p.exam === f.exam) && (!f.year || p.year === f.year) &&
        (!f.num || q.num === f.num) && (!f.text || p.text === f.text);
    });
    var res = { filters: f, items: pool, where: "filter" };
    if (f.zh.length) {
      res.items = pool.filter(function (q) {
        var hay = [q.answerZh, q.note || ""].concat(q.basis, q.wrong.map(function (w) { return w.tag + w.text; })).join(" ");
        return f.zh.every(function (z) { return hay.indexOf(z) >= 0; });
      });
    }
    if (f.words.length) {
      var res2 = res.items;
      var res_ = res2.filter(function (q) {
        var hay = q.stem + " " + Object.keys(q.options).map(function (k) { return q.options[k]; }).join(" ");
        return f.words.every(function (w) { return wordRe(w).test(hay); });
      });
      if (res_.length) { res.items = res_; res.where = "stem"; }
      else {
        // 题干和选项里没有，就退一步到原文定位段落里找
        res.items = res2.filter(function (q) {
          var hay = q.context.map(function (c) { return plain(c.text); }).join(" ");
          return f.words.every(function (w) { return wordRe(w).test(hay); });
        });
        res.where = "context";
      }
    }
    return res;
  }

  // ---------- 英汉对照译文 ----------
  // 原文按句对齐：1reading.json 里每条是一句（末尾带“(N words)”）。把各段拆成句子，按顺序找词语重合最多的那条译文；
  // 译文库的英文和真题措辞略有出入（改编过）也能对上，找不到的句子标出“译文库里没有”
  function norm(s) { return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\u00a0/g, " "); }
  function wordSet(s) {
    var set = {};
    (norm(s).toLowerCase().match(/[a-z0-9]+/g) || []).forEach(function (w) { set[w] = 1; });
    return set;
  }
  function overlap(a, b) {
    var inter = 0, union = 0, w;
    for (w in a) { union++; if (b[w]) inter++; }
    for (w in b) if (!a[w]) union++;
    return union ? inter / union : 0;
  }
  var ABBR = /(?:\b[A-Z]|\bU\.S|\bU\.K|\bMrs?|\bMs|\bDr|\bSt|\bProf|\bvs|\bv|\be\.g|\bi\.e|\bNo)$/;
  var SAID = /^[A-Z][A-Za-z.\s]{0,40}?\b(?:said|says|asks|asked|notes|noted|adds|added|writes|wrote|explains|explained)\b/;
  function splitSentences(p) {
    var out = [], st = 0, re = /[.?!…](?:["”’)]*)\s+(?=["“‘(]?[A-Z0-9])/g, m;
    while ((m = re.exec(p))) {
      if (ABBR.test(p.slice(st, m.index))) continue;                      // U.S. / J. Simons 之类不断句
      if (/["”’]\s*$/.test(m[0]) && SAID.test(p.slice(m.index + m[0].length))) continue;  // “…?” Horn said.
      out.push([st, m.index + m[0].replace(/\s+$/, "").length]);
      st = m.index + m[0].length;
    }
    if (p.slice(st).trim()) out.push([st, p.replace(/\s+$/, "").length]);
    return out;
  }
  function contained(a, b) {
    var n = 0, t = 0;
    for (var x in a) { t++; if (b[x]) n++; }
    return t > 0 && n / t >= 0.8;
  }
  function passageZh(p) {
    if (!zh) return null;
    if (p._zh !== undefined) return p._zh;
    var key = p.exam + " " + p.year + "年第" + p.text + "篇";
    var sents = zh.reading.filter(function (x) { return x.id === key; }).map(function (x) {
      return { w: wordSet(x.en.replace(/\s*\(\d+ words?\)\s*$/, "")), cn: x.cn };
    });
    if (!sents.length) return (p._zh = null);
    var k = 0;
    p._zh = p.paragraphs.map(function (para) {
      var out = [], prev = -1;
      splitSentences(para).forEach(function (r) {
        var w = wordSet(para.slice(r[0], r[1])), best = -1, bs = 0;
        for (var j = k; j < Math.min(k + 12, sents.length); j++) {
          var v = overlap(w, sents[j].w);
          if (v > bs) { bs = v; best = j; }
        }
        if (best >= 0 && bs >= 0.5) { k = best + 1; prev = best; out.push({ start: r[0], end: r[1], cn: sents[best].cn }); return; }
        // 译文库把几个短问句算作一句时（如 “…village of culture? Suburb of culture?”），并入上一句
        if (out.length && prev >= 0 && contained(w, sents[prev].w)) { out[out.length - 1].end = r[1]; return; }
        out.push({ start: r[0], end: r[1], cn: null });
      });
      return out;
    });
    return p._zh;
  }
  function questionZh(p, q) {
    if (!zh) return null;
    var x = zh.qs[p.exam + "_" + p.year + "_" + p.text + "_" + q.num];
    if (!x) return null;
    var opts = {};
    x.cn_opts.forEach(function (o) { var m = o.match(/^\[([A-D])\]\s*(.*)$/); if (m) opts[m[1]] = m[2]; });
    return { stem: x.cn_q.replace(/^\d+\.\s*/, ""), opts: opts };
  }
  // 全文一段：有译文时拆成句子，每句后面跟一行中文（默认隐藏，打开英汉对照才显示）
  function paraHTML(text, sents) {
    if (!sents) return esc(text);
    var html = "", last = 0;
    sents.forEach(function (s) {
      html += esc(text.slice(last, s.start)) + '<span class="s">' + esc(text.slice(s.start, s.end)) + "</span>" +
        (s.cn ? '<span class="zh">' + esc(s.cn) + "</span>" : '<span class="zh miss">（译文库里没有这一句）</span>');
      last = s.end;
    });
    return html + esc(text.slice(last));
  }

  // ---------- rendering ----------
  function rowHTML(q) {
    var p = passages[q.passage];
    var qz = questionZh(p, q), pz = passageZh(p);
    var opts = ["A", "B", "C", "D"].filter(function (k) { return q.options[k] != null; }).map(function (k) {
      var cn = qz && qz.opts[k] ? '<span class="zh">' + esc(qz.opts[k]) + "</span>" : "";
      return '<li class="opt' + (k === q.answer ? " ok" : "") + '"><span class="k">[' + k + ']</span><span>' + esc(q.options[k]) + cn + "</span></li>";
    }).join("");
    var ctx = q.context.map(function (c) {
      var ps = pz && pz[c.p - 1];
      var cn = ps ? '<p class="zh para-zh">' + esc(ps.map(function (s) { return s.cn || ""; }).join("")) +
        (ps.some(function (s) { return !s.cn; }) ? '<span class="miss">（本段有句子在译文库里没有译文）</span>' : "") + "</p>" : "";
      return '<p class="para"><span class="pn">P' + c.p + "</span>" + rich(c.text) + "</p>" + cn;
    }).join("");
    var rowId = p.year + "-" + p.exam + "-" + q.num;
    var quiz = isQuiz(rowId);
    var zhBtn = '<button class="zh-btn" type="button">' + (zhRows[rowId] ? "隐藏英汉对照译文" : "显示英汉对照译文") + "</button>";
    var map = (q.map || []).length ? '<div class="map">' + q.map.map(function (m) {
      return "<div><code>" + esc(m[0]) + "</code><span>≈</span><code>" + esc(m[1]) + "</code></div>";
    }).join("") + "</div>" : "";
    var basis = q.basis.map(function (b) { return "<p>" + rich(b) + "</p>"; }).join("");
    var note = q.note ? '<p style="margin-top:6px">' + rich(q.note) + "</p>" : "";
    var wrong = q.wrong.map(function (w) {
      return '<li><span class="k">' + esc(w.k) + '</span><span><span class="tag">' + esc(w.tag) + "</span>" + rich(w.text) + "</span></li>";
    }).join("");
    // 先做题：定位段落本身就暴露答案位置，和分析一起隐藏，点“显示答案与分析”后才出现
    var ps = q.context.map(function (c) { return c.p; }).join(",");
    return '<section class="row' + (quiz ? " quiz" : "") + (zhRows[rowId] ? " zh-on" : "") + '" id="' + esc(rowId) + '" data-ps="' + ps + '">' +
      '<div class="src">' + ctx +
        '<div class="q' + (quiz ? " hide-ans" : "") + '"><p class="stem">' + q.num + ". " + esc(q.stem) + "</p>" + (qz ? '<p class="zh stem-zh">' + esc(qz.stem) + "</p>" : "") + "<ol>" + opts + "</ol></div>" +
      "</div>" +
      '<div class="ana' + (quiz ? " hidden" : "") + '">' +
        // 顺序：先做题 → 再检查（译文）→ 最后看答案与分析
        '<div class="btns">' + zhBtn + anaBtn(quiz) + "</div>" +
        '<div class="ans"><span class="badge">答案 ' + esc(q.answer) + "</span><strong>" + esc(q.answerZh) + "</strong></div>" +
        "<div><h3>定位与依据</h3>" + basis + map + note + "</div>" +
        '<div><h3>排除</h3><ul class="wrong">' + wrong + "</ul></div>" +
      "</div></section>";
  }

  function groupHTML(pid, qs) {
    var p = passages[pid];
    // 题目定位到的段落，在全文里加左边线
    var located = {};
    qs.forEach(function (q) {
      if (isQuiz(p.year + "-" + p.exam + "-" + q.num)) return;
      q.context.forEach(function (c) { located[c.p] = true; });
    });
    var pz = passageZh(p);
    var full = p.paragraphs.map(function (t, i) {
      return '<p data-p="' + (i + 1) + '"' + (located[i + 1] ? ' class="located"' : "") + '><span class="pn">P' + (i + 1) + "</span>" + paraHTML(t, pz && pz[i]) + "</p>";
    }).join("");
    // 展开全文时：左边全文，右边逐题（定位段落 → 试题 → 分析）上下排列
    return '<div class="group"><h2><span class="eyebrow">' + p.year + " 考研英语（" + p.exam.slice(2) + "）· Text " + p.text + "</span>" +
      qs.map(function (q) { return q.num; }).join("、") + " 题</h2>" +
      '<div class="body">' +
        '<div class="full"><h3>Text ' + p.text + " 全文</h3>" + full + "</div>" +
        '<div class="rows">' +
        qs.map(rowHTML).join("") + "</div>" +
      "</div></div>";
  }

  function highlight(root, words, selector) {
    if (!words.length) return;
    var re = new RegExp("(^|[^A-Za-z])(" + words.map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]") + "[A-Za-z]*";
    }).join("|") + ")", "gi");
    root.querySelectorAll(selector).forEach(function (el) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (n) {
        var t = n.nodeValue;
        if (!re.test(t)) return;
        re.lastIndex = 0;
        var frag = document.createDocumentFragment(), last = 0, m;
        while ((m = re.exec(t))) {
          var start = m.index + m[1].length;
          frag.appendChild(document.createTextNode(t.slice(last, start)));
          var span = document.createElement("span");
          span.className = "hit";
          span.textContent = m[2];
          frag.appendChild(span);
          last = start + m[2].length;
        }
        frag.appendChild(document.createTextNode(t.slice(last)));
        n.parentNode.replaceChild(frag, n);
      });
    });
  }

  function directory() {
    var byP = {};
    questions.forEach(function (q) { (byP[q.passage] = byP[q.passage] || []).push(q); });
    var ids = Object.keys(byP).sort(function (a, b) {
      var pa = passages[a], pb = passages[b];
      return pb.year - pa.year || pa.exam.localeCompare(pb.exam) || pa.text - pb.text;
    });
    return '<div class="dir">' + ids.map(function (id) {
      var p = passages[id];
      return '<div class="item"><strong>' + esc(label(p)) + "</strong>" + byP[id].map(function (q) {
        return '<button class="chip" type="button" data-q="' + esc(p.year + "年" + q.num + "题") + '">' + q.num + " 题</button>";
      }).join("") + "</div>";
    }).join("") + "</div>";
  }

  function anaBtn(quiz) {
    return '<button class="reveal" type="button">' + (quiz ? "显示答案与分析" : "隐藏答案与分析") + "</button>";
  }

  function toolbar() {
    return '<div class="toolbar"><label><input type="checkbox" id="hide"' + (hideAnswers ? " checked" : "") + "> 先做题（隐藏原文定位、答案与分析）</label>" +
      '<label><input type="checkbox" id="zh"' + (zhAll ? " checked" : "") + "> 再检查（显示原文、题干和选项英汉对照）</label>" +
      '<label><input type="checkbox" id="ana"' + (showAll ? " checked" : "") + "> 看分析（显示答案与分析）</label>" +
      (zhFailed ? '<span class="warn">译文加载失败，请刷新重试</span>' : "") + "</div>";
  }

  function render() {
    var raw = $q.value;
    var url = new URL(location.href);
    if (raw.trim()) url.searchParams.set("q", raw.trim()); else url.searchParams.delete("q");
    history.replaceState(null, "", url);

    if (!raw.trim()) {
      $status.textContent = "题库共 " + questions.length + " 题。点题号直接查看，或在上方输入搜索。";
      $results.innerHTML = directory();
      return;
    }
    var r = search(raw);
    if (!r.items.length) {
      $status.textContent = "没有找到匹配的题目。可以换个单词，或输入“年份+题号”，例如 2023年22题。";
      $results.innerHTML = directory();
      return;
    }
    var shown = r.items.slice(0, MAX_ROWS);
    var msg = "找到 " + r.items.length + " 题";
    if (r.where === "context") msg += "（题干和选项里没有这个词，以下是原文定位段落中出现的）";
    if (r.items.length > MAX_ROWS) msg += "，先显示前 " + MAX_ROWS + " 题，可以加上年份缩小范围";
    $status.textContent = msg + "。";

    var groups = [], seen = {};
    shown.forEach(function (q) {
      if (!seen[q.passage]) { seen[q.passage] = []; groups.push(q.passage); }
      seen[q.passage].push(q);
    });
    $results.classList.toggle("zh-all", zhAll);
    $results.innerHTML = toolbar() + groups.map(function (g) { return groupHTML(g, seen[g]); }).join("");
    highlight($results, r.filters.words, r.where === "context" ? ".para" : ".stem, .opt");
  }

  // ---------- events ----------
  var timer;
  $q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(render, 120); });
  document.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (chip) { $q.value = chip.getAttribute("data-q"); render(); window.scrollTo({ top: 0 }); return; }
    var zb = e.target.closest(".zh-btn");
    if (zb) {
      var zrow = zb.closest(".row");
      var on = !zrow.classList.contains("zh-on");
      zrow.classList.toggle("zh-on", on);
      if (on) zhRows[zrow.id] = true; else delete zhRows[zrow.id];
      zb.textContent = on ? "隐藏英汉对照译文" : "显示英汉对照译文";
      return;
    }
    var btn = e.target.closest(".reveal");
    if (btn) {
      var row = btn.closest(".row");
      var show = row.classList.contains("quiz");
      rowState[row.id] = show;
      row.classList.toggle("quiz", !show);
      row.querySelector(".ana").classList.toggle("hidden", !show);
      row.querySelector(".q").classList.toggle("hide-ans", !show);
      btn.textContent = show ? "隐藏答案与分析" : "显示答案与分析";
      // 全文里的定位段落：本组还有已显示的题定位到它，就保留左边线
      var body = row.closest(".body");
      var full = body.querySelector(".full");
      row.getAttribute("data-ps").split(",").forEach(function (n) {
        var para = full.querySelector('p[data-p="' + n + '"]');
        if (!para) return;
        var keep = Array.prototype.some.call(body.querySelectorAll(".row:not(.quiz)"), function (r) {
          return r.getAttribute("data-ps").split(",").indexOf(n) >= 0;
        });
        para.classList.toggle("located", keep);
      });
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "zh") {
      zhAll = e.target.checked;
      try { localStorage.setItem("jiexi-zh", zhAll ? "1" : "0"); } catch (err) {}
      $results.classList.toggle("zh-all", zhAll);
      return;
    }
    if (e.target.id === "ana") {
      showAll = e.target.checked;
      rowState = {};
      try { localStorage.setItem("jiexi-ana", showAll ? "1" : "0"); } catch (err) {}
      render();
      return;
    }
    if (e.target.id !== "hide") return;
    hideAnswers = e.target.checked;
    rowState = {};
    try { localStorage.setItem("jiexi-hide", hideAnswers ? "1" : "0"); } catch (err) {}
    render();
  });

  (CFG.examples || ["2023年22题"]).forEach(function (ex, i) {
    if (i === 0) $examples.insertAdjacentHTML("beforeend", "<span>试试：</span>");
    $examples.insertAdjacentHTML("beforeend", '<button class="chip" type="button" data-q="' + esc(ex) + '">' + esc(ex) + "</button>");
  });

  fetch(DATA)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      d.passages.forEach(function (p) { passages[p.id] = p; });
      questions = d.questions.filter(function (q) { return passages[q.passage]; });
      questions.sort(function (a, b) {
        var pa = passages[a.passage], pb = passages[b.passage];
        return pb.year - pa.year || pa.exam.localeCompare(pb.exam) || a.num - b.num;
      });
      $q.value = new URL(location.href).searchParams.get("q") || "";
      render();
      return Promise.all(["1reading.json", "4tiganxuanxiang.json"].map(function (u) {
        return fetch(ROOT + u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
      })).then(function (res) {
        var qs = {};
        res[1].forEach(function (x) { qs[x.id] = x; });
        zh = { reading: res[0], qs: qs };
        render();
      }, function () { zhFailed = true; render(); });
    })
    .catch(function () {
      $status.textContent = "题库加载失败。如果是直接双击打开的本地文件，请改用 GitHub Pages 网址访问。";
    });
})();
