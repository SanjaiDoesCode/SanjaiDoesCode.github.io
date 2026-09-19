// ===========================================================
// Exercise analysis: turns MoveNet keypoints into angles,
// then into rep counts + a 0-100 form score + live feedback.
// ===========================================================

// MoveNet (COCO) keypoint indices
const KP = {
  nose: 0, leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4,
  leftShoulder: 5, rightShoulder: 6,
  leftElbow: 7, rightElbow: 8,
  leftWrist: 9, rightWrist: 10,
  leftHip: 11, rightHip: 12,
  leftKnee: 13, rightKnee: 14,
  leftAnkle: 15, rightAnkle: 16,
};

const MIN_CONF = 0.35;

function angleAt(a, b, c) {
  // angle at point b, formed by rays b->a and b->c, in degrees
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return null;
  let cos = dot / (mag1 * mag2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function ok(kp) {
  return kp && kp.score >= MIN_CONF;
}

function pickSide(kps, leftKeys, rightKeys) {
  const leftScore = leftKeys.reduce((s, k) => s + (kps[KP[k]]?.score || 0), 0);
  const rightScore = rightKeys.reduce((s, k) => s + (kps[KP[k]]?.score || 0), 0);
  return leftScore >= rightScore ? "left" : "right";
}

// ---- base class: shared rep state machine ----
class RepCounter {
  constructor({ downAngle, upAngle }) {
    this.downAngle = downAngle;
    this.upAngle = upAngle;
    this.phase = "up"; // up | down
    this.reps = 0;
    this.scores = [];
    this.repHadFault = false;
  }
  registerAngle(angle, faultThisFrame) {
    if (faultThisFrame) this.repHadFault = true;
    if (this.phase === "up" && angle <= this.downAngle) {
      this.phase = "down";
    } else if (this.phase === "down" && angle >= this.upAngle) {
      this.phase = "up";
      this.reps += 1;
      const repScore = this.repHadFault ? 65 : 96;
      this.scores.push(repScore);
      this.repHadFault = false;
      return { repCompleted: true, repScore };
    }
    return { repCompleted: false };
  }
  avgScore() {
    if (!this.scores.length) return null;
    return Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length);
  }
}

// ---------------- SQUAT ----------------
function analyzeSquat(kps, counter) {
  const side = pickSide(kps, ["leftHip", "leftKnee", "leftAnkle"], ["rightHip", "rightKnee", "rightAnkle"]);
  const hip = kps[KP[side + "Hip"]];
  const knee = kps[KP[side + "Knee"]];
  const ankle = kps[KP[side + "Ankle"]];
  const shoulder = kps[KP[side + "Shoulder"]];

  if (![hip, knee, ankle, shoulder].every(ok)) {
    return { feedback: "Step back so your hips, knees and ankles are all visible.", warning: true };
  }

  const kneeAngle = angleAt(hip, knee, ankle);
  const backAngle = angleAt(shoulder, hip, knee);
  if (kneeAngle == null || backAngle == null) return { feedback: "Finding your pose…" };

  // knee valgus: horizontal distance knee should track roughly over ankle
  const kneeCave = Math.abs(knee.x - ankle.x) > Math.abs(hip.x - ankle.x) * 0.9 && kneeAngle < 130;
  const roundedBack = backAngle < 130;

  let fault = false, feedback = "Good depth — keep your chest up.", warning = false;
  if (counter.phase === "up" && kneeAngle > 160) {
    feedback = "Standing — drop into your squat.";
  }
  if (kneeAngle < 140 && kneeAngle > counter.downAngle) {
    feedback = "Keep lowering, aim for thighs parallel.";
  }
  if (kneeCave) { feedback = "Knees are caving in — push them out over your toes."; fault = true; warning = true; }
  if (roundedBack) { feedback = "Chest is dropping — keep your back straighter."; fault = true; warning = true; }
  if (kneeAngle <= counter.downAngle && !fault) { feedback = "Nice depth — now drive back up."; }

  const result = counter.registerAngle(kneeAngle, fault);
  return {
    feedback,
    warning,
    reps: counter.reps,
    repCompleted: result.repCompleted,
    readout: { primary: `${Math.round(kneeAngle)}°`, secondary: `${Math.round(backAngle)}°` },
  };
}

// ---------------- PUSH-UP ----------------
function analyzePushup(kps, counter) {
  const side = pickSide(kps, ["leftShoulder", "leftElbow", "leftWrist"], ["rightShoulder", "rightElbow", "rightWrist"]);
  const shoulder = kps[KP[side + "Shoulder"]];
  const elbow = kps[KP[side + "Elbow"]];
  const wrist = kps[KP[side + "Wrist"]];
  const hip = kps[KP[side + "Hip"]];
  const ankle = kps[KP[side + "Ankle"]];

  if (![shoulder, elbow, wrist, hip].every(ok)) {
    return { feedback: "Get your shoulder, elbow, wrist and hip in frame, from the side.", warning: true };
  }

  const elbowAngle = angleAt(shoulder, elbow, wrist);
  const bodyLine = ok(ankle) ? angleAt(shoulder, hip, ankle) : 180;
  if (elbowAngle == null) return { feedback: "Finding your pose…" };

  const hipSag = bodyLine < 155 && bodyLine > 0;
  let fault = false, feedback = "Good — controlled tempo.", warning = false;
  if (hipSag) { feedback = "Hips are sagging — brace your core in a straight line."; fault = true; warning = true; }
  else if (elbowAngle < 100) feedback = "Good depth — press back up.";
  else if (elbowAngle > 150) feedback = "Extended — lower with control.";

  const result = counter.registerAngle(elbowAngle, fault);
  return {
    feedback,
    warning,
    reps: counter.reps,
    repCompleted: result.repCompleted,
    readout: { primary: `${Math.round(elbowAngle)}°`, secondary: `${Math.round(bodyLine)}°` },
  };
}

// ---------------- BICEP CURL ----------------
function analyzeCurl(kps, counter) {
  const side = pickSide(kps, ["leftShoulder", "leftElbow", "leftWrist"], ["rightShoulder", "rightElbow", "rightWrist"]);
  const shoulder = kps[KP[side + "Shoulder"]];
  const elbow = kps[KP[side + "Elbow"]];
  const wrist = kps[KP[side + "Wrist"]];
  const hip = kps[KP[side + "Hip"]];

  if (![shoulder, elbow, wrist].every(ok)) {
    return { feedback: "Show your shoulder, elbow and wrist to the camera.", warning: true };
  }

  const elbowAngle = angleAt(shoulder, elbow, wrist);
  if (elbowAngle == null) return { feedback: "Finding your pose…" };

  // elbow drift: elbow shouldn't travel far from the torso line
  const elbowDrift = ok(hip) ? Math.abs(elbow.x - shoulder.x) > Math.abs(hip.x - shoulder.x) * 1.6 : false;

  let fault = false, feedback = "Smooth curl.", warning = false;
  if (elbowDrift) { feedback = "Elbow is drifting forward — pin it to your side."; fault = true; warning = true; }
  else if (elbowAngle < 50) feedback = "Full contraction — nice squeeze, now lower slowly.";
  else if (elbowAngle > 155) feedback = "Fully extended — curl back up.";

  const result = counter.registerAngle(elbowAngle, fault);
  return {
    feedback,
    warning,
    reps: counter.reps,
    repCompleted: result.repCompleted,
    readout: { primary: `${Math.round(elbowAngle)}°`, secondary: side },
  };
}

// ---------------- PLANK (isometric hold) ----------------
class PlankTimer {
  constructor() {
    this.heldMs = 0;
    this.lastTick = null;
    this.scores = [];
  }
  tick(goodForm) {
    const now = performance.now();
    if (this.lastTick != null && goodForm) {
      this.heldMs += now - this.lastTick;
    }
    this.lastTick = now;
    this.scores.push(goodForm ? 100 : 55);
  }
  avgScore() {
    if (!this.scores.length) return null;
    return Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length);
  }
  seconds() {
    return Math.floor(this.heldMs / 1000);
  }
}

function analyzePlank(kps, timer) {
  const side = pickSide(kps, ["leftShoulder", "leftHip", "leftAnkle"], ["rightShoulder", "rightHip", "rightAnkle"]);
  const shoulder = kps[KP[side + "Shoulder"]];
  const hip = kps[KP[side + "Hip"]];
  const ankle = kps[KP[side + "Ankle"]];

  if (![shoulder, hip, ankle].every(ok)) {
    return { feedback: "Get into plank side-on to the camera, full body visible.", warning: true };
  }

  const lineAngle = angleAt(shoulder, hip, ankle);
  if (lineAngle == null) return { feedback: "Finding your pose…" };

  let feedback = "Straight line — hold it.", warning = false, good = true;
  if (lineAngle < 160) {
    good = false; warning = true;
    feedback = hip.y > (shoulder.y + ankle.y) / 2 ? "Hips are sagging — lift them up." : "Hips are piking up — lower them.";
  }

  timer.tick(good);
  return {
    feedback,
    warning,
    seconds: timer.seconds(),
    readout: { primary: `${Math.round(lineAngle)}°`, secondary: `${timer.seconds()}s` },
  };
}

const ExerciseLibrary = {
  squat: {
    label: "Squat",
    unit: "reps",
    makeCounter: () => new RepCounter({ downAngle: 100, upAngle: 160 }),
    analyze: analyzeSquat,
  },
  pushup: {
    label: "Push-up",
    unit: "reps",
    makeCounter: () => new RepCounter({ downAngle: 95, upAngle: 155 }),
    analyze: analyzePushup,
  },
  curl: {
    label: "Bicep curl",
    unit: "reps",
    makeCounter: () => new RepCounter({ downAngle: 55, upAngle: 155 }),
    analyze: analyzeCurl,
  },
  plank: {
    label: "Plank",
    unit: "seconds held",
    makeCounter: () => new PlankTimer(),
    analyze: analyzePlank,
    isHold: true,
  },
};
