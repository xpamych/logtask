import type { GraphLayoutEntry, GraphViewSettings } from "~/lib/api";
import { stablePosition } from "~/lib/graph/layout";
import { interpolateValue, smoothStepAmount, transitionAlpha, zoomCameraTarget } from "./motion";
import { InstanceBatch } from "./geometry";
import { arrowTriangle, circleTriangleFan, LINE_INSTANCE_STRIDE, lineQuad, nodeSegments, pushLineInstance, selfLinkTriangles } from "./instancing";
import { allowLabel, LabelAtlas, labelOutsideCanvas, labelText } from "./labelAtlas";
import type { LabelDescriptor } from "./labelAtlas";
import { colorForNode } from "~/lib/graph/model";
import type { SceneGraph, SceneNode } from "~/lib/graph/model";
import { createRenderEdgeCache, graphNodeLabelOpacity, graphNodeRadius, graphNodeRole, indexSceneNodes, isEdgeHighlighted } from "./renderEdges";
import type { RenderEdge } from "./renderEdges";

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

type RGBA = [number, number, number, number];

const CAMERA = `
uniform vec2 u_resolution;
uniform vec3 u_camera;
vec4 project(vec2 world) {
  vec2 p = (world - u_camera.xy) * u_camera.z / (u_resolution * 0.5);
  return vec4(p.x, -p.y, 0.0, 1.0);
}`;
const NODE_VERTEX = `#version 300 es
in vec2 a_position;
in vec2 a_center;
in float a_radius;
in vec4 a_color;
out vec4 v_color;
${CAMERA}
void main() {
  gl_Position = project(a_center + a_position * a_radius);
  v_color = a_color;
}`;
const LINE_VERTEX = `#version 300 es
in vec2 a_position;
in vec2 a_start;
in vec2 a_end;
in vec4 a_color;
in float a_width;
out vec4 v_color;
${CAMERA}
void main() {
  vec2 delta = a_end - a_start;
  float lineLength = max(length(delta), 0.0001);
  vec2 normal = vec2(-delta.y, delta.x) / lineLength;
  vec2 world = mix(a_start, a_end, a_position.x) + normal * a_position.y * a_width;
  gl_Position = project(world);
  v_color = a_color;
}`;
const ARROW_VERTEX = `#version 300 es
in vec2 a_position;
in vec2 a_endpoint;
in vec2 a_direction;
in float a_size;
in vec4 a_color;
out vec4 v_color;
${CAMERA}
void main() {
  vec2 normal = vec2(-a_direction.y, a_direction.x);
  vec2 world = a_endpoint + a_direction * a_position.x * a_size + normal * a_position.y * a_size;
  gl_Position = project(world);
  v_color = a_color;
}`;
const SELF_VERTEX = `#version 300 es
in vec4 a_geometry;
in vec2 a_center;
in vec4 a_color;
in float a_width;
out vec4 v_color;
${CAMERA}
void main() {
  gl_Position = project(a_center + a_geometry.xy + a_geometry.zw * a_width);
  v_color = a_color;
}`;
const FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() { outColor = v_color; }`;

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const result = gl.createShader(type)!;
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(result) ?? "ошибка шейдера");
  }
  return result;
}

interface ShapeAttribute {
  name: string;
  size: number;
  stride: number;
  offset: number;
  divisor: 0 | 1;
  buffer: "template" | "instance" | "color";
}

function templateAttribute(name: string, size: number, stride = 0): ShapeAttribute {
  return { name, size, stride, offset: 0, divisor: 0, buffer: "template" };
}

function instanceAttribute(name: string, size: number, stride: number, offset: number): ShapeAttribute {
  return { name, size, stride, offset, divisor: 1, buffer: "instance" };
}

function colorAttribute(): ShapeAttribute {
  return { name: "a_color", size: 4, stride: 16, offset: 0, divisor: 1, buffer: "color" };
}

class InstancedShape {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private templateBuffer: WebGLBuffer;
  private instanceBuffer: WebGLBuffer;
  private colorBuffer: WebGLBuffer;
  private resolutionLocation: WebGLUniformLocation | null;
  private cameraLocation: WebGLUniformLocation | null;

  constructor(
    private gl: WebGL2RenderingContext,
    vertexSource: string,
    template: Float32Array,
    attributes: ShapeAttribute[],
  ) {
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, shader(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(this.program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(this.program) ?? "ошибка программы WebGL");
    }
    this.resolutionLocation = gl.getUniformLocation(this.program, "u_resolution");
    this.cameraLocation = gl.getUniformLocation(this.program, "u_camera");
    this.vao = gl.createVertexArray()!;
    this.templateBuffer = gl.createBuffer()!;
    this.instanceBuffer = gl.createBuffer()!;
    this.colorBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    for (const attribute of attributes) {
      const buffer = attribute.buffer === "template"
        ? this.templateBuffer
        : attribute.buffer === "instance"
          ? this.instanceBuffer
          : this.colorBuffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (attribute.buffer === "template") gl.bufferData(gl.ARRAY_BUFFER, template, gl.STATIC_DRAW);
      const location = gl.getAttribLocation(this.program, attribute.name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, attribute.size, gl.FLOAT, false, attribute.stride, attribute.offset);
      gl.vertexAttribDivisor(location, attribute.divisor);
    }
    gl.bindVertexArray(null);
  }

  draw(mode: number, vertexCount: number, instances: InstanceBatch, colors: InstanceBatch) {
    if (instances.count === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances.values(), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors.values(), gl.STREAM_DRAW);
    gl.uniform2f(this.resolutionLocation, gl.canvas.width, gl.canvas.height);
    const camera = this.camera;
    gl.uniform3f(this.cameraLocation, camera.x, camera.y, camera.zoom);
    gl.drawArraysInstanced(mode, 0, vertexCount, instances.count);
  }

  camera = { x: 0, y: 0, zoom: 1 };

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.templateBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.colorBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

function color(value: string, alpha = 1): RGBA {
  const hex = value.trim().replace("#", "");
  if (/^[\da-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
      alpha,
    ];
  }
  return [0.35, 0.75, 0.8, alpha];
}

export class WebGlRenderer {
  private gl: WebGL2RenderingContext;
  private lineShape: InstancedShape;
  private arrowShape: InstancedShape;
  private selfShape: InstancedShape;
  private node16Shape: InstancedShape;
  private node64Shape: InstancedShape;
  private scene: SceneGraph = { nodes: [], edges: [], revision: 0 };
  private nodeById = new Map<string, SceneNode>();
  private cachedRenderEdges = createRenderEdgeCache();
  private renderEdges: RenderEdge[] = [];
  private lineBatch = new InstanceBatch();
  private arrowBatch = new InstanceBatch();
  private selfBatch = new InstanceBatch();
  private node16Batch = new InstanceBatch();
  private node64Batch = new InstanceBatch();
  private lineColors = new InstanceBatch();
  private arrowColors = new InstanceBatch();
  private selfColors = new InstanceBatch();
  private node16Colors = new InstanceBatch();
  private node64Colors = new InstanceBatch();
  private edgeColor: RGBA = [0.35, 0.75, 0.8, 0.78];
  private mutedEdgeColor: RGBA = color("#777777");
  private highlightEdgeColor: RGBA = color("#09bec8");
  private hoverColor: RGBA = color("#09bec8");
  private nodeBaseColors = new Map<string, RGBA>();
  private foreground = "#dddddd";
  private settings: GraphViewSettings | null = null;
  private positions = new Map<string, { x: number; y: number }>();
  private targetPositions = new Map<string, { x: number; y: number }>();
  private positionsInitialized = false;
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private cameraTarget: Camera | null = null;
  private frame = 0;
  private lastFrameTime = 0;
  private motionPreference: MediaQueryList;
  private onMotionPreference: () => void;
  private resizeObserver: ResizeObserver;
  private themeObserver: MutationObserver;
  private labels: CanvasRenderingContext2D | null;
  private labelAtlas: LabelAtlas | null = null;
  private labelAtlasFailed = false;
  private highlighted = new Set<string>();
  private hovered: string | null = null;
  private nodeAlphas = new Map<string, number>();
  private edgeAlphas = new Map<string, number>();
  onCameraChange: ((camera: Camera) => void) | null = null;
  onFrameTime: ((milliseconds: number) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    labelCanvas: HTMLCanvasElement,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true });
    if (!gl) throw new Error("WebGL2 недоступен в этом окружении");
    this.gl = gl;
    this.labels = labelCanvas.getContext("2d");
    this.lineShape = new InstancedShape(gl, LINE_VERTEX, lineQuad(), [
      templateAttribute("a_position", 2),
      instanceAttribute("a_start", 2, LINE_INSTANCE_STRIDE, 0),
      instanceAttribute("a_end", 2, LINE_INSTANCE_STRIDE, 8),
      colorAttribute(),
      instanceAttribute("a_width", 1, LINE_INSTANCE_STRIDE, 24),
    ]);
    this.arrowShape = new InstancedShape(gl, ARROW_VERTEX, arrowTriangle(), [
      templateAttribute("a_position", 2),
      instanceAttribute("a_endpoint", 2, 36, 0),
      instanceAttribute("a_direction", 2, 36, 8),
      instanceAttribute("a_size", 1, 36, 16),
      colorAttribute(),
    ]);
    this.selfShape = new InstancedShape(gl, SELF_VERTEX, selfLinkTriangles(), [
      templateAttribute("a_geometry", 4, 16),
      instanceAttribute("a_center", 2, 28, 0),
      colorAttribute(),
      instanceAttribute("a_width", 1, 28, 24),
    ]);
    const nodeAttributes = [
      templateAttribute("a_position", 2),
      instanceAttribute("a_center", 2, 28, 0),
      instanceAttribute("a_radius", 1, 28, 8),
      colorAttribute(),
    ];
    this.node16Shape = new InstancedShape(gl, NODE_VERTEX, circleTriangleFan(16), nodeAttributes);
    this.node64Shape = new InstancedShape(gl, NODE_VERTEX, circleTriangleFan(64), nodeAttributes);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    try {
      this.labelAtlas = new LabelAtlas(gl);
      labelCanvas.style.visibility = "hidden";
    } catch (error) {
      console.error("Инициализация atlas подписей:", error);
      this.labelAtlasFailed = true;
      labelCanvas.style.visibility = "visible";
    }
    this.motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.onMotionPreference = () => {
      this.cameraTarget = null;
      for (const [id, point] of this.targetPositions) this.positions.set(id, point);
      this.request();
    };
    this.motionPreference.addEventListener("change", this.onMotionPreference);
    this.themeObserver = new MutationObserver(() => {
      this.refreshStyles();
      this.request();
    });
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  private refreshStyles() {
    const styles = getComputedStyle(document.body);
    this.edgeColor = color(styles.getPropertyValue("--graph-edge") || "#536575", 0.78);
    this.highlightEdgeColor = color(styles.getPropertyValue("--accent") || "#09bec8");
    this.foreground = styles.getPropertyValue("--fg") || "#dddddd";
  }

  setScene(scene: SceneGraph, settings: GraphViewSettings) {
    this.scene = scene;
    this.nodeById = indexSceneNodes(scene.nodes);
    this.renderEdges = this.cachedRenderEdges(scene.edges);
    this.edgeAlphas.clear();
    this.settings = settings;
    this.nodeBaseColors = new Map(scene.nodes.map((node) => [
      node.id,
      color(colorForNode(node, settings.groups) ?? (node.kind === "journal" ? "#ff9800" : node.kind === "asset" ? "#4caf50" : node.kind === "virtual" ? "#777777" : "#9b59b6")),
    ]));
    this.refreshStyles();
    const ids = new Set(scene.nodes.map((node) => node.id));
    this.positions.forEach((_, id) => {
      if (!ids.has(id)) {
        this.positions.delete(id);
        this.targetPositions.delete(id);
        this.nodeAlphas.delete(id);
      }
    });
    for (const node of scene.nodes) {
      if (!this.positions.has(node.id)) {
        const point = stablePosition(node.id);
        this.positions.set(node.id, point);
        this.targetPositions.set(node.id, point);
      }
    }
    this.request();
  }

  setPositions(entries: GraphLayoutEntry[]) {
    const initialize = !this.positionsInitialized;
    this.positionsInitialized = true;
    for (const entry of entries) {
      if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) continue;
      const target = { x: entry.x, y: entry.y };
      this.targetPositions.set(entry.id, target);
      if (initialize || this.motionPreference.matches || entry.pinned || !this.positions.has(entry.id)) {
        this.positions.set(entry.id, target);
      }
    }
    this.request();
  }

  setHighlight(ids: Set<string>, hovered: string | null = null) {
    this.highlighted = new Set(ids);
    this.hovered = hovered;
    this.request();
  }

  private activeHighlight() {
    const result = new Set(this.highlighted);
    if (this.hovered) {
      result.add(this.hovered);
      for (const edge of this.scene.edges) {
        if (edge.source === this.hovered) result.add(edge.target);
        if (edge.target === this.hovered) result.add(edge.source);
      }
    }
    return result;
  }

  setCamera(camera: Camera) {
    this.cameraTarget = null;
    this.camera = { ...camera, zoom: Math.max(0.05, Math.min(5, camera.zoom)) };
    this.onCameraChange?.({ ...this.camera });
    this.request();
  }

  private transitionCamera(target: Camera) {
    if (this.motionPreference.matches) {
      this.setCamera(target);
      return;
    }
    this.cameraTarget = target;
    this.request();
  }

  getCamera() {
    return { ...this.camera };
  }

  private nodeRadius(node: SceneNode) {
    return graphNodeRadius(node, this.settings?.nodeScale ?? 1);
  }

  hitTest(clientX: number, clientY: number): SceneNode | null {
    const rect = this.canvas.getBoundingClientRect();
    const point = this.screenToWorld(clientX - rect.left, clientY - rect.top);
    for (let index = this.scene.nodes.length - 1; index >= 0; index -= 1) {
      const node = this.scene.nodes[index];
      const position = this.positions.get(node.id)!;
      const radius = this.nodeRadius(node) + 3 / this.camera.zoom;
      if (Math.hypot(point.x - position.x, point.y - position.y) <= radius) return node;
    }
    return null;
  }

  screenToWorld(x: number, y: number) {
    return {
      x: (x - this.canvas.clientWidth / 2) / this.camera.zoom + this.camera.x,
      y: (y - this.canvas.clientHeight / 2) / this.camera.zoom + this.camera.y,
    };
  }

  worldToScreen(x: number, y: number) {
    return {
      x: (x - this.camera.x) * this.camera.zoom + this.canvas.clientWidth / 2,
      y: (y - this.camera.y) * this.camera.zoom + this.canvas.clientHeight / 2,
    };
  }

  zoomBy(factor: number, x = this.canvas.clientWidth / 2, y = this.canvas.clientHeight / 2) {
    this.transitionCamera(zoomCameraTarget(
      this.cameraTarget ?? this.camera,
      factor,
      x,
      y,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    ));
  }

  panBy(dx: number, dy: number) {
    this.cameraTarget = null;
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
    this.onCameraChange?.({ ...this.camera });
    this.request();
  }

  fit() {
    if (this.scene.nodes.length === 0) return;
    const points = this.scene.nodes.map((node) => this.positions.get(node.id)!);
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const zoom = Math.min(
      2,
      Math.max(0.05, Math.min(
        (this.canvas.clientWidth - 80) / Math.max(100, maxX - minX),
        (this.canvas.clientHeight - 80) / Math.max(100, maxY - minY),
      )),
    );
    this.transitionCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom });
  }

  centerOn(id: string) {
    const point = this.positions.get(id);
    if (point) this.transitionCamera({ ...this.camera, ...point });
  }

  private resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(0, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(0, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      const labelCanvas = this.labels?.canvas;
      if (labelCanvas) {
        labelCanvas.width = width;
        labelCanvas.height = height;
      }
      this.request();
    }
  }

  private request() {
    if (this.frame) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      const moving = this.advanceMotion(now);
      this.draw();
      if (moving) this.request();
      else this.lastFrameTime = 0;
    });
  }

  private advanceMotion(now: number): boolean {
    const elapsed = this.lastFrameTime === 0 ? 0 : now - this.lastFrameTime;
    this.lastFrameTime = now;
    let moving = false;
    for (const [id, target] of this.targetPositions) {
      const current = this.positions.get(id) ?? target;
      if (current.x === target.x && current.y === target.y) {
        this.positions.set(id, target);
        continue;
      }
      const x = interpolateValue(current.x, target.x, elapsed, 0.12);
      const y = interpolateValue(current.y, target.y, elapsed, 0.12);
      if (Math.abs(target.x - x) > 0.02 || Math.abs(target.y - y) > 0.02) {
        moving = true;
        this.positions.set(id, { x, y });
      } else {
        this.positions.set(id, target);
      }
    }
    if (this.cameraTarget) {
      const target = this.cameraTarget;
      const amount = smoothStepAmount(elapsed, 0.18);
      this.camera = {
        x: this.camera.x + (target.x - this.camera.x) * amount,
        y: this.camera.y + (target.y - this.camera.y) * amount,
        zoom: this.camera.zoom + (target.zoom - this.camera.zoom) * amount,
      };
      if (
        Math.abs(target.x - this.camera.x) > 0.02 ||
        Math.abs(target.y - this.camera.y) > 0.02 ||
        Math.abs(target.zoom - this.camera.zoom) > 0.0001
      ) {
        moving = true;
      } else {
        this.camera = target;
        this.cameraTarget = null;
      }
      this.onCameraChange?.({ ...this.camera });
    }
    return this.advanceOpacity(elapsed) || moving;
  }

  private advanceOpacity(elapsed: number): boolean {
    const active = this.activeHighlight();
    let moving = false;
    for (const node of this.scene.nodes) {
      const target = graphNodeRole(node.id, this.hovered, active) === "muted" ? 0.25 : 1;
      const current = this.nodeAlphas.get(node.id) ?? target;
      if (current === target) continue;
      const next = transitionAlpha(current, target, elapsed, 0.12, this.motionPreference.matches);
      this.nodeAlphas.set(node.id, next.value);
      moving ||= next.moving;
    }
    for (const edge of this.renderEdges) {
      const key = `${edge.source}->${edge.target}`;
      const muted = active.size > 0 && !(active.has(edge.source) && active.has(edge.target));
      const target = muted ? 0.08 : this.edgeColor[3];
      const current = this.edgeAlphas.get(key) ?? target;
      if (current === target) continue;
      const next = transitionAlpha(current, target, elapsed, 0.12, this.motionPreference.matches);
      this.edgeAlphas.set(key, next.value);
      moving ||= next.moving;
    }
    return moving;
  }

  private draw() {
    if (!this.canvas.width || !this.canvas.height) return;
    const started = performance.now();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const camera = {
      x: this.camera.x,
      y: this.camera.y,
      zoom: this.camera.zoom * (window.devicePixelRatio || 1),
    };
    this.lineShape.camera = camera;
    this.arrowShape.camera = camera;
    this.selfShape.camera = camera;
    this.node16Shape.camera = camera;
    this.node64Shape.camera = camera;

    const activeHighlight = this.activeHighlight();
    const lines = this.lineBatch;
    const arrows = this.arrowBatch;
    const selfLinks = this.selfBatch;
    const lineColors = this.lineColors;
    const arrowColors = this.arrowColors;
    const selfColors = this.selfColors;
    lines.clear();
    arrows.clear();
    selfLinks.clear();
    lineColors.clear();
    arrowColors.clear();
    selfColors.clear();
    const edgeWidth = 0.35 * (this.settings?.edgeScale ?? 1);
    for (const edge of this.renderEdges) {
      const source = this.positions.get(edge.source);
      const target = this.positions.get(edge.target);
      if (!source || !target) continue;
      const muted = activeHighlight.size > 0 &&
        !(activeHighlight.has(edge.source) && activeHighlight.has(edge.target));
      const key = `${edge.source}->${edge.target}`;
      const base = isEdgeHighlighted(edge.source, edge.target, activeHighlight)
        ? this.highlightEdgeColor
        : muted ? this.mutedEdgeColor : this.edgeColor;
      const rgba: RGBA = [base[0], base[1], base[2], this.edgeAlphas.get(key) ?? base[3]];
      if (edge.source === edge.target) {
        selfLinks.push(source.x, source.y, ...rgba, edgeWidth);
        selfColors.push(...rgba);
        continue;
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      if (pushLineInstance(lines, source.x, source.y, target.x, target.y, rgba, edgeWidth)) {
        lineColors.push(...rgba);
      }
      if (this.settings?.arrows) {
        for (const direction of [1, -1]) {
          if ((direction === 1 && !edge.forward) || (direction === -1 && !edge.backward)) continue;
          const endpoint = direction === 1 ? target : source;
          const endpointId = direction === 1 ? edge.target : edge.source;
          const targetNode = this.nodeById.get(endpointId);
          const radius = targetNode ? this.nodeRadius(targetNode) : 5;
          const ux = (dx / length) * direction;
          const uy = (dy / length) * direction;
          const tipX = endpoint.x - ux * radius;
          const tipY = endpoint.y - uy * radius;
          const size = 5 + Math.min(4, edge.weight / 2);
          arrows.push(tipX, tipY, ux, uy, size, ...rgba);
          arrowColors.push(...rgba);
        }
      }
    }
    this.lineShape.draw(gl.TRIANGLES, 6, lines, lineColors);
    this.arrowShape.draw(gl.TRIANGLES, 3, arrows, arrowColors);
    this.selfShape.draw(gl.TRIANGLES, 72, selfLinks, selfColors);

    const nodes16 = this.node16Batch;
    const nodes64 = this.node64Batch;
    const colors16 = this.node16Colors;
    const colors64 = this.node64Colors;
    nodes16.clear();
    nodes64.clear();
    colors16.clear();
    colors64.clear();
    for (const node of this.scene.nodes) {
      const point = this.positions.get(node.id)!;
      const base = this.nodeBaseColors.get(node.id)!;
      const role = graphNodeRole(node.id, this.hovered, activeHighlight);
      const alpha = this.nodeAlphas.get(node.id) ?? (role === "muted" ? 0.25 : 1);
      const tint = role === "hovered" ? this.hoverColor : base;
      const rgba: RGBA = [tint[0], tint[1], tint[2], alpha];
      const radius = this.nodeRadius(node);
      const batch = nodeSegments(radius, this.camera.zoom) === 64 ? nodes64 : nodes16;
      const colors = batch === nodes64 ? colors64 : colors16;
      batch.push(point.x, point.y, radius, ...rgba);
      colors.push(...rgba);
    }
    this.node16Shape.draw(gl.TRIANGLE_FAN, 18, nodes16, colors16);
    this.node64Shape.draw(gl.TRIANGLE_FAN, 66, nodes64, colors64);
    this.drawLabels();
    this.onFrameTime?.(performance.now() - started);
  }

  private labelDescriptors(): LabelDescriptor[] {
    if (!this.settings) return [];
    const activeHighlight = this.activeHighlight();
    if (this.scene.nodes.length > 100 && this.camera.zoom < 1.5 && activeHighlight.size === 0) return [];
    const descriptors: LabelDescriptor[] = [];
    let count = 0;
    const addLabel = (node: SceneNode) => {
      const role = graphNodeRole(node.id, this.hovered, activeHighlight);
      const priority = role !== "normal";
      const opacity = graphNodeLabelOpacity(
        role === "muted" ? "normal" : role,
        this.scene.nodes.length,
        this.camera.zoom,
        this.settings!.labelThreshold,
      ) * (this.nodeAlphas.get(node.id) ?? 1);
      if (!allowLabel(opacity, priority, count)) return;
      const point = this.positions.get(node.id)!;
      const screen = this.worldToScreen(point.x, point.y);
      if (labelOutsideCanvas(screen.x, screen.y, this.canvas.clientWidth, this.canvas.clientHeight)) return;
      const title = node.clusterMembers ? `${node.title} (${node.clusterMembers.length})` : node.title;
      descriptors.push({
        key: node.id,
        text: labelText(title),
        x: screen.x,
        y: screen.y + this.nodeRadius(node) + 4,
        opacity,
        bold: role === "hovered",
        priority,
        color: this.foreground,
      });
      if (!priority) count += 1;
    };
    for (const node of this.scene.nodes) {
      if (node.id !== this.hovered) addLabel(node);
    }
    const hoveredNode = this.hovered ? this.nodeById.get(this.hovered) : undefined;
    if (hoveredNode) addLabel(hoveredNode);
    return descriptors;
  }

  private drawLabelsFallback(descriptors: LabelDescriptor[]) {
    const ctx = this.labels!;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const descriptor of descriptors) {
      ctx.globalAlpha = descriptor.opacity;
      ctx.font = descriptor.bold ? "bold 12px sans-serif" : "11px sans-serif";
      ctx.fillStyle = descriptor.color;
      ctx.fillText(descriptor.text, descriptor.x, descriptor.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawLabels() {
    if (!this.labels || !this.settings) return;
    const descriptors = this.labelDescriptors();
    if (this.labelAtlas && !this.labelAtlasFailed) {
      try {
        this.labelAtlas.sync(descriptors, window.devicePixelRatio || 1);
        this.labels.canvas.style.visibility = "hidden";
        return;
      } catch (error) {
        console.error("Отрисовка atlas подписей:", error);
        this.labelAtlasFailed = true;
        this.labelAtlas.dispose();
        this.labelAtlas = null;
      }
    }
    this.labels.canvas.style.visibility = "visible";
    this.drawLabelsFallback(descriptors);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.motionPreference.removeEventListener("change", this.onMotionPreference);
    this.themeObserver.disconnect();
    this.resizeObserver.disconnect();
    this.lineShape.dispose();
    this.arrowShape.dispose();
    this.selfShape.dispose();
    this.node16Shape.dispose();
    this.node64Shape.dispose();
    this.labelAtlas?.dispose();
  }
}
