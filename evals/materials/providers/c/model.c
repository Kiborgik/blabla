#include "model.h"
#include "store.h"

const char *FIELDS[2] = {"id", "text"};

const char *widget_file_name(void) {
    return STORE_FILE_NAME;
}
