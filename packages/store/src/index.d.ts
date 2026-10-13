export interface Store {
  write(path: string, data: unknown): Promise<void>;
  read(path: string): Promise<unknown>;
  exists(path: string): Promise<boolean>;
}
//# sourceMappingURL=index.d.ts.map
