package model

import "widget/store"

var Fields = []string{"id", "text"}

type Widget struct {
	ID   int
	Text string
}

func FileName() string {
	return store.FileName
}
