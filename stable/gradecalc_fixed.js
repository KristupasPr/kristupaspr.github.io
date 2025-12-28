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

  const defaultState = () => ({
    settings: {
      scale: "percent",
      rounding: 1,
      tenMax: 10,
      cap100: "no",
      bonusEnabled: "yes"
    },
    ui: { view: "subject", activeSubjectId: null, search: "" },
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

      status: (s.status === "completed" || s.status === "ongoing") ? s.status : "ongoing",
      finalRecordedPercent: (s.finalRecordedPercent === null || s.finalRecordedPercent === undefined) ? null : Number(s.finalRecordedPercent),

      // bonuses
      courseBonusPercentPoints: Number(s.courseBonusPercentPoints) || 0,

      components: Array.isArray(s.components) ? s.components.map(c => {
        // migrate: if old "items" exist, collapse into aggregate score/max.
        let aggScore = (c.score === null || c.score === undefined) ? null : Number(c.score);
        let aggMax = (c.max === null || c.max === undefined) ? null : Number(c.max);
        let aggDate = c.date || null;

        if ((!Number.isFinite(aggScore) || !Number.isFinite(aggMax)) && Array.isArray(c.items) && c.items.length){
          let ssum = 0, msum = 0;
          for (const it of c.items){
            const sc = Number(it.score);
            const mx = Number(it.max);
            if (!Number.isFinite(sc) || !Number.isFinite(mx) || mx <= 0) continue;
            ssum += sc; msum += mx;
          }
          aggScore = Number.isFinite(ssum) ? ssum : null;
          aggMax = Number.isFinite(msum) ? msum : null;
          // keep latest date if present
          const dated = c.items.map(it => it.date).filter(Boolean).sort();
          if (dated.length) aggDate = dated[dated.length - 1];
        }

        return ({
          id: c.id || uuid(),
          name: c.name || "component",
          weight: Number(c.weight) || 0,
          expectedPercent: (c.expectedPercent === "" || c.expectedPercent === undefined) ? null : (c.expectedPercent === null ? null : Number(c.expectedPercent)),
          bonusPoints: Number(c.bonusPoints) || 0,
          score: Number.isFinite(aggScore) ? aggScore : null,
          max: Number.isFinite(aggMax) ? aggMax : null,
          date: aggDate
        });
      }) : []
      })) : []
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
  state.settings = { ...defaultState().settings, ...state.settings };
  save();

  const openDlg = (dlg) => { try { dlg.showModal(); } catch { dlg.setAttribute("open",""); } };
  const closeDlg = (dlg) => { try { dlg.close(); } catch { dlg.removeAttribute("open"); } };

  // ---------- calculations ----------
  function bonusEnabled(){
    return state.settings.bonusEnabled === "yes";
  }

  function componentTotals(cmp){
    const sc = (cmp.score === null || cmp.score === undefined) ? null : Number(cmp.score);
    const mx = (cmp.max === null || cmp.max === undefined) ? null : Number(cmp.max);
    const rawScore = (Number.isFinite(sc) ? sc : 0);
    const max = (Number.isFinite(mx) ? mx : 0);
    const bonus = bonusEnabled() ? (Number(cmp.bonusPoints) || 0) : 0;
    return { rawScore, bonus, score: rawScore + bonus, max };
  }

  function componentActualPercent(cmp){
    const t = componentTotals(cmp);
    if (t.max <= 0) return null;
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

    const courseBonus = bonusEnabled() ? (Number(subject.courseBonusPercentPoints) || 0) : 0;
    const projectedFinal = projectedBase === null ? null : (projectedBase + courseBonus);

    const weightSumOk = (Wtotal > 0) ? (Math.abs(Wtotal - 100) < 1e-9) : false;
    return { Wtotal, gradedW, progress, projectedBase, projectedFinal, courseBonus, weightSumOk };
  }

  function subjectFinalForStats(subject){
    if (subject.status === "completed" && Number.isFinite(Number(subject.finalRecordedPercent))) {
      return Number(subject.finalRecordedPercent);
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

  // Solver includes course bonus (if enabled)
  function requiredOnComponent(subject, componentId, targetFinalPercent){
    const comps = subject.components || [];
    const Wtotal = subjectWeights(subject);
    const courseBonus = bonusEnabled() ? (Number(subject.courseBonusPercentPoints) || 0) : 0;
    const tgtBase = Number(targetFinalPercent) - courseBonus;

    const cmp = comps.find(c => c.id === componentId);
    if (!cmp) return { ok:false, msg:"component not found" };

    const wx = Number(cmp.weight) || 0;
    if (Wtotal <= 0) return { ok:false, msg:"no weights set" };
    if (wx <= 0) return { ok:false, msg:"component weight must be > 0" };

    let sumOther = 0;
    for (const c of comps){
      if (c.id === componentId) continue;
      const w = Number(c.weight) || 0;
      const used = componentPercentUsed(c);
      const p = (used.value === null) ? 0 : used.value;
      sumOther += w * p;
    }

    const required = (tgtBase * Wtotal - sumOther) / wx;
    return {
      ok: true,
      requiredPercent: required,
      impossible: (required > 100 + 1e-9),
      alreadySecured: (required < 0 - 1e-9)
    };
  }

  function requiredPointsForPlannedItem(component, requiredCompPercent, plannedMax){
    const t = componentTotals(component);
    const M = Number(plannedMax);
    if (!Number.isFinite(M) || M <= 0) return { ok:false, msg:"planned max must be > 0" };
    const p = Number(requiredCompPercent) / 100;
    const x = p * (t.max + M) - t.score;
    return { ok:true, required: x, max: M };
  }

  // ---------- rendering ----------
  function render(){
    renderSubjectList();
    if (state.ui.view === "dashboard") renderDashboard();
    else if (state.ui.view === "stats") renderStats();
    else renderSubject(activeSubject());
  }

  function renderSubjectList(){
    const list = $("#subjectList");
    const q = (state.ui.search || "").trim().toLowerCase();
    const filtered = state.subjects.filter(s => {
      if (!q) return true;
      return (s.name || "").toLowerCase().includes(q)
          || subjectMetaLabel(s).toLowerCase().includes(q)
          || (s.professor || "").toLowerCase().includes(q)
          || (s.type || "").toLowerCase().includes(q);
    });

    $("#subjectCount").textContent = `${filtered.length}/${state.subjects.length}`;
    list.innerHTML = "";

    if (filtered.length === 0){
      list.innerHTML = `<div class="gc-mini">no subjects yet. click <span class="gc-pill">+ subject</span>.</div>`;
      return;
    }

    for (const s of filtered){
      const fin = subjectFinalForStats(s);
      const el = document.createElement("div");
      el.className = "gc-subject" + (s.id === state.ui.activeSubjectId ? " active" : "");
      el.innerHTML = `
        <div class="name">${escapeHtml(s.name || "untitled")}</div>
        <div class="meta">${escapeHtml(subjectMetaLabel(s))} • ${escapeHtml(s.status)} • ${escapeHtml(displayGrade(fin))}</div>
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
      return {
        id:s.id, name:s.name||"untitled", meta:subjectMetaLabel(s), status:s.status,
        projected:m.projectedFinal, progress:m.progress, Wtotal:m.Wtotal
      };
    });

    const proj = rows.map(r => r.projected).filter(v => typeof v === "number");
    const avg = proj.length ? proj.reduce((a,b)=>a+b,0)/proj.length : null;

    main.innerHTML = `
      <div class="gc-card">
        <h2>dashboard</h2>
        <div class="gc-row" style="justify-content:space-between; align-items:center">
          <div class="gc-mini">quick overview (uses projected final)</div>
          <div class="gc-pill">avg projected: ${escapeHtml(displayGrade(avg))}</div>
        </div>

        <table class="gc-table">
          <thead>
            <tr><th>subject</th><th>sem</th><th>status</th><th class="gc-right">progress</th><th class="gc-right">projected</th><th class="gc-right">weights</th></tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td><a href="#" data-open="${escapeAttr(r.id)}">${escapeHtml(r.name)}</a></td>
                <td class="gc-mini">${escapeHtml(r.meta)}</td>
                <td class="gc-mini">${escapeHtml(r.status)}</td>
                <td class="gc-right">${escapeHtml(displayGrade(r.progress))}</td>
                <td class="gc-right">${escapeHtml(displayGrade(r.projected))}</td>
                <td class="gc-right gc-mini">${escapeHtml(String(roundTo(r.Wtotal,2) || 0))}%</td>
              </tr>
            `).join("") : `<tr><td colspan="6" class="gc-mini">no subjects</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    $$("[data-open]").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const id = a.getAttribute("data-open");
        state.ui.activeSubjectId = id;
        state.ui.view = "subject";
        save(); render();
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

    // group by semesterNo primarily
    const bySem = new Map();
    for (const s of state.subjects){
      const k = s.semesterNo ? `Semester ${s.semesterNo}` : "Semester —";
      if (!bySem.has(k)) bySem.set(k, []);
      bySem.get(k).push(s);
    }

    const semKeys = Array.from(bySem.keys()).sort((a,b) => {
      const na = parseInt(a.replace(/\D+/g,""),10);
      const nb = parseInt(b.replace(/\D+/g,""),10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });

    let overallCredits = 0;
    let overallWeighted = 0;
    let completedCount = 0;

    const semRows = semKeys.map(k => {
      const subjects = bySem.get(k);
      let cSum = 0, wSum = 0, usable = 0;

      for (const s of subjects){
        if (s.status === "completed") completedCount += 1;
        const final = subjectFinalForStats(s);
        if (typeof final === "number" && Number.isFinite(final)){
          const cr = creditsValue(s);
          cSum += cr;
          wSum += cr * final;
          usable += 1;
          overallCredits += cr;
          overallWeighted += cr * final;
        }
      }
      const avg = cSum > 0 ? (wSum / cSum) : null;
      return { semKey:k, subjects, credits:cSum, avg };
    });

    const overallAvg = overallCredits > 0 ? (overallWeighted / overallCredits) : null;

    main.innerHTML = `
      <div class="gc-card">
        <h2>stats</h2>
        <div class="gc-row" style="justify-content:space-between; align-items:center">
          <div class="gc-mini">credit-weighted averages • credits default to 1 if empty</div>
          <div class="gc-pill">overall studies: ${escapeHtml(displayGrade(overallAvg))}</div>
        </div>

        <div class="gc-row" style="margin-top:10px">
          <div class="gc-pill">subjects: ${escapeHtml(String(state.subjects.length))}</div>
          <div class="gc-pill">completed: ${escapeHtml(String(completedCount))}</div>
          <div class="gc-pill">total credits: ${escapeHtml(String(roundTo(overallCredits, 2)))}</div>
          <div class="gc-pill">bonuses: ${escapeHtml(bonusEnabled() ? "enabled" : "disabled")}</div>
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
                <td class="gc-right">${escapeHtml(String(roundTo(r.credits, 2)))}</td>
                <td class="gc-right">${escapeHtml(displayGrade(r.avg))}</td>
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

    box.innerHTML = `
      <div class="gc-card" style="margin:0">
        <h2>${escapeHtml(semKey)} :: subjects</h2>
        <table class="gc-table">
          <thead><tr><th>subject</th><th class="gc-right">credits</th><th>meta</th><th class="gc-right">final used</th></tr></thead>
          <tbody>
            ${subjects.map(s => {
              const fin = subjectFinalForStats(s);
              return `
                <tr>
                  <td><a href="#" data-open="${escapeAttr(s.id)}">${escapeHtml(s.name || "untitled")}</a></td>
                  <td class="gc-right gc-mini">${escapeHtml(String(creditsValue(s)))}</td>
                  <td class="gc-mini">${escapeHtml([s.year, s.season].filter(Boolean).join(" ") || "—")}</td>
                  <td class="gc-right">${escapeHtml(displayGrade(fin))}</td>
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
            <div class="t">progress</div>
            <div class="v">${escapeHtml(displayGrade(m.progress))}</div>
          </div>
          <div class="gc-kpi">
            <div class="t">projected base</div>
            <div class="v">${escapeHtml(displayGrade(m.projectedBase))}</div>
          </div>
          <div class="gc-kpi" ${bonusEnabled() ? "" : 'data-bonus-disabled="true"'}>
            <div class="t">projected final</div>
            <div class="v">${escapeHtml(displayGrade(m.projectedFinal))}</div>
          </div>
        </div>

        <div class="gc-row" style="justify-content:space-between; align-items:center; margin-top:12px">
          <div class="gc-mini">projected final includes bonuses (if enabled)</div>
          <div class="gc-pill">bonuses: ${escapeHtml(bonusEnabled() ? "enabled" : "disabled")}</div>
        </div>
      </div>

      <div class="gc-card">
        <h2>details</h2>
        ${renderSubjectDetails(subject)}
      </div>

      <div class="gc-card" ${bonusEnabled() ? "" : 'data-bonus-disabled="true"'}>
        <h2>bonus</h2>
        ${renderBonusPanel(subject)}
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
    wireBonusPanel(subject.id);
    wireComponents(subject.id);
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
    const finalVal = (subject.finalRecordedPercent === null || subject.finalRecordedPercent === undefined) ? "" : String(subject.finalRecordedPercent);
    const infoLink = (subject.infoLink || "").trim();

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
            <option value="completed" ${statusVal==="completed" ? "selected":""}>completed</option>
          </select>
        </div>
      </div>

      <div class="gc-cols" style="margin-top:10px">
        <div>
          <div class="gc-mini">final recorded % (completed)</div>
          <input class="gc-input" data-sub-final type="number" step="0.01" value="${escapeAttr(finalVal)}" placeholder="e.g., 92.5" />
          <div class="gc-mini" style="margin-top:6px">leave empty to use projected final.</div>
        </div>
        <div style="grid-column: span 2;">
          <div class="gc-mini">info link (e.g., sandas)</div>
          <div class="gc-row" style="align-items:center">
            <input class="gc-input" data-sub-infolink value="${escapeAttr(infoLink)}" placeholder="https://..." />
            <button class="gc-btn" id="btnOpenLink">open</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderBonusPanel(subject){
    const courseBonus = Number(subject.courseBonusPercentPoints) || 0;
    const comps = subject.components || [];
    const rows = comps.length ? `
      <table class="gc-table">
        <thead><tr><th>component</th><th class="gc-right">bonus points</th></tr></thead>
        <tbody>
          ${comps.map(c => `
            <tr>
              <td>${escapeHtml(c.name || "component")}</td>
              <td class="gc-right">
                <input class="gc-input" style="max-width:160px; display:inline-block" data-bonus-comp="${escapeAttr(c.id)}" type="number" step="0.01" value="${escapeAttr(String(Number(c.bonusPoints)||0))}" />
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : `<div class="gc-mini">no components yet.</div>`;

    return `
      <div class="gc-cols">
        <div>
          <div class="gc-mini">course bonus (percentage points)</div>
          <input class="gc-input" data-bonus-course type="number" step="0.01" value="${escapeAttr(String(courseBonus))}" />
          <div class="gc-mini" style="margin-top:6px">adds directly to final grade (e.g., +2.0pp).</div>
        </div>
        <div style="grid-column: span 2;">
          <div class="gc-mini">per-component bonus points</div>
          <div class="gc-mini" style="margin-top:4px">adds to the component score without increasing max points.</div>
        </div>
      </div>
      <div style="margin-top:10px">${rows}</div>
    `;
  }

  function renderComponentsTable(subject){
    const comps = subject.components || [];
    if (comps.length === 0){
      return `<div class="gc-mini">no components yet. add one (e.g., test 20%, midterm 30%, exam 50%).</div>`;
    }

    const rows = comps.map(c => {
      const used = componentPercentUsed(c);
      const actual = componentActualPercent(c);
      const t = componentTotals(c);
      const actualStr = actual === null ? "—" : `${roundTo(actual, state.settings.rounding).toFixed(state.settings.rounding)}%`;
      const usedStr = used.value === null ? "missing" : `${roundTo(used.value, state.settings.rounding).toFixed(state.settings.rounding)}% (${used.kind})`;
      const itemsCount = (c.items || []).length;
      const expVal = (c.expectedPercent === null || c.expectedPercent === undefined) ? "" : String(c.expectedPercent);

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

            <div class="gc-cols" style="grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-top:10px">
              <div>
                <div class="gc-mini">score</div>
                <input class="gc-input" data-cmp-score="${escapeAttr(c.id)}" type="number" step="0.01" value="${escapeAttr(c.score===null||c.score===undefined?``:String(c.score))}" placeholder="—" />
              </div>
              <div>
                <div class="gc-mini">max</div>
                <input class="gc-input" data-cmp-max="${escapeAttr(c.id)}" type="number" step="0.01" value="${escapeAttr(c.max===null||c.max===undefined?``:String(c.max))}" placeholder="—" />
              </div>
              <div>
                <div class="gc-mini">date (optional)</div>
                <input class="gc-input" data-cmp-date="${escapeAttr(c.id)}" type="date" value="${escapeAttr(c.date ? new Date(c.date).toISOString().slice(0,10) : ``)}" />
              </div>
            </div>

            <div class="gc-mini" style="margin-top:8px">
              actual: ${escapeHtml(actualStr)} • raw ${escapeHtml(String(roundTo(t.rawScore,2)))} ${bonusEnabled() ? `+ bonus ${escapeHtml(String(roundTo(t.bonus,2)))}` : ""} / ${escapeHtml(String(roundTo(t.max,2)))}
            </div>
          </td>
          <td class="gc-right">
            <div class="gc-actions" style="justify-content:flex-end">
              <button class="gc-btn" data-clear-comp="${escapeAttr(c.id)}">clear</button>
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
    `;
  }

  function renderTargetSolver(subject){
    const comps = (subject.components || []).filter(c => (Number(c.weight)||0) > 0);
    if (comps.length === 0){
      return `<div class="gc-mini">add at least one component with weight &gt; 0 to use the solver.</div>`;
    }
    const opts = comps.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name || "component")} (${Number(c.weight)||0}%)</option>`).join("");

    return `
      <div class="gc-cols">
        <div>
          <div class="gc-mini">target final %</div>
          <input class="gc-input" id="targetFinal" type="number" step="0.01" placeholder="e.g., 85" />
          <div class="gc-mini" style="margin-top:6px">${bonusEnabled() ? "course bonus is included automatically" : "bonuses are disabled"}</div>
        </div>
        <div>
          <div class="gc-mini">solve for component</div>
          <select class="gc-input" id="solveComp">${opts}</select>
        </div>
        <div>
          <div class="gc-mini">planned item max (optional)</div>
          <input class="gc-input" id="plannedMax" type="number" step="0.01" placeholder="e.g., 100" />
          <div class="gc-mini" style="margin-top:6px">shows points needed on the next item</div>
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
    const linkInp = $("[data-sub-infolink]");

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
      subject.status = statusSel.value === "completed" ? "completed" : "ongoing";
      save(); renderSubjectList(); render();
    });
    finalInp?.addEventListener("change", () => {
      const v = finalInp.value.trim();
      subject.finalRecordedPercent = v === "" ? null : Number(v);
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

  function wireBonusPanel(subjectId){
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) return;

    const course = $("[data-bonus-course]");
    course?.addEventListener("change", () => {
      subject.courseBonusPercentPoints = Number(course.value) || 0;
      save(); render();
    });

    $$("[data-bonus-comp]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-bonus-comp");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      c.bonusPoints = Number(inp.value) || 0;
      save(); render();
    }));
  }

  function wireComponents(subjectId){
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) return;

    $$("[data-cmp-name]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-name");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      c.name = inp.value.trim() || "component";
      save(); render();
    }));

    $$("[data-cmp-weight]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-weight");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      c.weight = Number(inp.value) || 0;
      save(); render();
    }));

    $$("[data-cmp-exp]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-exp");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      const v = inp.value.trim();
      c.expectedPercent = v === "" ? null : clamp(Number(v), 0, 100);
      save(); render();
    }));


    $$("[data-cmp-score]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-score");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      const v = inp.value.trim();
      c.score = v === "" ? null : Number(v);
      save(); render();
    }));

    $$("[data-cmp-max]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-max");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      const v = inp.value.trim();
      c.max = v === "" ? null : Number(v);
      save(); render();
    }));

    $$("[data-cmp-date]").forEach(inp => inp.addEventListener("change", () => {
      const cid = inp.getAttribute("data-cmp-date");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      const v = inp.value;
      c.date = v ? new Date(v).toISOString() : null;
      save();
    }));

    
    $$("[data-clear-comp]").forEach(btn => btn.addEventListener("click", () => {
      const cid = btn.getAttribute("data-clear-comp");
      const c = (subject.components||[]).find(x => x.id === cid);
      if (!c) return;
      if (!confirm("clear score/max/date for this component?")) return;
      c.score = null; c.max = null; c.date = null;
      save(); render();
    }));

$$("[data-del-comp]").forEach(btn => btn.addEventListener("click", () => {
      const cid = btn.getAttribute("data-del-comp");
      if (!confirm("delete this component?")) return;
      subject.components = (subject.components||[]).filter(c => c.id !== cid);
      save(); render();
    }));
  }

  function wireTargetSolver(subjectId){
    const subject = state.subjects.find(s => s.id === subjectId);
    if (!subject) return;

    $("#btnSolveExample")?.addEventListener("click", () => {
      $("#targetFinal").value = "85";
      $("#plannedMax").value = "100";
    });

    $("#btnSolve")?.addEventListener("click", () => {
      const out = $("#solveOut");
      out.textContent = "";

      const target = toNum($("#targetFinal").value);
      if (target === null){ out.textContent = "enter target final %"; return; }

      const compId = $("#solveComp").value;
      const res = requiredOnComponent(subject, compId, target);
      if (!res.ok){ out.textContent = res.msg || "error"; return; }

      const comp = (subject.components||[]).find(c => c.id === compId);
      const rp = res.requiredPercent;

      let msg = `required on "${comp?.name || "component"}": ${roundTo(rp, state.settings.rounding).toFixed(state.settings.rounding)}%`;
      if (res.impossible) msg += " (impossible > 100%)";
      if (res.alreadySecured) msg += " (already secured ≤ 0%)";

      const plannedMax = toNum($("#plannedMax").value);
      if (plannedMax !== null && plannedMax > 0 && comp){
        const pts = requiredPointsForPlannedItem(comp, rp, plannedMax);
        if (pts.ok){
          msg += ` | planned item: need ${roundTo(pts.required, state.settings.rounding).toFixed(state.settings.rounding)} / ${plannedMax} pts`;
        }
      }

      out.textContent = msg;
    });
  }

  // ---------- dialogs / operations ----------
  function openAddSubject(){
    $("#subName").value = "";
    $("#subSemNo").value = "";
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
    const credits = toNum($("#subCredits").value);
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
      status: "ongoing",
      finalRecordedPercent: null,
      courseBonusPercentPoints: 0,
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
      date: null
    });

    save();
    closeDlg($("#dlgComponent"));
    render();
  }

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
    $("#importText").value = "";
    openDlg($("#dlgImport"));
  }

  function doImport(){
    const txt = $("#importText").value.trim();
    if (!txt) return alert("paste json first");
    try{
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
    $("#setBonusEnabled").value = state.settings.bonusEnabled;
    openDlg($("#dlgSettings"));
  }

  function saveSettings(){
    state.settings.scale = $("#setScale").value;
    state.settings.rounding = clamp(Number($("#setRound").value || 1), 0, 4);
    state.settings.tenMax = Number($("#setTenMax").value || 10);
    state.settings.cap100 = $("#setCap100").value;
    state.settings.bonusEnabled = $("#setBonusEnabled").value === "no" ? "no" : "yes";
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

  $("#btnExport").addEventListener("click", exportData);
  $("#btnImport").addEventListener("click", openImport);
  $("#doImport").addEventListener("click", doImport);

  $("#btnReset").addEventListener("click", resetAll);

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