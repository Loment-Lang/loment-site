/* Loment playground.
 *
 * The page is static. On the first run this script loads Pyodide (CPython in
 * WebAssembly), then loads the reference compiler and LVM from ./py/ into the
 * virtual filesystem and runs the source there. Nothing is uploaded.
 *
 * Two editor modes share one compiler. "single" keeps one file in the textarea.
 * "project" keeps a small map of files and sends every non-entry file with the
 * run; the Python runner writes them under /loment/deps/<module>/ where the
 * compiler already looks for project modules.
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
  // v1 held one project; v2 holds the project list. The old key is migrated
  // once, then removed.
  var LEGACY_PROJECT_KEY = "loment-playground-project-v1";
  var PROJECTS_KEY = "loment-playground-projects-v2";
  var SINGLE_KEY = "loment-playground-single-v1";
  var MAX_IMPORT_FILE = 256 * 1024;
  var MAX_IMPORT_TOTAL = 2 * 1024 * 1024;
  var MAX_IMPORT_FILES = 200;
  var SKIP_DIRS = {
    "node_modules": 1, "target": 1, "dist": 1, "build": 1, "out": 1,
    "__pycache__": 1, ".git": 1, ".hg": 1, ".svn": 1, ".venv": 1,
    "venv": 1, ".idea": 1, ".gradle": 1, ".next": 1, ".cache": 1
  };

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

  var PROJECT_MAIN = [
    "module main",
    "",
    "choose runtime",
    "",
    "use lib",
    "",
    "fn main() {",
    "    print_num(answer());",
    '    print("\\n");',
    "}",
    ""
  ].join("\n");

  var PROJECT_LIB = [
    "module lib",
    "",
    "pub fn answer() -> i64 {",
    "    return 42;",
    "}",
    ""
  ].join("\n");

  var STUB_MAIN = [
    "module main",
    "",
    "choose runtime",
    "",
    "fn main() {",
    "}",
    ""
  ].join("\n");

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

  var mainEl = document.getElementById("pg-main");
  var managerEl = document.getElementById("pg-manager");
  var managerList = document.getElementById("pg-manager-list");
  var projectLabelEl = document.getElementById("pg-project-name");
  var treeEl = document.getElementById("pg-tree");
  var treeList = document.getElementById("pg-tree-list");
  var entryEl = document.getElementById("pg-entry-name");
  var fileNameEl = document.getElementById("pg-file-name");
  var extEl = document.getElementById("pg-ext");
  var nameEl = document.getElementById("pg-name");
  var actionEl = document.getElementById("pg-action");
  var langEl = document.getElementById("pg-lang");
  var editionEl = document.getElementById("pg-edition");
  var targetEl = document.getElementById("pg-target");
  var channelEl = document.getElementById("pg-channel");
  var exampleEl = document.getElementById("pg-example");
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
  var outputTargetEl = document.getElementById("pg-output-target");
  var runFileBtn = document.getElementById("pg-run-file");
  var fileInput = document.getElementById("pg-file-input");
  var folderInput = document.getElementById("pg-folder-input");
  var importTarget = null;
  var pyPromise = null;

  var mode = "single";
  var screen = "manager";
  var singleSource = "";
  var project = null;
  var projectsStore = null;
  var currentFile = null;
  var currentLang = "loment";
  var drafts = {};
  var saveTimer = 0;
  var singleTimer = 0;
  var dragState = null;

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
    requestAnimationFrame(function () {
      fit();
      syncScroll();
    });
  }

  function setStatus(text, isErr) {
    statusEl.textContent = text;
    statusEl.className = "pg-status" + (isErr ? " err" : "");
  }

  function safeName(raw) {
    var n = String(raw || "").trim().replace(/[^A-Za-z0-9_]/g, "_");
    if (!n) return "main";
    if (!/^[A-Za-z_]/.test(n)) n = "_" + n;
    return n;
  }

  function programName() {
    return safeName((nameEl.value || "").trim() || "main");
  }

  function fileStem(path) {
    return String(path || "main").split("/").pop().replace(/\.(lomt|lom)$/i, "");
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

  function syncLanguage(lang) {
    currentLang = lang;
    editionEl.disabled = lang !== "loment";
    exampleEl.disabled = lang !== "loment";
  }

  function addDirTo(p, path) {
    if (!path) return;
    var parts = path.split("/");
    for (var i = 1; i <= parts.length; i++) {
      var d = parts.slice(0, i).join("/");
      if (p.dirs.indexOf(d) < 0) p.dirs.push(d);
    }
  }

  function addDir(path) {
    if (!project) return;
    addDirTo(project, path);
  }

  function dedupeDirs() {
    if (!project) return;
    var seen = {};
    project.dirs = (project.dirs || []).filter(function (d) {
      if (!d || seen[d]) return false;
      seen[d] = true;
      return true;
    });
  }

  function newId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function defaultProjectFiles() {
    return {
      "src/main.lomt": PROJECT_MAIN,
      "src/lib.lomt": PROJECT_LIB
    };
  }

  function makeProject(name, files) {
    return {
      id: newId(),
      name: name || "src",
      entry: "src/main.lomt",
      dirs: ["src"],
      files: files || defaultProjectFiles(),
      updatedAt: Date.now()
    };
  }

  function normalizeProject(p) {
    if (!p || typeof p !== "object" || !p.files || typeof p.files !== "object") return null;
    var keys = Object.keys(p.files);
    keys.forEach(function (k) {
      if (typeof p.files[k] !== "string") delete p.files[k];
    });
    keys = Object.keys(p.files);
    if (!keys.length) return null;
    if (!p.id || typeof p.id !== "string") p.id = newId();
    if (!p.name || typeof p.name !== "string") p.name = "project";
    if (!Array.isArray(p.dirs)) p.dirs = [];
    p.dirs = p.dirs.filter(function (d) { return typeof d === "string" && d; });
    var known = p.dirs.slice();
    known.forEach(function (d) { addDirTo(p, d); });
    keys.forEach(function (file) {
      var cut = file.lastIndexOf("/");
      if (cut > 0) addDirTo(p, file.slice(0, cut));
    });
    var seen = {};
    p.dirs = p.dirs.filter(function (d) {
      if (seen[d]) return false;
      seen[d] = true;
      return true;
    });
    if (!p.files[p.entry]) p.entry = keys.sort()[0];
    if (typeof p.updatedAt !== "number") p.updatedAt = Date.now();
    return p;
  }

  function findIn(list, id) {
    if (!list || !id) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function findProject(id) {
    return projectsStore ? findIn(projectsStore.projects, id) : null;
  }

  function saveStoreObject(s) {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(s));
    } catch (e) { /* storage may be full or disabled */ }
  }

  function saveStore() {
    if (projectsStore) saveStoreObject(projectsStore);
  }

  function loadStore() {
    var s = null;
    try {
      s = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "null");
    } catch (e) { /* ignore a corrupt value */ }
    if (s && Array.isArray(s.projects)) {
      s.projects = s.projects.map(normalizeProject).filter(Boolean);
      if (!s.projects.length) {
        s.projects = [makeProject("src")];
        s.activeId = null;
        saveStoreObject(s);
      }
      if (!findIn(s.projects, s.activeId)) s.activeId = null;
      return s;
    }

    var legacy = null;
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_PROJECT_KEY) || "null");
    } catch (e) { /* ignore */ }
    var projects = [];
    if (legacy && legacy.files) {
      var migrated = normalizeProject({
        id: newId(),
        name: "src",
        entry: legacy.entry,
        dirs: legacy.dirs,
        files: legacy.files,
        updatedAt: Date.now()
      });
      if (migrated) projects.push(migrated);
    }
    if (!projects.length) projects.push(makeProject("src"));
    var store = {
      projects: projects,
      activeId: legacy && projects.length ? projects[0].id : null
    };
    saveStoreObject(store);
    try { localStorage.removeItem(LEGACY_PROJECT_KEY); } catch (e) { /* ignore */ }
    return store;
  }

  function saveProjectNow() {
    if (!project) return;
    clearTimeout(saveTimer);
    project.updatedAt = Date.now();
    if (projectsStore && projectsStore.projects.indexOf(project) < 0) {
      projectsStore.projects.push(project);
    }
    saveStore();
  }

  function scheduleProjectSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProjectNow, 250);
  }

  function saveSingleNow() {
    try {
      localStorage.setItem(SINGLE_KEY, singleSource);
    } catch (e) { /* ignore */ }
  }

  function scheduleSingleSave() {
    clearTimeout(singleTimer);
    singleTimer = setTimeout(saveSingleNow, 300);
  }

  function moduleStarter(path) {
    var stem = fileStem(path).replace(/[^A-Za-z0-9_]/g, "_");
    if (!stem) stem = "lib";
    if (!/^[A-Za-z_]/.test(stem)) stem = "_" + stem;
    if (stem === "main") return starter("main");
    return [
      "module " + stem,
      "",
      "pub fn value() -> i64 {",
      "    return 0;",
      "}",
      ""
    ].join("\n");
  }

  function normalizePath(raw) {
    var p = String(raw).trim().replace(/\\/g, "/");
    while (p.indexOf("./") === 0) p = p.slice(2);
    if (!p || p.charAt(0) === "/") return null;
    if (!/\.(lomt|lom)$/i.test(p)) p += ".lomt";
    var parts = p.split("/");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part || part === "." || part === "..") return null;
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part)) return null;
    }
    return p;
  }

  function normalizeDir(raw) {
    var p = String(raw).trim().replace(/\\/g, "/");
    while (p.indexOf("./") === 0) p = p.slice(2);
    if (!p || p.charAt(0) === "/") return null;
    var parts = p.split("/");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part || part === "." || part === "..") return null;
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part)) return null;
    }
    return parts.join("/");
  }

  function updateSourceHead() {
    var isProject = mode === "project";
    nameEl.hidden = isProject;
    extEl.hidden = isProject;
    fileNameEl.hidden = !isProject;
    if (isProject) fileNameEl.textContent = currentFile || project.entry;
  }

  function renderTreeLevel(node, parent, prefix) {
    Object.keys(node.dirs || {}).sort().forEach(function (dir) {
      var dirPath = prefix ? prefix + "/" + dir : dir;
      var dirRow = document.createElement("li");
      dirRow.className = "pg-tree-dir";
      dirRow.dataset.dir = dirPath;
      var head = document.createElement("div");
      head.className = "pg-dir-row";
      var label = document.createElement("div");
      label.className = "pg-dir-name";
      label.textContent = dir + "/";
      label.draggable = true;
      label.dataset.dir = dirPath;
      head.appendChild(label);
      var dirDel = document.createElement("button");
      dirDel.type = "button";
      dirDel.className = "pg-dir-del";
      dirDel.dataset.deleteDir = dirPath;
      dirDel.title = S.deleteFolder || "Delete folder";
      dirDel.setAttribute("aria-label", (S.deleteFolder || "Delete folder") + ": " + dirPath);
      dirDel.textContent = "×";
      head.appendChild(dirDel);
      dirRow.appendChild(head);
      var sub = document.createElement("ul");
      dirRow.appendChild(sub);
      renderTreeLevel(node.dirs[dir], sub, dirPath);
      parent.appendChild(dirRow);
    });
    (node.files || []).sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    }).forEach(function (f) {
      var row = document.createElement("li");
      row.className = "pg-file-row" + (f.path === currentFile ? " is-on" : "");
      var fileBtn = document.createElement("button");
      fileBtn.type = "button";
      fileBtn.className = "pg-file-btn";
      fileBtn.dataset.file = f.path;
      fileBtn.title = f.path;
      fileBtn.textContent = f.name;
      fileBtn.draggable = true;
      row.appendChild(fileBtn);

      var entryBtn = document.createElement("button");
      entryBtn.type = "button";
      entryBtn.className = "pg-entry-btn" + (f.path === project.entry ? " is-entry" : "");
      entryBtn.dataset.entry = f.path;
      entryBtn.title = S.setEntry || "Set as entry";
      entryBtn.setAttribute("aria-label", (S.setEntry || "Set as entry") + ": " + f.path);
      entryBtn.textContent = f.path === project.entry ? "●" : "○";
      row.appendChild(entryBtn);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "pg-file-del";
      del.dataset.delete = f.path;
      del.title = S.deleteFile || "Delete file";
      del.setAttribute("aria-label", (S.deleteFile || "Delete file") + ": " + f.path);
      del.textContent = "×";
      row.appendChild(del);

      parent.appendChild(row);
    });
  }

  function renderTree() {
    if (!treeList || !project) return;
    treeList.textContent = "";
    entryEl.textContent = project.entry;
    var tree = {};
    (project.dirs || []).forEach(function (path) {
      var parts = path.split("/");
      var node = tree;
      for (var i = 0; i < parts.length; i++) {
        node.dirs = node.dirs || {};
        if (!node.dirs[parts[i]]) node.dirs[parts[i]] = {};
        node = node.dirs[parts[i]];
      }
    });
    Object.keys(project.files).sort().forEach(function (path) {
      var parts = path.split("/");
      var node = tree;
      for (var i = 0; i < parts.length - 1; i++) {
        node.dirs = node.dirs || {};
        if (!node.dirs[parts[i]]) node.dirs[parts[i]] = {};
        node = node.dirs[parts[i]];
      }
      node.files = node.files || [];
      node.files.push({ name: parts[parts.length - 1], path: path });
    });
    renderTreeLevel(tree, treeList, "");
    updateOutputTarget(false);
  }

  function updateProjectLabel() {
    if (!projectLabelEl) return;
    if (mode === "project" && project) {
      projectLabelEl.textContent = project.name;
      projectLabelEl.hidden = false;
    } else {
      projectLabelEl.textContent = "";
      projectLabelEl.hidden = true;
    }
  }

  function updateOutputTarget(isFile) {
    if (!outputTargetEl) return;
    if (mode === "project" && project) {
      var label = isFile ? (S.fileLabel || "File") : (S.entryLabel || "Entry");
      var path = isFile ? currentFile : project.entry;
      outputTargetEl.textContent = label + " " + path;
      outputTargetEl.title = label + " " + path;
      outputTargetEl.hidden = false;
    } else {
      outputTargetEl.textContent = "";
      outputTargetEl.hidden = true;
    }
  }

  function applyModeUI() {
    var isProject = mode === "project";
    root.dataset.mode = mode;
    mainEl.dataset.mode = mode;
    treeEl.hidden = !isProject;
    if (runFileBtn) runFileBtn.hidden = !isProject;
    Array.prototype.forEach.call(document.querySelectorAll(".pg-mode"), function (btn) {
      var on = btn.dataset.mode === mode;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    updateSourceHead();
    updateProjectLabel();
    updateOutputTarget(false);
  }

  function applyScreen() {
    root.dataset.screen = screen;
    if (managerEl) managerEl.hidden = screen !== "manager";
    if (screen === "manager") renderManager();
  }

  function renderManager() {
    if (!managerList || !projectsStore) return;
    managerList.textContent = "";
    var list = projectsStore.projects.slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "pg-manager-empty";
      empty.textContent = S.noProjects || "No projects yet. Create one to start.";
      managerList.appendChild(empty);
      return;
    }
    list.forEach(function (p) {
      var card = document.createElement("article");
      card.className = "pg-project-card" + (p.id === projectsStore.activeId ? " is-active" : "");

      var title = document.createElement("h3");
      title.textContent = p.name;
      title.title = p.name;
      card.appendChild(title);

      var meta = document.createElement("div");
      meta.className = "pg-project-meta";
      var count = document.createElement("span");
      count.textContent = (S.fileCount || "{n} files").replace("{n}", String(Object.keys(p.files).length));
      meta.appendChild(count);
      var entry = document.createElement("span");
      entry.textContent = p.entry;
      entry.title = p.entry;
      meta.appendChild(entry);
      card.appendChild(meta);

      if (p.id === projectsStore.activeId) {
        var badge = document.createElement("span");
        badge.className = "pg-project-badge";
        badge.textContent = S.lastOpened || "Last opened";
        card.appendChild(badge);
      }

      var actions = document.createElement("div");
      actions.className = "pg-project-actions";
      var open = document.createElement("button");
      open.type = "button";
      open.className = "btn btn-solid";
      open.dataset.openProject = p.id;
      open.textContent = S.openProject || "Open";
      actions.appendChild(open);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-quiet pg-project-delete";
      del.dataset.deleteProject = p.id;
      del.textContent = S.deleteProject || "Delete";
      actions.appendChild(del);
      card.appendChild(actions);

      managerList.appendChild(card);
    });
  }

  function openManager() {
    if (screen === "editor") {
      if (mode === "project" && project) {
        project.files[currentFile] = src.value;
        saveProjectNow();
      } else {
        singleSource = src.value;
        saveSingleNow();
      }
    }
    screen = "manager";
    applyScreen();
  }

  function openProject(id, selectPath) {
    var p = findProject(id);
    if (!p) return;
    if (screen === "editor") {
      if (mode === "project" && project && project.id !== p.id) {
        project.files[currentFile] = src.value;
        saveProjectNow();
      } else if (mode !== "project") {
        singleSource = src.value;
        saveSingleNow();
      }
    }
    project = p;
    if (!project.files[project.entry]) project.entry = Object.keys(project.files).sort()[0];
    currentFile = selectPath && project.files[selectPath] != null ? selectPath : project.entry;
    src.value = project.files[currentFile];
    mode = "project";
    screen = "editor";
    projectsStore.activeId = project.id;
    project.updatedAt = Date.now();
    saveStore();
    applyScreen();
    applyModeUI();
    renderTree();
    render();
    clearOutput();
    src.focus();
  }

  function openSingle() {
    if (screen === "editor") {
      if (mode === "project" && project) {
        project.files[currentFile] = src.value;
        saveProjectNow();
      } else {
        singleSource = src.value;
        saveSingleNow();
      }
    }
    mode = "single";
    screen = "editor";
    src.value = singleSource || EXAMPLES.hello;
    singleSource = src.value;
    applyScreen();
    applyModeUI();
    render();
    clearOutput();
    src.focus();
  }

  function createProject() {
    if (!projectsStore) projectsStore = loadStore();
    var base = window.prompt(S.newProjectPrompt || "Project name", "project");
    if (base === null) return;
    base = String(base).trim();
    if (!base) {
      window.alert(S.badProjectName || "Give the project a name.");
      return;
    }
    base = base.slice(0, 48);
    var name = base;
    var i = 2;
    while (projectsStore.projects.some(function (p) { return p.name === name; })) {
      name = base + " " + (i++);
    }
    var p = makeProject(name);
    projectsStore.projects.push(p);
    projectsStore.activeId = p.id;
    saveStore();
    openProject(p.id);
  }

  function sanitizeImportName(name) {
    var base = String(name || "").split(/[\\/]/).pop();
    base = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
    if (!base || base === "." || base === "..") base = "file.txt";
    if (base.length > 120) {
      var dot = base.lastIndexOf(".");
      var ext = dot > 0 ? base.slice(dot).slice(0, 16) : "";
      base = base.slice(0, 120 - ext.length) + ext;
    }
    return base;
  }

  function uniqueImportPath(files, dir, name) {
    var parts = String(name || "").split("/").filter(Boolean);
    if (!parts.length) parts = ["file.txt"];
    parts = parts.map(sanitizeImportName);
    var base = parts.pop();
    var parent = parts.length ? parts.join("/") + "/" : "";
    var dot = base.lastIndexOf(".");
    var stem = dot > 0 ? base.slice(0, dot) : base;
    var ext = dot > 0 ? base.slice(dot) : "";
    var prefix = (dir ? dir + "/" : "") + parent;
    var path = prefix + base;
    var i = 2;
    while (files[path] != null) {
      path = prefix + stem + "-" + (i++) + ext;
    }
    return path;
  }

  function uniqueProjectName(base) {
    base = String(base || "imported").trim().slice(0, 48) || "imported";
    var name = base;
    var i = 2;
    while (projectsStore.projects.some(function (p) { return p.name === name; })) {
      name = base + " " + (i++);
    }
    return name;
  }

  function importProjectName(name) {
    var base = sanitizeImportName(name);
    var dot = base.lastIndexOf(".");
    return (dot > 0 ? base.slice(0, dot) : base) || "imported";
  }

  function decodeText(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      try { return new TextDecoder("utf-8").decode(bytes.subarray(3)); } catch (e) { return null; }
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      try { return new TextDecoder("utf-16le").decode(bytes.subarray(2)); } catch (e) { return null; }
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      try { return new TextDecoder("utf-16be").decode(bytes.subarray(2)); } catch (e) { return null; }
    }
    var limit = Math.min(bytes.length, 4096);
    for (var i = 0; i < limit; i++) {
      if (bytes[i] === 0) return null;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      try {
        return new TextDecoder("gb18030").decode(bytes);
      } catch (e2) {
        try { return new TextDecoder("windows-1252").decode(bytes); } catch (e3) { return null; }
      }
    }
  }

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > MAX_IMPORT_FILE) {
        reject(new Error("too large"));
        return;
      }
      file.arrayBuffer().then(function (buf) {
        var text = decodeText(new Uint8Array(buf));
        if (text === null) reject(new Error("not text"));
        else resolve(text);
      }).catch(reject);
    });
  }

  async function readSelectedFiles(selected) {
    var list = Array.prototype.slice.call(selected, 0, MAX_IMPORT_FILES);
    // Capture the directory-relative names before the input is reset; the
    // reset happens while the first file is being read.
    var meta = list.map(function (file) {
      return {
        file: file,
        name: file.name,
        relative: file.webkitRelativePath || "",
        size: file.size
      };
    });
    var skipped = Math.max(0, selected.length - list.length);
    var read = [];
    var total = 0;
    for (var i = 0; i < meta.length; i++) {
      var item = meta[i];
      if (total + item.size > MAX_IMPORT_TOTAL) {
        skipped++;
        continue;
      }
      try {
        var text = await readTextFile(item.file);
        total += item.size;
        read.push({ name: item.name, text: text, relative: item.relative });
      } catch (e) {
        skipped++;
      }
    }
    return { read: read, skipped: skipped };
  }

  async function importFiles(selected, target) {
    if (!selected || !selected.length) return;
    if (!projectsStore) projectsStore = loadStore();
    var got = await readSelectedFiles(selected);
    var read = got.read;
    var skipped = got.skipped;
    if (!read.length) {
      window.alert(S.importFailed || "Nothing was imported: the files are not text, or they are too large.");
      return;
    }

    var useProject = target === "project" && mode === "project" && project &&
      currentFile && project.files[currentFile] != null;
    var targetProject = project;
    var targetFile = currentFile;
    var cut = targetFile ? targetFile.lastIndexOf("/") : -1;
    var targetDir = cut > 0 ? targetFile.slice(0, cut) : "";

    if (useProject && project === targetProject) {
      targetProject.files[targetFile] = src.value;
      if (targetDir) addDir(targetDir);
      var firstPath = null;
      read.forEach(function (item) {
        var path = uniqueImportPath(targetProject.files, targetDir, item.name);
        targetProject.files[path] = item.text;
        if (!firstPath) firstPath = path;
      });
      currentFile = firstPath;
      src.value = targetProject.files[currentFile];
      saveProjectNow();
      renderTree();
      updateSourceHead();
      render();
      clearOutput();
      if (skipped) {
        window.alert((S.importSkipped || "{n} files were skipped.").replace("{n}", String(skipped)));
      }
      return;
    }

    var imported = {};
    var first = null;
    read.forEach(function (item) {
      var path = uniqueImportPath(imported, "src", item.name);
      imported[path] = item.text;
      if (!first) first = path;
    });
    var entry = imported["src/main.lomt"] ? "src/main.lomt" : null;
    if (!entry) {
      var candidates = Object.keys(imported).filter(function (p) {
        return /\.(lomt|lom)$/i.test(p) && /\bfn\s+(main|_start)\s*\(/.test(imported[p]);
      }).sort();
      if (candidates.length) entry = candidates[0];
    }
    if (!entry) {
      imported["src/main.lomt"] = STUB_MAIN;
      entry = "src/main.lomt";
    }
    var p = makeProject(uniqueProjectName(importProjectName(read[0].name)), imported);
    p.entry = entry;
    p.dirs = [];
    addDirTo(p, "src");
    Object.keys(imported).forEach(function (path) {
      var slash = path.lastIndexOf("/");
      if (slash > 0) addDirTo(p, path.slice(0, slash));
    });
    projectsStore.projects.push(p);
    projectsStore.activeId = p.id;
    saveStore();
    openProject(p.id, first);
    if (skipped) {
      window.alert((S.importSkipped || "{n} files were skipped.").replace("{n}", String(skipped)));
    }
  }

  async function importFolder(selected) {
    if (!selected || !selected.length) return;
    if (!projectsStore) projectsStore = loadStore();
    var got = await readSelectedFiles(selected);
    var read = got.read;
    var skipped = got.skipped;
    if (!read.length) {
      window.alert(S.importFailed || "Nothing was imported: the files are not text, or they are too large.");
      return;
    }

    var firstRelative = read[0].relative || "";
    var slash = firstRelative.indexOf("/");
    var root = slash > 0 ? firstRelative.slice(0, slash) : "";
    var imported = {};
    var firstPath = null;

    read.forEach(function (item) {
      var relative = item.relative || item.name;
      var parts = String(relative).split("/").filter(Boolean);
      if (root && parts[0] === root) parts.shift();
      if (!parts.length) {
        skipped++;
        return;
      }
      for (var i = 0; i < parts.length - 1; i++) {
        if (SKIP_DIRS[parts[i]]) {
          skipped++;
          return;
        }
      }
      var clean = parts.map(sanitizeImportName).join("/");
      var path = uniqueImportPath(imported, "", clean);
      imported[path] = item.text;
      if (!firstPath) firstPath = path;
    });

    if (!Object.keys(imported).length) {
      window.alert(S.importFailed || "Nothing was imported: the files are not text, or they are too large.");
      return;
    }

    var entry = imported["src/main.lomt"] ? "src/main.lomt"
      : (imported["main.lomt"] ? "main.lomt" : null);
    if (!entry) {
      var candidates = Object.keys(imported).filter(function (p) {
        return /\.(lomt|lom)$/i.test(p) && /\bfn\s+(main|_start)\s*\(/.test(imported[p]);
      }).sort();
      if (candidates.length) entry = candidates[0];
    }
    var addedStub = false;
    if (!entry) {
      imported["src/main.lomt"] = STUB_MAIN;
      entry = "src/main.lomt";
      addedStub = true;
    }

    var projectName = root || importProjectName(read[0].name);
    var p = makeProject(uniqueProjectName(projectName), imported);
    p.entry = entry;
    p.dirs = [];
    Object.keys(imported).forEach(function (path) {
      var cut = path.lastIndexOf("/");
      if (cut > 0) addDirTo(p, path.slice(0, cut));
    });
    projectsStore.projects.push(p);
    projectsStore.activeId = p.id;
    saveStore();

    var select = addedStub && firstPath && firstPath !== entry ? firstPath : entry;
    openProject(p.id, select);
    if (skipped) {
      window.alert((S.importSkipped || "Skipped files: {n}.").replace("{n}", String(skipped)));
    }
  }

  function pickFiles(target) {
    importTarget = target;
    if (!fileInput) return;
    fileInput.value = "";
    fileInput.click();
  }

  function pickFolder() {
    if (!folderInput) return;
    folderInput.value = "";
    folderInput.click();
  }

  function deleteProject(id) {
    var p = findProject(id);
    if (!p) return;
    if (!window.confirm((S.deleteProjectConfirm || "Delete this project?") + "\n" + p.name)) return;
    projectsStore.projects = projectsStore.projects.filter(function (x) { return x.id !== id; });
    if (projectsStore.activeId === id) projectsStore.activeId = null;
    if (project && project.id === id) {
      project = null;
      currentFile = null;
      mode = "single";
    }
    saveStore();
    renderManager();
  }

  function setMode(next, sourceOverride) {
    if (next !== "project") next = "single";
    if (next === mode) return;
    if (!projectsStore) projectsStore = loadStore();
    if (screen !== "editor") {
      screen = "editor";
      applyScreen();
    }
    if (mode === "single") {
      singleSource = src.value;
      saveSingleNow();
    }
    if (next === "project") {
      if (currentLang !== "loment") {
        drafts[currentLang] = src.value;
        langEl.value = "loment";
        syncLanguage("loment");
        singleSource = drafts.loment || starter("main");
      }
      if (!project) {
        var active = findProject(projectsStore.activeId);
        if (!active && projectsStore.projects.length) active = projectsStore.projects[0];
        if (!active) {
          active = makeProject("src");
          if (currentLang === "loment" && singleSource && singleSource !== EXAMPLES.hello) {
            active.files["src/main.lomt"] = singleSource;
          }
          projectsStore.projects.push(active);
        }
        project = active;
        projectsStore.activeId = active.id;
        saveStore();
      }
      currentFile = project.entry;
      src.value = project.files[currentFile];
    } else {
      if (project) {
        project.files[currentFile] = src.value;
        saveProjectNow();
      }
      if (sourceOverride != null) singleSource = sourceOverride;
      src.value = singleSource;
    }
    mode = next;
    applyModeUI();
    if (mode === "project") renderTree();
    render();
    clearOutput();
    src.focus();
  }

  function selectFile(path) {
    if (mode !== "project" || !project || !project.files.hasOwnProperty(path)) return;
    if (path === currentFile) return;
    project.files[currentFile] = src.value;
    currentFile = path;
    src.value = project.files[path];
    saveProjectNow();
    renderTree();
    updateSourceHead();
    render();
    clearOutput();
    src.focus();
  }

  function setEntry(path) {
    if (mode !== "project" || !project || !project.files.hasOwnProperty(path)) return;
    project.entry = path;
    saveProjectNow();
    renderTree();
    clearOutput();
  }

  function deleteFile(path) {
    if (mode !== "project" || !project || !project.files.hasOwnProperty(path)) return;
    var keys = Object.keys(project.files);
    if (keys.length <= 1) {
      window.alert(S.lastFile || "A project needs at least one file.");
      return;
    }
    if (!window.confirm((S.deleteConfirm || "Delete this file?") + "\n" + path)) return;
    delete project.files[path];
    if (project.entry === path) {
      project.entry = Object.keys(project.files).sort()[0];
    }
    if (currentFile === path) {
      currentFile = project.entry;
      src.value = project.files[currentFile];
    }
    saveProjectNow();
    renderTree();
    updateSourceHead();
    render();
    clearOutput();
  }

  function addFile() {
    if (mode !== "project" || !project) return;
    var cut = currentFile.lastIndexOf("/");
    var near = cut > 0 ? currentFile.slice(0, cut + 1) : "";
    var suggested = near + "lib.lomt";
    var i = 1;
    while (project.files[suggested] || project.dirs.indexOf(suggested) >= 0) {
      suggested = near + "lib" + (i++) + ".lomt";
    }
    var entered = window.prompt(S.newFilePrompt || "New file path", suggested);
    if (entered === null) return;
    var path = normalizePath(entered);
    if (!path) {
      window.alert(S.badFile || "Use a relative path ending in .lomt or .lom.");
      return;
    }
    if (project.files[path]) {
      window.alert(S.existsFile || "That file already exists.");
      selectFile(path);
      return;
    }
    if (project.dirs.indexOf(path) >= 0) {
      window.alert(S.existsFolder || "That folder already exists.");
      return;
    }
    project.files[currentFile] = src.value;
    project.files[path] = moduleStarter(path);
    var cut = path.lastIndexOf("/");
    if (cut > 0) addDir(path.slice(0, cut));
    currentFile = path;
    src.value = project.files[path];
    saveProjectNow();
    renderTree();
    updateSourceHead();
    render();
    clearOutput();
    src.focus();
  }

  function addFolder() {
    if (mode !== "project" || !project) return;
    var cut = currentFile.lastIndexOf("/");
    var near = cut > 0 ? currentFile.slice(0, cut + 1) : "";
    var suggested = near + "core";
    var i = 1;
    while (project.dirs.indexOf(suggested) >= 0) suggested = near + "core" + (i++);
    var entered = window.prompt(S.newFolderPrompt || "New folder path", suggested);
    if (entered === null) return;
    var path = normalizeDir(entered);
    if (!path) {
      window.alert(S.badFolder || "Use a relative folder path.");
      return;
    }
    if (project.dirs.indexOf(path) >= 0 || project.files[path]) {
      window.alert(project.files[path]
        ? (S.existsFile || "That file already exists.")
        : (S.existsFolder || "That folder already exists."));
      return;
    }
    addDir(path);
    saveProjectNow();
    renderTree();
    clearOutput();
  }

  function deleteDir(path) {
    if (mode !== "project" || !project) return;
    var under = Object.keys(project.files).filter(function (p) {
      return p.indexOf(path + "/") === 0;
    });
    if (Object.keys(project.files).length - under.length < 1) {
      window.alert(S.lastFile || "A project needs at least one file.");
      return;
    }
    if (!window.confirm((S.deleteFolderConfirm || "Delete this folder and everything inside it?") + "\n" + path)) return;
    under.forEach(function (p) { delete project.files[p]; });
    project.dirs = (project.dirs || []).filter(function (d) {
      return d !== path && d.indexOf(path + "/") !== 0;
    });
    if (project.entry.indexOf(path + "/") === 0 || project.entry === path) {
      project.entry = Object.keys(project.files).sort()[0];
    }
    if (currentFile === path || currentFile.indexOf(path + "/") === 0) {
      currentFile = project.entry;
      src.value = project.files[currentFile];
    }
    saveProjectNow();
    renderTree();
    updateSourceHead();
    render();
    clearOutput();
  }

  function moveEntry(targetDir) {
    if (!dragState || !project) return;
    var kind = dragState.kind;
    var path = dragState.path;
    var base = path.split("/").pop();
    if (kind === "file") {
      var newPath = targetDir ? targetDir + "/" + base : base;
      if (newPath === path) return;
      if (project.files[newPath]) {
        window.alert(S.existsFile || "That file already exists.");
        return;
      }
      if (project.dirs.indexOf(newPath) >= 0) {
        window.alert(S.existsFolder || "That folder already exists.");
        return;
      }
      var files = {};
      Object.keys(project.files).forEach(function (p) {
        if (p !== path) files[p] = project.files[p];
      });
      files[newPath] = project.files[path];
      project.files = files;
      if (targetDir) addDir(targetDir);
      if (project.entry === path) project.entry = newPath;
      if (currentFile === path) currentFile = newPath;
    } else if (kind === "dir") {
      if (targetDir === path) return;
      var newDir = targetDir ? targetDir + "/" + base : base;
      if (newDir === path) return;
      if (newDir.indexOf(path + "/") === 0) {
        window.alert(S.badMove || "A folder cannot move inside itself.");
        return;
      }
      if (project.dirs.indexOf(newDir) >= 0 || project.files[newDir]) {
        window.alert(S.existsFolder || "That folder already exists.");
        return;
      }
      var nextFiles = {};
      Object.keys(project.files).forEach(function (p) {
        if (p === path || p.indexOf(path + "/") === 0) {
          nextFiles[newDir + p.slice(path.length)] = project.files[p];
        } else {
          nextFiles[p] = project.files[p];
        }
      });
      project.files = nextFiles;
      var nextDirs = [];
      (project.dirs || []).forEach(function (d) {
        if (d === path || d.indexOf(path + "/") === 0) {
          nextDirs.push(newDir + d.slice(path.length));
        } else {
          nextDirs.push(d);
        }
      });
      project.dirs = nextDirs;
      addDir(newDir);
      if (targetDir) addDir(targetDir);
      if (project.entry === path || project.entry.indexOf(path + "/") === 0) {
        project.entry = newDir + project.entry.slice(path.length);
      }
      if (currentFile === path || currentFile.indexOf(path + "/") === 0) {
        currentFile = newDir + currentFile.slice(path.length);
      }
    } else {
      return;
    }
    dedupeDirs();
    dragState = null;
    saveProjectNow();
    renderTree();
    updateSourceHead();
    render();
    clearOutput();
  }

  src.addEventListener("input", function () {
    render();
    if (mode === "project") {
      project.files[currentFile] = src.value;
      scheduleProjectSave();
    } else {
      singleSource = src.value;
      scheduleSingleSave();
    }
    // Editing invalidates the last run. Without this, a successful exit/output
    // from the previous source stays visible and makes a broken edit look OK.
    if (statusEl.textContent !== S.ready) clearOutput();
  });
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

  langEl.addEventListener("change", function (e) {
    var next = e.target.value;
    var fromProject = mode === "project";
    if (fromProject) {
      project.files[currentFile] = src.value;
      drafts.loment = src.value;
      saveProjectNow();
      setMode("single", src.value);
    } else {
      drafts[currentLang] = src.value;
    }
    syncLanguage(next);
    src.value = drafts[next] || langStarter(next, programName());
    if (mode === "single") {
      singleSource = src.value;
      scheduleSingleSave();
    }
    render();
    clearOutput();
  });

  exampleEl.addEventListener("change", function (e) {
    if (mode === "project") setMode("single");
    if (currentLang !== "loment") {
      drafts[currentLang] = src.value;
      langEl.value = "loment";
      syncLanguage("loment");
    }
    src.value = EXAMPLES[e.target.value] || EXAMPLES.hello;
    if (mode === "single") {
      singleSource = src.value;
      scheduleSingleSave();
    }
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
    if (mode === "project" && project) {
      project.files[currentFile] = src.value;
      saveProjectNow();
    } else {
      singleSource = src.value;
      saveSingleNow();
    }
    try {
      sessionStorage.setItem("pg-src", singleSource);
      sessionStorage.setItem("pg-lang", langEl.value);
    } catch (e) { /* ignore */ }
    var u = new URL(window.location.href);
    u.searchParams.set("channel", channelEl.value);
    window.location.href = u.toString();
  });

  document.getElementById("pg-new").addEventListener("click", function () {
    if (mode === "project") {
      addFile();
      return;
    }
    var entered = window.prompt(S.newPrompt || "Name for the new program", programName());
    if (entered === null) return;
    nameEl.value = entered;
    nameEl.value = programName();
    src.value = langStarter(currentLang, nameEl.value);
    singleSource = src.value;
    scheduleSingleSave();
    render();
    clearOutput();
    src.focus();
  });

  nameEl.addEventListener("blur", function () { nameEl.value = programName(); });

  document.getElementById("pg-download").addEventListener("click", function () {
    var text;
    var filename;
    if (mode === "project") {
      project.files[currentFile] = src.value;
      text = src.value;
      filename = currentFile.split("/").pop();
    } else {
      text = src.value;
      filename = programName() + ".lomt";
    }
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  document.getElementById("pg-add-file").addEventListener("click", addFile);
  document.getElementById("pg-add-folder").addEventListener("click", addFolder);
  document.getElementById("pg-projects").addEventListener("click", openManager);
  document.getElementById("pg-manager-new").addEventListener("click", createProject);
  document.getElementById("pg-manager-single").addEventListener("click", openSingle);
  document.getElementById("pg-manager-import").addEventListener("click", function () { pickFiles("manager"); });
  document.getElementById("pg-manager-folder").addEventListener("click", pickFolder);
  document.getElementById("pg-tree-import").addEventListener("click", function () { pickFiles("project"); });
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var files = fileInput.files;
      var target = importTarget || (screen === "manager" ? "manager" : "project");
      importTarget = null;
      if (files && files.length) importFiles(files, target);
      fileInput.value = "";
    });
  }
  if (folderInput) {
    folderInput.addEventListener("change", function () {
      var files = folderInput.files;
      if (files && files.length) importFolder(files);
      folderInput.value = "";
    });
  }

  managerList.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("button") : null;
    if (!btn) return;
    if (btn.dataset.openProject) {
      openProject(btn.dataset.openProject);
    } else if (btn.dataset.deleteProject) {
      deleteProject(btn.dataset.deleteProject);
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll(".pg-mode"), function (btn) {
    btn.addEventListener("click", function () { setMode(btn.dataset.mode); });
  });

  function clearDropMarks() {
    treeList.classList.remove("drag-over");
    Array.prototype.forEach.call(treeList.querySelectorAll(".drag-over"), function (el) {
      el.classList.remove("drag-over");
    });
  }

  function clearDragMarks() {
    Array.prototype.forEach.call(treeList.querySelectorAll(".is-dragging"), function (el) {
      el.classList.remove("is-dragging");
    });
  }

  treeList.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("button") : null;
    if (!btn) return;
    if (btn.dataset.file) {
      selectFile(btn.dataset.file);
    } else if (btn.dataset.entry) {
      e.preventDefault();
      setEntry(btn.dataset.entry);
    } else if (btn.dataset.delete) {
      e.preventDefault();
      deleteFile(btn.dataset.delete);
    } else if (btn.dataset.deleteDir) {
      e.preventDefault();
      deleteDir(btn.dataset.deleteDir);
    }
  });

  treeList.addEventListener("dragstart", function (e) {
    var label = e.target.closest ? e.target.closest(".pg-dir-name") : null;
    var file = e.target.closest ? e.target.closest(".pg-file-btn") : null;
    if (label) {
      dragState = { kind: "dir", path: label.dataset.dir };
    } else if (file) {
      dragState = { kind: "file", path: file.dataset.file };
    } else {
      return;
    }
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragState.path); } catch (err) { /* ignore */ }
    }
    var row = e.target.closest ? e.target.closest(".pg-file-row, .pg-tree-dir") : null;
    if (row) row.classList.add("is-dragging");
  });

  treeList.addEventListener("dragover", function (e) {
    if (!dragState) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDropMarks();
    var dirRow = e.target.closest ? e.target.closest(".pg-tree-dir") : null;
    if (dirRow) {
      dirRow.classList.add("drag-over");
    } else {
      treeList.classList.add("drag-over");
    }
  });

  treeList.addEventListener("dragleave", function (e) {
    if (!dragState) return;
    if (!e.relatedTarget || !treeList.contains(e.relatedTarget)) clearDropMarks();
  });

  treeList.addEventListener("drop", function (e) {
    if (!dragState) return;
    e.preventDefault();
    var dirRow = e.target.closest ? e.target.closest(".pg-tree-dir") : null;
    var targetDir = dirRow ? dirRow.dataset.dir : "";
    clearDropMarks();
    clearDragMarks();
    moveEntry(targetDir);
  });

  treeList.addEventListener("dragend", function () {
    dragState = null;
    clearDropMarks();
    clearDragMarks();
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
          "def run_text(text, action, edition, target, name, language, files_json):",
          "    return pg_runner.run_text(text, action, edition, target, name, language, files_json)"
        ].join("\n")).then(function () { return py; });
    });
  }

  function run(useCurrent) {
    var action = actionEl.value;
    var edition = editionEl.value;
    var target = targetEl.value;
    var language = langEl.value;
    var text;
    var runName;
    var filesJson = "";

    if (mode === "project") {
      project.files[currentFile] = src.value;
      var entryPath = useCurrent && currentFile ? currentFile : project.entry;
      var entryText = project.files[entryPath];
      if (typeof entryText !== "string") {
        errEl.textContent = "entry file is missing: " + entryPath;
        errBlock.hidden = false;
        setStatus(S.error, true);
        return;
      }
      updateOutputTarget(useCurrent && currentFile === entryPath);
      text = entryText;
      runName = safeName(fileStem(entryPath));
      language = "loment";
      var siblings = {};
      Object.keys(project.files).forEach(function (path) {
        if (path !== entryPath) siblings[path] = project.files[path];
      });
      filesJson = JSON.stringify(siblings);
      saveProjectNow();
    } else {
      var m = src.value.match(/^\s*module\s+([A-Za-z_][A-Za-z0-9_]*)/m);
      if (m) nameEl.value = m[1];
      text = src.value;
      runName = programName();
    }

    var t0 = performance.now();
    runBtn.disabled = true;
    errBlock.hidden = true;
    outEl.textContent = "";
    linksEl.textContent = "";
    exitEl.textContent = "—";
    elapsedEl.textContent = "";
    var promise = pyPromise || (pyPromise = boot());
    promise.then(function (py) {
      setStatus(S.compiling);
      var fn = py.globals.get("run_text");
      var res = fn(text, action, edition, target, runName, language, filesJson);
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
      var failed = d.rc !== 0 && !!d.err;
      setStatus(failed ? S.finishedErrors : S.finished, failed);
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
  window.addEventListener("pagehide", function () {
    if (screen !== "editor") return;
    if (mode === "project" && project) {
      project.files[currentFile] = src.value;
      saveProjectNow();
    } else {
      singleSource = src.value;
      saveSingleNow();
    }
  });
  runBtn.addEventListener("click", function () { run(false); });
  if (runFileBtn) {
    runFileBtn.addEventListener("click", function () { run(true); });
  }
  channelEl.value = CHANNEL;

  var saved = null;
  var savedLang = "loment";
  try {
    saved = sessionStorage.getItem("pg-src");
    savedLang = sessionStorage.getItem("pg-lang") || "loment";
  } catch (e) { /* ignore */ }
  if (!saved) {
    try { saved = localStorage.getItem(SINGLE_KEY); } catch (e) { /* ignore */ }
  }
  if (savedLang !== "loment" && langEl.querySelector('option[value="' + savedLang + '"]')) {
    langEl.value = savedLang;
  }
  syncLanguage(langEl.value);
  singleSource = saved || (langEl.value === "loment" ? EXAMPLES.hello : langStarter(langEl.value, "main"));
  if (saved) { try { sessionStorage.removeItem("pg-src"); } catch (e) { /* ignore */ } }
  if (saved) { try { sessionStorage.removeItem("pg-lang"); } catch (e) { /* ignore */ } }

  projectsStore = loadStore();
  project = null;
  currentFile = null;
  mode = "single";
  screen = "manager";
  src.value = singleSource;
  applyScreen();
  applyModeUI();
  render();
  syncAction();
})();
