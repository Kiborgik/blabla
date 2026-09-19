package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"

	"blabla.dev/adapter/blabla"
)

type Todo struct {
	ID   int    `json:"id"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}

type Storage struct {
	path string
}

func NewStorage(path string) *Storage {
	if path == "" {
		var err error
		path, err = os.Getwd()
		if err != nil {
			panic(err)
		}
		path = filepath.Join(path, "todos.json")
	}
	return &Storage{path: path}
}

func (s *Storage) Load() []Todo {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []Todo{}
		}
		panic(err)
	}
	var todos []Todo
	if err := json.Unmarshal(data, &todos); err != nil {
		panic(err)
	}
	return todos
}

func (s *Storage) Save(todos []Todo) {
	tmpPath := s.path + ".tmp"
	data, err := json.Marshal(todos)
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		panic(err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		panic(err)
	}
}

func (s *Storage) Reset() {
	os.Remove(s.path)
	os.Remove(s.path + ".tmp")
}

type Application struct {
	storage *Storage
	todos   []Todo
}

func NewApplication(storage *Storage) *Application {
	return &Application{
		storage: storage,
		todos:   storage.Load(),
	}
}

func (a *Application) Reset() {
	a.storage.Reset()
	a.todos = []Todo{}
}

func (a *Application) Add(text string) {
	if text == "" {
		return
	}
	nextID := 0
	for _, todo := range a.todos {
		if todo.ID > nextID {
			nextID = todo.ID
		}
	}
	nextID++
	a.todos = append(a.todos, Todo{ID: nextID, Text: text, Done: false})
	a.storage.Save(a.todos)
}

func (a *Application) Complete(id int) {
	for i, todo := range a.todos {
		if todo.ID == id {
			if !todo.Done {
				a.todos[i].Done = true
				a.storage.Save(a.todos)
			}
			return
		}
	}
}

func (a *Application) Remove(id int) {
	original := len(a.todos)
	a.todos = slices.DeleteFunc(a.todos, func(t Todo) bool { return t.ID == id })
	if len(a.todos) < original {
		a.storage.Save(a.todos)
	}
}

func (a *Application) Observe() map[string][]Todo {
	todos := make([]Todo, len(a.todos))
	copy(todos, a.todos)
	return map[string][]Todo{"todos": todos}
}

func main() {
	application := NewApplication(NewStorage(""))
	adapter := blabla.New(
		application.Reset,
		func() any { return application.Observe() },
	)
	adapter.Action("add", 1, func(args blabla.Args) error {
		text, err := args.String(0)
		if err != nil {
			return err
		}
		application.Add(text)
		return nil
	})
	adapter.Action("complete", 1, func(args blabla.Args) error {
		id, err := args.Int(0)
		if err != nil {
			return err
		}
		application.Complete(id)
		return nil
	})
	adapter.Action("remove", 1, func(args blabla.Args) error {
		id, err := args.Int(0)
		if err != nil {
			return err
		}
		application.Remove(id)
		return nil
	})
	os.Exit(adapter.Run())
}
