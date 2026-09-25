// ====== Photo-realistic water surface (WebGL) — shared by all pages ======
// Any failure path hides the canvas so the static CSS photo in .backdrop shows instead.
(function () {
const canvas = document.getElementById('water');
if (!canvas) return;

function fallback(reason) {
  if (reason) console.warn('water: ' + reason + ' — using static backdrop');
  canvas.style.display = 'none';
}

// Visitors who asked for reduced motion get the static photo.
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { fallback(); return; }

// failIfMajorPerformanceCaveat: software-rendered WebGL (blocklisted GPU, VMs) would crawl,
// so fall back to the static photo there too.
const ctxOpts = {
  alpha: false, antialias: false, depth: false, stencil: false,
  premultipliedAlpha: false, preserveDrawingBuffer: false,
  failIfMajorPerformanceCaveat: true,
};
const gl = canvas.getContext('webgl', ctxOpts) || canvas.getContext('experimental-webgl', ctxOpts);
if (!gl) { fallback('WebGL unavailable'); return; }

// Max drawing-buffer size. The water is soft and blurry, so capping resolution on
// large / high-DPR screens is invisible but saves a lot of GPU work.
const PIXEL_BUDGET = 2.5e6;
let W = innerWidth, H = innerHeight, dpr = 1;

let mouseX = -9999, mouseY = -9999, prevMX = -9999, prevMY = -9999;
const MAX_RIPPLES = 8;
const ripples = [];
function spawnRipple(x, y, strength = 1) {
  ripples.push({ x, y, t: 0, life: 2.5, strength });
  if (ripples.length > MAX_RIPPLES) ripples.shift();
}
let lastSpawn = 0;
addEventListener('mousemove', e => {
  mouseX = e.clientX; mouseY = e.clientY;
  const now = performance.now();
  const d = Math.hypot(e.clientX - prevMX, e.clientY - prevMY);
  if (now - lastSpawn > 130 && d > 6) {
    spawnRipple(e.clientX, e.clientY, Math.min(1, d / 40));
    lastSpawn = now;
  }
  prevMX = e.clientX; prevMY = e.clientY;
}, { passive: true });
// mouseleave does not reach window; listen on the root element instead.
document.documentElement.addEventListener('mouseleave', () => { mouseX = mouseY = -9999; });
addEventListener('click', e => spawnRipple(e.clientX, e.clientY, 1.6));

// Ambient drops (skipped while the tab is hidden).
setInterval(() => {
  if (document.hidden) return;
  if (Math.random() < 0.35) spawnRipple(Math.random() * W, Math.random() * H, 0.3 + Math.random() * 0.3);
}, 1400);

const vsSrc = `
attribute vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }
`;

const fsSrc = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform vec3 uTint;
uniform float uTintAmount;
uniform float uDarken;
uniform sampler2D uTex;
uniform vec3 uRipples[8];

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i=0; i<4; i++){ v += a*noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);

  vec2 q = p * 1.3;
  vec2 swirl1 = vec2(
    fbm(q + vec2(uTime * 0.035, 0.0)),
    fbm(q + vec2(0.0, uTime * 0.03) + 17.3)
  );
  vec2 q2 = p * 3.0 + swirl1 * 0.7;
  vec2 swirl2 = vec2(
    fbm(q2 + vec2(uTime * 0.08, uTime * 0.02)),
    fbm(q2 + vec2(uTime * 0.025, uTime * 0.09) + 5.3)
  ) - 0.5;
  float swellX = sin(p.y * 2.2 + uTime * 0.18) + sin(p.y * 4.8 - uTime * 0.11) * 0.4;
  float swellY = cos(p.x * 1.7 - uTime * 0.14) + cos(p.x * 4.2 + uTime * 0.09) * 0.4;
  vec2 flow = swirl2 * 0.055 + vec2(swellX * 0.018, swellY * 0.014);

  vec2 rippleDisp = vec2(0.0);
  float rippleHi = 0.0;
  for (int i = 0; i < 8; i++){
    vec2 rp = uRipples[i].xy;
    float rt = uRipples[i].z;
    if (rt <= 0.0 || rt >= 2.5) continue;
    vec2 rpUv = (rp - 0.5 * uRes) / min(uRes.x, uRes.y);
    vec2 d = p - rpUv;
    float dist = length(d);
    float radius = rt * 0.3;
    float band = abs(dist - radius);
    float decay = 1.0 - rt / 2.5;
    float wave = sin((dist - radius) * 32.0) * exp(-band * 22.0);
    rippleDisp += normalize(d + vec2(0.0001)) * wave * 0.011 * decay;
    rippleHi += exp(-band * 28.0) * decay * 0.4;
  }

  float aspect = uRes.x / uRes.y;
  vec2 tuv = uv;
  float texAspect = 1.333;
  if (aspect > texAspect) {
    float h = texAspect / aspect;
    tuv.y = (uv.y - 0.5) * h + 0.5;
  } else {
    float w = aspect / texAspect;
    tuv.x = (uv.x - 0.5) * w + 0.5;
  }
  tuv += flow + rippleDisp * 0.6;
  tuv = clamp(tuv, 0.001, 0.999);

  vec3 col = texture2D(uTex, tuv).rgb;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 tinted = mix(col, uTint * (lum * 1.4 + 0.1), uTintAmount);
  col = tinted;

  col *= uDarken;
  col += vec3(1.0, 1.0, 1.0) * rippleHi * 0.25;

  vec2 mp = (uMouse - 0.5 * uRes) / min(uRes.x, uRes.y);
  float md = distance(p, mp);
  col += vec3(0.9, 0.95, 1.0) * exp(-md * 6.0) * 0.08;

  // vignette: 1 at the centre, fading out towards the edges
  float vig = 1.0 - smoothstep(0.5, 1.5, length(p));
  col *= mix(0.78, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
const vs = compile(gl.VERTEX_SHADER, vsSrc);
const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
if (!vs || !fs) { fallback('shader compile failed'); return; }
const program = gl.createProgram();
gl.attachShader(program, vs);
gl.attachShader(program, fs);
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  console.error(gl.getProgramInfoLog(program));
  fallback('shader link failed');
  return;
}
gl.useProgram(program);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
const a = gl.getAttribLocation(program, 'a');
gl.enableVertexAttribArray(a);
gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

const uRes = gl.getUniformLocation(program, 'uRes');
const uTime = gl.getUniformLocation(program, 'uTime');
const uMouse = gl.getUniformLocation(program, 'uMouse');
const uTint = gl.getUniformLocation(program, 'uTint');
const uTintAmount = gl.getUniformLocation(program, 'uTintAmount');
const uDarken = gl.getUniformLocation(program, 'uDarken');
const uTex = gl.getUniformLocation(program, 'uTex');
const uRipples = gl.getUniformLocation(program, 'uRipples');

const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 60, 100, 255]));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

const img = new Image();
img.onload = () => {
  if (gl.isContextLost()) return;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
};
img.onerror = () => fallback('water photo failed to load');
img.src = '/assets/water-main.jpg';

function resizeCanvas(){
  W = innerWidth; H = innerHeight;
  dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(PIXEL_BUDGET / Math.max(1, W * H)));
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  gl.viewport(0, 0, canvas.width, canvas.height);
}
resizeCanvas();
// Coalesce bursts of resize events (e.g. mobile toolbars) into one reallocation per frame.
let resizeQueued = false;
addEventListener('resize', () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; resizeCanvas(); });
});

// The site is dark-mode / blue-theme only.
const PALETTE = { tint: [0.35, 0.55, 0.95], amount: 0.5, darken: 0.45 };

let raf = 0;
canvas.addEventListener('webglcontextlost', () => {
  cancelAnimationFrame(raf);
  fallback('WebGL context lost');
}, false);

const rippleData = new Float32Array(MAX_RIPPLES * 3);
let lastT = 0;
function render(now){
  const t = now * 0.001;
  const dt = Math.min(0.05, (now - lastT) * 0.001 || 0.016);
  lastT = now;

  for (let i = ripples.length - 1; i >= 0; i--){
    ripples[i].t += dt;
    if (ripples[i].t >= ripples[i].life) ripples.splice(i, 1);
  }
  rippleData.fill(0);
  for (let i = 0; i < ripples.length && i < MAX_RIPPLES; i++){
    rippleData[i*3] = ripples[i].x * dpr;
    rippleData[i*3+1] = (H - ripples[i].y) * dpr;
    rippleData[i*3+2] = ripples[i].t;
  }

  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.uniform1f(uTime, t);
  gl.uniform2f(uMouse, mouseX * dpr, (H - mouseY) * dpr);
  gl.uniform3fv(uTint, PALETTE.tint);
  gl.uniform1f(uTintAmount, PALETTE.amount);
  gl.uniform1f(uDarken, PALETTE.darken);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(uTex, 0);
  gl.uniform3fv(uRipples, rippleData);

  gl.clearColor(0.05, 0.15, 0.25, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  raf = requestAnimationFrame(render);
}
raf = requestAnimationFrame(render);
})();
