export class BoundedQueue<T> {
  private queue: T[] = [];
  private maxSize: number;
  private resolvePush: (() => void) | null = null;
  private resolvePull: ((value: T | null) => void) | null = null;
  private _closed = false;

  constructor(maxSize: number) {
    if (maxSize < 1) throw new Error('maxSize must be >= 1');
    this.maxSize = maxSize;
  }

  get closed(): boolean {
    return this._closed;
  }

  get size(): number {
    return this.queue.length;
  }

  async push(item: T): Promise<void> {
    if (this._closed) throw new Error('Queue is closed');
    this.queue.push(item);
    this.resolvePull?.();
    this.resolvePull = null;
    if (this.queue.length >= this.maxSize) {
      await new Promise<void>((resolve) => {
        this.resolvePush = resolve;
      });
    }
  }

  async pull(): Promise<T | null> {
    while (this.queue.length === 0) {
      if (this._closed) return null;
      await new Promise<void>((resolve) => {
        this.resolvePull = resolve;
      });
    }
    const item = this.queue.shift()!;
    this.resolvePush?.();
    this.resolvePush = null;
    return item;
  }

  close(): void {
    this._closed = true;
    this.resolvePull?.();
    this.resolvePull = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const item = await this.pull();
        if (item === null) return { done: true, value: undefined };
        return { done: false, value: item };
      },
    };
  }
}
