package widget.model;

import widget.store.WidgetStore;

public class Widget {
    public static final String[] FIELDS = {"id", "text"};

    public final int id;
    public final String text;

    public Widget(int id, String text) {
        this.id = id;
        this.text = text;
    }

    public static String fileName() {
        return WidgetStore.FILE_NAME;
    }
}
