export class GeometryBatch {
  private buffer: Float32Array;
  private length = 0;

  constructor(capacity = 4096) {
    this.buffer = new Float32Array(capacity);
  }

  get vertexCount() {
    return this.length / 6;
  }

  clear() {
    this.length = 0;
  }

  vertex(x: number, y: number, r: number, g: number, b: number, a: number) {
    if (this.length + 6 > this.buffer.length) {
      const grown = new Float32Array(this.buffer.length * 2);
      grown.set(this.buffer);
      this.buffer = grown;
    }
    this.buffer[this.length++] = x;
    this.buffer[this.length++] = y;
    this.buffer[this.length++] = r;
    this.buffer[this.length++] = g;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = a;
  }

  values() {
    return this.buffer.subarray(0, this.length);
  }
}
