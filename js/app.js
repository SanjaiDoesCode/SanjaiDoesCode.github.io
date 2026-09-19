// ===========================================================
// App: wires up navigation, hero illustration, the workout
// flow (camera + pose engine + exercise analysis), auth modal,
// and the dashboard.
// ===========================================================
(function () {
  "use strict";

  /* ---------------- navigation ---------------- */
  const views = {
    landing: document.getElementById("view-landing"),
    workout: document.getElementById("view-workout"),
    dashboard: document.getElementById("view-dashboard"),
  };
  function showView(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("view--active", k === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (name === "dashboard") renderDashboard();
  }
  document.querySelectorAll("[data-nav]").forEach((el) =>
    el.addEventListener("click", () => showView(el.dataset.nav))
  );
  document.getElementById("startTrigger").addEventListener("click", () => showView("workout"));
  document.getElementById("heroStart").addEventListener("click", () => showView("workout"));
  document.querySelectorAll(".exercise-card[data-exercise]").forEach((card) =>
    card.addEventListener("click", () => {
      selectExercise(card.dataset.exercise);
      showView("workout");
    })
  );

  /* ---------------- toast ---------------- */
  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }

  /* ---------------- hero decorative skeleton ---------------- */
  (function drawHeroSkeleton() {
    const pts = {
      nose: [160, 40], leftShoulder: [130, 90], rightShoulder: [190, 90],
      leftElbow: [110, 140], rightElbow: [210, 140],
      leftWrist: [100, 190], rightWrist: [220, 190],
      leftHip: [138, 200], rightHip: [182, 200],
      leftKnee: [128, 275], rightKnee: [192, 275],
      leftAnkle: [122, 350], rightAnkle: [198, 350],
    };
    const pairs = [
      ["leftShoulder", "rightShoulder"], ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"],
      ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"],
      ["leftShoulder", "leftHip"], ["rightShoulder", "rightHip"], ["leftHip", "rightHip"],
      ["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"], ["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"],
    ];
    const lineGroup = document.getElementById("skelLines");
    const jointGroup = document.getElementById("skelJoints");
    pairs.forEach(([a, b], i) => {
      const [x1, y1] = pts[a], [x2, y2] = pts[b];
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1);
      line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      line.style.animationDelay = `${i * 0.06}s`;
      lineGroup.appendChild(line);
    });
    Object.values(pts).forEach(([x, y]) => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 5);
      jointGroup.appendChild(c);
    });
  })();

  /* ---------------- workout state ---------------- */
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const scoreRing = document.getElementById("scoreRing");
  const scoreNumber = document.getElementById("scoreNumber");
  const repCount = document.getElementById("repCount");
  const repLabel = document.getElementById("repLabel");
  const feedbackBanner = document.getElementById("feedbackBanner");
  const feedbackText = document.getElementById("feedbackText");
  const cameraToggle = document.getElementById("cameraToggle");
  const finishBtn = document.getElementById("finishBtn");
  const modelStatus = document.getElementById("modelStatus");
  const stagePlaceholder = document.getElementById("stagePlaceholder");
  const RING_CIRCUMFERENCE = 327;

  let currentExerciseKey = "squat";
  let counter = ExerciseLibrary[currentExerciseKey].makeCounter();
  let engine = null;
  let sessionStart = null;
  let cameraOn = false;
  let modelReady = false;

  function selectExercise(key) {
    currentExerciseKey = key;
    counter = ExerciseLibrary[key].makeCounter();
    repLabel.textContent = ExerciseLibrary[key].unit;
    repCount.textContent = "0";
    scoreNumber.textContent = "--";
    scoreRing.style.strokeDashoffset = RING_CIRCUMFERENCE;
    document.querySelectorAll(".picker-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.exercise === key));
    setFeedback("Step into frame to begin", false);
  }
  document.querySelectorAll(".picker-btn").forEach((b) => b.addEventListener("click", () => selectExercise(b.dataset.exercise)));

  function setFeedback(msg, warning) {
    feedbackText.textContent = msg;
    feedbackBanner.classList.toggle("is-warning", !!warning);
  }

  function updateScoreRing(score) {
    if (score == null) return;
    scoreNumber.textContent = score;
    const offset = RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * score) / 100;
    scoreRing.style.strokeDashoffset = offset;
    scoreRing.style.stroke = score >= 80 ? "#37F0A0" : score >= 60 ? "#FFB020" : "#FF5470";
  }

  function handlePoseFrame(keypoints) {
    const def = ExerciseLibrary[currentExerciseKey];
    const result = def.analyze(keypoints, counter);
    if (!result) return {};
    setFeedback(result.feedback, result.warning);
    if (def.isHold) {
      repCount.textContent = result.seconds ?? counter.seconds();
      updateScoreRing(counter.avgScore());
    } else {
      repCount.textContent = counter.reps;
      if (result.repCompleted) updateScoreRing(counter.avgScore());
    }
    return result;
  }

  async function ensureModel() {
    if (modelReady) return;
    modelStatus.textContent = "Loading pose model…";
    engine = new PoseEngine(video, canvas, { onPose: handlePoseFrame });
    await engine.loadModel();
    modelReady = true;
    modelStatus.textContent = "Model ready.";
  }

  cameraToggle.addEventListener("click", async () => {
    if (!cameraOn) {
      try {
        cameraToggle.disabled = true;
        cameraToggle.textContent = "Starting…";
        await ensureModel();
        await engine.startCamera();
        engine.start();
        cameraOn = true;
        sessionStart = performance.now();
        stagePlaceholder.style.display = "none";
        cameraToggle.textContent = "Stop camera";
        finishBtn.disabled = false;
        modelStatus.textContent = "Tracking live — step back into frame.";
      } catch (e) {
        console.error(e);
        modelStatus.textContent = "Camera or model failed to start. Check permissions.";
        cameraToggle.textContent = "Enable camera";
      } finally {
        cameraToggle.disabled = false;
      }
    } else {
      engine.stop();
      cameraOn = false;
      cameraToggle.textContent = "Enable camera";
      stagePlaceholder.style.display = "flex";
    }
  });

  finishBtn.addEventListener("click", async () => {
    const def = ExerciseLibrary[currentExerciseKey];
    const durationSeconds = sessionStart ? Math.round((performance.now() - sessionStart) / 1000) : 0;
    const reps = def.isHold ? counter.seconds() : counter.reps;
    const avgFormScore = counter.avgScore();

    if (!reps) {
      toast("Do at least one rep before saving.");
      return;
    }

    try {
      const session = await FormFitDB.getSession();
      if (!session && FormFitDB.isConfigured()) {
        openAuth("signin");
        toast("Sign in to save this session.");
        return;
      }
      await FormFitDB.saveSession({
        exercise: def.label,
        reps,
        durationSeconds,
        avgFormScore: avgFormScore ?? 0,
      });
      toast(FormFitDB.isConfigured() ? "Session saved to your account." : "Session finished (backend not configured — not saved).");
    } catch (e) {
      console.error(e);
      toast("Couldn't save session: " + e.message);
    }

    if (cameraOn) {
      engine.stop();
      cameraOn = false;
      cameraToggle.textContent = "Enable camera";
      stagePlaceholder.style.display = "flex";
    }
    selectExercise(currentExerciseKey);
    sessionStart = null;
  });

  selectExercise("squat");

  /* ---------------- auth modal ---------------- */
  const authModal = document.getElementById("authModal");
  const authForm = document.getElementById("authForm");
  const authTitle = document.getElementById("authTitle");
  const authSubmit = document.getElementById("authSubmit");
  const authSwitch = document.getElementById("authSwitch");
  const authError = document.getElementById("authError");
  const authTrigger = document.getElementById("authTrigger");
  let authMode = "signin";

  function openAuth(mode) {
    authMode = mode;
    authTitle.textContent = mode === "signin" ? "Sign in to FormFit" : "Create your FormFit account";
    authSubmit.textContent = mode === "signin" ? "Sign in" : "Create account";
    authSwitch.textContent = mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in";
    authError.textContent = "";
    if (!FormFitDB.isConfigured()) {
      authError.textContent = "Backend not configured yet — add your Supabase keys in js/config.js.";
    }
    authModal.classList.add("is-open");
  }
  document.getElementById("authClose").addEventListener("click", () => authModal.classList.remove("is-open"));
  authModal.addEventListener("click", (e) => { if (e.target === authModal) authModal.classList.remove("is-open"); });
  authTrigger.addEventListener("click", () => openAuth("signin"));
  authSwitch.addEventListener("click", () => openAuth(authMode === "signin" ? "signup" : "signin"));
  document.getElementById("authGuest").addEventListener("click", () => authModal.classList.remove("is-open"));

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    authError.textContent = "";
    authSubmit.disabled = true;
    try {
      if (authMode === "signin") await FormFitDB.signIn(email, password);
      else await FormFitDB.signUp(email, password);
      authModal.classList.remove("is-open");
      toast(authMode === "signin" ? "Signed in." : "Account created — check your inbox if confirmation is required.");
      refreshAuthUI();
    } catch (err) {
      authError.textContent = err.message || "Something went wrong.";
    } finally {
      authSubmit.disabled = false;
    }
  });

  async function refreshAuthUI() {
    const session = await FormFitDB.getSession();
    authTrigger.textContent = session ? "Sign out" : "Sign in";
    authTrigger.onclick = session
      ? async () => { await FormFitDB.signOut(); toast("Signed out."); refreshAuthUI(); }
      : () => openAuth("signin");
    document.getElementById("dashboardSignedOutNote").style.display = session ? "none" : "block";
  }
  refreshAuthUI();
  FormFitDB.onAuthChange(() => refreshAuthUI());

  /* ---------------- dashboard ---------------- */
  let historyChart = null;
  async function renderDashboard() {
    const rows = await FormFitDB.getHistory(30);
    const historyList = document.getElementById("historyList");
    const streakValue = document.getElementById("streakValue");
    const avgScoreValue = document.getElementById("avgScoreValue");

    if (!rows.length) {
      historyList.innerHTML = '<p class="history-empty">No sessions yet — finish a workout to see it here.</p>';
      streakValue.innerHTML = '0<small>days</small>';
      avgScoreValue.innerHTML = '--<small>/100</small>';
    } else {
      historyList.innerHTML = rows
        .slice(0, 8)
        .map((r) => {
          const date = new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
          return `<div class="history-row">
            <span>${r.exercise}</span>
            <span class="history-row__meta">${r.reps} · ${r.avg_form_score ?? "--"} form · ${date}</span>
          </div>`;
        })
        .join("");

      const avg = Math.round(rows.reduce((s, r) => s + (r.avg_form_score || 0), 0) / rows.length);
      avgScoreValue.innerHTML = `${avg}<small>/100</small>`;
      streakValue.innerHTML = `${computeStreak(rows)}<small>days</small>`;
    }

    const byDay = {};
    rows.forEach((r) => {
      const d = new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      byDay[d] = (byDay[d] || 0) + 1;
    });
    const labels = Object.keys(byDay).reverse();
    const data = Object.values(byDay).reverse();

    const ctx = document.getElementById("historyChart");
    if (historyChart) historyChart.destroy();
    historyChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["No data"],
        datasets: [{ data: data.length ? data : [0], backgroundColor: "#37F0A0", borderRadius: 6, maxBarThickness: 28 }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#9098AC" } },
          y: { beginAtZero: true, ticks: { color: "#9098AC", stepSize: 1 }, grid: { color: "rgba(255,255,255,.06)" } },
        },
      },
    });
  }

  function computeStreak(rows) {
    const days = new Set(rows.map((r) => new Date(r.created_at).toDateString()));
    let streak = 0;
    let cursor = new Date();
    while (days.has(cursor.toDateString())) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }
})();
