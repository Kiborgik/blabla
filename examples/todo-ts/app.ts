import { Adapter } from "../../adapters/typescript/blabla_adapter.ts";
import { TodoStorage, type Todo } from "./storage.ts";

export const ACTIONS = ["add", "complete", "remove"];

export class TodoApplication {
    private items: Todo[];
    private readonly storage: TodoStorage;

    constructor(storage: TodoStorage) {
        this.storage = storage;
        this.items = storage.load();
    }

    reset(): void {
        this.storage.reset();
        this.items = [];
    }

    add(text: string): void {
        if (text === "") {
            return;
        }
        const next = this.items.reduce((highest, todo) => Math.max(highest, todo.id), 0) + 1;
        this.items.push({ id: next, text, done: false });
        this.storage.save(this.items);
    }

    complete(id: number): void {
        const target = this.items.find((todo) => todo.id === id);
        if (target === undefined || target.done) {
            return;
        }
        target.done = true;
        this.storage.save(this.items);
    }

    remove(id: number): void {
        const before = this.items.length;
        this.items = this.items.filter((todo) => todo.id !== id);
        if (this.items.length < before) {
            this.storage.save(this.items);
        }
    }

    observe(): { todos: Todo[] } {
        return { todos: this.items.map((todo) => ({ ...todo })) };
    }
}

export function bind(application: TodoApplication): Adapter {
    const adapter = new Adapter(
        () => application.reset(),
        () => application.observe(),
    );
    adapter.action("add", 1, (args) => application.add(args.string(0)));
    adapter.action("complete", 1, (args) => application.complete(args.integer(0)));
    adapter.action("remove", 1, (args) => application.remove(args.integer(0)));
    return adapter;
}

bind(new TodoApplication(new TodoStorage())).serve();
