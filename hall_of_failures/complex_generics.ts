type DeepPartial<T> = T extends Function
  ? T
  : T extends Array<infer U>
  ? _DeepPartialArray<U>
  : T extends object
  ? _DeepPartialObject<T>
  : T | undefined;

interface _DeepPartialArray<T> extends Array<DeepPartial<T>> {}
type _DeepPartialObject<T> = { [P in keyof T]?: DeepPartial<T[P]> };

export class StateStore<T> {
  private state: T;

  constructor(initialState: T) {
    this.state = initialState;
  }

  update(patch: DeepPartial<T>): void {
    // Implementation uses complex type merging
    Object.assign(this.state as any, patch);
  }
}
