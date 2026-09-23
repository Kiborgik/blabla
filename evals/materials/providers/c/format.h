#ifndef FORMAT_H
#define FORMAT_H

#include "model.h"

int format_encode(const Widget *widgets, int count, char *out, int capacity);
int format_decode(const char *text, Widget *out, int capacity);

#endif
