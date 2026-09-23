package format

import (
	"encoding/json"

	"widget/model"
)

func Encode(widgets []model.Widget) (string, error) {
	rows := make([]map[string]any, 0, len(widgets))
	for _, widget := range widgets {
		rows = append(rows, map[string]any{"id": widget.ID, "text": widget.Text})
	}
	text, err := json.Marshal(rows)
	return string(text), err
}

func Decode(text string) ([]model.Widget, error) {
	var rows []struct {
		ID   int    `json:"id"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(text), &rows); err != nil {
		return nil, err
	}
	widgets := make([]model.Widget, 0, len(rows))
	for _, row := range rows {
		widgets = append(widgets, model.Widget{ID: row.ID, Text: row.Text})
	}
	return widgets, nil
}
