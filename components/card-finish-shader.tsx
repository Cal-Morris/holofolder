"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { CardFinish } from "@/hooks/use-collection"

const TARGET_FRAME_MS = 1000 / 30
const REDUCED_MOTION_FRAME_MS = 1000 / 12
const MAX_SHADER_PIXEL_RATIO = 1.35

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform vec2 u_resolution;
uniform vec2 u_glint;
uniform float u_angle;
uniform float u_time;
uniform float u_finish;
uniform float u_seed;
uniform float u_hue_offset;
uniform float u_pattern_scale;
uniform float u_intensity;

varying vec2 v_uv;

vec3 hsv2rgb(vec3 c) {
  vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float linePattern(vec2 uv, float spacing, float width, float angle) {
  vec2 dir = vec2(cos(angle), sin(angle));
  float v = dot(uv, dir) * spacing;
  return smoothstep(width, 0.0, abs(fract(v) - 0.5));
}

float rectMask(vec2 uv, vec2 lower, vec2 upper, float softness) {
  vec2 low = smoothstep(lower, lower + softness, uv);
  vec2 high = 1.0 - smoothstep(upper - softness, upper, uv);
  return low.x * low.y * high.x * high.y;
}

void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 center = (uv - u_glint) * aspect;
  vec2 dir = normalize(vec2(cos(u_angle), sin(u_angle)));
  vec2 crossDir = vec2(-dir.y, dir.x);

  float seedOffset = fract(sin(u_seed * 91.7) * 371.13);
  float patternScale = clamp(u_pattern_scale, 0.72, 1.32);
  float sweep = exp(-pow(abs(dot(center, crossDir)) * (5.6 + seedOffset * 1.2) * patternScale, 2.0));
  float hotSpot = exp(-dot(center, center) * 8.2);
  float travelling = 0.5 + 0.5 * sin(dot(uv, dir) * (13.5 + seedOffset * 5.8) * patternScale - u_time * (1.0 + seedOffset * 0.45) + u_seed);
  float grain = hash(floor((uv + vec2(seedOffset * 0.19, u_time * 0.006)) * u_resolution.xy * 0.42));

  float diagonalLines = linePattern(uv + vec2(u_time * 0.015 + seedOffset * 0.11, 0.0), (34.0 + seedOffset * 14.0) * patternScale, 0.14, u_angle + 0.54 + seedOffset * 0.58);
  float fineLines = linePattern(uv + vec2(seedOffset * 0.07, seedOffset * 0.03), (76.0 + seedOffset * 28.0) * patternScale, 0.09, u_angle - 0.5 + seedOffset * 0.44);
  float edgeLight = smoothstep(0.74, 0.98, max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0);
  float tileGrid = max(
    linePattern(uv + vec2(seedOffset * 0.04, 0.0), 22.0, 0.055, 0.0),
    linePattern(uv + vec2(0.0, seedOffset * 0.04), 24.0, 0.055, 1.5708)
  );
  float artWindow = rectMask(uv, vec2(0.095, 0.46), vec2(0.905, 0.835), 0.035);
  float surfaceMask = 1.0;

  if (u_finish < 0.5) {
    surfaceMask = 0.28 + edgeLight * 0.55 + hotSpot * 0.16;
  } else if (u_finish < 1.5) {
    surfaceMask = artWindow * 0.96 + edgeLight * 0.2 + hotSpot * 0.08;
  } else if (u_finish < 2.5) {
    surfaceMask = max(1.0 - artWindow * 0.92, edgeLight * 0.26);
  }

  float prism = (sweep * (0.56 + travelling * 0.38) + hotSpot * 0.46 + diagonalLines * 0.2 + fineLines * 0.12 + edgeLight * 0.16) * surfaceMask;

  float finishBoost = 1.0;
  float hueShift = 0.0;
  float lineBoost = 0.0;
  float alphaBase = 0.62;

  if (u_finish < 0.5) {
    finishBoost = 0.68;
    hueShift = 0.58;
    lineBoost = 0.025;
    alphaBase = 0.5;
  } else if (u_finish < 1.5) {
    finishBoost = 1.12;
    hueShift = 0.55;
    lineBoost = 0.08;
    alphaBase = 0.68;
  } else if (u_finish < 2.5) {
    finishBoost = 0.96;
    hueShift = 0.5;
    lineBoost = 0.28;
    alphaBase = 0.66;
  } else if (u_finish < 3.5) {
    finishBoost = 1.22;
    hueShift = 0.28;
    lineBoost = 0.16;
    alphaBase = 0.7;
  } else if (u_finish < 4.5) {
    finishBoost = 1.42;
    hueShift = 0.12;
    lineBoost = 0.24;
    alphaBase = 0.74;
  } else if (u_finish < 5.5) {
    finishBoost = 1.56;
    hueShift = 0.04;
    lineBoost = 0.34;
    alphaBase = 0.78;
  } else if (u_finish < 6.5) {
    finishBoost = 1.5;
    hueShift = 0.09;
    lineBoost = 0.42;
    alphaBase = 0.8;
  } else if (u_finish < 7.5) {
    finishBoost = 1.08;
    hueShift = 0.58;
    lineBoost = 0.14;
    alphaBase = 0.64;
  } else if (u_finish < 8.5) {
    finishBoost = 1.28;
    hueShift = 0.52;
    lineBoost = 0.3;
    alphaBase = 0.72;
  } else if (u_finish < 9.5) {
    finishBoost = 1.42;
    hueShift = 0.62;
    lineBoost = 0.38;
    alphaBase = 0.78;
  } else if (u_finish < 10.5) {
    finishBoost = 1.35;
    hueShift = 0.88;
    lineBoost = 0.32;
    alphaBase = 0.76;
  } else if (u_finish < 11.5) {
    finishBoost = 1.5;
    hueShift = 0.18;
    lineBoost = 0.34;
    alphaBase = 0.8;
  } else {
    finishBoost = 1.28;
    hueShift = 0.56;
    lineBoost = 0.28;
    alphaBase = 0.72;
  }

  float hue = fract(hueShift + u_hue_offset + dot(uv, vec2(0.55, 0.22)) + sweep * (0.22 + seedOffset * 0.18) + u_time * 0.015);
  vec3 rainbow = hsv2rgb(vec3(hue, 0.76, 1.0));
  vec3 pearl = vec3(1.0, 0.96, 0.88);
  vec3 color = mix(rainbow, pearl, hotSpot * 0.46);
  vec3 secretGold = vec3(1.0, 0.73, 0.26);

  if (u_finish > 5.5 && u_finish < 6.5) {
    color = mix(mix(secretGold, pearl, hotSpot * 0.34), rainbow, 0.2);
  } else if (u_finish > 4.5 && u_finish < 5.5) {
    color = mix(color, secretGold, 0.24 + edgeLight * 0.32);
  }

  float reverseTile = u_finish > 1.5 && u_finish < 2.5 ? tileGrid * 0.24 : 0.0;
  float sparkle = smoothstep(0.965, 1.0, hash(floor((uv + seedOffset) * vec2(34.0, 48.0)))) * (0.48 + 0.52 * sin(u_time * 2.6 + seedOffset * 6.283));
  float specialtyTexture = 0.0;

  if (u_finish > 6.5 && u_finish < 7.5) {
    color = mix(color, vec3(0.9, 0.97, 1.0), 0.34);
    specialtyTexture = sparkle * 0.12 + edgeLight * 0.08;
  } else if (u_finish > 7.5 && u_finish < 8.5) {
    color = mix(color, vec3(0.82, 0.9, 1.0), 0.28);
    specialtyTexture = diagonalLines * 0.16 + fineLines * 0.12;
  } else if (u_finish > 8.5 && u_finish < 9.5) {
    color = mix(rainbow, vec3(0.84, 0.95, 1.0), 0.36);
    specialtyTexture = sparkle * 0.22 + tileGrid * 0.08;
  } else if (u_finish > 9.5 && u_finish < 10.5) {
    color = mix(vec3(1.0, 0.28, 0.72), pearl, hotSpot * 0.28);
    specialtyTexture = diagonalLines * 0.18 + sparkle * 0.12;
  } else if (u_finish > 10.5 && u_finish < 11.5) {
    color = rainbow;
    specialtyTexture = hotSpot * 0.18 + sparkle * 0.16;
  } else if (u_finish > 11.5) {
    color = mix(rainbow, vec3(0.86, 0.96, 1.0), 0.42);
    specialtyTexture = sparkle * 0.18 + fineLines * 0.1;
  }

  float texture = (diagonalLines * lineBoost + fineLines * lineBoost * 0.45 + reverseTile + specialtyTexture + grain * 0.035) * surfaceMask;
  float alpha = clamp((prism * finishBoost + texture) * alphaBase * 0.82 * clamp(u_intensity, 0.72, 1.28), 0.0, 0.62);

  gl_FragColor = vec4(color, alpha);
}
`

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }

  return shader
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
  if (!vertexShader || !fragmentShader) return null

  const program = gl.createProgram()
  if (!program) return null

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  return program
}

function getFinishUniformValue(finish: CardFinish) {
  if (finish === "normal") return 0
  if (finish === "reverse_holo") return 2
  if (finish === "double_rare") return 7
  if (finish === "ultra_rare") return 8
  if (finish === "illustration_rare") return 3
  if (finish === "special_illustration_rare") return 4
  if (finish === "secret_rare") return 5
  if (finish === "hyper_rare") return 6
  if (finish === "radiant_rare") return 9
  if (finish === "ace_spec") return 10
  if (finish === "amazing_rare") return 11
  if (finish === "shiny_rare") return 12
  return 1
}

interface CardFinishShaderProps {
  finish: CardFinish
  glintX: number
  glintY: number
  glintAngle: number
  glintPhase: number
  patternSeed: number
  finishIntensity: number
  hueOffset: number
  patternScale: number
  fallbackClassName: string
  fallbackStyle: CSSProperties
}

export default function CardFinishShader({
  finish,
  glintX,
  glintY,
  glintAngle,
  glintPhase,
  patternSeed,
  finishIntensity,
  hueOffset,
  patternScale,
  fallbackClassName,
  fallbackStyle,
}: CardFinishShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const uniformsRef = useRef({
    finish,
    glintAngle,
    glintPhase,
    glintX,
    glintY,
    finishIntensity,
    hueOffset,
    patternScale,
    patternSeed,
  })
  const [isActive, setIsActive] = useState(true)
  const [hasWebGl, setHasWebGl] = useState(true)

  useEffect(() => {
    uniformsRef.current = {
      finish,
      glintAngle,
      glintPhase,
      glintX,
      glintY,
      finishIntensity,
      hueOffset,
      patternScale,
      patternSeed,
    }
  }, [finish, finishIntensity, glintAngle, glintPhase, glintX, glintY, hueOffset, patternScale, patternSeed])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof IntersectionObserver === "undefined") return

    let isVisible = true
    let isDocumentVisible = document.visibilityState !== "hidden"
    const updateActiveState = () => setIsActive(isVisible && isDocumentVisible)
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = Boolean(entry?.isIntersecting)
        updateActiveState()
      },
      { rootMargin: "140px" },
    )
    const handleVisibilityChange = () => {
      isDocumentVisible = document.visibilityState !== "hidden"
      updateActiveState()
    }

    observer.observe(canvas)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!isActive) return

    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    })

    if (!gl) {
      setHasWebGl(false)
      return
    }

    const program = createProgram(gl)
    if (!program) {
      setHasWebGl(false)
      return
    }

    const positionBuffer = gl.createBuffer()
    if (!positionBuffer) {
      setHasWebGl(false)
      return
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )

    const positionLocation = gl.getAttribLocation(program, "a_position")
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution")
    const glintLocation = gl.getUniformLocation(program, "u_glint")
    const angleLocation = gl.getUniformLocation(program, "u_angle")
    const timeLocation = gl.getUniformLocation(program, "u_time")
    const finishLocation = gl.getUniformLocation(program, "u_finish")
    const seedLocation = gl.getUniformLocation(program, "u_seed")
    const hueOffsetLocation = gl.getUniformLocation(program, "u_hue_offset")
    const patternScaleLocation = gl.getUniformLocation(program, "u_pattern_scale")
    const intensityLocation = gl.getUniformLocation(program, "u_intensity")
    let frameId = 0
    let lastFrameTime = -TARGET_FRAME_MS
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const targetFrameMs = prefersReducedMotion ? REDUCED_MOTION_FRAME_MS : TARGET_FRAME_MS

    const render = (time: number) => {
      if (time - lastFrameTime < targetFrameMs) {
        frameId = window.requestAnimationFrame(render)
        return
      }

      lastFrameTime = time
      const rect = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_SHADER_PIXEL_RATIO)
      const width = Math.max(1, Math.round(rect.width * pixelRatio))
      const height = Math.max(1, Math.round(rect.height * pixelRatio))
      const uniforms = uniformsRef.current

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      gl.viewport(0, 0, width, height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.enableVertexAttribArray(positionLocation)
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
      gl.uniform2f(resolutionLocation, width, height)
      gl.uniform2f(glintLocation, uniforms.glintX, uniforms.glintY)
      gl.uniform1f(angleLocation, uniforms.glintAngle * Math.PI / 180)
      gl.uniform1f(timeLocation, time / 1000 + uniforms.glintPhase)
      gl.uniform1f(finishLocation, getFinishUniformValue(uniforms.finish))
      gl.uniform1f(seedLocation, uniforms.patternSeed)
      gl.uniform1f(hueOffsetLocation, uniforms.hueOffset)
      gl.uniform1f(patternScaleLocation, uniforms.patternScale)
      gl.uniform1f(intensityLocation, uniforms.finishIntensity)
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      frameId = window.requestAnimationFrame(render)
    }

    frameId = window.requestAnimationFrame(render)

    return () => {
      window.cancelAnimationFrame(frameId)
      gl.deleteBuffer(positionBuffer)
      gl.deleteProgram(program)
    }
  }, [isActive])

  if (!hasWebGl) {
    return <div className={`card-finish-layer pointer-events-none absolute inset-0 z-[2] ${fallbackClassName}`} style={fallbackStyle} />
  }

  return (
    <div className="card-finish-composite pointer-events-none absolute inset-0 z-[2]" style={fallbackStyle}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-card-finish={finish}
        className="card-finish-shader absolute inset-0 h-full w-full"
      />
      <div className={`card-finish-mobile-sheen absolute inset-0 ${fallbackClassName}`} aria-hidden="true" />
    </div>
  )
}
