import { createInterface } from "node:readline";

export const LINE_LIMIT = 1024 * 1024;

export class ProtocolError extends Error {}

export class Args {
    private readonly values: unknown[];

    constructor(values: unknown[]) {
        this.values = values;
    }

    get length(): number {
        return this.values.length;
    }

    string(index: number): string {
        const value = this.at(index);
        if (typeof value !== "string") {
            throw new ProtocolError(`argument ${index} is not a string`);
        }
        return value;
    }

    integer(index: number): number {
        const value = this.at(index);
        if (typeof value !== "number" || !Number.isInteger(value)) {
            throw new ProtocolError(`argument ${index} is not a whole number`);
        }
        return value;
    }

    boolean(index: number): boolean {
        const value = this.at(index);
        if (typeof value !== "boolean") {
            throw new ProtocolError(`argument ${index} is not a boolean`);
        }
        return value;
    }

    private at(index: number): unknown {
        if (index >= this.values.length) {
            throw new ProtocolError(`argument ${index} is missing`);
        }
        return this.values[index];
    }
}

export type Handler = (args: Args) => void;

export class Adapter {
    private readonly actions = new Map<string, { arity: number; handler: Handler }>();
    private readonly onReset: () => void;
    private readonly onObserve: () => unknown;

    constructor(onReset: () => void, onObserve: () => unknown) {
        this.onReset = onReset;
        this.onObserve = onObserve;
    }

    action(name: string, arity: number, handler: Handler): Adapter {
        this.actions.set(name, { arity, handler });
        return this;
    }

    call(name: string, values: unknown[]): void {
        const entry = this.actions.get(name);
        if (entry === undefined) {
            throw new ProtocolError(`unknown action: ${name}`);
        }
        if (values.length !== entry.arity) {
            throw new ProtocolError(
                `${name} takes ${entry.arity} arguments, got ${values.length}`,
            );
        }
        entry.handler(new Args(values));
    }

    handle(request: Record<string, unknown>): unknown {
        switch (request.op) {
            case "reset":
                this.onReset();
                return { ok: true };
            case "observe":
                return this.onObserve();
            case "call": {
                const name = request.name;
                if (typeof name !== "string") {
                    throw new ProtocolError("call has no action name");
                }
                const values = request.args ?? [];
                if (!Array.isArray(values)) {
                    throw new ProtocolError("call arguments are not a list");
                }
                this.call(name, values);
                return { ok: true };
            }
            default:
                throw new ProtocolError(`unknown op: ${String(request.op)}`);
        }
    }

    serve(source: NodeJS.ReadableStream = process.stdin): void {
        const lines = createInterface({ input: source });
        lines.on("line", (line) => {
            if (line.trim() === "") {
                return;
            }
            if (line.length > LINE_LIMIT) {
                process.stderr.write("request exceeded the line limit\n");
                return;
            }
            let request: unknown;
            try {
                request = JSON.parse(line);
            } catch (failure) {
                process.stderr.write(`unreadable request: ${String(failure)}\n`);
                return;
            }
            if (typeof request !== "object" || request === null || Array.isArray(request)) {
                process.stderr.write("request is not an object\n");
                return;
            }
            const envelope = request as Record<string, unknown>;
            let result: unknown;
            try {
                result = this.handle(envelope);
            } catch (failure) {
                if (!(failure instanceof ProtocolError)) {
                    throw failure;
                }
                result = { ok: false, error: failure.message };
            }
            process.stdout.write(`${JSON.stringify({ id: envelope.id ?? null, result })}\n`);
        });
    }
}
