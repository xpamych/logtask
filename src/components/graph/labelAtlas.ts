import { InstanceBatch } from "./geometry.ts";

export interface LabelDescriptor {
  key: string;
  text: string;
  x: number;
  y: number;
  opacity: number;
  bold: boolean;
  priority: boolean;
  color: string;
}

interface LabelSize {
  width: number;
  height: number;
}

interface LabelRect extends LabelSize {
  x: number;
  y: number;
}

export interface LabelSprite {
  key: string;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface PendingRaster {
  descriptor: LabelDescriptor;
  rect: LabelRect;
}

export function labelText(title: string): string {
  return title.length > 42 ? `${title.slice(0, 41)}…` : title;
}

export function allowLabel(opacity: number, priority: boolean, normalCount: number): boolean {
  return opacity !== 0 && (priority || normalCount < 200);
}

export function labelOutsideCanvas(x: number, y: number, width: number, height: number): boolean {
  return x < -100 || y < -30 || x > width + 100 || y > height + 30;
}

export function labelSpriteCssSize(size: number, pixelRatio: number): number {
  return size / pixelRatio;
}

export function labelCacheKey(descriptor: LabelDescriptor, pixelRatio: number): string {
  return `${descriptor.text}\0${descriptor.bold}\0${descriptor.color}\0${pixelRatio}`;
}

class LabelAtlasOverflow extends Error {
  readonly size: number;

  constructor(size: number) {
    super("Недостаточно места в atlas подписей");
    this.size = size;
  }
}

export class LabelAtlasLayout {
  atlasSize: number;
  private placements = new Map<string, LabelRect>();
  private x = 0;
  private y = 0;
  private rowHeight = 0;
  readonly pending: PendingRaster[] = [];

  constructor(size = 2048) {
    this.atlasSize = size;
  }

  sync(
    descriptors: LabelDescriptor[],
    pixelRatio: number,
    measure: (descriptor: LabelDescriptor) => LabelSize,
    rendered: string[],
  ): LabelSprite[] {
    try {
      this.pending.length = 0;
      const sprites: LabelSprite[] = [];
      for (const descriptor of descriptors) {
        const key = labelCacheKey(descriptor, pixelRatio);
        let rect = this.placements.get(key);
        if (!rect) {
          const size = measure(descriptor);
          rect = this.allocate(size);
          this.placements.set(key, rect);
          this.pending.push({ descriptor, rect });
          rendered.push(key);
        }
        sprites.push({
          key: descriptor.key,
          opacity: descriptor.opacity,
          x: descriptor.x,
          y: descriptor.y,
          width: rect.width,
          height: rect.height,
          u0: rect.x / this.atlasSize,
          v0: rect.y / this.atlasSize,
          u1: (rect.x + rect.width) / this.atlasSize,
          v1: (rect.y + rect.height) / this.atlasSize,
        });
      }
      return sprites;
    } catch (error) {
      if (!(error instanceof LabelAtlasOverflow)) throw error;
      this.atlasSize = error.size;
      this.placements.clear();
      this.x = 0;
      this.y = 0;
      this.rowHeight = 0;
      return this.sync(descriptors, pixelRatio, measure, rendered);
    }
  }

  private allocate(size: LabelSize): LabelRect {
    if (size.width > this.atlasSize || size.height > this.atlasSize) {
      throw new LabelAtlasOverflow(Math.max(size.width, size.height));
    }
    if (this.x + size.width > this.atlasSize) {
      this.x = 0;
      this.y += this.rowHeight;
      this.rowHeight = 0;
    }
    if (this.y + size.height > this.atlasSize) {
      throw new LabelAtlasOverflow(this.atlasSize * 2);
    }
    const rect = { x: this.x, y: this.y, ...size };
    this.x += size.width;
    this.rowHeight = Math.max(this.rowHeight, size.height);
    return rect;
  }
}

const SPRITE_VERTEX = `#version 300 es
in vec2 a_position;
in vec2 a_offset;
in vec2 a_size;
in vec2 a_uv0;
in vec2 a_uv1;
in float a_opacity;
uniform vec2 u_resolution;
uniform float u_pixelRatio;
out vec2 v_uv;
out float v_opacity;
void main() {
  vec2 screen = a_offset + a_position * a_size;
  vec2 point = screen * u_pixelRatio / (u_resolution * 0.5);
  gl_Position = vec4(point.x - 1.0, 1.0 - point.y, 0.0, 1.0);
  v_uv = mix(a_uv0, a_uv1, a_position);
  v_opacity = a_opacity;
}`;
const SPRITE_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in float v_opacity;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_uv);
  outColor.a *= v_opacity;
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type)!;
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(result) ?? "ошибка шейдера подписей");
  }
  return result;
}

class LabelSpriteProgram {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private templateBuffer: WebGLBuffer;
  private instanceBuffer: WebGLBuffer;
  private batch = new InstanceBatch();

  private gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, compile(gl, gl.VERTEX_SHADER, SPRITE_VERTEX));
    gl.attachShader(this.program, compile(gl, gl.FRAGMENT_SHADER, SPRITE_FRAGMENT));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(this.program) ?? "ошибка программы подписей");
    }
    this.vao = gl.createVertexArray()!;
    this.templateBuffer = gl.createBuffer()!;
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.templateBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(position, 0);
    const attributes = [
      ["a_offset", 2, 0],
      ["a_size", 2, 8],
      ["a_uv0", 2, 16],
      ["a_uv1", 2, 24],
      ["a_opacity", 1, 32],
    ] as const;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    for (const [name, size, offset] of attributes) {
      const location = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 36, offset);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
  }

  draw(sprites: LabelSprite[], pixelRatio: number) {
    const gl = this.gl;
    this.batch.clear();
    for (const sprite of sprites) {
      this.batch.push(
        sprite.x,
        sprite.y,
        labelSpriteCssSize(sprite.width, pixelRatio),
        labelSpriteCssSize(sprite.height, pixelRatio),
        sprite.u0,
        sprite.v0,
        sprite.u1,
        sprite.v1,
        sprite.opacity,
      );
    }
    if (this.batch.count === 0) return;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.batch.values(), gl.STREAM_DRAW);
    gl.uniform2f(gl.getUniformLocation(this.program, "u_resolution"), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_pixelRatio"), pixelRatio);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_texture"), 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.batch.count);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.templateBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

export class LabelAtlas {
  private layout = new LabelAtlasLayout();
  private texture: WebGLTexture;
  private textureSize = 0;
  private program: LabelSpriteProgram;
  private measureCanvas: HTMLCanvasElement;
  private rasterCanvas: HTMLCanvasElement;

  private gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.texture = gl.createTexture()!;
    this.program = new LabelSpriteProgram(gl);
    this.measureCanvas = document.createElement("canvas");
    this.rasterCanvas = document.createElement("canvas");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  sync(descriptors: LabelDescriptor[], pixelRatio: number): LabelSprite[] {
    const gl = this.gl;
    const rendered: string[] = [];
    const sprites = this.layout.sync(descriptors, pixelRatio, (descriptor) => {
      const context = this.measureCanvas.getContext("2d")!;
      const size = descriptor.bold ? 12 : 11;
      context.font = `${descriptor.bold ? "bold " : ""}${size * pixelRatio}px sans-serif`;
      return {
        width: Math.max(1, Math.ceil(context.measureText(descriptor.text).width + 2 * pixelRatio)),
        height: Math.max(1, Math.ceil((descriptor.bold ? 16 : 15) * pixelRatio)),
      };
    }, rendered);
    if (this.textureSize !== this.layout.atlasSize) {
      this.textureSize = this.layout.atlasSize;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.textureSize, this.textureSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    for (const pending of this.layout.pending) this.upload(pending.descriptor, pending.rect, pixelRatio);
    this.program.draw(sprites, pixelRatio);
    return sprites;
  }

  private upload(descriptor: LabelDescriptor, rect: LabelRect, pixelRatio: number) {
    const gl = this.gl;
    const canvas = this.rasterCanvas;
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext("2d")!;
    const size = descriptor.bold ? 12 : 11;
    context.font = `${descriptor.bold ? "bold " : ""}${size * pixelRatio}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillStyle = descriptor.color;
    context.globalAlpha = 1;
    context.fillText(descriptor.text, rect.width / 2, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  clear() {
    this.layout = new LabelAtlasLayout();
    this.textureSize = 0;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    this.program.dispose();
    this.measureCanvas.width = 0;
    this.rasterCanvas.width = 0;
  }
}
