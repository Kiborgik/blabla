#include "blabla_adapter.h"

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

namespace {

const char *const STORE = "todos.db";

struct Todo {
    long long id;
    std::string text;
    bool done;
};

class Store {
public:
    Store() { load(); }

    const std::vector<Todo> &items() const { return items_; }

    void clear() {
        items_.clear();
        std::remove(STORE);
    }

    void add(const std::string &text) {
        if (text.empty()) {
            return;
        }
        long long next = 0;
        for (const Todo &todo : items_) {
            next = std::max(next, todo.id);
        }
        items_.push_back(Todo{next + 1, text, false});
        save();
    }

    void complete(long long id) {
        for (Todo &todo : items_) {
            if (todo.id == id && !todo.done) {
                todo.done = true;
                save();
                return;
            }
        }
    }

    void remove(long long id) {
        const std::size_t before = items_.size();
        items_.erase(
            std::remove_if(items_.begin(), items_.end(),
                           [id](const Todo &todo) { return todo.id == id; }),
            items_.end());
        if (items_.size() != before) {
            save();
        }
    }

private:
    void save() const {
        std::ofstream file(STORE, std::ios::binary | std::ios::trunc);
        if (!file) {
            return;
        }
        for (const Todo &todo : items_) {
            file << todo.id << ' ' << (todo.done ? 1 : 0) << ' ' << todo.text.size() << '\n';
            file.write(todo.text.data(), static_cast<std::streamsize>(todo.text.size()));
            file << '\n';
        }
    }

    void load() {
        items_.clear();
        std::ifstream file(STORE, std::ios::binary);
        if (!file) {
            return;
        }
        while (true) {
            long long id = 0;
            int done = 0;
            std::size_t size = 0;
            if (!(file >> id >> done >> size)) {
                return;
            }
            file.get();
            std::string text(size, '\0');
            file.read(text.data(), static_cast<std::streamsize>(size));
            if (file.gcount() != static_cast<std::streamsize>(size)) {
                return;
            }
            file.get();
            items_.push_back(Todo{id, text, done != 0});
        }
    }

    std::vector<Todo> items_;
};

void reset_store(void *state) { static_cast<Store *>(state)->clear(); }

void observe_store(void *state, blabla_out *out) {
    const Store &store = *static_cast<Store *>(state);
    blabla_out_text(out, "{\"todos\":[");
    bool first = true;
    for (const Todo &todo : store.items()) {
        if (!first) {
            blabla_out_text(out, ",");
        }
        first = false;
        blabla_out_text(out, "{\"id\":");
        blabla_out_integer(out, todo.id);
        blabla_out_text(out, ",\"text\":");
        blabla_out_string(out, todo.text.c_str());
        blabla_out_text(out, ",\"done\":");
        blabla_out_bool(out, todo.done ? 1 : 0);
        blabla_out_text(out, "}");
    }
    blabla_out_text(out, "]}");
}

int add_todo(void *state, const blabla_args *args, char *error, std::size_t error_size) {
    if (args->items[0].kind != BLABLA_ARG_STRING) {
        std::snprintf(error, error_size, "add takes a string");
        return 0;
    }
    static_cast<Store *>(state)->add(args->items[0].text);
    return 1;
}

int complete_todo(void *state, const blabla_args *args, char *error, std::size_t error_size) {
    if (args->items[0].kind != BLABLA_ARG_INT) {
        std::snprintf(error, error_size, "complete takes an integer");
        return 0;
    }
    static_cast<Store *>(state)->complete(args->items[0].integer);
    return 1;
}

int remove_todo(void *state, const blabla_args *args, char *error, std::size_t error_size) {
    if (args->items[0].kind != BLABLA_ARG_INT) {
        std::snprintf(error, error_size, "remove takes an integer");
        return 0;
    }
    static_cast<Store *>(state)->remove(args->items[0].integer);
    return 1;
}

const blabla_action ACTIONS[] = {
    {"add", 1, add_todo},
    {"complete", 1, complete_todo},
    {"remove", 1, remove_todo},
};

}

int main() {
    Store store;
    blabla_adapter adapter{
        &store,
        reset_store,
        observe_store,
        ACTIONS,
        static_cast<int>(sizeof ACTIONS / sizeof ACTIONS[0]),
    };
    return blabla_serve(&adapter);
}
