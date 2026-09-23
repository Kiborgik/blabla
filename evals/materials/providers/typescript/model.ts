import { FILE_NAME } from "./store";

export const FIELDS = ["id", "text"];

export class Widget {
  constructor(public id: number, public text: string) {}

  static fileName(): string {
    return FILE_NAME;
  }
}
