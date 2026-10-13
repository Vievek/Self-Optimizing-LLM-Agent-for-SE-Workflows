export interface Store {
  // Path-based access control - see Section 3.6
  write(path: string, data: unknown): Promise<void>;
  read(path: string): Promise<unknown>;
  exists(path: string): Promise<boolean>;
}
