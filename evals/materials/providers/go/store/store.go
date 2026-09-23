package store

import "widget/model"

const FileName = "widget.json"

type Store struct {
	Path string
}

func (s *Store) Load() []model.Widget {
	return nil
}
