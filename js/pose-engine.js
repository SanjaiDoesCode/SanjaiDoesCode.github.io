// ===========================================================
// PoseEngine: camera + MoveNet pose detection + skeleton draw.
// ===========================================================
const POSE_PAIRS = [
  ["leftShoulder", "rightShoulder"], ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"],
  ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"],
  ["leftShoulder", "leftHip"], ["rightShoulder", "rightHip"], ["leftHip", "rightHip"],
  ["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"],
  ["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"],
];

class PoseEngine {
  constructor(video, canvas, { onPose } = {}) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.detector = null;
    this.running = false;
    this.onPose = onPose || (() => {});
    this.smoothed = null;
  }

  async loadModel() {
    await tf.setBackend("webgl");
    await tf.ready();
    this.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    });
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise((res) => (this.video.onloadedmetadata = res));
    this.video.play();
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
  }

  stopCamera() {
    const stream = this.video.srcObject;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }

  smooth(keypoints) {
    const alpha = 0.55;
    if (!this.smoothed) {
      this.smoothed = keypoints.map((k) => ({ ...k }));
      return this.smoothed;
    }
    this.smoothed = keypoints.map((k, i) => ({
      x: alpha * k.x + (1 - alpha) * this.smoothed[i].x,
      y: alpha * k.y + (1 - alpha) * this.smoothed[i].y,
      score: k.score,
      name: k.name,
    }));
    return this.smoothed;
  }

  draw(keypoints, warning) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const byName = {};
    keypoints.forEach((k) => (byName[k.name] = k));
    const lineColor = warning ? "#FF5470" : "#37F0A0";

    ctx.lineWidth = 4;
    ctx.strokeStyle = lineColor;
    ctx.lineCap = "round";
    POSE_PAIRS.forEach(([a, b]) => {
      const pa = byName[a], pb = byName[b];
      if (pa && pb && pa.score > 0.35 && pb.score > 0.35) {
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    });
    ctx.fillStyle = lineColor;
    keypoints.forEach((k) => {
      if (k.score > 0.35) {
        ctx.beginPath();
        ctx.arc(k.x, k.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  async start() {
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      if (this.video.readyState >= 2) {
        const poses = await this.detector.estimatePoses(this.video, { flipHorizontal: false });
        if (poses[0]) {
          const kp = this.smooth(poses[0].keypoints);
          const kpsByIndex = kp; // MoveNet returns in fixed COCO order
          const result = this.onPose(kpsByIndex);
          this.draw(kp, result && result.warning);
        } else {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    this.stopCamera();
    this.ctx && this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
