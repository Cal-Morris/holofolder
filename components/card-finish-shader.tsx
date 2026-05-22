"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { CardFinish } from "@/hooks/use-collection"

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

void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 center = (uv - u_glint) * aspect;
  vec2 dir = normalize(vec2(cos(u_angle), sin(u_angle)));
  vec2 crossDir = vec2(-dir.y, dir.x);

  float sweep = exp(-pow(abs(dot(center, crossDir)) * 7.6, 2.0));
  float hotSpot = exp(-dot(center, center) * 9.5);
  float travelling = 0.5 + 0.5 * sin(dot(uv, dir) * 18.0 - u_time * 1.25);
  float grain = hash(floor((uv + u_time * 0.006) * u_resolution.xy * 0.42));

  float diagonalLines = linePattern(uv + vec2(u_time * 0.015, 0.0), 42.0, 0.13, u_angle + 0.65);
  float fineLines = linePattern(uv, 96.0, 0.08, u_angle - 0.42);
  float prism = sweep * (0.48 + travelling * 0.34) + hotSpot * 0.42 + diagonalLines * 0.18 + fineLines * 0.1;

  float finishBoost = 1.0;
  float hueShift = 0.0;
  float lineBoost = 0.0;

  if (u_finish < 1.5) {
    finishBoost = 0.95;
    hueShift = 0.55;
    lineBoost = 0.04;
  } else if (u_finish < 2.5) {
    finishBoost = 0.82;
    hueShift = 0.5;
    lineBoost = 0.28;
  } else if (u_finish < 3.5) {
    finishBoost = 1.05;
    hueShift = 0.28;
    lineBoost = 0.16;
  } else if (u_finish < 4.5) {
    finishBoost = 1.25;
    hueShift = 0.12;
    lineBoost = 0.24;
  } else {
    finishBoost = 1.36;
    hueShift = 0.04;
    lineBoost = 0.34;
  }

  float hue = fract(hueShift + dot(uv, vec2(0.55, 0.22)) + sweep * 0.28 + u_time * 0.015);
  vec3 rainbow = hsv2rgb(vec3(hue, 0.76, 1.0));
  vec3 pearl = vec3(1.0, 0.96, 0.88);
  vec3 color = mix(rainbow, pearl, hotSpot * 0.46);

  float texture = diagonalLines * lineBoost + fineLines * lineBoost * 0.45 + grain * 0.035;
  float alpha = clamp((prism * finishBoost + texture) * 0.58, 0.0, 0.72);

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
  if (finish === "reverse_holo") return 2
  if (finish === "illustration_rare") return 3
  if (finish === "special_illustration_rare") return 4
  if (finish === "secret_rare" || finish === "hyper_rare") return 5
  return 1
}

interface CardFinishShaderProps {
  finish: CardFinish
  glintX: number
  glintY: number
  glintAngle: number
  fallbackClassName: string
  fallbackStyle: CSSProperties
}

export default function CardFinishShader({
  finish,
  glintX,
  glintY,
  glintAngle,
  fallbackClassName,
  fallbackStyle,
}: CardFinishShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasWebGl, setHasWebGl] = useState(true)

  useEffect(() => {
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
    let frameId = 0

    const render = (time: number) => {
      const rect = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(rect.width * pixelRatio))
      const height = Math.max(1, Math.round(rect.height * pixelRatio))

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
      gl.uniform2f(glintLocation, glintX, glintY)
      gl.uniform1f(angleLocation, glintAngle * Math.PI / 180)
      gl.uniform1f(timeLocation, time / 1000)
      gl.uniform1f(finishLocation, getFinishUniformValue(finish))
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      frameId = window.requestAnimationFrame(render)
    }

    frameId = window.requestAnimationFrame(render)

    return () => {
      window.cancelAnimationFrame(frameId)
      gl.deleteBuffer(positionBuffer)
      gl.deleteProgram(program)
    }
  }, [finish, glintAngle, glintX, glintY])

  if (!hasWebGl) {
    return <div className={`card-finish-layer pointer-events-none absolute inset-0 z-[2] ${fallbackClassName}`} style={fallbackStyle} />
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="card-finish-shader pointer-events-none absolute inset-0 z-[2] h-full w-full"
    />
  )
}
