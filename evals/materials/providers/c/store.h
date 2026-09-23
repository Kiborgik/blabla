#ifndef STORE_H
#define STORE_H

#include "model.h"

#define STORE_FILE_NAME "widget.json"

typedef struct {
    const char *path;
} Store;

int store_load(const Store *store, Widget *out, int capacity);

#endif
