(() => {
  const STORAGE_KEY = "uni_grade_calc_v4";

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const uuid = () =>
    (crypto?.randomUUID ? crypto.randomUUID() :
      "id_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16));

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const roundTo = (x, d) => {
    if (x === null || x === undefined || Number.isNaN(x)) return x;
    const p = Math.pow(10, d);
    return Math.round(x * p) / p;
  };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const escapeAttr = (s) => escapeHtml(s).replace(/"/g, "&quot;");

  const DASH_QUOTES = [
    { text: "Kūryba irgi naikinimas ir netgi pats nihilistiškiausias. Jeigu man tektų rinktis bulvę arba Veneciją, nedvejodamas pasirinkčiau bulvę.", author: "A. Šliogeris" },

  ];

  let dashboardQuote = null;

  function pickDashboardQuote(){
    if (!DASH_QUOTES.length){
      return { text: "Add philosopher quotes in gradecalc.js", author: "" };
    }
    let idx = 0;
    try{
      const raw = localStorage.getItem("gc_dash_quote_idx");
      const parsed = Number(raw);
      idx = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      localStorage.setItem("gc_dash_quote_idx", String((idx + 1) % DASH_QUOTES.length));
    } catch (_) {
      idx = Math.floor(Math.random() * DASH_QUOTES.length);
    }
    return DASH_QUOTES[idx % DASH_QUOTES.length];
  }

  function getDashboardQuote(){
    if (!dashboardQuote) dashboardQuote = pickDashboardQuote();
    return dashboardQuote;
  }

  let infoTipEl = null;
  let activeInfoEl = null;

  function ensureInfoTip(){
    if (infoTipEl) return infoTipEl;
    infoTipEl = document.createElement("div");
    infoTipEl.className = "gc-global-tip";
    document.body.appendChild(infoTipEl);
    return infoTipEl;
  }

  function positionInfoTip(anchor){
    if (!infoTipEl || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const tipRect = infoTipEl.getBoundingClientRect();
    const margin = 8;
    let top = rect.top - tipRect.height - 10;
    if (top < margin) top = rect.bottom + 10;
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = clamp(left, margin, window.innerWidth - tipRect.width - margin);
    if (top + tipRect.height > window.innerHeight - margin){
      top = Math.max(margin, window.innerHeight - tipRect.height - margin);
    }
    infoTipEl.style.left = `${Math.round(left)}px`;
    infoTipEl.style.top = `${Math.round(top)}px`;
  }

  function showInfoTip(el){
    const text = el?.getAttribute("data-info") || "";
    if (!text) return;
    const tip = ensureInfoTip();
    tip.textContent = text;
    tip.classList.add("is-visible");
    requestAnimationFrame(() => positionInfoTip(el));
  }

  function hideInfoTip(){
    if (!infoTipEl) return;
    infoTipEl.classList.remove("is-visible");
  }

  function initInfoTips(){
    document.addEventListener("mouseover", (e) => {
      const info = e.target.closest(".gc-info");
      if (!info) return;
      if (activeInfoEl === info) return;
      activeInfoEl = info;
      showInfoTip(info);
    });
    document.addEventListener("mouseout", (e) => {
      const info = e.target.closest(".gc-info");
      if (!info) return;
      if (e.relatedTarget && info.contains(e.relatedTarget)) return;
      if (activeInfoEl === info) activeInfoEl = null;
      hideInfoTip();
    });
    document.addEventListener("focusin", (e) => {
      const info = e.target.closest(".gc-info");
      if (!info) return;
      activeInfoEl = info;
      showInfoTip(info);
    });
    document.addEventListener("focusout", (e) => {
      const info = e.target.closest(".gc-info");
      if (!info) return;
      if (activeInfoEl === info) activeInfoEl = null;
      hideInfoTip();
    });
    document.addEventListener("scroll", () => {
      if (activeInfoEl) positionInfoTip(activeInfoEl);
    }, true);
    window.addEventListener("resize", () => {
      if (activeInfoEl) positionInfoTip(activeInfoEl);
    });
  }

  const defaultState = () => ({
    settings: {
      scale: "percent",
      rounding: 1,
      tenMax: 10,
      cap100: "no",
      bonusEnabled: "yes",
      passThreshold: 4,
      defaultCredits: 5,
      defaultStatus: "ongoing",
      defaultSemester: ""
    },
    ui: {
      view: "subject",
      activeSubjectId: null,
      search: "",
      filters: { status: [], sem: [], type: [] },
      filtersCollapsed: false
    },
    subjects: []
  });

  function normalizeSubject(s){
    // migrate links -> single infoLink
    let infoLink = (typeof s.infoLink === "string") ? s.infoLink : "";
    if (!infoLink && Array.isArray(s.links) && s.links[0]?.url) infoLink = String(s.links[0].url);
    const semesterNo = (s.semesterNo === null || s.semesterNo === undefined) ? null : Number(s.semesterNo);

    // season: store in s.season (Fall/Spring). older stored semester may include other strings
    const seasonRaw = (typeof s.season === "string") ? s.season : (typeof s.semester === "string" ? s.semester : "");
    const season = (seasonRaw === "Fall" || seasonRaw === "Spring") ? seasonRaw : "";

    let finalRecordedPercent = (s.finalRecordedPercent === null || s.finalRecordedPercent === undefined) ? null : Number(s.finalRecordedPercent);
    if (Number.isFinite(finalRecordedPercent) && finalRecordedPercent >= 0 && finalRecordedPercent <= 10){
      finalRecordedPercent = finalRecordedPercent * 10;
    }

    return {
      id: s.id || uuid(),
      name: s.name || "untitled",

      // Primary categorization
      semesterNo: Number.isFinite(semesterNo) ? clamp(Math.round(semesterNo), 1, 8) : null,

      // Optional additional term info
      year: Number.isFinite(Number(s.year)) ? Number(s.year) : null,
      season,
      term: typeof s.term === "string" ? s.term : "",

      credits: Number.isFinite(Number(s.credits)) ? Number(s.credits) : null,

      type: typeof s.type === "string" ? s.type : "",
      professor: typeof s.professor === "string" ? s.professor : "",
      infoLink,

      status: (s.status === "completed" || s.status === "ongoing" || s.status === "upcoming") ? s.status : "ongoing",
      finalRecordedPercent,
      targetRemaining: Number.isFinite(Number(s.targetRemaining)) ? Number(s.targetRemaining) : null,
      solverTarget: Number.isFinite(Number(s.solverTarget)) ? Number(s.solverTarget) : null,
      solverSelectedIds: Array.isArray(s.solverSelectedIds) ? s.solverSelectedIds.filter(id => typeof id === "string") : [],
      finalType: (s.finalType === "pass" || s.finalType === "fail" || s.finalType === "numeric") ? s.finalType : "numeric",

      // bonuses
      courseBonusPercentPoints: Number(s.courseBonusPercentPoints) || 0,
      bonusEnabled: (typeof s.bonusEnabled === "boolean")
        ? s.bonusEnabled
        : (Number(s.courseBonusPercentPoints) ? true : false),

      components: Array.isArray(s.components) ? s.components.map(c => {
        const items = Array.isArray(c.items) ? c.items.map(it => ({
          id: it.id || uuid(),
          name: it.name || "item",
          score: Number(it.score) || 0,
          max: Number(it.max) || 0,
          date: it.date || null
        })) : [];

        let score = Number.isFinite(Number(c.score)) ? Number(c.score) : null;
        let max = Number.isFinite(Number(c.max)) ? Number(c.max) : null;

        if ((score === null || max === null) && items.length){
          let sSum = 0, mSum = 0;
          for (const it of items){
            const sc = Number(it.score);
            const mx = Number(it.max);
            if (!Number.isFinite(sc) || !Number.isFinite(mx) || mx <= 0) continue;
            sSum += sc; mSum += mx;
          }
          if (score === null) score = sSum;
          if (max === null) max = mSum;
        }

        return {
          id: c.id || uuid(),
          name: c.name || "component",
          weight: Number(c.weight) || 0,
          expectedPercent: (c.expectedPercent === "" || c.expectedPercent === undefined) ? null : (c.expectedPercent === null ? null : Number(c.expectedPercent)),
          bonusPoints: Number(c.bonusPoints) || 0,
          score,
          max,
          items
        };
      }) : []
    };
  }

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      const base = defaultState();
      return {
        ...base,
        ...data,
        settings: { ...base.settings, ...(data.settings || {}) },
        ui: { ...base.ui, ...(data.ui || {}) },
        subjects: Array.isArray(data.subjects) ? data.subjects.map(normalizeSubject) : []
      };
    } catch { return defaultState(); }
  };

  let state = load();
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  // Migration: normalize current stored subjects & settings
  state.subjects = state.subjects.map(normalizeSubject);
  state.settings = { ...defaultState().settings, ...state.settings, bonusEnabled: "yes" };
  save();

  const openDlg = (dlg) => { try { dlg.showModal(); } catch { dlg.setAttribute("open",""); } };
  const closeDlg = (dlg) => { try { dlg.close(); } catch { dlg.removeAttribute("open"); } };

  // ---------- calculations ----------
  function bonusEnabled(){
    return true;
  }

  function subjectBonusEnabled(subject){
    return bonusEnabled() && subject.bonusEnabled === true;
  }

  function componentTotals(cmp){
    const rawScore = (cmp.score === null || cmp.score === undefined || cmp.score === "") ? null : toNum(cmp.score);
    const rawMax = (cmp.max === null || cmp.max === undefined || cmp.max === "") ? null : toNum(cmp.max);
    const score = rawScore;
    return { rawScore, score, max: rawMax };
  }

  function componentActualPercent(cmp){
    const t = componentTotals(cmp);
    if (t.max === null || t.max <= 0 || t.rawScore === null) return null;
    return (t.score / t.max) * 100;
  }

  function componentPercentUsed(cmp){
    const actual = componentActualPercent(cmp);
    if (actual !== null) return { kind:"actual", value: actual };
    const exp = toNum(cmp.expectedPercent);
    if (exp !== null) return { kind:"expected", value: clamp(exp, 0, 100) };
    return { kind:"missing", value: null };
  }

  function subjectWeights(subject){
    return (subject.components || []).reduce((acc,c) => acc + (Number(c.weight) || 0), 0);
  }

  function subjectMetrics(subject){
    const comps = subject.components || [];
    const Wtotal = subjectWeights(subject);

    let gradedW = 0;
    let gradedWeighted = 0;
    let projectedWeighted = 0;

    for (const c of comps){
      const w = Number(c.weight) || 0;
      const used = componentPercentUsed(c);
      const actual = componentActualPercent(c);

      if (actual !== null){
        gradedW += w;
        gradedWeighted += w * actual;
      }

      const p = (used.value === null) ? 0 : used.value;
      projectedWeighted += w * p;
    }

    const progress = gradedW > 0 ? (gradedWeighted / gradedW) : null;
    const projectedBase = Wtotal > 0 ? (projectedWeighted / Wtotal) : null;

    const bonusPoints = subjectBonusEnabled(subject) ? clamp(Number(subject.courseBonusPercentPoints) || 0, 0, 10) : 0;
    const bonusPercentPoints = bonusPoints * 10;
    const projectedFinal = projectedBase === null ? null : (projectedBase + bonusPercentPoints);

    const weightSumOk = (Wtotal > 0) ? (Math.abs(Wtotal - 100) < 1e-9) : false;
    return { Wtotal, gradedW, progress, projectedBase, projectedFinal, bonusPoints, bonusPercentPoints, weightSumOk };
  }

  function subjectHasAllResults(subject){
    const comps = (subject.components || []).filter(c => (Number(c.weight) || 0) > 0);
    if (comps.length === 0) return false;
    return comps.every(c => {
      const scoreOk = c.score !== null && c.score !== undefined && Number.isFinite(Number(c.score));
      const maxOk = c.max !== null && c.max !== undefined && Number.isFinite(Number(c.max)) && Number(c.max) > 0;
      return scoreOk && maxOk;
    });
  }

  function applyAutoFinalIfCompleted(subject){
    if (!subject || subject.status !== "completed") return;
    if (subject.finalType !== "numeric") return;
    if (subject.finalRecordedPercent !== null && subject.finalRecordedPercent !== undefined) return;
    if (!subjectHasAllResults(subject)) return;
    const m = subjectMetrics(subject);
    if (!Number.isFinite(Number(m.projectedFinal))) return;
    subject.finalRecordedPercent = roundTo(Number(m.projectedFinal), 4);
  }

  function subjectFinalForStats(subject){
    if (subject.status === "completed" && subject.finalType !== "numeric") return null;
    if (subject.status === "completed" && Number.isFinite(Number(subject.finalRecordedPercent))) {
      const base = Number(subject.finalRecordedPercent);
      const bonusPoints = subjectBonusEnabled(subject) ? clamp(Number(subject.courseBonusPercentPoints) || 0, 0, 10) : 0;
      return base + (bonusPoints * 10);
    }
    return subjectMetrics(subject).projectedFinal;
  }

  function creditsValue(subject){
    const c = Number(subject.credits);
    return Number.isFinite(c) && c > 0 ? c : 1;
  }

  function displayGrade(percent){
    if (percent === null || percent === undefined) return "—";
    const { scale, rounding, tenMax, cap100 } = state.settings;
    const pRaw = Number(percent);
    const p = (cap100 === "yes") ? clamp(pRaw, 0, 100) : pRaw;

    if (scale === "percent") return `${roundTo(p, rounding).toFixed(rounding)}%`;
    if (scale === "ten") {
      const max = Number(tenMax) || 10;
      const val = (p / 100) * max;
      return `${roundTo(val, rounding).toFixed(rounding)} / ${max}`;
    }
    const pp = clamp(p, 0, 100);
    const letter = pp >= 90 ? "A" : pp >= 80 ? "B" : pp >= 70 ? "C" : pp >= 60 ? "D" : pp >= 50 ? "E" : "F";
    return `${letter} (${roundTo(pp, 1)}%)`;
  }

  function displayGradeNoLetter(percent){
    if (percent === null || percent === undefined) return "—";
    if (state.settings.scale !== "letter") return displayGrade(percent);
    const { rounding, cap100 } = state.settings;
    const pRaw = Number(percent);
    const p = (cap100 === "yes") ? clamp(pRaw, 0, 100) : pRaw;
    return `${roundTo(p, rounding).toFixed(rounding)}%`;
  }

  function displayGradeFixed(percent, decimals){
    if (percent === null || percent === undefined) return "—";
    const { scale, tenMax, cap100 } = state.settings;
    const pRaw = Number(percent);
    if (!Number.isFinite(pRaw)) return "—";
    const p = (cap100 === "yes") ? clamp(pRaw, 0, 100) : pRaw;
    if (scale === "percent") return `${roundTo(p, decimals).toFixed(decimals)}%`;
    if (scale === "ten"){
      const max = Number(tenMax) || 10;
      const val = (p / 100) * max;
      return `${roundTo(val, decimals).toFixed(decimals)} / ${max}`;
    }
    return `${roundTo(p, decimals).toFixed(decimals)}%`;
  }

  function displayGradeWhole(percent){
    if (percent === null || percent === undefined) return "—";
    const { scale, tenMax, cap100 } = state.settings;
    const pRaw = Number(percent);
    if (!Number.isFinite(pRaw)) return "—";
    const p = (cap100 === "yes") ? clamp(pRaw, 0, 100) : pRaw;

    if (scale === "percent") return `${Math.round(p)}%`;
    if (scale === "ten"){
      const max = Number(tenMax) || 10;
      const val = (p / 100) * max;
      return `${Math.round(val)} / ${max}`;
    }
    const pp = clamp(p, 0, 100);
    return `${Math.round(pp)}%`;
  }

  function wholePercentValue(percent){
    const n = Number(percent);
    if (!Number.isFinite(n)) return null;
    const p = (state.settings.cap100 === "yes") ? clamp(n, 0, 100) : n;
    return Math.round(p);
  }

  function displayRawPercent(percent){
    const n = Number(percent);
    if (!Number.isFinite(n)) return "—";
    return `${roundTo(n, 4).toFixed(4)}%`;
  }

  function displayProgress(metrics){
    if (!metrics || metrics.progress === null || metrics.progress === undefined) return "—";
    const gradedW = Number(metrics.gradedW) || 0;
    const totalW = Number(metrics.Wtotal) || 0;
    if (gradedW <= 0) return "—";

    const { scale, rounding, tenMax, cap100 } = state.settings;
    const pRaw = Number(metrics.progress);
    if (!Number.isFinite(pRaw)) return "—";
    const p = (cap100 === "yes") ? clamp(pRaw, 0, 100) : pRaw;
    const bonusPct = Number(metrics.bonusPercentPoints) || 0;
    if (totalW <= 0) return displayGrade(p);
    const earnedPercentPoints = (p * gradedW) / totalW;
    const possiblePercentPoints = (gradedW / totalW) * 100;
    const showSoFar = gradedW < totalW;

    if (scale === "ten"){
      const max = Number(tenMax) || 10;
      const denomBase = (possiblePercentPoints / 100) * max;
      const numBase = (earnedPercentPoints / 100) * max;
      const bonusTen = (bonusPct / 100) * max;
      const denom = denomBase;
      const num = showSoFar ? (numBase + bonusTen) : numBase;
      if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) return "—";
      if (showSoFar) return `${roundTo(num, rounding)} / ${roundTo(denom, rounding)}`;
      return displayGrade(p + bonusPct);
    }

    if (scale === "percent" || scale === "letter"){
      if (showSoFar){
        const num = earnedPercentPoints + bonusPct;
        const denom = possiblePercentPoints;
        return `${roundTo(num, rounding)} / ${roundTo(denom, rounding)}%`;
      }
      return displayGrade(p + bonusPct);
    }

    return displayGrade(p);
  }

  function activeSubject(){
    const id = state.ui.activeSubjectId;
    return state.subjects.find(s => s.id === id) || null;
  }

  function subjectMetaLabel(s){
    const sem = (s.semesterNo ? `sem ${s.semesterNo}` : "sem —");
    const y = Number.isFinite(Number(s.year)) ? String(s.year) : "";
    const season = (s.season || "").trim();
    const extra = (y || season) ? ` • ${[y, season].filter(Boolean).join(" ")}` : "";
    return `${sem}${extra}`;
  }

  function subjectFinalLabel(subject){
    if (subject.status === "completed" && subject.finalType === "pass") return "įskaityta";
    if (subject.status === "completed" && subject.finalType === "fail") return "neįskaityta";
    return displayGradeWhole(subjectFinalForStats(subject));
  }

  function finalRecordedValueTen(subject){
    const v = Number(subject.finalRecordedPercent);
    if (!Number.isFinite(v)) return null;
    return v / 10;
  }

  function ensureFilters(){
    const filters = state.ui.filters || {};
    if (!Array.isArray(filters.status)) filters.status = [];
    if (!Array.isArray(filters.sem)) filters.sem = [];
    if (!Array.isArray(filters.type)) filters.type = [];
    state.ui.filters = filters;
    return filters;
  }

  function subjectMatchesSearch(subject, q){
    if (!q) return true;
    return (subject.name || "").toLowerCase().includes(q)
        || subjectMetaLabel(subject).toLowerCase().includes(q)
        || (subject.professor || "").toLowerCase().includes(q)
        || (subject.type || "").toLowerCase().includes(q);
  }

  function subjectMatchesFilters(subject, filters){
    if (filters.status.length && !filters.status.includes(subject.status)) return false;
    const semVal = subject.semesterNo ? String(subject.semesterNo) : "—";
    if (filters.sem.length && !filters.sem.includes(semVal)) return false;
    const typeVal = (subject.type || "").trim() || "—";
    if (filters.type.length && !filters.type.includes(typeVal)) return false;
    return true;
  }

  function requiredOnRemaining(subject, targetFinalPercent){
    const comps = subject.components || [];
    const Wtotal = subjectWeights(subject);
    if (Wtotal <= 0) return { ok:false, msg:"no weights set" };

    let gradedW = 0;
    let gradedWeighted = 0;
    let remainingW = 0;

    for (const c of comps){
      const w = Number(c.weight) || 0;
      if (w <= 0) continue;
      const actual = componentActualPercent(c);
      if (actual !== null){
        gradedW += w;
        gradedWeighted += w * actual;
      } else {
        remainingW += w;
      }
    }

    if (remainingW <= 0) return { ok:false, msg:"no remaining weight" };

    const bonusPoints = subjectBonusEnabled(subject) ? clamp(Number(subject.courseBonusPercentPoints) || 0, 0, 10) : 0;
    const targetBase = Number(targetFinalPercent) - (bonusPoints * 10);
    const required = (targetBase * Wtotal - gradedWeighted) / remainingW;

    return {
      ok: true,
      requiredPercent: required,
      remainingW,
      gradedW,
      impossible: (required > 100 + 1e-9),
      alreadySecured: (required < 0 - 1e-9)
    };
  }

  // Solver includes subject bonus points (if enabled)
  function requiredOnSelectedComponents(subject, targetFinalPercent, componentIds){
    const comps = subject.components || [];
    const Wtotal = subjectWeights(subject);
    if (Wtotal <= 0) return { ok:false, msg:"no weights set" };

    const selected = new Set(componentIds || []);
    const bonusPoints = subjectBonusEnabled(subject) ? clamp(Number(subject.courseBonusPercentPoints) || 0, 0, 10) : 0;
    const tgtBase = Number(targetFinalPercent) - (bonusPoints * 10);

    let sumKnown = 0;
    let selectedW = 0;
    let expectedW = 0;
    let zeroW = 0;

    for (const c of comps){
      const w = Number(c.weight) || 0;
      if (w <= 0) continue;
      const actual = componentActualPercent(c);
      if (actual !== null){
        sumKnown += w * actual;
        continue;
      }
      if (selected.has(c.id)){
        selectedW += w;
        continue;
      }
      const exp = toNum(c.expectedPercent);
      if (exp !== null){
        sumKnown += w * clamp(exp, 0, 100);
        expectedW += w;
        continue;
      }
      zeroW += w;
    }

    if (selectedW <= 0) return { ok:false, msg:"select at least one component" };

    const required = (tgtBase * Wtotal - sumKnown) / selectedW;
    return {
      ok: true,
      requiredPercent: required,
      selectedW,
      expectedW,
      zeroW,
      impossible: (required > 100 + 1e-9),
      alreadySecured: (required < 0 - 1e-9)
    };
  }

  function finalWithSelectedAt(subject, componentIds, selectedPercent){
    const comps = subject.components || [];
    const Wtotal = subjectWeights(subject);
    if (Wtotal <= 0) return null;

    const selected = new Set(componentIds || []);
    const selPct = clamp(Number(selectedPercent) || 0, 0, 100);
    let sum = 0;

    for (const c of comps){
      const w = Number(c.weight) || 0;
      if (w <= 0) continue;
      const actual = componentActualPercent(c);
      if (actual !== null){
        sum += w * actual;
        continue;
      }
      if (selected.has(c.id)){
        sum += w * selPct;
        continue;
      }
      const exp = toNum(c.expectedPercent);
      if (exp !== null) sum += w * clamp(exp, 0, 100);
    }

    const base = sum / Wtotal;
    const bonusPoints = subjectBonusEnabled(subject) ? clamp(Number(subject.courseBonusPercentPoints) || 0, 0, 10) : 0;
    return base + (bonusPoints * 10);
  }

  // ---------- rendering ----------
  function syncSidebarHeight(){
    const side = document.querySelector(".gc-side");
    const main = document.querySelector(".gc-main");
    const list = document.querySelector(".gc-subjects");
    if (!side || !main || !list) return;
    if (window.matchMedia("(max-width: 980px)").matches){
      side.style.height = "";
      side.style.maxHeight = "";
      list.style.height = "";
      list.style.maxHeight = "";
      return;
    }
    side.style.height = "";
    side.style.maxHeight = "";
    const mainRect = main.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const available = Math.floor(mainRect.bottom - listRect.top);
    if (!Number.isFinite(available) || available <= 0) return;
    list.style.height = `${available}px`;
    list.style.maxHeight = `${available}px`;
  }

  function render(){
    renderSidebarFilters();
    renderSubjectList();
    if (state.ui.view === "dashboard") renderDashboard();
    else if (state.ui.view === "stats") renderStats();
    else renderSubject(activeSubject());
    requestAnimationFrame(syncSidebarHeight);
    setTimeout(syncSidebarHeight, 0);
  }

  function renderSidebarFilters(){
    const box = $("#sidebarFilters");
    if (!box) return;
    const filters = ensureFilters();
    const q = (state.ui.search || "").trim().toLowerCase();
    const collapsed = state.ui.filtersCollapsed === true;
    const base = state.subjects.filter(s => subjectMatchesSearch(s, q));

    const statusList = ["ongoing", "upcoming", "completed"];
    const statusCounts = statusList.map(st => ({
      value: st,
      count: base.filter(s => s.status === st).length
    }));

    const semCountsMap = new Map();
    for (const s of base){
      const semVal = s.semesterNo ? String(s.semesterNo) : "—";
      semCountsMap.set(semVal, (semCountsMap.get(semVal) || 0) + 1);
    }
    const semValues = ["1","2","3","4","5","6","7","8","—"].filter(v => semCountsMap.has(v) || filters.sem.includes(v));

    const typeCountsMap = new Map();
    for (const s of base){
      const t = (s.type || "").trim() || "—";
      typeCountsMap.set(t, (typeCountsMap.get(t) || 0) + 1);
    }
    const typeValues = Array.from(typeCountsMap.keys())
      .filter(v => v !== "—")
      .sort((a,b) => a.localeCompare(b));
    if (typeCountsMap.has("—") || filters.type.includes("—")) typeValues.push("—");

    const renderChips = (items, group) => items.map(item => {
      const value = typeof item === "string" ? item : item.value;
      const count = typeof item === "string" ? null : item.count;
      const active = filters[group].includes(value);
      const label = value === "—" ? "—" : value;
      const countLabel = count === null ? "" : `<span class="gc-filter-count">${count}</span>`;
      return `
        <button class="gc-filter-chip ${active ? "active" : ""}" data-filter-group="${group}" data-filter-value="${escapeAttr(value)}" aria-pressed="${active ? "true" : "false"}">
          ${escapeHtml(label)} ${countLabel}
        </button>
      `;
    }).join("");

    const activeLabels = [];
    for (const st of filters.status) activeLabels.push(st);
    for (const sem of filters.sem) activeLabels.push(`sem ${sem}`);
    for (const t of filters.type) activeLabels.push(t === "—" ? "type —" : t);
    const summary = activeLabels.length ? activeLabels.join(" • ") : "none";

    box.classList.toggle("is-collapsed", collapsed);
    box.innerHTML = `
      <div class="gc-filter-head">
        <div class="gc-mini">filters</div>
        <div class="gc-filter-actions">
          <button class="gc-filter-clear" id="clearFilters">clear</button>
          <button class="gc-filter-toggle" id="toggleFilters" aria-label="${collapsed ? "show filters" : "hide filters"}" aria-expanded="${collapsed ? "false" : "true"}"></button>
        </div>
      </div>
      <div class="gc-mini gc-filter-summary">selected: ${escapeHtml(summary)}</div>
      <div class="gc-filter-group">
        <div class="gc-mini">status</div>
        <div class="gc-filter-chips">
          ${renderChips(statusCounts, "status")}
        </div>
      </div>
      <div class="gc-filter-group">
        <div class="gc-mini">semester</div>
        <div class="gc-filter-chips">
          ${renderChips(semValues, "sem")}
        </div>
      </div>
      <div class="gc-filter-group">
        <div class="gc-mini">type</div>
        <div class="gc-filter-chips">
          ${renderChips(typeValues, "type")}
        </div>
      </div>
    `;

    $$("[data-filter-group]", box).forEach(btn => btn.addEventListener("click", () => {
      const group = btn.getAttribute("data-filter-group");
      const value = btn.getAttribute("data-filter-value");
      const arr = ensureFilters()[group] || [];
      const idx = arr.indexOf(value);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(value);
      save(); render();
    }));

    $("#clearFilters")?.addEventListener("click", () => {
      state.ui.filters = { status: [], sem: [], type: [] };
      save(); render();
    });

    $("#toggleFilters")?.addEventListener("click", () => {
      state.ui.filtersCollapsed = !collapsed;
      save(); render();
      setTimeout(syncSidebarHeight, 0);
    });
  }

  function renderSubjectList(){
    const list = $("#subjectList");
    const q = (state.ui.search || "").trim().toLowerCase();
    const filters = ensureFilters();
    const filtered = state.subjects.filter(s => subjectMatchesSearch(s, q) && subjectMatchesFilters(s, filters));

    $("#subjectCount").textContent = `${filtered.length}/${state.subjects.length}`;
    list.innerHTML = "";

    if (filtered.length === 0){
      list.innerHTML = `<div class="gc-mini">no subjects yet. click <span class="gc-pill">+ subject</span>.</div>`;
      return;
    }

    for (const s of filtered){
      const finLabel = subjectFinalLabel(s);
      const el = document.createElement("div");
      el.className = "gc-subject" + (s.id === state.ui.activeSubjectId ? " active" : "");
      el.innerHTML = `
        <div class="name">${escapeHtml(s.name || "untitled")}</div>
        <div class="meta">${escapeHtml(subjectMetaLabel(s))} • ${escapeHtml(s.status)} • ${escapeHtml(finLabel)}</div>
      `;
      el.addEventListener("click", () => {
        state.ui.activeSubjectId = s.id;
        state.ui.view = "subject";
        save(); render();
      });
      list.appendChild(el);
    }
  }

  function renderDashboard(){
    const main = $("#main");
    const rows = state.subjects.map(s => {
      const m = subjectMetrics(s);
      const finalLabel = subjectFinalLabel(s);
      const semValue = s.semesterNo ? String(s.semesterNo) : "—";
      return {
        id:s.id, name:s.name||"untitled", sem:semValue, status:s.status,
        projected:m.projectedFinal, progress:m.progress, Wtotal:m.Wtotal, gradedW:m.gradedW, bonusPercentPoints:m.bonusPercentPoints,
        final: finalLabel,
        meta: subjectMetaLabel(s),
        type: (s.type || "").trim(),
        professor: (s.professor || "").trim(),
        credits: creditsValue(s),
        components: (s.components || []).length,
        finalType: s.finalType || "numeric",
        finalPercent: subjectFinalForStats(s)
      };
    });
    const ongoing = rows.filter(r => r.status === "ongoing");
    const upcoming = rows.filter(r => r.status === "upcoming");
    const completed = rows.filter(r => r.status === "completed");
    const ongoingTerms = Array.from(new Set(ongoing.map(r => r.meta)));
    const ongoingTermLabel = ongoing.length
      ? (ongoingTerms.length === 1 ? ongoingTerms[0] : "mixed terms")
      : "—";
    const barBySem = new Map();
    const pushToSem = (r, kind) => {
      const k = r.sem || "—";
      if (!barBySem.has(k)) barBySem.set(k, []);
      barBySem.get(k).push({ ...r, kind });
    };
    for (const r of completed) pushToSem(r, "completed");
    for (const r of ongoing) pushToSem(r, "ongoing");
    for (const r of upcoming) pushToSem(r, "upcoming");
    const baseSemKeys = ["1","2","3","4","5","6","7","8"];
    const extraSemKeys = Array.from(barBySem.keys()).filter(k => !baseSemKeys.includes(k));
    const barSemKeys = baseSemKeys.concat(extraSemKeys).sort((a,b) => {
      const na = parseInt(String(a).replace(/\D+/g,""),10);
      const nb = parseInt(String(b).replace(/\D+/g,""),10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });

    const dashQuote = getDashboardQuote();
    const dashQuoteText = dashQuote?.text ? `"${dashQuote.text}"` : "—";
    const dashQuoteAuthor = dashQuote?.author ? `— ${dashQuote.author}` : "";

    main.innerHTML = `
      <div class="gc-dashboard">
        <div class="gc-card gc-dash-intro">
          <div class="gc-dash-head">
            <div>
              <h2>dashboard</h2>

            </div>
            <div class="gc-row gc-dash-pills">
              <div class="gc-pill">ongoing: ${escapeHtml(String(ongoing.length))}</div>
              <div class="gc-pill">upcoming: ${escapeHtml(String(upcoming.length))}</div>
              <div class="gc-pill">completed: ${escapeHtml(String(completed.length))}</div>
            </div>
          </div>
          <div class="gc-dash-banner">
            <div class="gc-dash-banner-left">
              <div class="gc-mini">ongoing now</div>
              <div class="gc-dash-big">${escapeHtml(String(ongoing.length))}</div>
              <div class="gc-mini">${ongoing.length === 1 ? "subject in motion" : "subjects in motion"}</div>
            </div>
            <div class="gc-dash-banner-right">
              <div class="gc-dash-tip">${escapeHtml(dashQuoteText)}</div>
              ${dashQuoteAuthor ? `<div class="gc-mini gc-dash-quote-author">${escapeHtml(dashQuoteAuthor)}</div>` : ""}
            </div>
          </div>
        </div>

        <div class="gc-card gc-dash-ongoing">
          <div class="gc-row" style="justify-content:space-between; align-items:baseline">
            <h2>ongoing focus</h2>
            <div class="gc-mini">term: ${escapeHtml(ongoingTermLabel)}</div>
          </div>
          <div class="gc-dash-grid">
            ${ongoing.length ? ongoing.map(r => `
                <div class="gc-dash-card" data-open="${escapeAttr(r.id)}" role="button" tabindex="0">
                  <div class="gc-dash-card-head">
                    <div>
                      <div class="gc-dash-title">${escapeHtml(r.name)}</div>
                      <div class="gc-mini">${escapeHtml(r.professor || "professor —")}</div>
                      <div class="gc-mini">${escapeHtml(r.type || "type —")}</div>
                    </div>
                  </div>
                <div class="gc-dash-stats">
                  <div class="gc-dash-stat">
                    <div class="gc-mini">progress</div>
                    <div class="gc-dash-value">${escapeHtml(displayProgress(r))}</div>
                  </div>
                  <div class="gc-dash-stat">
                    <div class="gc-mini">projected</div>
                    <div class="gc-dash-value">${escapeHtml(displayGrade(r.projected))}</div>
                  </div>
                  <div class="gc-dash-stat">
                    <div class="gc-mini">weights</div>
                    <div class="gc-dash-value">${escapeHtml(String(roundTo(r.Wtotal,2) || 0))}%</div>
                  </div>
                </div>
                <div class="gc-dash-foot">
                  <div class="gc-mini">components: ${escapeHtml(String(r.components))}</div>
                  <div class="gc-dash-credit">${escapeHtml(String(roundTo(r.credits, 2)))} cred.</div>
                </div>
              </div>
            `).join("") : `<div class="gc-mini">no ongoing subjects yet. mark one as ongoing to make it appear here.</div>`}
          </div>
        </div>

        <div class="gc-dash-columns">
          <div class="gc-card gc-dash-list-card gc-dash-wide">
            <h2>completed</h2>
            <div class="gc-mini">connected bargraph with semester markers</div>
            <div class="gc-dash-chart">
              <div class="gc-dash-axis" aria-hidden="true">
                <div class="gc-dash-axis-label">10</div>
                <div class="gc-dash-axis-label">0</div>
              </div>
              <div class="gc-dash-tape-strip">
                ${barSemKeys.length ? barSemKeys.map(k => {
                  const list = (barBySem.get(k) || []).slice().sort((a,b) => {
                    if (a.kind !== b.kind){
                      const order = { completed: 0, ongoing: 1, upcoming: 2 };
                      return (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
                    }
                    return (a.name || "").localeCompare(b.name || "");
                  });
                  const label = (k === "—") ? "unknown" : `sem ${k}`;
                  const barCount = Math.max(1, list.length);
                  return `
                    <div class="gc-dash-tape-group" style="--bars:${barCount}">
                      <div class="gc-dash-tape-bars">
                        ${list.length ? list.map(r => {
                          const isGhost = r.kind !== "completed";
                          const pct = Number(r.finalPercent);
                          let h = isGhost ? 18 : 50;
                          if (!isGhost){
                            if (Number.isFinite(pct)) h = clamp(pct, 0, 100);
                            else if (r.finalType === "pass") h = 80;
                            else if (r.finalType === "fail") h = 20;
                          }
                          h = Math.max(8, Math.round(h));
                        const tip = isGhost
                          ? `${r.name} • ${r.kind}`
                          : `${r.name} • ${r.final}`;
                          const cls = isGhost
                            ? "gc-dash-bar gc-dash-bar-upcoming"
                            : (r.finalType === "pass"
                              ? "gc-dash-bar gc-dash-bar-pass"
                              : (r.finalType === "fail" ? "gc-dash-bar gc-dash-bar-fail" : "gc-dash-bar"));
                          return `
                            <div class="${cls}" data-open="${escapeAttr(r.id)}" role="button" tabindex="0" style="--h:${h}px" data-tip="${escapeAttr(tip)}"></div>
                          `;
                        }).join("") : `<div class="gc-dash-bar gc-dash-bar-empty" style="--h:12px"></div>`}
                      </div>
                      <div class="gc-dash-tape-sem">${escapeHtml(label)}</div>
                    </div>
                  `;
                }).join("") : `<div class="gc-mini">no completed subjects yet.</div>`}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    $$("[data-open]").forEach(el => {
      const open = (e) => {
        e.preventDefault();
        const id = el.getAttribute("data-open");
        state.ui.activeSubjectId = id;
        state.ui.view = "subject";
        save(); render();
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") open(e);
      });
    });

  }

  function renderStats(){
    const main = $("#main");
    if (state.subjects.length === 0){
      main.innerHTML = `
        <div class="gc-card">
          <h2>stats</h2>
          <div class="gc-mini">add subjects first.</div>
        </div>
      `;
      return;
    }

    const completedAll = state.subjects.filter(s => s.status === "completed");
    const completedPassFail = completedAll.filter(s => s.finalType === "pass" || s.finalType === "fail");
    if (completedAll.length === 0){
      main.innerHTML = `
        <div class="gc-card">
          <h2>stats</h2>
          <div class="gc-mini">no completed subjects yet. mark a subject as completed to include it here.</div>
        </div>
      `;
      return;
    }
    const completedSubjects = completedAll.filter(s => s.finalType === "numeric");
    if (completedSubjects.length === 0){
      main.innerHTML = `
        <div class="gc-card">
          <h2>stats</h2>
          <div class="gc-mini">no numeric grades yet. pass/fail subjects don't affect stats.</div>
          <div class="gc-row" style="margin-top:10px">
            <div class="gc-pill">completed (pass/fail): ${escapeHtml(String(completedAll.length))}</div>
            <div class="gc-pill">total subjects: ${escapeHtml(String(state.subjects.length))}</div>
          </div>
        </div>
      `;
      return;
    }

    // group by semesterNo primarily (include pass/fail in lists)
    const bySem = new Map();
    for (const s of completedAll){
      const k = s.semesterNo ? String(s.semesterNo) : "—";
      if (!bySem.has(k)) bySem.set(k, []);
      bySem.get(k).push(s);
    }

    const semKeys = Array.from(bySem.keys()).sort((a,b) => {
      const na = parseInt(String(a).replace(/\D+/g,""),10);
      const nb = parseInt(String(b).replace(/\D+/g,""),10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });

    let overallCredits = 0;
    let overallWeighted = 0;

    const semRows = semKeys.map(k => {
      const subjects = bySem.get(k);
      let cSum = 0, wSum = 0;
      let creditsTotal = 0;
      const numericSubjects = subjects.filter(s => s.finalType === "numeric");
      const passSubjects = subjects.filter(s => s.finalType === "pass");

      for (const s of numericSubjects){
        const final = wholePercentValue(subjectFinalForStats(s));
        if (typeof final === "number" && Number.isFinite(final)){
          const cr = creditsValue(s);
          cSum += cr;
          wSum += cr * final;
          overallCredits += cr;
          overallWeighted += cr * final;
          creditsTotal += cr;
        }
      }
      for (const s of passSubjects){
        creditsTotal += creditsValue(s);
      }
      const avg = cSum > 0 ? (wSum / cSum) : null;
      return { semKey:k, subjects, credits:cSum, creditsTotal, avg };
    });

    const overallAvg = overallCredits > 0 ? (overallWeighted / overallCredits) : null;

    // extra overall statistics (computed on percent scale)
    const finalsAll = completedSubjects.map(s => wholePercentValue(subjectFinalForStats(s))).filter(v => typeof v === "number" && Number.isFinite(v));

    const unweightedAvg = finalsAll.length ? finalsAll.reduce((a,b)=>a+b,0)/finalsAll.length : null;
    const sortedAll = finalsAll.slice().sort((a,b)=>a-b);
    const medianAll = sortedAll.length ? (sortedAll.length%2 ? sortedAll[(sortedAll.length-1)/2] : (sortedAll[sortedAll.length/2-1]+sortedAll[sortedAll.length/2])/2) : null;

    const stdAll = (finalsAll.length >= 2) ? Math.sqrt(finalsAll.reduce((acc,x)=>acc+Math.pow(x-(unweightedAvg||0),2),0)/(finalsAll.length-1)) : null;

    const passThreshold = clamp(Number(state.settings.passThreshold) || 4, 0, 10);
    const passThresholdLabel = roundTo(passThreshold, 2).toFixed(2).replace(/\.?0+$/,"");
    const passThresholdPercent = roundTo(passThreshold * 10, 1).toFixed(1).replace(/\.?0+$/,"");
    const PASS_PERCENT = passThreshold * 10;
    const HIGH_PERCENT = 90;
    const passCountNumeric = finalsAll.filter(v => v >= PASS_PERCENT).length;
    const passCount = passCountNumeric + completedAll.filter(s => s.finalType === "pass").length;
    const highCount = finalsAll.filter(v => v >= HIGH_PERCENT).length;
    const rate = (n, total) => (total > 0 ? Math.round((n / total) * 100) : null);
    const passRate = rate(passCount, finalsAll.length + completedPassFail.length);
    const highRate = rate(highCount, finalsAll.length);

    const creditsCompleted = completedSubjects.reduce((a,s)=>a+creditsValue(s),0);

    main.innerHTML = `
      <div class="gc-card gc-overall-card">
        <h2>overall statistics</h2>
        <div class="gc-overall-board">
          <div class="gc-overall-tile gc-overall-wide">
            <div class="gc-overall-label">weighted avg <span class="gc-info" data-info="Credit-weighted average across completed subjects.">i</span></div>
            <div class="gc-overall-big">${escapeHtml(displayGradeWhole(overallAvg))}</div>
            <div class="gc-overall-meta">raw: ${escapeHtml(displayRawPercent(overallAvg))} • uses credits as weights</div>
            <div class="gc-overall-meter${overallAvg===null?" is-empty":""}"><span style="--pct:${overallAvg===null?0:clamp(Number(overallAvg),0,100)}"></span></div>
          </div>
          <div class="gc-overall-tile gc-overall-wide">
            <div class="gc-overall-label">pass rate <span class="gc-info" data-info="Percent of completed subjects at or above ${escapeAttr(passThresholdLabel)} / 10 (${escapeAttr(passThresholdPercent)}%), plus pass/fail outcomes.">i</span></div>
            <div class="gc-overall-big">${escapeHtml(passRate === null ? "—" : `${passRate}%`)}</div>
            <div class="gc-overall-meta">passed: ${escapeHtml(String(passCount))} / ${escapeHtml(String(finalsAll.length + completedPassFail.length))}</div>
            <div class="gc-overall-meter${passRate===null?" is-empty":""}"><span style="--pct:${passRate===null?0:clamp(Number(passRate),0,100)}"></span></div>
          </div>
          <div class="gc-overall-tile">
            <div class="gc-overall-label">unweighted avg <span class="gc-info" data-info="Simple average across completed subjects.">i</span></div>
            <div class="gc-overall-value">${escapeHtml(displayGradeWhole(unweightedAvg))}</div>
            <div class="gc-overall-meta">raw: ${escapeHtml(displayRawPercent(unweightedAvg))}</div>
            <div class="gc-overall-meter${unweightedAvg===null?" is-empty":""}"><span style="--pct:${unweightedAvg===null?0:clamp(Number(unweightedAvg),0,100)}"></span></div>
          </div>
          <div class="gc-overall-tile">
            <div class="gc-overall-label">median</div>
            <div class="gc-overall-value">${escapeHtml(displayGradeWhole(medianAll))}</div>
            <div class="gc-overall-meta">raw: ${escapeHtml(displayRawPercent(medianAll))}</div>
            <div class="gc-overall-meter${medianAll===null?" is-empty":""}"><span style="--pct:${medianAll===null?0:clamp(Number(medianAll),0,100)}"></span></div>
          </div>
          <div class="gc-overall-tile">
            <div class="gc-overall-label">std dev</div>
            <div class="gc-overall-value">${escapeHtml(stdAll===null?"—":String(roundTo(stdAll, state.settings.rounding)))}</div>
            <div class="gc-overall-meta">spread of completed finals</div>
            <div class="gc-overall-meter${stdAll===null?" is-empty":""}"><span style="--pct:${stdAll===null?0:clamp((Number(stdAll) / 30) * 100,0,100)}"></span></div>
          </div>
          <div class="gc-overall-tile">
            <div class="gc-overall-label">completion</div>
            <div class="gc-overall-value">${escapeHtml(String(completedAll.length))}</div>
            <div class="gc-overall-meta">of ${escapeHtml(String(state.subjects.length))} subjects</div>
            <div class="gc-overall-meter${state.subjects.length===0?" is-empty":""}"><span style="--pct:${state.subjects.length===0?0:clamp((completedAll.length / state.subjects.length) * 100,0,100)}"></span></div>
          </div>
        </div>
      </div>


      <div class="gc-card">
        <h2>by semester (1–8)</h2>
        <table class="gc-table">
          <thead><tr><th>semester</th><th class="gc-right">subjects</th><th class="gc-right">credits</th><th class="gc-right">average</th></tr></thead>
          <tbody>
            ${semRows.map(r => `
              <tr>
                <td><a href="#" data-sem="${escapeAttr(r.semKey)}">${escapeHtml(r.semKey)}</a></td>
                <td class="gc-right">${escapeHtml(String(r.subjects.length))}</td>
                <td class="gc-right">${escapeHtml(String(roundTo(r.creditsTotal ?? r.credits, 2)))}</td>
                <td class="gc-right">${escapeHtml(displayGradeFixed(r.avg, 2))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="gc-mini" style="margin-top:10px">click a semester to expand its subject list.</div>
        <div id="semDetail" style="margin-top:12px"></div>
      </div>
    `;

    $$("[data-sem]").forEach(a => a.addEventListener("click", (e) => {
      e.preventDefault();
      const k = a.getAttribute("data-sem");
      renderSemDetail(k, bySem.get(k) || []);
    }));

    renderSemDetail(semKeys[0], bySem.get(semKeys[0]) || []);
  }

  function renderSemDetail(semKey, subjects){
    const box = $("#semDetail");
    if (!box) return;

    if (!subjects.length){
      box.innerHTML = `
        <div class="gc-card" style="margin:0">
          <h2>${escapeHtml(semKey)} :: subjects</h2>
          <div class="gc-mini">no completed subjects in this semester.</div>
        </div>
      `;
      return;
    }

    box.innerHTML = `
      <div class="gc-card" style="margin:0">
        <h2>semester ${escapeHtml(semKey)} :: subjects</h2>
        <table class="gc-table">
          <thead><tr><th>subject</th><th class="gc-right">credits</th><th>term</th><th class="gc-right">final used</th></tr></thead>
          <tbody>
            ${subjects.map(s => {
              const finLabel = subjectFinalLabel(s);
              return `
                <tr>
                  <td><a href="#" data-open="${escapeAttr(s.id)}">${escapeHtml(s.name || "untitled")}</a></td>
                  <td class="gc-right gc-mini">${escapeHtml(String(creditsValue(s)))}</td>
                  <td class="gc-mini">${escapeHtml([s.year, s.season].filter(Boolean).join(" ") || "—")}</td>
                  <td class="gc-right">${escapeHtml(finLabel)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    $$("[data-open]", box).forEach(a => a.addEventListener("click", (e) => {
      e.preventDefault();
      const id = a.getAttribute("data-open");
      state.ui.activeSubjectId = id;
      state.ui.view = "subject";
      save(); render();
    }));
  }

  function renderSubject(subject){
    const main = $("#main");
    if (!subject){
      main.innerHTML = `
        <div class="gc-card">
          <h2>no subject selected</h2>
          <div class="gc-mini">pick one from the left or create a new subject.</div>
        </div>
      `;
      return;
    }

    const m = subjectMetrics(subject);
    const warn = m.weightSumOk ? "" : `<span class="gc-mini">weights sum: ${escapeHtml(String(roundTo(m.Wtotal,2)))} (not 100)</span>`;
    const targetNum = (subject.targetRemaining === null || subject.targetRemaining === undefined) ? null : Number(subject.targetRemaining);
    const targetRemainingVal = targetNum === null ? "" : String(targetNum);
    let remainingStr = "—";
    if (targetNum !== null){
      const res = requiredOnRemaining(subject, targetNum);
      if (res.ok){
        remainingStr = `${roundTo(res.requiredPercent, state.settings.rounding).toFixed(state.settings.rounding)}%`;
        if (res.impossible) remainingStr += " (impossible > 100%)";
        if (res.alreadySecured) remainingStr += " (already secured)";
      } else {
        remainingStr = res.msg || "—";
      }
    }

    main.innerHTML = `
      <div class="gc-card">
        <div class="gc-row" style="justify-content:space-between; align-items:end">
          <div>
            <h2>${escapeHtml(subject.name || "untitled")}</h2>
            <div class="gc-mini">${escapeHtml(subjectMetaLabel(subject))} • ${warn}</div>
          </div>
          <div class="gc-actions">
            <button class="gc-btn" id="btnAddComponent">+ component</button>
            <button class="gc-btn" id="btnRenameSubject">rename</button>
            <button class="gc-btn gc-btn-danger" id="btnDeleteSubject">delete</button>
          </div>
        </div>

        <div class="gc-kpis">
          <div class="gc-kpi">
            <div class="t">progress <span class="gc-info" data-info="Current average based only on graded components (shows earned / possible so far when some weights are missing).">i</span></div>
            <div class="v">${escapeHtml(displayProgress(m))}</div>
          </div>
          <div class="gc-kpi">
            <div class="t">required on remaining <span class="gc-info" data-info="Average % needed on ungraded components to hit your target final (uses current bonus setting).">i</span></div>
            <div class="v">${escapeHtml(remainingStr)}</div>
            <div class="gc-mini" style="margin-top:6px">target final %</div>
            <input class="gc-input" id="targetRemaining" type="number" step="0.01" placeholder="e.g., 85" value="${escapeAttr(targetRemainingVal)}" />
          </div>
          <div class="gc-kpi">
            <div class="t">projected final <span class="gc-info" data-info="Projected base plus subject bonus points (if enabled).">i</span></div>
            <div class="v">${escapeHtml(displayGrade(m.projectedFinal))}</div>
          </div>
        </div>

        <div class="gc-row" style="justify-content:space-between; align-items:center; margin-top:12px">
          <div class="gc-mini">projected final includes bonuses (if enabled)</div>
          <div class="gc-pill">bonuses: ${escapeHtml(subjectBonusEnabled(subject) ? "enabled" : "disabled")}</div>
        </div>
      </div>

      <div class="gc-card">
        <h2>details</h2>
        ${renderSubjectDetails(subject)}
      </div>
      <div class="gc-card">
        <h2>components</h2>
        ${renderComponentsTable(subject)}
      </div>

      <div class="gc-card">
        <h2>target solver</h2>
        ${renderTargetSolver(subject)}
      </div>
    `;

    $("#btnAddComponent").addEventListener("click", () => openAddComponent(subject.id));
    $("#btnRenameSubject").addEventListener("click", () => renameSubject(subject.id));
    $("#btnDeleteSubject").addEventListener("click", () => deleteSubject(subject.id));

    wireSubjectDetails(subject.id);
    wireComponents(subject.id);
    wireRequiredRemaining(subject.id);
    wireTargetSolver(subject.id);
  }

  function renderSubjectDetails(subject){
    const semNoVal = subject.semesterNo ? String(subject.semesterNo) : "";
    const creditsVal = Number.isFinite(Number(subject.credits)) ? String(subject.credits) : "";
    const yearVal = Number.isFinite(Number(subject.year)) ? String(subject.year) : "";
    const seasonVal = (subject.season || "").trim();
    const termLabel = (subject.term || "").trim();
    const typeVal = (subject.type || "").trim();
    const professorVal = (subject.professor || "").trim();
    const statusVal = subject.status || "ongoing";
    const finalTen = finalRecordedValueTen(subject);
    const finalVal = (finalTen === null) ? "" : String(roundTo(finalTen, Math.max(2, state.settings.rounding)));
    const infoLink = (subject.infoLink || "").trim();
    const bonusEnabledVal = subject.bonusEnabled === true;
    const finalTypeVal = subject.finalType || "numeric";

    return `
      <div class="gc-cols">
        <div>
          <div class="gc-mini">semester number (1–8)</div>
          <select class="gc-input" data-sub-semno>
            <option value="" ${semNoVal===""?"selected":""}>—</option>
            ${[1,2,3,4,5,6,7,8].map(n => `<option value="${n}" ${String(n)===semNoVal?"selected":""}>${n}</option>`).join("")}
          </select>
        </div>
        <div>
          <div class="gc-mini">credits</div>
          <input class="gc-input" data-sub-credits type="number" step="0.5" value="${escapeAttr(creditsVal)}" placeholder="e.g., 6" />
        </div>
        <div>
          <div class="gc-mini">type</div>
          <select class="gc-input" data-sub-type>
            <option value="" ${typeVal===""?"selected":""}>—</option>
            <option value="IND" ${typeVal==="IND"?"selected":""}>IND</option>
            <option value="PD" ${typeVal==="PD"?"selected":""}>PD</option>
            <option value="Programinis" ${typeVal==="Programinis"?"selected":""}>Programinis</option>
            <option value="Other" ${typeVal==="Other"?"selected":""}>Other</option>
          </select>
        </div>
      </div>

      <div class="gc-cols" style="margin-top:10px">
        <div>
          <div class="gc-mini">year (optional)</div>
          <input class="gc-input" data-sub-year type="number" step="1" value="${escapeAttr(yearVal)}" placeholder="e.g., 2026" />
        </div>
        <div>
          <div class="gc-mini">season (optional)</div>
          <select class="gc-input" data-sub-season>
            <option value="" ${seasonVal==="" ? "selected":""}>—</option>
            <option value="Fall" ${seasonVal==="Fall" ? "selected":""}>Fall</option>
            <option value="Spring" ${seasonVal==="Spring" ? "selected":""}>Spring</option>
          </select>
        </div>
        <div>
          <div class="gc-mini">professor</div>
          <input class="gc-input" data-sub-professor value="${escapeAttr(professorVal)}" placeholder="name / surname" />
        </div>
      </div>

      <div class="gc-cols" style="margin-top:10px">
        <div style="grid-column: span 2;">
          <div class="gc-mini">term label (optional)</div>
          <input class="gc-input" data-sub-term value="${escapeAttr(termLabel)}" placeholder="e.g., 2026 Fall (VILNIUS TECH)" />
        </div>
        <div>
          <div class="gc-mini">status</div>
          <select class="gc-input" data-sub-status>
            <option value="ongoing" ${statusVal==="ongoing" ? "selected":""}>ongoing</option>
            <option value="upcoming" ${statusVal==="upcoming" ? "selected":""}>upcoming</option>
            <option value="completed" ${statusVal==="completed" ? "selected":""}>completed</option>
          </select>
        </div>
      </div>

      <div class="gc-cols" style="margin-top:10px">
        <div>
          <div class="gc-mini">bonus points</div>
          <label class="gc-row" style="align-items:center; gap:8px">
            <input type="checkbox" data-sub-bonus-enabled ${bonusEnabledVal ? "checked" : ""} />
            <span class="gc-mini">enable bonus points for this subject</span>
          </label>
        </div>
      </div>

      ${statusVal==="completed" ? `
      <div class="gc-cols" style="grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px; margin-top:10px">
        <div>
          <div class="gc-mini">result type</div>
          <select class="gc-input" data-sub-finaltype>
            <option value="numeric" ${finalTypeVal==="numeric" ? "selected":""}>numeric</option>
            <option value="pass" ${finalTypeVal==="pass" ? "selected":""}>įskaityta</option>
            <option value="fail" ${finalTypeVal==="fail" ? "selected":""}>neįskaityta</option>
          </select>
        </div>
        ${finalTypeVal==="numeric" ? `
        <div>
          <div class="gc-mini">final recorded (0-10)</div>
          <input class="gc-input" data-sub-final type="number" step="0.01" value="${escapeAttr(finalVal)}" placeholder="e.g., 8.5" />
          <div class="gc-mini" style="margin-top:6px">leave empty to use projected final.</div>
        </div>
        ` : `
        <div class="gc-mini" style="margin-top:22px">no numeric grade</div>
        `}
      </div>

      <div class="gc-cols" style="margin-top:10px">
        <div style="grid-column: span 3;">
          <div class="gc-mini">info link (e.g., sandas)</div>
          <div class="gc-row" style="align-items:center">
            <input class="gc-input" data-sub-infolink value="${escapeAttr(infoLink)}" placeholder="https://..." />
            <button class="gc-btn" id="btnOpenLink">open</button>
          </div>
        </div>
      </div>
    ` : `
      <div class="gc-cols" style="margin-top:10px">
        <div style="grid-column: span 3;">
          <div class="gc-mini">info link (e.g., sandas)</div>
          <div class="gc-row" style="align-items:center">
            <input class="gc-input" data-sub-infolink value="${escapeAttr(infoLink)}" placeholder="https://..." />
            <button class="gc-btn" id="btnOpenLink">open</button>
          </div>
        </div>
      </div>
    `}
    `;
  }

  function renderComponentsTable(subject){
    const comps = subject.components || [];
    const bonusRow = subject.bonusEnabled ? `
      <div class="gc-row" style="justify-content:flex-end; align-items:center; gap:8px; margin-top:10px">
        <div class="gc-mini">bonus points</div>
        <input class="gc-input" data-sub-bonus-points type="number" step="0.01" min="0" max="10" value="${escapeAttr(String(clamp(Number(subject.courseBonusPercentPoints) || 0, 0, 10)))}" style="width:120px" />
        <div class="gc-mini">/ 10</div>
      </div>
    ` : "";
    if (comps.length === 0){
      return `
        <div class="gc-mini">no components yet. add one (e.g., test 20%, midterm 30%, exam 50%).</div>
        ${bonusRow}
      `;
    }

    const rows = comps.map(c => {
      const used = componentPercentUsed(c);
      const actual = componentActualPercent(c);
      const t = componentTotals(c);
      const actualStr = actual === null ? "—" : `${roundTo(actual, state.settings.rounding).toFixed(state.settings.rounding)}%`;
      const usedStr = used.value === null ? "missing" : `${roundTo(used.value, state.settings.rounding).toFixed(state.settings.rounding)}% (${used.kind})`;
      const expVal = (c.expectedPercent === null || c.expectedPercent === undefined) ? "" : String(c.expectedPercent);
      const scoreVal = (c.score === null || c.score === undefined || !Number.isFinite(Number(c.score))) ? "" : String(c.score);
      const maxVal = (c.max === null || c.max === undefined || !Number.isFinite(Number(c.max))) ? "" : String(c.max);
      const rawScoreStr = t.rawScore === null ? "—" : String(roundTo(t.rawScore, 2));
      const rawMaxStr = t.max === null ? "—" : String(roundTo(t.max, 2));

      return `
        <tr>
          <td>
            <div class="gc-mini">name</div>
            <input class="gc-input" data-cmp-name="${escapeAttr(c.id)}" value="${escapeAttr(c.name || "")}" placeholder="component" />
            <div class="gc-mini" style="margin-top:8px">used: ${escapeHtml(usedStr)}</div>
          </td>
          <td>
            <div class="gc-cols" style="grid-template-columns: 1fr 1fr; gap:10px">
              <div>
                <div class="gc-mini">weight %</div>
                <input class="gc-input" data-cmp-weight="${escapeAttr(c.id)}" type="number" step="0.01" value="${escapeAttr(String(Number(c.weight)||0))}" />
              </div>
              <div>
                <div class="gc-mini">expected %</div>
                <input class="gc-input" data-cmp-exp="${escapeAttr(c.id)}" type="number" step="0.01" value="${escapeAttr(expVal)}" placeholder="—" />
              </div>
            </div>
            <div class="gc-cols" style="grid-template-columns: 1fr 1fr; gap:10px; margin-top:8px">
              <div>
                <div class="gc-mini">score</div>
                <input class="gc-input" data-cmp-score="${escapeAttr(c.id)}" type="number" step="0.01" value="${escapeAttr(scoreVal)}" placeholder="e.g., 18" />
              </div>
              <div>
                <div class="gc-mini">max</div>
                <input class="gc-input" data-cmp-max="${escapeAttr(c.id)}" type="number" step="0.01" value="${escapeAttr(maxVal)}" placeholder="e.g., 20" />
              </div>
            </div>
            <div class="gc-mini" style="margin-top:8px">
              actual: ${escapeHtml(actualStr)} • raw ${escapeHtml(rawScoreStr)} / ${escapeHtml(rawMaxStr)}
            </div>
          </td>
          <td class="gc-right">
            <div class="gc-actions" style="justify-content:flex-end">
              <button class="gc-btn gc-btn-danger" data-del-comp="${escapeAttr(c.id)}">delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <table class="gc-table">
        <thead><tr><th>component</th><th>numbers</th><th class="gc-right">actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${bonusRow}
    `;
  }

  function renderTargetSolver(subject){
    const comps = (subject.components || []).filter(c => (Number(c.weight)||0) > 0);
    if (comps.length === 0){
      return `<div class="gc-mini">add at least one component with weight &gt; 0 to use the solver.</div>`;
    }
    const missing = comps.filter(c => componentActualPercent(c) === null);
    if (missing.length === 0){
      return `<div class="gc-mini">all components already have actual values. clear a score to use the solver.</div>`;
    }
    const selectedSet = new Set(subject.solverSelectedIds || []);
    const opts = missing.map(c => {
      const selected = selectedSet.has(c.id) ? " selected" : "";
      return `<option value="${escapeAttr(c.id)}"${selected}>${escapeHtml(c.name || "component")} (${Number(c.weight)||0}%)</option>`;
    }).join("");
    const solverTargetVal = (subject.solverTarget === null || subject.solverTarget === undefined) ? "" : String(subject.solverTarget);

    return `
      <div class="gc-cols">
        <div>
          <div class="gc-mini">target final % <span class="gc-info" data-info="Goal for the overall final grade (bonus points are included if enabled).">i</span></div>
          <input class="gc-input" id="targetFinal" type="number" step="0.01" placeholder="e.g., 85" value="${escapeAttr(solverTargetVal)}" />
          <div class="gc-mini" style="margin-top:6px">${subjectBonusEnabled(subject) ? "bonus points are included automatically" : "bonuses are disabled"}</div>
        </div>
        <div>
          <div class="gc-mini">solve for components <span class="gc-info" data-info="Select one or more missing components to share the required average.">i</span></div>
          <select class="gc-input" id="solveComps" multiple size="4">${opts}</select>
          <div class="gc-mini" style="margin-top:6px">ctrl/cmd-click to select multiple</div>
        </div>
        <div>
          <div class="gc-mini">note</div>
          <div class="gc-mini" style="margin-top:6px">unselected missing components use expected % if set, otherwise 0%.</div>
        </div>
      </div>

      <div class="gc-actions" style="margin-top:10px">
        <button class="gc-btn gc-btn-primary" id="btnSolve">compute</button>
        <button class="gc-btn" id="btnSolveExample">example</button>
      </div>

      <div id="solveOut" class="gc-mini" style="margin-top:10px"></div>
    `;
  }

  // ---------- wiring ----------
  function wireSubjectDetails(subjectId){
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) return;

    const semNoSel = $("[data-sub-semno]");
    const creditsInp = $("[data-sub-credits]");
    const typeSel = $("[data-sub-type]");
    const yearInp = $("[data-sub-year]");
    const seasonSel = $("[data-sub-season]");
    const profInp = $("[data-sub-professor]");
    const termInp = $("[data-sub-term]");
    const statusSel = $("[data-sub-status]");
    const finalInp = $("[data-sub-final]");
    const finalTypeSel = $("[data-sub-finaltype]");
    const linkInp = $("[data-sub-infolink]");
    const bonusEnabledInp = $("[data-sub-bonus-enabled]");

    semNoSel?.addEventListener("change", () => {
      const v = semNoSel.value.trim();
      subject.semesterNo = v === "" ? null : clamp(Number(v), 1, 8);
      save(); renderSubjectList(); render();
    });
    creditsInp?.addEventListener("change", () => {
      const v = creditsInp.value.trim();
      subject.credits = v === "" ? null : (Number(v) || null);
      save();
    });
    typeSel?.addEventListener("change", () => { subject.type = typeSel.value || ""; save(); renderSubjectList(); });
    yearInp?.addEventListener("change", () => {
      const v = yearInp.value.trim();
      subject.year = v === "" ? null : (Number(v) || null);
      save(); renderSubjectList();
    });
    seasonSel?.addEventListener("change", () => { subject.season = seasonSel.value || ""; save(); renderSubjectList(); });
    profInp?.addEventListener("change", () => { subject.professor = profInp.value || ""; save(); renderSubjectList(); });
    termInp?.addEventListener("change", () => { subject.term = termInp.value || ""; save(); renderSubjectList(); });
    statusSel?.addEventListener("change", () => {
      subject.status = statusSel.value === "completed" ? "completed" : (statusSel.value === "upcoming" ? "upcoming" : "ongoing");
      applyAutoFinalIfCompleted(subject);
      save(); renderSubjectList(); render();
    });
    finalTypeSel?.addEventListener("change", () => {
      const v = finalTypeSel.value;
      subject.finalType = (v === "pass" || v === "fail") ? v : "numeric";
      applyAutoFinalIfCompleted(subject);
      save(); renderSubjectList(); render();
    });
    bonusEnabledInp?.addEventListener("change", () => {
      subject.bonusEnabled = bonusEnabledInp.checked;
      applyAutoFinalIfCompleted(subject);
      save(); render();
    });
    finalInp?.addEventListener("change", () => {
      const v = finalInp.value.trim();
      if (v === ""){
        subject.finalRecordedPercent = null;
      } else {
        const num = toNum(v);
        subject.finalRecordedPercent = num === null ? null : clamp(num, 0, 10) * 10;
      }
      applyAutoFinalIfCompleted(subject);
      save(); renderSubjectList();
    });
    linkInp?.addEventListener("change", () => {
      subject.infoLink = linkInp.value.trim();
      save();
    });

    $("#btnOpenLink")?.addEventListener("click", () => {
      const url = (subject.infoLink || "").trim();
      if (!url) return alert("no link set");
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  function wireComponents(subjectId){
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) return;

    $$("[data-cmp-name]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-name");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      c.name = inp.value.trim() || "component";
      applyAutoFinalIfCompleted(subject);
      save(); render();
    }));

    $$("[data-cmp-weight]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-weight");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      c.weight = Number(inp.value) || 0;
      applyAutoFinalIfCompleted(subject);
      save(); render();
    }));

    $$("[data-cmp-exp]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-exp");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      const v = inp.value.trim();
      c.expectedPercent = v === "" ? null : clamp(Number(v), 0, 100);
      applyAutoFinalIfCompleted(subject);
      save(); render();
    }));

    $$("[data-cmp-score]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-score");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      const v = inp.value.trim();
      c.score = v === "" ? null : toNum(v);
      applyAutoFinalIfCompleted(subject);
      save(); render();
    }));

    $$("[data-cmp-max]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-max");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      const v = inp.value.trim();
      c.max = v === "" ? null : toNum(v);
      applyAutoFinalIfCompleted(subject);
      save(); render();
    }));

    $("[data-sub-bonus-points]")?.addEventListener("change", (e) => {
      const v = e.target.value.trim();
      subject.courseBonusPercentPoints = v === "" ? 0 : clamp(toNum(v) || 0, 0, 10);
      applyAutoFinalIfCompleted(subject);
      save(); render();
    });

    $$("[data-del-comp]").forEach(btn => btn.addEventListener("click", () => {
      const cid = btn.getAttribute("data-del-comp");
      if (!confirm("delete this component?")) return;
      subject.components = (subject.components||[]).filter(c => c.id !== cid);
      save(); render();
    }));
  }

  function wireRequiredRemaining(subjectId){
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) return;
    const inp = $("#targetRemaining");
    if (!inp) return;
    inp.addEventListener("change", () => {
      const v = inp.value.trim();
      subject.targetRemaining = v === "" ? null : toNum(v);
      save(); render();
    });
  }

  function wireTargetSolver(subjectId){
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) return;

    const fmtPct = (v) => `${roundTo(v, state.settings.rounding).toFixed(state.settings.rounding)}%`;
    const compute = () => {
      const out = $("#solveOut");
      if (!out) return;

      const targetRaw = $("#targetFinal")?.value?.trim() || "";
      const target = targetRaw === "" ? null : toNum(targetRaw);
      const select = $("#solveComps");
      const selectedIds = select ? Array.from(select.selectedOptions).map(o => o.value) : [];

      if (target === null){
        out.textContent = "enter target final %";
        return;
      }
      if (selectedIds.length === 0){
        out.textContent = "select at least one component";
        return;
      }

      const res = requiredOnSelectedComponents(subject, target, selectedIds);
      if (!res.ok){
        out.textContent = res.msg || "error";
        return;
      }

      let requiredDisplay = fmtPct(res.requiredPercent);
      if (res.requiredPercent > 100){
        const finalAt100 = finalWithSelectedAt(subject, selectedIds, 100);
        if (finalAt100 !== null){
          const deficit = Math.max(0, Number(target) - finalAt100);
          if (subjectBonusEnabled(subject)){
            const bonusPts = roundTo(deficit / 10, state.settings.rounding).toFixed(state.settings.rounding);
            requiredDisplay = `100% + ${bonusPts} bonus pts`;
          } else {
            const extraPct = roundTo(deficit, state.settings.rounding).toFixed(state.settings.rounding);
            requiredDisplay = `100% + ${extraPct}%`;
          }
        } else {
          requiredDisplay = "100% + extra";
        }
      }
      let msg = `required avg on selected (${roundTo(res.selectedW, 2)}% weight): ${requiredDisplay}`;
      if (res.alreadySecured) msg += " (already secured)";

      const notes = [];
      if (res.expectedW > 0) notes.push(`uses expected % for ${roundTo(res.expectedW, 2)}% weight`);
      if (res.zeroW > 0) notes.push(`assumes 0% for ${roundTo(res.zeroW, 2)}% weight`);

      out.innerHTML = `<div class="gc-mini">${escapeHtml(msg)}</div>` +
        (notes.length ? `<div class="gc-mini" style="margin-top:6px">${notes.map(escapeHtml).join(" • ")}</div>` : "");
    };

    const targetInp = $("#targetFinal");
    const select = $("#solveComps");
    targetInp?.addEventListener("input", () => {
      const v = targetInp.value.trim();
      subject.solverTarget = v === "" ? null : toNum(v);
      save();
      compute();
    });
    select?.addEventListener("change", () => {
      subject.solverSelectedIds = Array.from(select.selectedOptions).map(o => o.value);
      save();
      compute();
    });

    $("#btnSolveExample")?.addEventListener("click", () => {
      $("#targetFinal").value = "85";
      const select = $("#solveComps");
      if (select){
        Array.from(select.options).forEach((o, i) => { o.selected = i < 2; });
      }
      subject.solverTarget = 85;
      subject.solverSelectedIds = select ? Array.from(select.selectedOptions).map(o => o.value) : [];
      save();
      compute();
    });

    $("#btnSolve")?.addEventListener("click", () => {
      compute();
    });

    compute();
  }

  // ---------- dialogs / operations ----------
  function openAddSubject(){
    $("#subName").value = "";
    $("#subSemNo").value = state.settings.defaultSemester ? String(state.settings.defaultSemester) : "";
    $("#subCredits").value = "";
    $("#subYear").value = "";
    $("#subSeason").value = "";
    $("#subTerm").value = "";
    openDlg($("#dlgSubject"));
    $("#subName").focus();
  }

  function createSubject(){
    const name = $("#subName").value.trim();
    if (!name) return alert("subject name required");

    const semNo = toNum($("#subSemNo").value);
    const creditsRaw = $("#subCredits").value.trim();
    const defaultCredits = Number(state.settings.defaultCredits);
    const fallbackCredits = Number.isFinite(defaultCredits) && defaultCredits > 0 ? defaultCredits : 5;
    const credits = creditsRaw === "" ? fallbackCredits : toNum(creditsRaw);
    if (credits === null || credits <= 0) return alert("credits required (e.g., 6)");

    const year = toNum($("#subYear").value);
    const season = $("#subSeason").value || "";
    const term = $("#subTerm").value.trim();

    const s = normalizeSubject({
      id: uuid(),
      name,
      semesterNo: semNo === null ? null : clamp(Math.round(semNo), 1, 8),
      credits,
      year: year === null ? null : Math.round(year),
      season,
      term,
      status: (state.settings.defaultStatus === "completed" || state.settings.defaultStatus === "upcoming" || state.settings.defaultStatus === "ongoing")
        ? state.settings.defaultStatus
        : "ongoing",
      finalRecordedPercent: null,
      finalType: "numeric",
      courseBonusPercentPoints: 0,
      bonusEnabled: false,
      solverTarget: null,
      solverSelectedIds: [],
      components: [],
      infoLink: ""
    });

    state.subjects.unshift(s);
    state.ui.activeSubjectId = s.id;
    state.ui.view = "subject";
    save();
    closeDlg($("#dlgSubject"));
    render();
  }

  function renameSubject(subjectId){
    const s = state.subjects.find(x => x.id === subjectId);
    if (!s) return;
    const name = prompt("new subject name:", s.name || "");
    if (name === null) return;
    const n = name.trim();
    if (!n) return alert("name cannot be empty");
    s.name = n;
    save(); render();
  }

  function deleteSubject(subjectId){
    const s = state.subjects.find(x => x.id === subjectId);
    if (!s) return;
    if (!confirm(`delete subject "${s.name}"?`)) return;
    state.subjects = state.subjects.filter(x => x.id !== subjectId);
    if (state.ui.activeSubjectId === subjectId) state.ui.activeSubjectId = state.subjects[0]?.id || null;
    save(); render();
  }

  function openAddComponent(subjectId){
    $("#dlgComponent").dataset.subjectId = subjectId;
    $("#cmpName").value = "";
    $("#cmpWeight").value = "";
    $("#cmpExpected").value = "";
    openDlg($("#dlgComponent"));
    $("#cmpName").focus();
  }

  function createComponent(){
    const subjectId = $("#dlgComponent").dataset.subjectId;
    const s = state.subjects.find(x => x.id === subjectId);
    if (!s) return;

    const name = $("#cmpName").value.trim();
    const w = toNum($("#cmpWeight").value);
    const expTxt = $("#cmpExpected").value.trim();
    const exp = expTxt === "" ? null : toNum(expTxt);

    if (!name) return alert("component name required");
    if (w === null) return alert("weight required");

    s.components.push({
      id: uuid(),
      name,
      weight: w,
      expectedPercent: exp === null ? null : clamp(exp, 0, 100),
      bonusPoints: 0,
      score: null,
      max: null,
      items: []
    });

    applyAutoFinalIfCompleted(s);
    save();
    closeDlg($("#dlgComponent"));
    render();
  }
  // Export/Import/Reset/Settings
  function exportData(){
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gradecalc_export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function openImport(){
    const fileInput = $("#importFile");
    if (fileInput) fileInput.value = "";
    openDlg($("#dlgImport"));
  }

  function doImport(){
    const fileInput = $("#importFile");
    const file = fileInput?.files?.[0];
    if (!file) return alert("choose a json file first");
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const txt = String(reader.result || "").trim();
        const data = JSON.parse(txt);
        if (!data || typeof data !== "object" || !Array.isArray(data.subjects)) {
          return alert("invalid format (expected {subjects:[...]})");
        }
        const base = defaultState();
        state = {
          ...base,
          ...data,
          settings: { ...base.settings, ...(data.settings || {}) },
          ui: { ...base.ui, ...(data.ui || {}) },
          subjects: data.subjects.map(normalizeSubject)
        };
        save();
        closeDlg($("#dlgImport"));
        render();
      } catch(e){ alert("json parse error: " + e.message); }
    };
    reader.onerror = () => alert("could not read file");
    reader.readAsText(file);
  }

  function resetAll(){
    if (!confirm("reset everything?")) return;
    state = defaultState();
    save(); render();
  }

  function openSettings(){
    $("#setScale").value = state.settings.scale;
    $("#setRound").value = String(state.settings.rounding);
    $("#setTenMax").value = String(state.settings.tenMax);
    $("#setCap100").value = state.settings.cap100;
    $("#setPassThreshold").value = String(state.settings.passThreshold ?? 4);
    $("#setDefaultCredits").value = String(state.settings.defaultCredits ?? 5);
    $("#setDefaultStatus").value = state.settings.defaultStatus || "ongoing";
    $("#setDefaultSemester").value = state.settings.defaultSemester ? String(state.settings.defaultSemester) : "";
    openDlg($("#dlgSettings"));
  }

  function saveSettings(){
    state.settings.scale = $("#setScale").value;
    state.settings.rounding = clamp(Number($("#setRound").value || 1), 0, 4);
    state.settings.tenMax = Number($("#setTenMax").value || 10);
    state.settings.cap100 = $("#setCap100").value;
    const passThresholdVal = toNum($("#setPassThreshold").value);
    state.settings.passThreshold = passThresholdVal === null ? 4 : clamp(passThresholdVal, 0, 10);
    const defaultCreditsVal = toNum($("#setDefaultCredits").value);
    state.settings.defaultCredits = defaultCreditsVal && defaultCreditsVal > 0 ? defaultCreditsVal : 5;
    const defaultStatusVal = $("#setDefaultStatus").value;
    state.settings.defaultStatus = (defaultStatusVal === "completed" || defaultStatusVal === "upcoming" || defaultStatusVal === "ongoing")
      ? defaultStatusVal
      : "ongoing";
    const defaultSemesterVal = $("#setDefaultSemester").value;
    state.settings.defaultSemester = defaultSemesterVal === "" ? "" : clamp(Math.round(Number(defaultSemesterVal)), 1, 8);
    state.settings.bonusEnabled = "yes";
    save();
    closeDlg($("#dlgSettings"));
    render();
  }

  // ---------- global wiring ----------
  $("#btnAddSubject").addEventListener("click", openAddSubject);
  $("#createSubject").addEventListener("click", createSubject);

  $("#createComponent").addEventListener("click", createComponent);

  $("#btnDashboard").addEventListener("click", () => { state.ui.view = "dashboard"; save(); render(); });
  $("#btnStats").addEventListener("click", () => { state.ui.view = "stats"; save(); render(); });

  $("#btnSettings").addEventListener("click", openSettings);
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#btnResetInSettings").addEventListener("click", () => { closeDlg($("#dlgSettings")); resetAll(); });

  $("#btnExport").addEventListener("click", exportData);
  $("#btnImport").addEventListener("click", openImport);
  $("#doImport").addEventListener("click", doImport);
  window.addEventListener("resize", () => requestAnimationFrame(syncSidebarHeight));
  initInfoTips();

  $("#search").addEventListener("input", (e) => {
    state.ui.search = e.target.value || "";
    save();
    renderSubjectList();
  });

  $$("dialog [data-close]").forEach(btn => btn.addEventListener("click", () => closeDlg(btn.closest("dialog"))));

  if (!state.ui.activeSubjectId && state.subjects[0]){
    state.ui.activeSubjectId = state.subjects[0].id;
    save();
  }

  render();
})();
