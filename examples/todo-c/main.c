#include "blabla_adapter.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define STORE "todos.db"
#define CAPACITY 1024

typedef struct {
    long long id;
    int done;
    char *text;
} Todo;

typedef struct {
    Todo items[CAPACITY];
    int count;
} Store;

static void store_clear(Store *store) {
    for (int index = 0; index < store->count; index++) {
        free(store->items[index].text);
        store->items[index].text = NULL;
    }
    store->count = 0;
}

static void store_save(const Store *store) {
    FILE *file = fopen(STORE ".tmp", "wb");
    if (!file) {
        return;
    }
    for (int index = 0; index < store->count; index++) {
        const Todo *todo = &store->items[index];
        size_t size = strlen(todo->text);
        fprintf(file, "%lld %d %zu\n", todo->id, todo->done, size);
        fwrite(todo->text, 1, size, file);
        fputc('\n', file);
    }
    fclose(file);
    remove(STORE);
    rename(STORE ".tmp", STORE);
}

static void store_load(Store *store) {
    store_clear(store);
    FILE *file = fopen(STORE, "rb");
    if (!file) {
        return;
    }
    while (store->count < CAPACITY) {
        long long id = 0;
        int done = 0;
        size_t size = 0;
        if (fscanf(file, "%lld %d %zu\n", &id, &done, &size) != 3) {
            break;
        }
        char *text = (char *)malloc(size + 1);
        if (!text) {
            break;
        }
        if (fread(text, 1, size, file) != size) {
            free(text);
            break;
        }
        text[size] = '\0';
        fgetc(file);
        store->items[store->count].id = id;
        store->items[store->count].done = done;
        store->items[store->count].text = text;
        store->count++;
    }
    fclose(file);
}

static int find_index(const Store *store, long long id) {
    for (int index = 0; index < store->count; index++) {
        if (store->items[index].id == id) {
            return index;
        }
    }
    return -1;
}

static void reset(void *state) {
    Store *store = (Store *)state;
    store_clear(store);
    remove(STORE);
    remove(STORE ".tmp");
}

static void observe(void *state, blabla_out *out) {
    Store *store = (Store *)state;
    blabla_out_text(out, "{\"todos\":[");
    for (int index = 0; index < store->count; index++) {
        if (index > 0) {
            blabla_out_text(out, ",");
        }
        blabla_out_text(out, "{\"id\":");
        blabla_out_integer(out, store->items[index].id);
        blabla_out_text(out, ",\"text\":");
        blabla_out_string(out, store->items[index].text);
        blabla_out_text(out, ",\"done\":");
        blabla_out_bool(out, store->items[index].done);
        blabla_out_text(out, "}");
    }
    blabla_out_text(out, "]}");
}

static int add(void *state, const blabla_args *args, char *error, size_t error_size) {
    Store *store = (Store *)state;
    if (args->items[0].kind != BLABLA_ARG_STRING) {
        snprintf(error, error_size, "add takes a string");
        return 0;
    }
    const char *text = args->items[0].text;
    if (text[0] == '\0') {
        return 1;
    }
    if (store->count >= CAPACITY) {
        snprintf(error, error_size, "the store is full");
        return 0;
    }
    long long next = 0;
    for (int index = 0; index < store->count; index++) {
        if (store->items[index].id > next) {
            next = store->items[index].id;
        }
    }
    char *copy = (char *)malloc(strlen(text) + 1);
    if (!copy) {
        snprintf(error, error_size, "out of memory");
        return 0;
    }
    strcpy(copy, text);
    store->items[store->count].id = next + 1;
    store->items[store->count].done = 0;
    store->items[store->count].text = copy;
    store->count++;
    store_save(store);
    return 1;
}

static int complete(void *state, const blabla_args *args, char *error, size_t error_size) {
    Store *store = (Store *)state;
    if (args->items[0].kind != BLABLA_ARG_INT) {
        snprintf(error, error_size, "complete takes an integer");
        return 0;
    }
    int index = find_index(store, args->items[0].integer);
    if (index >= 0 && !store->items[index].done) {
        store->items[index].done = 1;
        store_save(store);
    }
    return 1;
}

static int remove_todo(void *state, const blabla_args *args, char *error, size_t error_size) {
    Store *store = (Store *)state;
    if (args->items[0].kind != BLABLA_ARG_INT) {
        snprintf(error, error_size, "remove takes an integer");
        return 0;
    }
    int index = find_index(store, args->items[0].integer);
    if (index < 0) {
        return 1;
    }
    free(store->items[index].text);
    for (int shift = index; shift + 1 < store->count; shift++) {
        store->items[shift] = store->items[shift + 1];
    }
    store->count--;
    store->items[store->count].text = NULL;
    store_save(store);
    return 1;
}

static const blabla_action ACTIONS[] = {
    {"add", 1, add},
    {"complete", 1, complete},
    {"remove", 1, remove_todo},
};

int main(void) {
    static Store store;
    store_load(&store);
    blabla_adapter adapter = {
        &store,
        reset,
        observe,
        ACTIONS,
        (int)(sizeof ACTIONS / sizeof ACTIONS[0]),
    };
    return blabla_serve(&adapter);
}
