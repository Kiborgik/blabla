package blabla

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

const LineLimit = 1024 * 1024

type Args []any

func (args Args) String(index int) (string, error) {
	if index >= len(args) {
		return "", fmt.Errorf("argument %d is missing", index)
	}
	value, ok := args[index].(string)
	if !ok {
		return "", fmt.Errorf("argument %d is not a string", index)
	}
	return value, nil
}

func (args Args) Int(index int) (int, error) {
	if index >= len(args) {
		return 0, fmt.Errorf("argument %d is missing", index)
	}
	number, ok := args[index].(float64)
	if !ok {
		return 0, fmt.Errorf("argument %d is not a number", index)
	}
	whole := int(number)
	if float64(whole) != number {
		return 0, fmt.Errorf("argument %d is not a whole number", index)
	}
	return whole, nil
}

func (args Args) Bool(index int) (bool, error) {
	if index >= len(args) {
		return false, fmt.Errorf("argument %d is missing", index)
	}
	value, ok := args[index].(bool)
	if !ok {
		return false, fmt.Errorf("argument %d is not a boolean", index)
	}
	return value, nil
}

type Handler func(Args) error

type Action struct {
	Arity   int
	Handler Handler
}

type Adapter struct {
	reset   func()
	observe func() any
	actions map[string]Action
}

func New(reset func(), observe func() any) *Adapter {
	return &Adapter{reset: reset, observe: observe, actions: map[string]Action{}}
}

func (adapter *Adapter) Action(name string, arity int, handler Handler) *Adapter {
	adapter.actions[name] = Action{Arity: arity, Handler: handler}
	return adapter
}

func (adapter *Adapter) Call(name string, args Args) error {
	action, known := adapter.actions[name]
	if !known {
		return fmt.Errorf("unknown action: %s", name)
	}
	if len(args) != action.Arity {
		return fmt.Errorf("%s takes %d arguments, got %d", name, action.Arity, len(args))
	}
	return action.Handler(args)
}

type request struct {
	ID   json.RawMessage `json:"id"`
	Op   string          `json:"op"`
	Name string          `json:"name"`
	Args []any           `json:"args"`
}

func (adapter *Adapter) handle(incoming request) (any, error) {
	switch incoming.Op {
	case "reset":
		adapter.reset()
		return map[string]any{"ok": true}, nil
	case "observe":
		return adapter.observe(), nil
	case "call":
		if incoming.Name == "" {
			return nil, fmt.Errorf("call has no action name")
		}
		if err := adapter.Call(incoming.Name, incoming.Args); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	default:
		return nil, fmt.Errorf("unknown op: %s", incoming.Op)
	}
}

func (adapter *Adapter) Serve(in io.Reader, out io.Writer, logs io.Writer) error {
	reader := bufio.NewReaderSize(in, LineLimit)
	writer := bufio.NewWriter(out)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) == 0 && err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		var incoming request
		if decodeErr := json.Unmarshal(line, &incoming); decodeErr != nil {
			fmt.Fprintf(logs, "unreadable request: %v\n", decodeErr)
			if err == io.EOF {
				return nil
			}
			continue
		}
		identity := incoming.ID
		if identity == nil {
			identity = json.RawMessage("null")
		}
		result, callErr := adapter.handle(incoming)
		if callErr != nil {
			result = map[string]any{"ok": false, "error": callErr.Error()}
		}
		encoded, encodeErr := json.Marshal(map[string]any{
			"id":     identity,
			"result": result,
		})
		if encodeErr != nil {
			return encodeErr
		}
		writer.Write(encoded)
		writer.WriteByte('\n')
		if flushErr := writer.Flush(); flushErr != nil {
			return flushErr
		}
		if err == io.EOF {
			return nil
		}
	}
}

func (adapter *Adapter) Run() int {
	if err := adapter.Serve(os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "adapter stopped: %v\n", err)
		return 1
	}
	return 0
}
