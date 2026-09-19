package todo.store;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import todo.model.Todo;

public final class TodoStore {
    public static final String FILE_NAME = "todos.db";

    private final Path path;

    public TodoStore(Path directory) {
        this.path = directory.resolve(FILE_NAME);
    }

    public List<Todo> load() {
        List<Todo> loaded = new ArrayList<>();
        if (!Files.exists(path)) {
            return loaded;
        }
        try {
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                int first = line.indexOf('\t');
                int second = line.indexOf('\t', first + 1);
                if (first < 0 || second < 0) {
                    continue;
                }
                long id = Long.parseLong(line.substring(0, first));
                boolean done = "1".equals(line.substring(first + 1, second));
                loaded.add(new Todo(id, decode(line.substring(second + 1)), done));
            }
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
        return loaded;
    }

    public void save(List<Todo> todos) {
        List<String> lines = new ArrayList<>();
        for (Todo todo : todos) {
            lines.add(todo.id() + "\t" + (todo.done() ? "1" : "0") + "\t" + encode(todo.text()));
        }
        try {
            Files.write(path, lines, StandardCharsets.UTF_8);
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static String encode(String text) {
        StringBuilder out = new StringBuilder();
        for (int index = 0; index < text.length(); index++) {
            char letter = text.charAt(index);
            switch (letter) {
                case '\\' -> out.append("\\\\");
                case '\t' -> out.append("\\t");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                default -> out.append(letter);
            }
        }
        return out.toString();
    }

    private static String decode(String text) {
        StringBuilder out = new StringBuilder();
        for (int index = 0; index < text.length(); index++) {
            char letter = text.charAt(index);
            if (letter != '\\' || index + 1 >= text.length()) {
                out.append(letter);
                continue;
            }
            char escaped = text.charAt(++index);
            switch (escaped) {
                case '\\' -> out.append('\\');
                case 't' -> out.append('\t');
                case 'n' -> out.append('\n');
                case 'r' -> out.append('\r');
                default -> out.append(escaped);
            }
        }
        return out.toString();
    }

    public void clear() {
        try {
            Files.deleteIfExists(path);
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
    }
}
