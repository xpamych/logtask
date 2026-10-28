import type { GraphLayoutEntry, GraphViewSettings } from "~/lib/api";
import { stablePosition } from "~/lib/graph/layout";
import { colorForNode } from "~/lib/graph/model";
import type { SceneGraph, SceneNode } from "~/lib/graph/model";
import { createRenderEdgeCache, graphNodeLabelOpacity, graphNodeRadius, graphNodeRole, indexSceneNodes } from "./renderEdges";
import type { RenderEdge } from "./renderEdges";

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

type RGBA = [number, number, number, number];

const VERTEX = `#version 300 es
in vec2 a_position;
in vec4 a_color;
uniform vec2 u_resolution;
uniform vec3 u_camera;
out vec4 v_color;
void main() {
  vec2 p = (a_position - u_camera.xy) * u_camera.z / (u_resolution * 0.5);
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
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
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private positionLocation: number;
  private vertexColorLocation: number;
  private resolutionLocation: WebGLUniformLocation | null;
  private cameraLocation: WebGLUniformLocation | null;
  private scene: SceneGraph = { nodes: [], edges: [], revision: 0 };
  private nodeById = new Map<string, SceneNode>();
  private cachedRenderEdges = createRenderEdgeCache();
  private renderEdges: RenderEdge[] = [];
  private settings: GraphViewSettings | null = null;
  private positions = new Map<string, { x: number; y: number }>();
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private labels: CanvasRenderingContext2D | null;
  private highlighted = new Set<string>();
  private hovered: string | null = null;
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
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, shader(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(this.program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(this.program) ?? "ошибка программы WebGL");
    }
    this.positionLocation = gl.getAttribLocation(this.program, "a_position");
    this.vertexColorLocation = gl.getAttribLocation(this.program, "a_color");
    this.resolutionLocation = gl.getUniformLocation(this.program, "u_resolution");
    this.cameraLocation = gl.getUniformLocation(this.program, "u_camera");
    this.buffer = gl.createBuffer()!;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setScene(scene: SceneGraph, settings: GraphViewSettings) {
    this.scene = scene;
    this.nodeById = indexSceneNodes(scene.nodes);
    this.renderEdges = this.cachedRenderEdges(scene.edges);
    this.settings = settings;
    const ids = new Set(scene.nodes.map((node) => node.id));
    this.positions.forEach((_, id) => {
      if (!ids.has(id)) this.positions.delete(id);
    });
    for (const node of scene.nodes) {
      if (!this.positions.has(node.id)) this.positions.set(node.id, stablePosition(node.id));
    }
    this.request();
  }

  setPositions(entries: GraphLayoutEntry[]) {
    for (const entry of entries) {
      if (Number.isFinite(entry.x) && Number.isFinite(entry.y)) {
        this.positions.set(entry.id, { x: entry.x, y: entry.y });
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
    this.camera = { ...camera, zoom: Math.max(0.05, Math.min(5, camera.zoom)) };
    this.onCameraChange?.({ ...this.camera });
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
    const before = this.screenToWorld(x, y);
    const zoom = Math.max(0.05, Math.min(5, this.camera.zoom * factor));
    this.camera = {
      x: before.x - (x - this.canvas.clientWidth / 2) / zoom,
      y: before.y - (y - this.canvas.clientHeight / 2) / zoom,
      zoom,
    };
    this.onCameraChange?.({ ...this.camera });
    this.request();
  }

  panBy(dx: number, dy: number) {
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
    this.setCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom });
  }

  centerOn(id: string) {
    const point = this.positions.get(id);
    if (point) this.setCamera({ ...this.camera, ...point });
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
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private vertex(vertices: number[], x: number, y: number, rgba: RGBA) {
    vertices.push(x, y, ...rgba);
  }

  private line(vertices: number[], ax: number, ay: number, bx: number, by: number, rgba: RGBA) {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) return;
    const width = 0.35 * (this.settings?.edgeScale ?? 1);
    const ox = (-dy / length) * width;
    const oy = (dx / length) * width;
    this.triangle(vertices, [ax + ox, ay + oy], [ax - ox, ay - oy], [bx + ox, by + oy], rgba);
    this.triangle(vertices, [ax - ox, ay - oy], [bx - ox, by - oy], [bx + ox, by + oy], rgba);
  }

  private triangle(
    vertices: number[],
    a: [number, number],
    b: [number, number],
    c: [number, number],
    rgba: RGBA,
  ) {
    this.vertex(vertices, a[0], a[1], rgba);
    this.vertex(vertices, b[0], b[1], rgba);
    this.vertex(vertices, c[0], c[1], rgba);
  }

  private drawGeometry(mode: number, vertices: number[]) {
    if (vertices.length === 0) return;
    const gl = this.gl;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    gl.drawArrays(mode, 0, vertices.length / 6);
  }

  private draw() {
    if (!this.canvas.width || !this.canvas.height) return;
    const started = performance.now();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.enableVertexAttribArray(this.vertexColorLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(this.vertexColorLocation, 4, gl.FLOAT, false, 24, 8);
    gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
    gl.uniform3f(
      this.cameraLocation,
      this.camera.x,
      this.camera.y,
      this.camera.zoom * (window.devicePixelRatio || 1),
    );

    const styles = getComputedStyle(document.body);
    const activeHighlight = this.activeHighlight();
    const edgeColor = color(styles.getPropertyValue("--graph-edge") || "#536575", 0.78);
    const lines: number[] = [];
    const arrows: number[] = [];
    for (const edge of this.renderEdges) {
      const source = this.positions.get(edge.source);
      const target = this.positions.get(edge.target);
      if (!source || !target) continue;
      const muted = activeHighlight.size > 0 &&
        !(activeHighlight.has(edge.source) && activeHighlight.has(edge.target));
      const rgba = muted ? color("#777777", 0.08) : edgeColor;
      if (edge.source === edge.target) {
        for (let step = 0; step < 12; step += 1) {
          const a = (step / 12) * Math.PI * 2;
          const b = ((step + 1) / 12) * Math.PI * 2;
          this.line(lines, source.x + Math.cos(a) * 16, source.y + Math.sin(a) * 16,
            source.x + Math.cos(b) * 16, source.y + Math.sin(b) * 16, rgba);
        }
        continue;
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      this.line(lines, source.x, source.y, target.x, target.y, rgba);
      if (this.settings?.arrows) {
        for (const direction of [1, -1]) {
          if ((direction === 1 && !edge.forward) || (direction === -1 && !edge.backward)) continue;
          const endpoint = direction === 1 ? target : source;
          const endpointId = direction === 1 ? edge.target : edge.source;
          const targetNode = this.nodeById.get(endpointId);
          const radius = targetNode ? this.nodeRadius(targetNode) : 5;
          const ux = (dx / length) * direction;
          const uy = (dy / length) * direction;
          const tip: [number, number] = [endpoint.x - ux * radius, endpoint.y - uy * radius];
          const size = 5 + Math.min(4, edge.weight / 2);
          this.triangle(arrows, tip,
            [tip[0] - ux * size - uy * size * 0.6, tip[1] - uy * size + ux * size * 0.6],
            [tip[0] - ux * size + uy * size * 0.6, tip[1] - uy * size - ux * size * 0.6], rgba);
        }
      }
    }
    this.drawGeometry(gl.TRIANGLES, lines);
    this.drawGeometry(gl.TRIANGLES, arrows);

    const triangles: number[] = [];
    for (const node of this.scene.nodes) {
      const point = this.positions.get(node.id)!;
      const custom = this.settings ? colorForNode(node, this.settings.groups) : null;
      const base = custom ?? (node.kind === "journal" ? "#ff9800" : node.kind === "asset" ? "#4caf50" : node.kind === "virtual" ? "#777777" : "#9b59b6");
      const role = graphNodeRole(node.id, this.hovered, activeHighlight);
      const rgba = color(role === "hovered" ? "#09bec8" : base, role === "muted" ? 0.25 : 1);
      const radius = this.nodeRadius(node);
      for (let segment = 0; segment < 14; segment += 1) {
        const a = (segment / 14) * Math.PI * 2;
        const b = ((segment + 1) / 14) * Math.PI * 2;
        this.triangle(triangles, [point.x, point.y],
          [point.x + Math.cos(a) * radius, point.y + Math.sin(a) * radius],
          [point.x + Math.cos(b) * radius, point.y + Math.sin(b) * radius], rgba);
      }
    }
    this.drawGeometry(gl.TRIANGLES, triangles);
    this.drawLabels();
    this.onFrameTime?.(performance.now() - started);
  }

  private drawLabels() {
    const ctx = this.labels;
    if (!ctx || !this.settings) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const styles = getComputedStyle(document.body);
    const foreground = styles.getPropertyValue("--fg") || "#dddddd";
    const activeHighlight = this.activeHighlight();
    let count = 0;
    const drawLabel = (node: SceneNode) => {
      const role = graphNodeRole(node.id, this.hovered, activeHighlight);
      const priority = role !== "normal";
      const opacity = graphNodeLabelOpacity(role, this.scene.nodes.length, this.camera.zoom, this.settings!.labelThreshold);
      if (opacity === 0 || (count >= 200 && !priority)) return;
      const point = this.positions.get(node.id)!;
      const screen = this.worldToScreen(point.x, point.y);
      if (screen.x < -100 || screen.y < -30 || screen.x > this.canvas.clientWidth + 100 || screen.y > this.canvas.clientHeight + 30) return;
      const title = node.clusterMembers ? `${node.title} (${node.clusterMembers.length})` : node.title;
      ctx.globalAlpha = opacity;
      ctx.font = role === "hovered" ? "bold 12px sans-serif" : "11px sans-serif";
      ctx.fillStyle = role === "hovered" ? "#000000" : role === "highlighted" ? "#777777" : foreground;
      ctx.fillText(title.length > 42 ? `${title.slice(0, 41)}…` : title, screen.x, screen.y + this.nodeRadius(node) + 4);
      if (!priority) count += 1;
    };
    for (const node of this.scene.nodes) {
      if (node.id !== this.hovered) drawLabel(node);
    }
    const hoveredNode = this.hovered ? this.nodeById.get(this.hovered) : undefined;
    if (hoveredNode) drawLabel(hoveredNode);
    ctx.globalAlpha = 1;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
