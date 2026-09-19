package todo.app;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import todo.model.Todo;
import todo.store.TodoStore;

public final class TodoApp {
    public static final String[] ACTIONS = {"add", "complete", "remove"};

    private final TodoStore store;
    private List<Todo> todos;

    public TodoApp(Path directory) {
        this.store = new TodoStore(directory);
        this.todos = store.load();
    }

    public List<Todo> todos() {
        return List.copyOf(todos);
    }

    public void reset() {
        store.clear();
        todos = new ArrayList<>();
    }

    public void add(String text) {
        if (text.isEmpty()) {
            return;
        }
        long next = 0;
        for (Todo todo : todos) {
            next = Math.max(next, todo.id());
        }
        todos.add(new Todo(next + 1, text, false));
        store.save(todos);
    }

    public void complete(long id) {
        for (int index = 0; index < todos.size(); index++) {
            Todo todo = todos.get(index);
            if (todo.id() == id && !todo.done()) {
                todos.set(index, todo.completed());
                store.save(todos);
                return;
            }
        }
    }

    public void remove(long id) {
        int before = todos.size();
        todos.removeIf(todo -> todo.id() == id);
        if (todos.size() != before) {
            store.save(todos);
        }
    }
}
