import blabla.Adapter;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import todo.app.TodoApp;
import todo.model.Todo;

public final class Main {
    public static Adapter bind(TodoApp application) {
        Adapter adapter = new Adapter(application::reset, () -> observation(application));
        adapter.action("add", 1, args -> application.add(args.string(0)));
        adapter.action("complete", 1, args -> application.complete(args.integer(0)));
        adapter.action("remove", 1, args -> application.remove(args.integer(0)));
        return adapter;
    }

    static Object observation(TodoApp application) {
        List<Object> rows = new ArrayList<>();
        for (Todo todo : application.todos()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", todo.id());
            row.put("text", todo.text());
            row.put("done", todo.done());
            rows.add(row);
        }
        return Map.of("todos", rows);
    }

    public static void main(String[] arguments) throws IOException {
        System.exit(bind(new TodoApp(Path.of("."))).serve());
    }
}
