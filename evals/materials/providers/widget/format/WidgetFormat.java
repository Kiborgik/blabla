package widget.format;

import java.util.ArrayList;
import java.util.List;
import widget.model.Widget;

public class WidgetFormat {
    public static String encode(List<Widget> widgets) {
        StringBuilder text = new StringBuilder("[");
        for (int index = 0; index < widgets.size(); index++) {
            Widget widget = widgets.get(index);
            if (index > 0) {
                text.append(',');
            }
            text.append("{\"id\":").append(widget.id).append(",\"text\":\"").append(widget.text.replace("\"", "\\\"")).append("\"}");
        }
        return text.append(']').toString();
    }

    public static List<Widget> decode(String text) {
        List<Widget> widgets = new ArrayList<>();
        for (String row : text.substring(1, Math.max(1, text.length() - 1)).split("\\},")) {
            int idStart = row.indexOf("\"id\":");
            int textStart = row.indexOf("\"text\":\"");
            if (idStart < 0 || textStart < 0) {
                continue;
            }
            int id = Integer.parseInt(row.substring(idStart + 5, row.indexOf(',', idStart)).trim());
            String value = row.substring(textStart + 8);
            value = value.substring(0, value.lastIndexOf('"'));
            widgets.add(new Widget(id, value.replace("\\\"", "\"")));
        }
        return widgets;
    }
}
