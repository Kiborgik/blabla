package todo.model;

public final class Todo {
    public static final String[] FIELDS = {"id", "text", "done"};

    private final long id;
    private final String text;
    private final boolean done;

    public Todo(long id, String text, boolean done) {
        this.id = id;
        this.text = text;
        this.done = done;
    }

    public long id() {
        return id;
    }

    public String text() {
        return text;
    }

    public boolean done() {
        return done;
    }

    public Todo completed() {
        return new Todo(id, text, true);
    }
}
