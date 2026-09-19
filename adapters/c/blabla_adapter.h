#ifndef BLABLA_ADAPTER_H
#define BLABLA_ADAPTER_H

#include <stddef.h>

#define BLABLA_MAX_ARGS 8
#define BLABLA_MAX_TEXT 4096

typedef enum {
    BLABLA_ARG_ABSENT = 0,
    BLABLA_ARG_INT,
    BLABLA_ARG_BOOL,
    BLABLA_ARG_STRING
} blabla_arg_kind;

typedef struct {
    blabla_arg_kind kind;
    long long integer;
    int boolean;
    char text[BLABLA_MAX_TEXT];
} blabla_arg;

typedef struct {
    blabla_arg items[BLABLA_MAX_ARGS];
    int count;
} blabla_args;

typedef struct {
    char *buffer;
    size_t capacity;
    size_t length;
} blabla_out;

typedef int (*blabla_action_fn)(void *state, const blabla_args *args, char *error, size_t error_size);
typedef void (*blabla_reset_fn)(void *state);
typedef void (*blabla_observe_fn)(void *state, blabla_out *out);

typedef struct {
    const char *name;
    int arity;
    blabla_action_fn handler;
} blabla_action;

typedef struct {
    void *state;
    blabla_reset_fn reset;
    blabla_observe_fn observe;
    const blabla_action *actions;
    int action_count;
} blabla_adapter;

void blabla_out_reset(blabla_out *out);
void blabla_out_text(blabla_out *out, const char *text);
void blabla_out_string(blabla_out *out, const char *text);
void blabla_out_integer(blabla_out *out, long long value);
void blabla_out_bool(blabla_out *out, int value);

int blabla_serve(const blabla_adapter *adapter);

#endif
