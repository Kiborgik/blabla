package blabla;

import java.io.BufferedReader;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Adapter {
    public static final int LINE_LIMIT = 1024 * 1024;

    public static final class ProtocolError extends RuntimeException {
        public ProtocolError(String message) {
            super(message);
        }
    }

    public static final class Args {
        private final List<Object> values;

        Args(List<Object> values) {
            this.values = values;
        }

        public int size() {
            return values.size();
        }

        public String string(int index) {
            Object value = at(index);
            if (!(value instanceof String text)) {
                throw new ProtocolError("argument " + index + " is not a string");
            }
            return text;
        }

        public long integer(int index) {
            Object value = at(index);
            if (value instanceof Boolean || !(value instanceof Double number)) {
                throw new ProtocolError("argument " + index + " is not a whole number");
            }
            long whole = (long) (double) number;
            if ((double) whole != number) {
                throw new ProtocolError("argument " + index + " is not a whole number");
            }
            return whole;
        }

        public boolean bool(int index) {
            Object value = at(index);
            if (!(value instanceof Boolean flag)) {
                throw new ProtocolError("argument " + index + " is not a boolean");
            }
            return flag;
        }

        private Object at(int index) {
            if (index >= values.size()) {
                throw new ProtocolError("argument " + index + " is missing");
            }
            return values.get(index);
        }
    }

    public interface Handler {
        void call(Args args);
    }

    public interface Observer {
        Object observe();
    }

    private record Action(int arity, Handler handler) {}

    private final Runnable reset;
    private final Observer observer;
    private final Map<String, Action> actions = new LinkedHashMap<>();

    public Adapter(Runnable reset, Observer observer) {
        this.reset = reset;
        this.observer = observer;
    }

    public Adapter action(String name, int arity, Handler handler) {
        actions.put(name, new Action(arity, handler));
        return this;
    }

    public void call(String name, List<Object> values) {
        Action action = actions.get(name);
        if (action == null) {
            throw new ProtocolError("unknown action: " + name);
        }
        if (values.size() != action.arity()) {
            throw new ProtocolError(
                    name + " takes " + action.arity() + " arguments, got " + values.size());
        }
        action.handler().call(new Args(values));
    }

    private Object handle(Map<String, Object> request) {
        Object operation = request.get("op");
        if ("reset".equals(operation)) {
            reset.run();
            return Map.of("ok", Boolean.TRUE);
        }
        if ("observe".equals(operation)) {
            return observer.observe();
        }
        if ("call".equals(operation)) {
            Object name = request.get("name");
            if (!(name instanceof String action)) {
                throw new ProtocolError("call has no action name");
            }
            Object given = request.getOrDefault("args", new ArrayList<>());
            if (!(given instanceof List<?> values)) {
                throw new ProtocolError("call arguments are not a list");
            }
            call(action, new ArrayList<>(values));
            return Map.of("ok", Boolean.TRUE);
        }
        throw new ProtocolError("unknown op: " + operation);
    }

    public int serve() throws IOException {
        PrintStream sink =
                new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        PrintStream logs =
                new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8);
        return serve(System.in, sink, logs);
    }

    public int serve(InputStream source, PrintStream sink, PrintStream logs) throws IOException {
        BufferedReader reader =
                new BufferedReader(new InputStreamReader(source, StandardCharsets.UTF_8));
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.isBlank()) {
                continue;
            }
            if (line.length() > LINE_LIMIT) {
                logs.println("request exceeded the line limit");
                logs.flush();
                continue;
            }
            Map<String, Object> request;
            String identity;
            try {
                Json json = new Json(line);
                Object parsed = json.value();
                json.end();
                if (!(parsed instanceof Map<?, ?> object)) {
                    logs.println("request is not an object");
                    logs.flush();
                    continue;
                }
                request = new LinkedHashMap<>();
                for (Map.Entry<?, ?> entry : object.entrySet()) {
                    request.put(String.valueOf(entry.getKey()), entry.getValue());
                }
                identity = json.raw("id");
            } catch (ProtocolError failure) {
                logs.println("unreadable request: " + failure.getMessage());
                logs.flush();
                continue;
            }
            Object result;
            try {
                result = handle(request);
            } catch (ProtocolError failure) {
                Map<String, Object> error = new LinkedHashMap<>();
                error.put("ok", Boolean.FALSE);
                error.put("error", failure.getMessage());
                result = error;
            }
            sink.print("{\"id\":" + identity + ",\"result\":" + write(result) + "}\n");
            sink.flush();
        }
        return 0;
    }

    static String write(Object value) {
        StringBuilder out = new StringBuilder();
        render(value, out);
        return out.toString();
    }

    private static void render(Object value, StringBuilder out) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String text) {
            quote(text, out);
        } else if (value instanceof Boolean flag) {
            out.append(flag ? "true" : "false");
        } else if (value instanceof Integer || value instanceof Long) {
            out.append(value);
        } else if (value instanceof Double number) {
            out.append(number == Math.rint(number) ? String.valueOf((long) (double) number) : number);
        } else if (value instanceof Map<?, ?> object) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : object.entrySet()) {
                if (!first) {
                    out.append(',');
                }
                first = false;
                quote(String.valueOf(entry.getKey()), out);
                out.append(':');
                render(entry.getValue(), out);
            }
            out.append('}');
        } else if (value instanceof List<?> items) {
            out.append('[');
            for (int index = 0; index < items.size(); index++) {
                if (index > 0) {
                    out.append(',');
                }
                render(items.get(index), out);
            }
            out.append(']');
        } else {
            quote(String.valueOf(value), out);
        }
    }

    private static void quote(String text, StringBuilder out) {
        out.append('"');
        for (int index = 0; index < text.length(); index++) {
            char letter = text.charAt(index);
            switch (letter) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (letter < 0x20 || letter > 0x7e) {
                        out.append(String.format("\\u%04x", (int) letter));
                    } else {
                        out.append(letter);
                    }
                }
            }
        }
        out.append('"');
    }

    private static final class Json {
        private final String text;
        private int at;
        private final Map<String, String> rawTop = new LinkedHashMap<>();
        private int depth;

        Json(String text) {
            this.text = text;
        }

        String raw(String key) {
            return rawTop.getOrDefault(key, "null");
        }

        void end() {
            skip();
            if (at != text.length()) {
                throw new ProtocolError("trailing content after the request");
            }
        }

        Object value() {
            skip();
            if (at >= text.length()) {
                throw new ProtocolError("the request is empty");
            }
            char letter = text.charAt(at);
            return switch (letter) {
                case '{' -> object();
                case '[' -> array();
                case '"' -> string();
                case 't' -> literal("true", Boolean.TRUE);
                case 'f' -> literal("false", Boolean.FALSE);
                case 'n' -> literal("null", null);
                default -> number();
            };
        }

        private Object object() {
            at++;
            depth++;
            Map<String, Object> result = new LinkedHashMap<>();
            skip();
            if (at < text.length() && text.charAt(at) == '}') {
                at++;
                depth--;
                return result;
            }
            while (true) {
                skip();
                String key = string();
                skip();
                expect(':');
                int from = position();
                Object held = value();
                if (depth == 1) {
                    rawTop.put(key, text.substring(from, at).trim());
                }
                result.put(key, held);
                skip();
                if (at < text.length() && text.charAt(at) == ',') {
                    at++;
                    continue;
                }
                expect('}');
                depth--;
                return result;
            }
        }

        private int position() {
            skip();
            return at;
        }

        private Object array() {
            at++;
            depth++;
            List<Object> result = new ArrayList<>();
            skip();
            if (at < text.length() && text.charAt(at) == ']') {
                at++;
                depth--;
                return result;
            }
            while (true) {
                result.add(value());
                skip();
                if (at < text.length() && text.charAt(at) == ',') {
                    at++;
                    continue;
                }
                expect(']');
                depth--;
                return result;
            }
        }

        private String string() {
            expect('"');
            StringBuilder out = new StringBuilder();
            while (at < text.length()) {
                char letter = text.charAt(at++);
                if (letter == '"') {
                    return out.toString();
                }
                if (letter != '\\') {
                    out.append(letter);
                    continue;
                }
                if (at >= text.length()) {
                    break;
                }
                char escaped = text.charAt(at++);
                switch (escaped) {
                    case '"' -> out.append('"');
                    case '\\' -> out.append('\\');
                    case '/' -> out.append('/');
                    case 'b' -> out.append('\b');
                    case 'f' -> out.append('\f');
                    case 'n' -> out.append('\n');
                    case 'r' -> out.append('\r');
                    case 't' -> out.append('\t');
                    case 'u' -> {
                        if (at + 4 > text.length()) {
                            throw new ProtocolError("a truncated unicode escape");
                        }
                        String digits = text.substring(at, at + 4);
                        for (int index = 0; index < 4; index++) {
                            if (Character.digit(digits.charAt(index), 16) < 0) {
                                throw new ProtocolError("a malformed unicode escape");
                            }
                        }
                        out.append((char) Integer.parseInt(digits, 16));
                        at += 4;
                    }
                    default -> throw new ProtocolError("an unknown escape: \\" + escaped);
                }
            }
            throw new ProtocolError("an unterminated string");
        }

        private Object literal(String word, Object held) {
            if (!text.startsWith(word, at)) {
                throw new ProtocolError("not a JSON value at offset " + at);
            }
            at += word.length();
            return held;
        }

        private Object number() {
            int from = at;
            while (at < text.length() && "+-0123456789.eE".indexOf(text.charAt(at)) >= 0) {
                at++;
            }
            if (from == at) {
                throw new ProtocolError("not a JSON value at offset " + at);
            }
            try {
                return Double.valueOf(text.substring(from, at));
            } catch (NumberFormatException failure) {
                throw new ProtocolError("not a number: " + text.substring(from, at));
            }
        }

        private void expect(char letter) {
            skip();
            if (at >= text.length() || text.charAt(at) != letter) {
                throw new ProtocolError("expected " + letter + " at offset " + at);
            }
            at++;
        }

        private void skip() {
            while (at < text.length() && Character.isWhitespace(text.charAt(at))) {
                at++;
            }
        }
    }
}
