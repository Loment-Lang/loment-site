(() => {
  "use strict";

  const API =
    "https://api.github.com/repos/Loment-Lang/loment/pulls" +
    "?state=closed&sort=updated&direction=desc&per_page=100";
  const REFRESH_MS = 5 * 60 * 1000;
  const FEED = 12;

  const DICT = {
    en: {
      loading: "Reading the repository…",
      completed: "Completed",
      notMerged: "Not merged yet",
      checked: "Checked",
      rate: "GitHub's anonymous request limit was reached.",
      retry: "Try again after",
      error: "GitHub did not answer.",
      other: "Other work",
      milestone: "Milestone",
      noData: "No merged pull requests in the window."
    },
    "zh-Hans": {
      loading: "正在读取仓库……",
      completed: "已完成",
      notMerged: "尚未合并",
      checked: "检查于",
      rate: "GitHub 的匿名请求额度已用完。",
      retry: "请在以下时间后重试",
      error: "GitHub 没有响应。",
      other: "其他工作",
      milestone: "里程碑",
      noData: "抓取窗口里没有已合并的 PR。"
    },
    ja: {
      loading: "リポジトリを読み込んでいます…",
      completed: "完了",
      notMerged: "まだマージされていない",
      checked: "確認",
      rate: "GitHub の匿名リクエスト上限に達しました。",
      retry: "次の時刻以降に再試行してください",
      error: "GitHub が応答しませんでした。",
      other: "その他の作業",
      milestone: "マイルストーン",
      noData: "取得範囲にマージ済みの PR はありません。"
    },
    ru: {
      loading: "Читаю репозиторий…",
      completed: "Завершено",
      notMerged: "Ещё не влито",
      checked: "Проверено",
      rate: "Достигнут анонимный лимит запросов GitHub.",
      retry: "Попробуйте после",
      error: "GitHub не ответил.",
      other: "Прочая работа",
      milestone: "Веха",
      noData: "В загруженном окне нет влитых pull request'ов."
    },
    es: {
      loading: "Leyendo el repositorio…",
      completed: "Completado",
      notMerged: "Aún sin fusionar",
      checked: "Comprobado",
      rate: "Se alcanzó el límite anónimo de peticiones de GitHub.",
      retry: "Vuelve a intentarlo después de",
      error: "GitHub no respondió.",
      other: "Otro trabajo",
      milestone: "Hito",
      noData: "No hay pull requests fusionados en la ventana."
    }
  };

  const LOCALES = {
    en: "en-GB",
    "zh-Hans": "zh-CN",
    ja: "ja-JP",
    ru: "ru-RU",
    es: "es-ES"
  };

  const FEATURES = [
    { name: "LVM-A and the time bridge", pr: 2127, re: /LVM-A|choose lvm|substrate/i },
    { name: "LNotary artifact auditor", pr: 2126, re: /LNotary/i },
    { name: "Hot update: the whole toolchain", pr: 2128, re: /hot update|hot-update|updater/i },
    { name: "Block scoping in tur2027.1Alpha", pr: 1887, re: /block scop/i },
    { name: "Self-hosted classes (C4a)", pr: 1863, re: /C4a|self-hosted non-virtual classes/i },
    { name: "Flomtc v1", pr: 1794, re: /Flomtc/i },
    { name: "Dissigsegv design", pr: 1796, re: /Dissigsegv/i },
    { name: "Borrows B2+B3", pr: 1769, re: /Borrows? B[23]|B2\+B3/i },
    { name: "Top severities cleared", pr: 1692, re: /sev-0|sev-1|severit/i },
    { name: "Effects A3b: captures and abort", pr: 1654, re: /Effects A3b/i },
    { name: "Borrows B1", pr: 1651, re: /Borrows? B1/i },
    { name: "Domains: sibling edges", pr: 1649, re: /sibling edges/i },
    { name: "Classes C1–C3", pr: 1645, re: /Classes C2\/C3|Classes C1|LSPE C1/i },
    { name: "LSPE framework V0–V3", pr: 1644, re: /LSPE framework/i },
    { name: "Semantics oracle", pr: 1637, re: /semantics oracle|source-level oracle/i },
    { name: "Effects, first runtime slice", pr: 1640, re: /Effects A3a|tail-resumptive/i },
    { name: "Function values and closures", pr: 1629, re: /function pointers|closures|dimension `fp`/i }
  ];

  const lang = document.documentElement.lang || "en";
  const t = DICT[lang] || DICT.en;
  const fmt = new Intl.DateTimeFormat(LOCALES[lang] || "en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short"
  });

  const milestonesEl = document.getElementById("milestones");
  const mergesEl = document.getElementById("merges");
  const stampEl = document.getElementById("stamp");
  const refreshEl = document.getElementById("refresh");

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function timeNode(iso) {
    const d = new Date(iso);
    const tm = el("time", null, fmt.format(d));
    tm.dateTime = iso;
    tm.style.fontFamily = "var(--mono)";
    return tm;
  }

  function prLink(pr, label) {
    const a = el("a", null, label || `#${pr.number} ${pr.title}`);
    a.href = pr.html_url;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  function line(parts) {
    const p = el("p");
    parts.forEach((part, i) => {
      if (i > 0) p.append(document.createTextNode(" · "));
      p.append(part);
    });
    return p;
  }

  function featureOf(pr) {
    const pinned = FEATURES.find(f => f.pr === pr.number);
    if (pinned) return pinned.name;
    const matched = FEATURES.find(f => f.re && f.re.test(pr.title));
    return matched ? matched.name : t.other;
  }

  function render(merged) {
    const byNumber = new Map(merged.map(pr => [pr.number, pr]));

    milestonesEl.replaceChildren();
    for (const f of FEATURES) {
      const pr = byNumber.get(f.pr);
      const row = el("div", "row");
      row.append(el("h3", null, f.name));
      const body = el("div");
      if (pr) {
        body.append(line([
          document.createTextNode(`${t.completed} `),
          timeNode(pr.merged_at),
          prLink(pr, `#${pr.number} ${pr.title}`)
        ]));
      } else {
        const a = el("a", null, `PR #${f.pr}`);
        a.href = `https://github.com/Loment-Lang/loment/pull/${f.pr}`;
        a.target = "_blank";
        a.rel = "noopener";
        body.append(line([document.createTextNode(`${t.notMerged} `), a]));
      }
      row.append(body);
      milestonesEl.append(row);
    }

    mergesEl.replaceChildren();
    if (!merged.length) {
      mergesEl.append(el("p", "body", t.noData));
    }
    for (const pr of merged.slice(0, FEED)) {
      const row = el("div", "row");
      const head = el("h3");
      head.append(timeNode(pr.merged_at));
      row.append(head);
      const body = el("div");
      const titleP = el("p");
      titleP.append(prLink(pr));
      body.append(titleP);
      body.append(line([
        document.createTextNode(`${t.milestone} `),
        document.createTextNode(featureOf(pr))
      ]));
      row.append(body);
      mergesEl.append(row);
    }

    const now = new Date();
    stampEl.textContent = `${t.checked} ${new Intl.DateTimeFormat(
      LOCALES[lang] || "en-GB",
      { hour: "2-digit", minute: "2-digit" }
    ).format(now)}`;
  }

  function fail(message) {
    milestonesEl.replaceChildren(el("p", "body", message));
    mergesEl.replaceChildren();
    stampEl.textContent = "";
  }

  async function load() {
    if (!milestonesEl.dataset.loaded) {
      milestonesEl.replaceChildren(el("p", "body", t.loading));
    }
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) {
        const reset = res.headers.get("X-RateLimit-Reset");
        if (res.status === 403 && reset) {
          const when = fmt.format(new Date(Number(reset) * 1000));
          return fail(`${t.rate} ${t.retry} ${when}.`);
        }
        return fail(`${t.error} (HTTP ${res.status})`);
      }
      const rows = await res.json();
      const merged = rows
        .filter(pr => pr.merged_at)
        .sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at));
      milestonesEl.dataset.loaded = "1";
      render(merged);
    } catch (err) {
      fail(t.error);
    }
  }

  refreshEl.addEventListener("click", ev => {
    ev.preventDefault();
    load();
  });
  load();
  setInterval(load, REFRESH_MS);
})();
