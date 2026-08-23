// Dependency-free WebGL background for the hero: an animated aurora/flow field
// in CSQ's dark-green -> lime palette. One full-screen triangle + a fragment
// shader doing FBM noise. Handles resize (DPR capped at 2), pauses when the tab
// is hidden, and renders a single static frame under prefers-reduced-motion.
// All GL resources are freed on unmount.
import { useEffect, useRef } from "react";

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Palette mirrors the page: #022417 dark green base -> #d4ff00 lime glow.
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uRes.x / uRes.y;

  float t = uTime * 0.045;
  float n = fbm(p * 1.15 + vec2(t, -t * 0.7));
  float n2 = fbm(p * 2.1 - vec2(t * 0.6, t));
  float v = n * 0.6 + n2 * 0.4;

  vec3 dark = vec3(0.008, 0.027, 0.016);
  vec3 mid = vec3(0.02, 0.13, 0.07);
  vec3 lime = vec3(0.83, 1.0, 0.0);

  vec3 col = mix(dark, mid, smoothstep(0.18, 0.7, v));
  col = mix(col, lime, smoothstep(0.6, 0.95, v) * 0.45);

  // soft vignette so content stays readable
  float r = length(p);
  col *= 1.0 - smoothstep(0.65, 1.5, r) * 0.55;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function WebglBg({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Capture the narrowed, non-null canvas for use inside closures below —
    // TS does not carry the narrowing across function boundaries on its own.
    const cv = canvas;
    const gl = cv.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;
    // Non-null alias for closures (TS drops the narrowing across boundaries).
    const ctx = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // Fullscreen triangle
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(cv.clientWidth * dpr));
      const h = Math.max(1, Math.floor(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        ctx.viewport(0, 0, w, h);
      }
    }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let start = performance.now();
    let running = true;

    function render() {
      if (!running) return;
      const time = (performance.now() - start) / 1000;
      ctx.uniform2f(uRes, cv.width, cv.height);
      ctx.uniform1f(uTime, reduced ? 6.0 : time); // static-ish frame if reduced
      ctx.drawArrays(ctx.TRIANGLES, 0, 3);
      if (!reduced) raf = requestAnimationFrame(render);
    }

    // Pause when the tab is hidden to save GPU.
    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        running = true;
        start = performance.now() - 6000; // keep continuity-ish
        raf = requestAnimationFrame(render);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    render();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      ctx.deleteBuffer(buf);
      ctx.deleteShader(vs);
      ctx.deleteShader(fs);
      ctx.deleteProgram(prog);
      const loseCtx = ctx.getExtension("WEBGL_lose_context");
      loseCtx?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
