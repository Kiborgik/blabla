#include "format.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int format_encode(const Widget *widgets, int count, char *out, int capacity) {
    int written = snprintf(out, capacity, "[");
    for (int index = 0; index < count && written < capacity; index++) {
        written += snprintf(out + written, capacity - written, "%s{\"id\":%d,\"text\":\"%s\"}",
                            index > 0 ? "," : "", widgets[index].id, widgets[index].text);
    }
    if (written < capacity) {
        written += snprintf(out + written, capacity - written, "]");
    }
    return written;
}

int format_decode(const char *text, Widget *out, int capacity) {
    int count = 0;
    const char *cursor = text;
    while (count < capacity && (cursor = strstr(cursor, "\"id\":")) != NULL) {
        out[count].id = (int)strtol(cursor + 5, NULL, 10);
        const char *start = strstr(cursor, "\"text\":\"");
        if (start == NULL) {
            break;
        }
        start += 8;
        const char *end = strchr(start, '"');
        if (end == NULL) {
            break;
        }
        char *copy = malloc((size_t)(end - start) + 1);
        memcpy(copy, start, (size_t)(end - start));
        copy[end - start] = '\0';
        out[count].text = copy;
        count++;
        cursor = end;
    }
    return count;
}
