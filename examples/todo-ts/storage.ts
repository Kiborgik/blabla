import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";

export const STORE_FILE = "todos.json";

export interface Todo {
    id: number;
    text: string;
    done: boolean;
}

export class TodoStorage {
    load(): Todo[] {
        try {
            return JSON.parse(readFileSync(STORE_FILE, "utf8")) as Todo[];
        } catch {
            return [];
        }
    }

    save(todos: Todo[]): void {
        const pending = `${STORE_FILE}.tmp`;
        writeFileSync(pending, JSON.stringify(todos));
        renameSync(pending, STORE_FILE);
    }

    reset(): void {
        for (const path of [STORE_FILE, `${STORE_FILE}.tmp`]) {
            try {
                rmSync(path);
            } catch {
                continue;
            }
        }
    }
}
