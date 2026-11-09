/* Loment playground.
 *
 * The page is static. On the first run this script loads Pyodide (CPython in
 * WebAssembly), then loads the reference compiler and LVM from ./py/ into the
 * virtual filesystem and runs the source there. Nothing is uploaded.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var BASE = new URL("./", script ? script.src : window.location.href);
  var CDN = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";

  // Two compiler snapshots. Beta is built from the latest main branch; stable
  // is the 0.1.5.1 release. Each channel has its own manifest under
  // ./<channel>/ so a module or a library cannot leak between them.
  var params = new URLSearchParams(window.location.search);
  var CHANNEL = params.get("channel") === "stable" ? "stable" : "beta";
  var ASSET = new URL(CHANNEL + "/", BASE);
  var CONCURRENCY = 12;

  var EXAMPLES = {
    hello: [
      "module hello",
      "",
      "choose runtime",
      "",
      "fn main() {",
      '    print("hello from Loment\\n");',
      "    print_num(6 * 7);",
      '    print("\\n");',
      "}",
      ""
    ].join("\n"),
    flow: [
      "module flow",
      "",
      "choose runtime",
      "",
      "fn main() {",
      "    let total: u32 = 0;",
      "    for i in 1..11 {",
      "        if i % 2 == 0 {",
      "            continue;",
      "        }",
      "        total = total + i;",
      "    }",
      '    print("odd sum 1..10 = ");',
      "    print_num(total);",
      '    print("\\n");',
      "}",
      ""
    ].join("\n"),
    data: [
      "module data",
      "",
      "choose runtime",
      "",
      "struct Point {",
      "    x: u32,",
      "    y: u32,",
      "}",
      "",
      "enum Shape {",
      "    Dot,",
      "    Size(u32),",
      "}",
      "",
      "fn main() {",
      "    let p: Point = Point { x: 3, y: 4 };",
      "    print_num(p.x * p.x + p.y * p.y);",
      '    print("\\n");',
      "    match Shape::Size(9) {",
      '        Shape::Dot => { print("dot\\n"); }',
      '        Shape::Size(n) => { print_num(n); print("\\n"); }',
      "    }",
      "}",
      ""
    ].join("\n"),
    domain: [
      "module domain",
      "",
      "choose runtime",
      "",
      "capability slots : disk[0..4]",
      "",
      "fn main() {",
      "    guard slots(2);",
      '    print("slot 2 is inside the domain\\n");',
      "}",
      ""
    ].join("\n")
  };

  function starter(name) {
    return [
      "module " + name,
      "",
      "choose runtime",
      "",
      "fn main() {",
      '    print("hello from my program\\n");',
      "}",
      ""
    ].join("\n");
  }

  function langStarter(lang, name) {
    if (lang === "python") {
      return [
        "choose write grammar python",
        "",
        "def _start() -> int:",
        "    print_num(6 * 7)",
        "    return 0",
        ""
      ].join("\n");
    }
    if (lang === "java" || lang === "csharp") {
      return [
        "choose write grammar " + lang,
        "",
        "public class Main {",
        "    public static int _start() {",
        "        int x = 6 * 7;",
        "        return x;",
        "    }",
        "}",
        ""
      ].join("\n");
    }
    if (lang === "c" || lang === "cpp") {
      return [
        "choose write grammar " + lang,
        "",
        "int _start() {",
        "    int x = 6 * 7;",
        "    return x;",
        "}",
        ""
      ].join("\n");
    }
    if (lang === "go") {
      return [
        "choose write grammar go",
        "",
        "package main",
        "",
        "func _start() int {",
        "    var x int = 6 * 7",
        "    return x",
        "}",
        ""
      ].join("\n");
    }
    return starter(name);
  }

  var root = document.getElementById("pg");
  if (!root) return;
  var S = root.dataset;

  var nameEl = document.getElementById("pg-name");
  var actionEl = document.getElementById("pg-action");
  var langEl = document.getElementById("pg-lang");
  var editionEl = document.getElementById("pg-edition");
  var targetEl = document.getElementById("pg-target");
  var channelEl = document.getElementById("pg-channel");
  var linksEl = document.getElementById("pg-links");
  var src = document.getElementById("pg-src");
  var hl = document.querySelector("#pg-hl code");
  var gutter = document.getElementById("pg-gutter");
  var statusEl = document.getElementById("pg-status");
  var runBtn = document.getElementById("pg-run");
  var outEl = document.getElementById("pg-stdout");
  var errEl = document.getElementById("pg-stderr");
  var errBlock = document.getElementById("pg-stderr-block");
  var exitEl = document.getElementById("pg-exit");
  var elapsedEl = document.getElementById("pg-elapsed");
  var pyPromise = null;

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(code) {
    var re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*")|\b(\d+)\b|\b(module|choose|fn|def|let|const|struct|enum|match|if|elif|else|while|for|in|return|break|continue|defer|guard|capability|excluded|extern|trait|impl|pub|use|as|and|or|not|true|false)\b/g;
    var out = "";
    var last = 0;
    var m;
    while ((m = re.exec(code))) {
      out += escapeHtml(code.slice(last, m.index));
      var cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "n" : "k";
      out += '<span class="' + cls + '">' + escapeHtml(m[0]) + "</span>";
      last = m.index + m[0].length;
    }
    out += escapeHtml(code.slice(last));
    return out + "\n";
  }

  function syncScroll() {
    var pre = document.getElementById("pg-hl");
    pre.scrollTop = src.scrollTop;
    pre.scrollLeft = src.scrollLeft;
    gutter.scrollTop = src.scrollTop;
  }

  function fit() {
    var pre = document.getElementById("pg-hl");
    pre.style.width = src.clientWidth + "px";
    pre.style.height = src.clientHeight + "px";
  }

  function render() {
    hl.innerHTML = highlight(src.value);
    var n = src.value.split("\n").length;
    var g = "";
    for (var i = 1; i <= n; i++) g += i + "\n";
    gutter.textContent = g;
    fit();
    syncScroll();
  }

  function setStatus(text, isErr) {
    statusEl.textContent = text;
    statusEl.className = "pg-status" + (isErr ? " err" : "");
  }

  src.addEventListener("input", render);
  src.addEventListener("scroll", syncScroll);

  src.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      var s = src.selectionStart;
      var t = src.selectionEnd;
      src.setRangeText("    ", s, t, "end");
      render();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  function programName() {
    var raw = (nameEl.value || "").trim();
    if (!raw) return "main";
    var n = raw.replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z_]/.test(n)) n = "_" + n;
    return n;
  }

  function addDownload(data) {
    var bin = atob(data.artifact);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = data.filename;
    a.textContent = "Download " + data.filename;
    linksEl.appendChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function clearOutput() {
    setStatus(S.ready);
    outEl.textContent = "";
    errEl.textContent = "";
    errBlock.hidden = true;
    linksEl.textContent = "";
    exitEl.textContent = "—";
    elapsedEl.textContent = "";
  }

  var drafts = {};
  var currentLang = "loment";

  function syncLanguage(lang) {
    currentLang = lang;
    editionEl.disabled = lang !== "loment";
    document.getElementById("pg-example").disabled = lang !== "loment";
  }

  langEl.addEventListener("change", function (e) {
    drafts[currentLang] = src.value;
    var next = e.target.value;
    syncLanguage(next);
    src.value = drafts[next] || langStarter(next, programName());
    render();
    clearOutput();
  });

  document.getElementById("pg-example").addEventListener("change", function (e) {
    if (currentLang !== "loment") {
      drafts[currentLang] = src.value;
      langEl.value = "loment";
      syncLanguage("loment");
    }
    src.value = EXAMPLES[e.target.value] || EXAMPLES.hello;
    render();
    clearOutput();
  });

  function syncAction() {
    var opt = actionEl.options[actionEl.selectedIndex];
    runBtn.textContent = opt ? opt.textContent : "Run";
    targetEl.disabled = !(actionEl.value === "build" || actionEl.value === "asm");
  }
  actionEl.addEventListener("change", syncAction);

  channelEl.addEventListener("change", function () {
    try { sessionStorage.setItem("pg-src", src.value); } catch (e) { /* ignore */ }
    try { sessionStorage.setItem("pg-lang", langEl.value); } catch (e) { /* ignore */ }
    var u = new URL(window.location.href);
    u.searchParams.set("channel", channelEl.value);
    window.location.href = u.toString();
  });

  document.getElementById("pg-new").addEventListener("click", function () {
    var entered = window.prompt(S.newPrompt || "Name for the new program", programName());
    if (entered === null) return;
    nameEl.value = entered;
    nameEl.value = programName();
    src.value = langStarter(currentLang, nameEl.value);
    render();
    clearOutput();
    src.focus();
  });

  nameEl.addEventListener("blur", function () { nameEl.value = programName(); });

  document.getElementById("pg-download").addEventListener("click", function () {
    var blob = new Blob([src.value], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = programName() + ".lomt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  function loadEngine() {
    if (window.loadPyodide) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = CDN + "pyodide.js";
      s.onload = resolve;
      s.onerror = function () { reject(new Error("could not load the engine from " + CDN)); };
      document.head.appendChild(s);
    });
  }

  function loadTree(py) {
    return fetch(new URL("manifest.json?ts=" + Date.now(), ASSET), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("missing " + CHANNEL + "/manifest.json");
      return r.json();
    }).then(function (m) {
      var list = m.files || [];
      var i = 0;
      function next() {
        if (i >= list.length) return Promise.resolve();
        var pair = list[i++];
        return fetch(new URL(pair[0], ASSET), { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error("missing " + pair[0]);
          return r.text();
        }).then(function (text) {
          var dst = pair[1];
          var cut = dst.lastIndexOf("/");
          if (cut > 0) py.FS.mkdirTree(dst.slice(0, cut));
          py.FS.writeFile(dst, text);
          return next();
        });
      }
      var workers = [];
      for (var k = 0; k < CONCURRENCY; k++) workers.push(next());
      return Promise.all(workers).then(function () { return py; });
    });
  }

  function boot() {
    setStatus(S.loadingEngine);
    return loadEngine().then(function () {
      return loadPyodide({ indexURL: CDN });
    }).then(function (py) {
      setStatus(S.loadingCompiler);
      return loadTree(py);
    }).then(function (py) {
      return py.runPythonAsync([
          "import sys",
          'sys.path.insert(0, "/loment/tools")',
          'sys.path.append("/loment/loment")',
          "import pg_runner",
          "",
          "def run_text(text, action, edition, target, name, language):",
          "    return pg_runner.run_text(text, action, edition, target, name, language)"
        ].join("\n")).then(function () { return py; });
    });
  }

  function run() {
    var m = src.value.match(/^\s*module\s+([A-Za-z_][A-Za-z0-9_]*)/m);
    if (m) nameEl.value = m[1];
    var t0 = performance.now();
    runBtn.disabled = true;
    errBlock.hidden = true;
    outEl.textContent = "";
    linksEl.textContent = "";
    exitEl.textContent = "—";
    elapsedEl.textContent = "";
    var action = actionEl.value;
    var edition = editionEl.value;
    var target = targetEl.value;
    var language = langEl.value;
    var promise = pyPromise || (pyPromise = boot());
    promise.then(function (py) {
      setStatus(S.compiling);
      var fn = py.globals.get("run_text");
      var res = fn(src.value, action, edition, target, nameEl.value || "main", language);
      var d = res.toJs();
      res.destroy();
      outEl.textContent = d.out || (language !== "loment" && !d.err ? (S.noOutput || "") : "");
      if (d.err) {
        errEl.textContent = d.err;
        errBlock.hidden = false;
      }
      if (d.kind === "build" && d.artifact) addDownload(d);
      exitEl.textContent = S.exit + " " + d.rc;
      elapsedEl.textContent = Math.round(performance.now() - t0) + " ms";
      setStatus(d.rc === 0 ? S.finished : S.finishedErrors, d.rc !== 0);
    }).catch(function (e) {
      errEl.textContent = String(e && e.stack || e);
      errBlock.hidden = false;
      exitEl.textContent = "error";
      setStatus(S.error, true);
      pyPromise = null;
    }).then(function () {
      runBtn.disabled = false;
    });
  }

  window.addEventListener("resize", function () { fit(); syncScroll(); });
  runBtn.addEventListener("click", run);
  channelEl.value = CHANNEL;
  var saved = null;
  var savedLang = "loment";
  try {
    saved = sessionStorage.getItem("pg-src");
    savedLang = sessionStorage.getItem("pg-lang") || "loment";
  } catch (e) { /* ignore */ }
  if (savedLang !== "loment" && langEl.querySelector('option[value="' + savedLang + '"]')) {
    langEl.value = savedLang;
  }
  syncLanguage(langEl.value);
  src.value = saved || (langEl.value === "loment" ? EXAMPLES.hello : langStarter(langEl.value, "main"));
  if (saved) { try { sessionStorage.removeItem("pg-src"); } catch (e) { /* ignore */ } }
  if (saved) { try { sessionStorage.removeItem("pg-lang"); } catch (e) { /* ignore */ } }
  render();
  syncAction();
})();
