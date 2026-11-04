export class PageLoadGuard {
  private epoch = 0;

  begin(): number {
    this.epoch += 1;
    return this.epoch;
  }

  isCurrent(token: number): boolean {
    return token === this.epoch;
  }
}
