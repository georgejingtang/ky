// 考研阅读精析检索：读取 data/questions.json，在浏览器里本地搜索并按“左原文·右分析”渲染。
(function () {
  "use strict";

  var MAX_ROWS = 30;
  var $q = document.getElementById("q");
  var $status = document.getElementById("status");
  var $results = document.getElementById("results");
  var $examples = document.getElementById("examples");
  var passages = {};
  var questions = [];
  var hideAnswers = false;
  var fullOpen = false;
  try { hideAnswers = localStorage.getItem("jiexi-hide") === "1"; } catch (e) {}

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

  // ---------- rendering ----------
  function rowHTML(q) {
    var p = passages[q.passage];
    var opts = ["A", "B", "C", "D"].filter(function (k) { return q.options[k] != null; }).map(function (k) {
      return '<li class="opt' + (k === q.answer ? " ok" : "") + '"><span class="k">[' + k + ']</span><span>' + esc(q.options[k]) + "</span></li>";
    }).join("");
    var ctx = q.context.map(function (c) {
      return '<p class="para"><span class="pn">P' + c.p + "</span>" + rich(c.text) + "</p>";
    }).join("");
    var map = (q.map || []).length ? '<div class="map">' + q.map.map(function (m) {
      return "<div><code>" + esc(m[0]) + "</code><span>≈</span><code>" + esc(m[1]) + "</code></div>";
    }).join("") + "</div>" : "";
    var basis = q.basis.map(function (b) { return "<p>" + rich(b) + "</p>"; }).join("");
    var note = q.note ? '<p style="margin-top:6px">' + rich(q.note) + "</p>" : "";
    var wrong = q.wrong.map(function (w) {
      return '<li><span class="k">' + esc(w.k) + '</span><span><span class="tag">' + esc(w.tag) + "</span>" + rich(w.text) + "</span></li>";
    }).join("");
    return '<section class="row" id="' + esc(p.year + "-" + p.exam + "-" + q.num) + '">' +
      '<div class="src">' + ctx +
        '<div class="q' + (hideAnswers ? " hide-ans" : "") + '"><p class="stem">' + q.num + ". " + esc(q.stem) + "</p><ol>" + opts + "</ol></div>" +
      "</div>" +
      '<div class="ana' + (hideAnswers ? " hidden" : "") + '">' +
        (hideAnswers ? '<button class="reveal" type="button">显示答案与分析</button>' : "") +
        '<div class="ans"><span class="badge">答案 ' + esc(q.answer) + "</span><strong>" + esc(q.answerZh) + "</strong></div>" +
        "<div><h3>定位与依据</h3>" + basis + map + note + "</div>" +
        '<div><h3>排除</h3><ul class="wrong">' + wrong + "</ul></div>" +
      "</div></section>";
  }

  function groupHTML(pid, qs) {
    var p = passages[pid];
    // 题目定位到的段落，在全文里加左边线
    var located = {};
    qs.forEach(function (q) { q.context.forEach(function (c) { located[c.p] = true; }); });
    var full = p.paragraphs.map(function (t, i) {
      return '<p' + (located[i + 1] ? ' class="located"' : "") + '><span class="pn">P' + (i + 1) + "</span>" + esc(t) + "</p>";
    }).join("");
    // 展开全文时：左边全文，右边逐题（定位段落 → 试题 → 分析）上下排列
    return '<div class="group"><h2><span class="eyebrow">' + p.year + " 考研英语（" + p.exam.slice(2) + "）· Text " + p.text + "</span>" +
      qs.map(function (q) { return q.num; }).join("、") + " 题</h2>" +
      '<div class="body' + (fullOpen ? " open" : "") + '">' +
        '<details class="full"' + (fullOpen ? " open" : "") + "><summary>" +
          '<span class="when-closed">展开 Text ' + p.text + " 全文（共 " + p.paragraphs.length + " 段），题目会排到全文右边</span>" +
          '<span class="when-open">收起 Text ' + p.text + " 全文</span></summary>" + full + "</details>" +
        '<div class="rows"><div class="colhead"><div>原文 · 试题</div><div>分析</div></div>' +
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

  function toolbar() {
    return '<div class="toolbar"><label><input type="checkbox" id="hide"' + (hideAnswers ? " checked" : "") + "> 先做题（隐藏答案与分析）</label></div>";
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
    $results.innerHTML = toolbar() + groups.map(function (g) { return groupHTML(g, seen[g]); }).join("");
    highlight($results, r.filters.words, r.where === "context" ? ".para" : ".stem, .opt");
  }

  // ---------- events ----------
  var timer;
  $q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(render, 120); });
  document.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (chip) { $q.value = chip.getAttribute("data-q"); render(); window.scrollTo({ top: 0 }); return; }
    var btn = e.target.closest(".reveal");
    if (btn) {
      var ana = btn.parentNode;
      ana.classList.remove("hidden");
      ana.parentNode.querySelector(".q").classList.remove("hide-ans");
      btn.remove();
    }
  });
  // 全文展开/收起：切换左右布局，并记住状态供下次搜索沿用
  document.addEventListener("toggle", function (e) {
    if (!e.target.matches || !e.target.matches("details.full")) return;
    fullOpen = e.target.open;
    e.target.parentNode.classList.toggle("open", fullOpen);
  }, true);
  document.addEventListener("change", function (e) {
    if (e.target.id !== "hide") return;
    hideAnswers = e.target.checked;
    try { localStorage.setItem("jiexi-hide", hideAnswers ? "1" : "0"); } catch (err) {}
    render();
  });

  ["2023年22题", "swayed", "Quinn", "2023 英语一"].forEach(function (ex, i) {
    if (i === 0) $examples.insertAdjacentHTML("beforeend", "<span>试试：</span>");
    $examples.insertAdjacentHTML("beforeend", '<button class="chip" type="button" data-q="' + esc(ex) + '">' + esc(ex) + "</button>");
  });

  fetch("data/questions.json")
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
    })
    .catch(function () {
      $status.textContent = "题库加载失败。如果是直接双击打开的本地文件，请改用 GitHub Pages 网址访问。";
    });
})();
