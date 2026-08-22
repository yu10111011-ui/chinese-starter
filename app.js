(() => {
  const STORAGE_KEY = "chinese-starter-progress-v1";
  const view = document.getElementById("view");
  const progressChip = document.getElementById("progressChip");
  const navButtons = [...document.querySelectorAll("[data-nav]")];

  const state = {
    route: "home",
    lessonId: null,
    cardIndex: 0,
    cardFlipped: false,
    cardFilter: "all",
    greetRegion: "すべて",
    quizIndex: 0,
    quizScore: 0,
    quizAnswered: false,
    quizChoices: [],
    quizPool: [],
  };

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { lessons: {}, quizzes: 0 };
    } catch {
      return { lessons: {}, quizzes: 0 };
    }
  }

  function saveProgress(progress) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    updateProgressChip();
  }

  function markLessonDone(id) {
    const progress = loadProgress();
    progress.lessons[id] = true;
    saveProgress(progress);
  }

  function isLessonDone(id) {
    return !!loadProgress().lessons[id];
  }

  function updateProgressChip() {
    const total = COURSE.lessons.length;
    const done = COURSE.lessons.filter((l) => isLessonDone(l.id)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressChip.textContent = `${pct}%`;
  }

  let cachedVoices = [];
  const preferredVoiceByLang = Object.create(null);
  let ttsAudio = null;
  const voiceWarningShown = Object.create(null);

  function refreshVoices() {
    if (!window.speechSynthesis) return;
    cachedVoices = window.speechSynthesis.getVoices() || [];
  }

  function normalizeLang(code) {
    return String(code || "zh-CN").replace(/_/g, "-");
  }

  function langPrefix(code) {
    return normalizeLang(code).split("-")[0].toLowerCase();
  }

  function scoreVoiceForLang(voice, wantedLang) {
    const wanted = normalizeLang(wantedLang).toLowerCase();
    const wantedPrefix = langPrefix(wanted);
    const lang = (voice.lang || "").replace(/_/g, "-").toLowerCase();
    const name = (voice.name || "").toLowerCase();
    const blob = `${lang} ${name}`;
    const voicePrefix = lang.split("-")[0];

    // Never use Japanese for non-Japanese text (漢字を日本語読みしてしまう)。
    if (wantedPrefix !== "ja" && (/^ja\b|japanese|日本語|ヒラギノ|haruka|ayumi|ichiro|kyoko/.test(blob))) {
      return -1000;
    }

    let score = 0;
    if (lang === wanted) score += 100;
    else if (lang.startsWith(wanted)) score += 90;
    else if (voicePrefix === wantedPrefix) score += 70;
    else if (blob.includes(wantedPrefix)) score += 40;
    else return -1;

    if (wantedPrefix === "zh") {
      if (/yaoyao|huihui|xiaoxiao|yunxi|yunyang|simplified|普通话|中国|zh-cn/.test(blob)) score += 30;
      if (/taiwan|zh-tw|hk|cantonese|粤|yue/.test(blob)) score -= 20;
    }
    if (voice.localService) score += 5;
    return score;
  }

  function pickVoiceForLang(voices, wantedLang) {
    let best = null;
    let bestScore = 0;
    for (const voice of voices) {
      const score = scoreVoiceForLang(voice, wantedLang);
      if (score > bestScore) {
        best = voice;
        bestScore = score;
      }
    }
    return best;
  }

  function showVoiceToast(message) {
    let el = document.getElementById("ttsToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ttsToast";
      el.className = "tts-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.hidden = false;
    clearTimeout(showVoiceToast._timer);
    showVoiceToast._timer = setTimeout(() => {
      el.hidden = true;
    }, 5200);
  }

  function stopAudio() {
    if (!ttsAudio) return;
    try {
      ttsAudio.pause();
      ttsAudio.removeAttribute("src");
      ttsAudio.load();
    } catch {
      /* ignore */
    }
    ttsAudio = null;
  }

  function onlineTtsCandidates(text, langCode) {
    const tl = normalizeLang(langCode);
    const prefix = langPrefix(tl);
    const q = encodeURIComponent(text);
    const list = [];

    // Chinese: Youdao is more reliable than Google from github.io.
    if (prefix === "zh") {
      list.push(`https://dict.youdao.com/dictvoice?audio=${q}&le=zh`);
      list.push(`https://dict.youdao.com/dictvoice?audio=${q}&type=0`);
    }

    // Google Translate TTS (needs referrerPolicy=no-referrer).
    list.push(
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(tl)}&q=${q}`
    );
    if (tl.includes("-")) {
      list.push(
        `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(prefix)}&q=${q}`
      );
    }
    return list;
  }

  function playAudioUrl(url) {
    return new Promise((resolve, reject) => {
      stopAudio();
      const audio = new Audio();
      ttsAudio = audio;
      audio.preload = "auto";
      audio.referrerPolicy = "no-referrer";
      let settled = false;
      const ok = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const fail = (err) => {
        if (!settled) {
          settled = true;
          reject(err || new Error("audio failed"));
        }
      };
      audio.onerror = () => fail(new Error("audio error"));
      audio.src = url;
      const playResult = audio.play();
      if (playResult && typeof playResult.then === "function") {
        playResult.then(ok).catch(fail);
      } else {
        ok();
      }
    });
  }

  async function speakOnlineFallback(text, langCode) {
    const urls = onlineTtsCandidates(text, langCode);
    let lastError = null;
    for (const url of urls) {
      try {
        await playAudioUrl(url);
        return true;
      } catch (err) {
        lastError = err;
      }
    }
    showVoiceToast(
      `音声を再生できませんでした（${normalizeLang(langCode)}）。もう一度押すか、Edge/Chromeで開き直してください。`
    );
    console.warn("TTS online fallback failed", lastError);
    return false;
  }

  function speakWithVoice(text, voice, langCode) {
    if (!window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    // Chrome can drop utterances if speak() is called immediately after cancel().
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = voice?.lang || normalizeLang(langCode);
    if (voice) utter.voice = voice;
    utter.rate = 0.9;
    utter.onerror = () => {
      speakOnlineFallback(text, langCode);
    };
    setTimeout(() => {
      try {
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utter);
      } catch {
        speakOnlineFallback(text, langCode);
      }
    }, 40);
    return true;
  }

  function localAudioUrl(text, langCode) {
    const prefix = langPrefix(langCode);
    const pack = (window.AUDIO_MANIFEST && window.AUDIO_MANIFEST[prefix]) || null;
    if (!pack) return null;
    const rel = pack[text];
    if (!rel) return null;
    // Same-origin relative URL (Brave-safe; not blocked by third-party shields).
    return rel;
  }

  // Keep this synchronous enough for autoplay policies: do not await before first play().
  function speak(text, langCode = "zh-CN") {
    if (!text) return;
    const wanted = normalizeLang(langCode);

    // Prefer bundled same-origin MP3 (works in Brave with shields up).
    const localUrl = localAudioUrl(text, wanted);
    if (localUrl) {
      playAudioUrl(localUrl).catch(() => {
        // Fall through to OS / online if local file missing on older deploy.
        speakWithoutLocal(text, wanted);
      });
      return;
    }

    speakWithoutLocal(text, wanted);
  }

  function speakWithoutLocal(text, wanted) {
    refreshVoices();

    const cached = preferredVoiceByLang[wanted];
    const voice = cached || pickVoiceForLang(cachedVoices, wanted);
    if (voice) preferredVoiceByLang[wanted] = voice;

    if (voice) {
      speakWithVoice(text, voice, wanted);
      return;
    }

    if (!voiceWarningShown[wanted]) {
      voiceWarningShown[wanted] = true;
      const braveHint = /brave/i.test(navigator.userAgent || "")
        ? " Braveのシールドが外部音声を遮断している場合があります。"
        : "";
      showVoiceToast(
        `端末に「${wanted}」ボイスがないため、オンライン発音を試します。${braveHint}`
      );
    }
    speakOnlineFallback(text, wanted);
  }

  function setRoute(route, lessonId = null) {
    state.route = route;
    state.lessonId = lessonId;
    navButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === route || (route === "lesson" && btn.dataset.nav === "lessons"));
    });
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function allItems(filterLessonId = "all") {
    const lessons =
      filterLessonId === "all"
        ? COURSE.lessons
        : COURSE.lessons.filter((l) => l.id === filterLessonId);
    return lessons.flatMap((lesson) =>
      lesson.items.map((item) => ({ ...item, lessonId: lesson.id, lessonTitle: lesson.title }))
    );
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderHome() {
    const done = COURSE.lessons.filter((l) => isLessonDone(l.id)).length;
    const totalItems = allItems().length;
    view.innerHTML = `
      <section class="hero">
        <div>
          <div class="eyebrow">简体中文 · Beginner</div>
          <h1>声調から始める、<br />毎日10分の中国語。</h1>
          <p>
            日本語話者向けの簡体字入門教材です。ピンイン・例文・音声（ブラウザ読み上げ）・
            フラッシュカード・クイズまで、このページだけで完結します。
          </p>
          <div class="hero-actions">
            <button class="btn btn-primary" data-go="lessons">レッスンを始める</button>
            <button class="btn btn-secondary" data-go="greetings">世界の挨拶</button>
            <button class="btn btn-ghost" data-go="tones">声調を見る</button>
          </div>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="label">レッスン</div><div class="value">${COURSE.lessons.length}</div></div>
          <div class="stat"><div class="label">語句・フレーズ</div><div class="value">${totalItems}</div></div>
          <div class="stat"><div class="label">完了レッスン</div><div class="value">${done} / ${COURSE.lessons.length}</div></div>
        </div>
      </section>

      <section class="panel" style="margin-top:18px;">
        <h2 style="margin:0 0 8px;font-size:1.15rem;">多言語を勉強するなら、何から？</h2>
        <ol class="start-list">
          ${(WORLD_GREETINGS?.howToStart || [])
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("")}
        </ol>
        <p style="color:var(--muted);margin:10px 0 0;line-height:1.6;">
          いまの軸は中国語。寄り道するなら <strong>世界の挨拶</strong> で音と文字に触れてから戻るのがおすすめです。
          中国語の🔊はアプリ内音声なので、Braveでもそのまま鳴ります。
        </p>
      </section>

      <div class="section-head">
        <div>
          <h2>コース一覧</h2>
          <p>上から順に進むのがおすすめ。気になる単元から入ってもOK。</p>
        </div>
      </div>
      <div class="grid-3">
        ${COURSE.lessons
          .map((lesson, i) => {
            const doneFlag = isLessonDone(lesson.id);
            return `
              <button class="lesson-card" data-open-lesson="${lesson.id}">
                <div class="meta">
                  <span>Lesson ${i + 1}</span>
                  <span class="badge ${doneFlag ? "badge-done" : "badge-todo"}">${doneFlag ? "完了" : "未完了"}</span>
                </div>
                <div class="hanzi-preview">${escapeHtml(lesson.preview)}</div>
                <h3>${escapeHtml(lesson.title)}</h3>
                <p>${escapeHtml(lesson.summary)}</p>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderLessons() {
    view.innerHTML = `
      <div class="section-head">
        <div>
          <h2>レッスン</h2>
          <p>各カードを開いて、意味・ピンイン・発音を確認しましょう。</p>
        </div>
      </div>
      <div class="grid-3">
        ${COURSE.lessons
          .map((lesson, i) => {
            const doneFlag = isLessonDone(lesson.id);
            return `
              <button class="lesson-card" data-open-lesson="${lesson.id}">
                <div class="meta">
                  <span>Lesson ${i + 1}</span>
                  <span class="badge ${doneFlag ? "badge-done" : "badge-todo"}">${doneFlag ? "完了" : "未完了"}</span>
                </div>
                <div class="hanzi-preview">${escapeHtml(lesson.preview)}</div>
                <h3>${escapeHtml(lesson.title)}</h3>
                <p>${escapeHtml(lesson.summary)}</p>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderLesson(id) {
    const lesson = COURSE.lessons.find((l) => l.id === id);
    if (!lesson) {
      setRoute("lessons");
      return;
    }
    const idx = COURSE.lessons.findIndex((l) => l.id === id);
    const doneFlag = isLessonDone(id);
    view.innerHTML = `
      <section class="panel">
        <div class="back-row">
          <button class="btn btn-secondary" data-go="lessons">← 一覧へ</button>
          <button class="btn ${doneFlag ? "btn-ghost" : "btn-primary"}" data-complete-lesson="${lesson.id}">
            ${doneFlag ? "完了済み" : "このレッスンを完了にする"}
          </button>
        </div>
        <div class="lesson-title">
          <small>Lesson ${idx + 1}</small>
          <h2>${escapeHtml(lesson.title)}</h2>
          <p style="color:var(--muted);margin:8px 0 0;">${escapeHtml(lesson.summary)}</p>
        </div>
        <div class="item-list" style="margin-top:18px;">
          ${lesson.items
            .map(
              (item) => `
            <div class="item">
              <div class="hanzi">${escapeHtml(item.zh)}</div>
              <div>
                <div class="pinyin">${escapeHtml(item.py)}</div>
                <div class="meaning">${escapeHtml(item.ja)}</div>
                ${item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ""}
              </div>
              <button class="speak-btn" type="button" data-speak="${escapeHtml(item.zh)}" data-lang="zh-CN" title="発音を聞く" aria-label="発音を聞く">🔊</button>
            </div>
          `
            )
            .join("")}
        </div>
        <div class="tip"><strong>ポイント:</strong> ${escapeHtml(lesson.tip)}</div>
        <div class="hero-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" data-go="cards" data-filter="${lesson.id}">この単元をカードで復習</button>
          <button class="btn btn-primary" data-go="quiz" data-filter="${lesson.id}">この単元でクイズ</button>
        </div>
      </section>
    `;
  }

  function renderCards() {
    const items = allItems(state.cardFilter);
    if (!items.length) {
      view.innerHTML = `<div class="panel empty">カードがありません。</div>`;
      return;
    }
    if (state.cardIndex >= items.length) state.cardIndex = 0;
    const item = items[state.cardIndex];
    view.innerHTML = `
      <div class="section-head">
        <div>
          <h2>フラッシュカード</h2>
          <p>表は漢字、裏はピンインと意味。クリックで裏面へ。</p>
        </div>
      </div>
      <div class="filter-row">
        <button class="chip ${state.cardFilter === "all" ? "active" : ""}" data-card-filter="all">すべて</button>
        ${COURSE.lessons
          .map(
            (l) =>
              `<button class="chip ${state.cardFilter === l.id ? "active" : ""}" data-card-filter="${l.id}">${escapeHtml(l.title)}</button>`
          )
          .join("")}
      </div>
      <div class="flash-wrap">
        <div class="panel flash-card" id="flashCard" role="button" tabindex="0" aria-label="カードをめくる">
          <div class="hint">${state.cardIndex + 1} / ${items.length} · クリックで裏返し</div>
          ${
            state.cardFlipped
              ? `<div class="flash-back">
                  <div class="big-pinyin">${escapeHtml(item.py)}</div>
                  <div class="big-meaning">${escapeHtml(item.ja)}</div>
                  <div style="margin-top:14px;font-family:var(--font-sc);font-size:2rem;font-weight:700;">${escapeHtml(item.zh)}</div>
                </div>`
              : `<div class="flash-front"><div class="big-hanzi">${escapeHtml(item.zh)}</div></div>`
          }
        </div>
        <aside class="panel side-panel">
          <h3>使い方</h3>
          <ol>
            <li>漢字を見て意味を思い出す</li>
            <li>裏返してピンインを確認</li>
            <li>🔊 で発音を聞く</li>
          </ol>
          <p>単元: ${escapeHtml(item.lessonTitle)}</p>
          <div class="flash-controls">
            <button class="btn btn-secondary" id="cardPrev">前へ</button>
            <button class="btn btn-secondary" id="cardNext">次へ</button>
            <button class="btn btn-primary" data-speak="${escapeHtml(item.zh)}" data-lang="zh-CN">発音を聞く</button>
          </div>
        </aside>
      </div>
    `;
  }

  function buildQuizPool(filter = "all") {
    const pool = allItems(filter).filter((x) => x.zh && x.ja);
    state.quizPool = shuffle(pool).slice(0, Math.min(8, pool.length));
    state.quizIndex = 0;
    state.quizScore = 0;
    state.quizAnswered = false;
    prepareQuizChoices();
  }

  function prepareQuizChoices() {
    const current = state.quizPool[state.quizIndex];
    if (!current) {
      state.quizChoices = [];
      return;
    }
    const distractors = shuffle(allItems().filter((x) => x.ja !== current.ja))
      .slice(0, 3)
      .map((x) => x.ja);
    state.quizChoices = shuffle([current.ja, ...distractors]);
    state.quizAnswered = false;
  }

  function renderQuiz() {
    if (!state.quizPool.length) buildQuizPool(state.cardFilter === "all" ? "all" : state.cardFilter);

    if (!state.quizPool.length) {
      view.innerHTML = `<div class="panel empty">クイズ用の語句がありません。</div>`;
      return;
    }

    if (state.quizIndex >= state.quizPool.length) {
      const progress = loadProgress();
      progress.quizzes = (progress.quizzes || 0) + 1;
      saveProgress(progress);
      view.innerHTML = `
        <section class="panel quiz-card">
          <div class="eyebrow">Quiz complete</div>
          <h2>結果: ${state.quizScore} / ${state.quizPool.length}</h2>
          <p class="quiz-sub">間違えた語はレッスンかカードで復習しましょう。</p>
          <div class="quiz-controls">
            <button class="btn btn-primary" id="quizRestart">もう一度</button>
            <button class="btn btn-secondary" data-go="cards">カードへ</button>
            <button class="btn btn-ghost" data-go="lessons">レッスンへ</button>
          </div>
        </section>
      `;
      return;
    }

    const q = state.quizPool[state.quizIndex];
    view.innerHTML = `
      <div class="section-head">
        <div>
          <h2>クイズ</h2>
          <p>漢字の意味を選んでください。${state.quizIndex + 1} / ${state.quizPool.length}</p>
        </div>
      </div>
      <section class="panel quiz-card">
        <div class="quiz-prompt">${escapeHtml(q.zh)}</div>
        <div class="quiz-sub">${escapeHtml(q.py)} · 🔊 で聞いてから答えてもOK</div>
        <div class="choices">
          ${state.quizChoices
            .map(
              (choice) =>
                `<button class="choice" data-answer="${escapeHtml(choice)}" ${state.quizAnswered ? "disabled" : ""}>${escapeHtml(choice)}</button>`
            )
            .join("")}
        </div>
        <div class="quiz-controls">
          <button class="btn btn-secondary" data-speak="${escapeHtml(q.zh)}" data-lang="zh-CN">発音を聞く</button>
          <button class="btn btn-primary" id="quizNext" ${state.quizAnswered ? "" : "disabled"}>次へ</button>
        </div>
        <div class="quiz-result" id="quizFeedback" hidden></div>
      </section>
    `;
  }

  function renderTones() {
    view.innerHTML = `
      <div class="section-head">
        <div>
          <h2>声調チートシート</h2>
          <p>中国語の核。まずは ma の4変化で感覚をつかみましょう。</p>
        </div>
      </div>
      <div class="tone-grid">
        ${COURSE.tones
          .map(
            (t) => `
          <div class="tone-card">
            <div class="num">${t.n}</div>
            <strong>${escapeHtml(t.name)}</strong>
            <div>${escapeHtml(t.contour)}</div>
            <div class="example">${escapeHtml(t.example)}</div>
            <div class="py">${escapeHtml(t.py)}</div>
            <p>${escapeHtml(t.tip)}</p>
            <button class="btn btn-secondary" style="margin-top:12px;" data-speak="${escapeHtml(t.example)}" data-lang="zh-CN">聞く</button>
          </div>
        `
          )
          .join("")}
      </div>
      <div class="section-head">
        <div>
          <h2>まとめて練習</h2>
          <p>同じ子音・母音でも声調で意味が変わります。</p>
        </div>
      </div>
      <div class="tone-practice">
        ${["妈|mā", "麻|má", "马|mǎ", "骂|mà"]
          .map((pair) => {
            const [zh, py] = pair.split("|");
            return `<button type="button" data-speak="${zh}" data-lang="zh-CN"><span class="zh">${zh}</span><span class="py">${py}</span></button>`;
          })
          .join("")}
      </div>
      <div class="tip" style="margin-top:16px;">
        <strong>学習のコツ:</strong> 単語を覚えるとき、必ず声調記号付きピンインとセットで覚える。
        ローマ字だけだと別の語になってしまいます。
      </div>
    `;
  }

  function renderGreetings() {
    const regions = [...new Set((WORLD_GREETINGS.items || []).map((x) => x.region))];
    const filter = state.greetRegion || "すべて";
    const items = (WORLD_GREETINGS.items || []).filter(
      (item) => filter === "すべて" || item.region === filter
    );

    view.innerHTML = `
      <div class="section-head">
        <div>
          <h2>${escapeHtml(WORLD_GREETINGS.title)}</h2>
          <p>${escapeHtml(WORLD_GREETINGS.subtitle)}</p>
        </div>
      </div>
      <div class="filter-row">
        <button class="chip ${filter === "すべて" ? "active" : ""}" data-greet-region="すべて">すべて</button>
        ${regions
          .map(
            (region) =>
              `<button class="chip ${filter === region ? "active" : ""}" data-greet-region="${escapeHtml(region)}">${escapeHtml(region)}</button>`
          )
          .join("")}
      </div>
      <div class="greet-grid">
        ${items
          .map((item) => {
            const hello = item.phrases.find((p) => p.kind === "hello") || item.phrases[0];
            return `
              <article class="greet-card">
                <div class="greet-head">
                  <span class="greet-flag" aria-hidden="true">${item.flag || ""}</span>
                  <div>
                    <strong>${escapeHtml(item.language)}</strong>
                    <div class="greet-meta">${escapeHtml(item.country)} · ${escapeHtml(item.region)}</div>
                  </div>
                </div>
                <div class="greet-hello">
                  <div class="greet-text">${escapeHtml(hello.text)}</div>
                  <div class="greet-roman">${escapeHtml(hello.roman)}</div>
                  <div class="greet-ja">${escapeHtml(hello.ja)}</div>
                </div>
                <div class="greet-phrases">
                  ${item.phrases
                    .map(
                      (p) => `
                    <button type="button" class="greet-phrase" data-speak="${escapeHtml(p.text)}" data-lang="${escapeHtml(item.lang)}" title="${escapeHtml(p.ja)}">
                      <span class="kind">${p.kind === "hello" ? "挨拶" : p.kind === "thanks" ? "お礼" : "別れ"}</span>
                      <span class="txt">${escapeHtml(p.text)}</span>
                      <span class="rom">${escapeHtml(p.roman)}</span>
                    </button>
                  `
                    )
                    .join("")}
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function render() {
    updateProgressChip();
    switch (state.route) {
      case "home":
        renderHome();
        break;
      case "lessons":
        renderLessons();
        break;
      case "lesson":
        renderLesson(state.lessonId);
        break;
      case "cards":
        renderCards();
        break;
      case "quiz":
        renderQuiz();
        break;
      case "tones":
        renderTones();
        break;
      case "greetings":
        renderGreetings();
        break;
      default:
        renderHome();
    }
  }

  document.body.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav && nav.dataset.nav) {
      if (nav.dataset.nav === "cards") {
        state.cardFilter = "all";
        state.cardIndex = 0;
        state.cardFlipped = false;
      }
      if (nav.dataset.nav === "quiz") {
        state.cardFilter = "all";
        buildQuizPool("all");
      }
      setRoute(nav.dataset.nav);
      return;
    }

    const go = e.target.closest("[data-go]");
    if (go) {
      const dest = go.dataset.go;
      if (go.dataset.filter) {
        state.cardFilter = go.dataset.filter;
        state.cardIndex = 0;
        state.cardFlipped = false;
        if (dest === "quiz") buildQuizPool(go.dataset.filter);
      }
      setRoute(dest);
      return;
    }

    const openLesson = e.target.closest("[data-open-lesson]");
    if (openLesson) {
      setRoute("lesson", openLesson.dataset.openLesson);
      return;
    }

    const complete = e.target.closest("[data-complete-lesson]");
    if (complete) {
      markLessonDone(complete.dataset.completeLesson);
      render();
      return;
    }

    const speakBtn = e.target.closest("[data-speak]");
    if (speakBtn) {
      speak(speakBtn.dataset.speak, speakBtn.dataset.lang || "zh-CN");
      return;
    }

    const greetRegion = e.target.closest("[data-greet-region]");
    if (greetRegion) {
      state.greetRegion = greetRegion.dataset.greetRegion;
      render();
      return;
    }

    const cardFilter = e.target.closest("[data-card-filter]");
    if (cardFilter) {
      state.cardFilter = cardFilter.dataset.cardFilter;
      state.cardIndex = 0;
      state.cardFlipped = false;
      render();
      return;
    }

    if (e.target.closest("#flashCard")) {
      state.cardFlipped = !state.cardFlipped;
      render();
      return;
    }

    if (e.target.closest("#cardPrev")) {
      const items = allItems(state.cardFilter);
      state.cardIndex = (state.cardIndex - 1 + items.length) % items.length;
      state.cardFlipped = false;
      render();
      return;
    }

    if (e.target.closest("#cardNext")) {
      const items = allItems(state.cardFilter);
      state.cardIndex = (state.cardIndex + 1) % items.length;
      state.cardFlipped = false;
      render();
      return;
    }

    const answer = e.target.closest("[data-answer]");
    if (answer && !state.quizAnswered) {
      const q = state.quizPool[state.quizIndex];
      const selected = answer.dataset.answer;
      const correct = selected === q.ja;
      state.quizAnswered = true;
      if (correct) state.quizScore += 1;
      render();
      const feedback = document.getElementById("quizFeedback");
      const buttons = [...document.querySelectorAll(".choice")];
      buttons.forEach((btn) => {
        if (btn.dataset.answer === q.ja) btn.classList.add("correct");
        if (btn.dataset.answer === selected && !correct) btn.classList.add("wrong");
        btn.disabled = true;
      });
      if (feedback) {
        feedback.hidden = false;
        feedback.textContent = correct
          ? "正解！いい感じです。"
          : `不正解。正解は「${q.ja}」（${q.py}）です。`;
      }
      const next = document.getElementById("quizNext");
      if (next) next.disabled = false;
      return;
    }

    if (e.target.closest("#quizNext")) {
      state.quizIndex += 1;
      prepareQuizChoices();
      render();
      return;
    }

    if (e.target.closest("#quizRestart")) {
      buildQuizPool(state.cardFilter || "all");
      render();
    }
  });

  document.body.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      if (document.activeElement && document.activeElement.id === "flashCard") {
        e.preventDefault();
        state.cardFlipped = !state.cardFlipped;
        render();
      }
    }
  });

  if (window.speechSynthesis) {
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    // Some browsers need a kick to populate voices.
    try {
      window.speechSynthesis.getVoices();
    } catch {
      /* ignore */
    }
  }

  updateProgressChip();
  render();
})();
