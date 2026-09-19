#include "blabla_adapter.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BLABLA_LINE_LIMIT (1024 * 1024)

static void out_grow(blabla_out *out, size_t needed) {
    if (out->length + needed + 1 <= out->capacity) {
        return;
    }
    size_t capacity = out->capacity ? out->capacity : 256;
    while (capacity < out->length + needed + 1) {
        capacity *= 2;
    }
    char *buffer = (char *)realloc(out->buffer, capacity);
    if (!buffer) {
        fprintf(stderr, "blabla: out of memory building a response\n");
        exit(1);
    }
    out->buffer = buffer;
    out->capacity = capacity;
}

void blabla_out_reset(blabla_out *out) {
    out->length = 0;
    if (out->buffer) {
        out->buffer[0] = '\0';
    }
}

void blabla_out_text(blabla_out *out, const char *text) {
    size_t size = strlen(text);
    out_grow(out, size);
    memcpy(out->buffer + out->length, text, size);
    out->length += size;
    out->buffer[out->length] = '\0';
}

void blabla_out_string(blabla_out *out, const char *text) {
    blabla_out_text(out, "\"");
    for (const char *cursor = text; *cursor; cursor++) {
        unsigned char byte = (unsigned char)*cursor;
        char escaped[8];
        switch (byte) {
            case '"': blabla_out_text(out, "\\\""); break;
            case '\\': blabla_out_text(out, "\\\\"); break;
            case '\n': blabla_out_text(out, "\\n"); break;
            case '\r': blabla_out_text(out, "\\r"); break;
            case '\t': blabla_out_text(out, "\\t"); break;
            default:
                if (byte < 0x20) {
                    snprintf(escaped, sizeof escaped, "\\u%04x", byte);
                    blabla_out_text(out, escaped);
                } else {
                    escaped[0] = (char)byte;
                    escaped[1] = '\0';
                    blabla_out_text(out, escaped);
                }
        }
    }
    blabla_out_text(out, "\"");
}

void blabla_out_integer(blabla_out *out, long long value) {
    char rendered[32];
    snprintf(rendered, sizeof rendered, "%lld", value);
    blabla_out_text(out, rendered);
}

void blabla_out_bool(blabla_out *out, int value) {
    blabla_out_text(out, value ? "true" : "false");
}

static const char *skip_space(const char *cursor) {
    while (*cursor == ' ' || *cursor == '\t' || *cursor == '\n' || *cursor == '\r') {
        cursor++;
    }
    return cursor;
}

static const char *read_string(const char *cursor, char *into, size_t size) {
    if (*cursor != '"') {
        return NULL;
    }
    cursor++;
    size_t written = 0;
    while (*cursor && *cursor != '"') {
        char value = *cursor;
        if (value == '\\') {
            cursor++;
            switch (*cursor) {
                case 'n': value = '\n'; break;
                case 'r': value = '\r'; break;
                case 't': value = '\t'; break;
                case 'b': value = '\b'; break;
                case 'f': value = '\f'; break;
                case 'u': {
                    char digits[5] = {0};
                    for (int index = 0; index < 4; index++) {
                        if (!cursor[1 + index]) {
                            return NULL;
                        }
                        digits[index] = cursor[1 + index];
                    }
                    cursor += 4;
                    value = (char)strtol(digits, NULL, 16);
                    break;
                }
                case '\0': return NULL;
                default: value = *cursor;
            }
        }
        if (into) {
            if (written + 1 >= size) {
                return NULL;
            }
            into[written] = value;
        }
        written++;
        cursor++;
    }
    if (*cursor != '"') {
        return NULL;
    }
    if (into) {
        into[written] = '\0';
    }
    return cursor + 1;
}

static const char *skip_value(const char *cursor);

static const char *skip_members(const char *cursor, char close) {
    cursor = skip_space(cursor);
    if (*cursor == close) {
        return cursor + 1;
    }
    while (*cursor) {
        cursor = skip_value(cursor);
        if (!cursor) {
            return NULL;
        }
        cursor = skip_space(cursor);
        if (*cursor == ',') {
            cursor = skip_space(cursor + 1);
            continue;
        }
        if (*cursor == close) {
            return cursor + 1;
        }
        return NULL;
    }
    return NULL;
}

static const char *skip_value(const char *cursor) {
    cursor = skip_space(cursor);
    if (*cursor == '"') {
        return read_string(cursor, NULL, 0);
    }
    if (*cursor == '{') {
        cursor = skip_space(cursor + 1);
        if (*cursor == '}') {
            return cursor + 1;
        }
        while (*cursor) {
            cursor = read_string(skip_space(cursor), NULL, 0);
            if (!cursor) {
                return NULL;
            }
            cursor = skip_space(cursor);
            if (*cursor != ':') {
                return NULL;
            }
            cursor = skip_value(cursor + 1);
            if (!cursor) {
                return NULL;
            }
            cursor = skip_space(cursor);
            if (*cursor == ',') {
                cursor = skip_space(cursor + 1);
                continue;
            }
            if (*cursor == '}') {
                return cursor + 1;
            }
            return NULL;
        }
        return NULL;
    }
    if (*cursor == '[') {
        return skip_members(cursor + 1, ']');
    }
    const char *start = cursor;
    while (*cursor && *cursor != ',' && *cursor != '}' && *cursor != ']' && *cursor != ' ') {
        cursor++;
    }
    return cursor == start ? NULL : cursor;
}

static const char *find_member(const char *line, const char *key) {
    const char *cursor = skip_space(line);
    if (*cursor != '{') {
        return NULL;
    }
    cursor = skip_space(cursor + 1);
    if (*cursor == '}') {
        return NULL;
    }
    while (*cursor) {
        char name[64];
        const char *after = read_string(cursor, name, sizeof name);
        if (!after) {
            return NULL;
        }
        after = skip_space(after);
        if (*after != ':') {
            return NULL;
        }
        after = skip_space(after + 1);
        if (strcmp(name, key) == 0) {
            return after;
        }
        after = skip_value(after);
        if (!after) {
            return NULL;
        }
        after = skip_space(after);
        if (*after == ',') {
            cursor = skip_space(after + 1);
            continue;
        }
        return NULL;
    }
    return NULL;
}

static int read_arg(const char **cursor, blabla_arg *into) {
    const char *at = skip_space(*cursor);
    if (*at == '"') {
        const char *after = read_string(at, into->text, sizeof into->text);
        if (!after) {
            return 0;
        }
        into->kind = BLABLA_ARG_STRING;
        *cursor = after;
        return 1;
    }
    if (strncmp(at, "true", 4) == 0) {
        into->kind = BLABLA_ARG_BOOL;
        into->boolean = 1;
        *cursor = at + 4;
        return 1;
    }
    if (strncmp(at, "false", 5) == 0) {
        into->kind = BLABLA_ARG_BOOL;
        into->boolean = 0;
        *cursor = at + 5;
        return 1;
    }
    char *end = NULL;
    long long value = strtoll(at, &end, 10);
    if (end == at) {
        return 0;
    }
    if (*end == '.' || *end == 'e' || *end == 'E') {
        return 0;
    }
    into->kind = BLABLA_ARG_INT;
    into->integer = value;
    *cursor = end;
    return 1;
}

static int read_args(const char *line, blabla_args *into) {
    into->count = 0;
    const char *cursor = find_member(line, "args");
    if (!cursor) {
        return 1;
    }
    if (*cursor != '[') {
        return 0;
    }
    cursor = skip_space(cursor + 1);
    if (*cursor == ']') {
        return 1;
    }
    while (*cursor) {
        if (into->count >= BLABLA_MAX_ARGS) {
            return 0;
        }
        if (!read_arg(&cursor, &into->items[into->count])) {
            return 0;
        }
        into->count++;
        cursor = skip_space(cursor);
        if (*cursor == ',') {
            cursor = skip_space(cursor + 1);
            continue;
        }
        return *cursor == ']';
    }
    return 0;
}

static void emit(const char *identity, const char *result) {
    printf("{\"id\":%s,\"result\":%s}\n", identity, result);
    fflush(stdout);
}

static void emit_error(const char *identity, const char *message) {
    blabla_out out = {0};
    blabla_out_text(&out, "{\"ok\":false,\"error\":");
    blabla_out_string(&out, message);
    blabla_out_text(&out, "}");
    emit(identity, out.buffer ? out.buffer : "{\"ok\":false}");
    free(out.buffer);
}

static const blabla_action *find_action(const blabla_adapter *adapter, const char *name) {
    for (int index = 0; index < adapter->action_count; index++) {
        if (strcmp(adapter->actions[index].name, name) == 0) {
            return &adapter->actions[index];
        }
    }
    return NULL;
}

int blabla_serve(const blabla_adapter *adapter) {
    char *line = (char *)malloc(BLABLA_LINE_LIMIT);
    if (!line) {
        fprintf(stderr, "blabla: out of memory reading requests\n");
        return 1;
    }
    while (fgets(line, BLABLA_LINE_LIMIT, stdin)) {
        const char *trimmed = skip_space(line);
        if (*trimmed == '\0') {
            continue;
        }
        char identity[256];
        const char *identity_at = find_member(line, "id");
        if (!identity_at) {
            fprintf(stderr, "blabla: request without a readable id\n");
            continue;
        }
        const char *identity_end = skip_value(identity_at);
        if (!identity_end) {
            fprintf(stderr, "blabla: request with an unreadable id\n");
            continue;
        }
        size_t identity_size = (size_t)(identity_end - identity_at);
        if (identity_size >= sizeof identity) {
            fprintf(stderr, "blabla: request id is too long\n");
            continue;
        }
        memcpy(identity, identity_at, identity_size);
        identity[identity_size] = '\0';

        char operation[32];
        const char *operation_at = find_member(line, "op");
        if (!operation_at || !read_string(operation_at, operation, sizeof operation)) {
            emit_error(identity, "request has no readable op");
            continue;
        }

        if (strcmp(operation, "reset") == 0) {
            adapter->reset(adapter->state);
            emit(identity, "{\"ok\":true}");
            continue;
        }
        if (strcmp(operation, "observe") == 0) {
            blabla_out out = {0};
            adapter->observe(adapter->state, &out);
            emit(identity, out.buffer ? out.buffer : "{}");
            free(out.buffer);
            continue;
        }
        if (strcmp(operation, "call") != 0) {
            emit_error(identity, "unknown op");
            continue;
        }

        char name[128];
        const char *name_at = find_member(line, "name");
        if (!name_at || !read_string(name_at, name, sizeof name)) {
            emit_error(identity, "call has no readable name");
            continue;
        }
        const blabla_action *action = find_action(adapter, name);
        if (!action) {
            emit_error(identity, "unknown action");
            continue;
        }
        blabla_args args;
        if (!read_args(line, &args)) {
            emit_error(identity, "call arguments are not readable scalars");
            continue;
        }
        if (args.count != action->arity) {
            emit_error(identity, "call has the wrong number of arguments");
            continue;
        }
        char failure[256];
        failure[0] = '\0';
        if (!action->handler(adapter->state, &args, failure, sizeof failure)) {
            emit_error(identity, failure[0] ? failure : "the action refused the call");
            continue;
        }
        emit(identity, "{\"ok\":true}");
    }
    free(line);
    return 0;
}
