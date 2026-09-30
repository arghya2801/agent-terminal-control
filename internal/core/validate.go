package core

import (
	"encoding/json"
	"fmt"
	"math"
)

func ParseSettings(data []byte) (Object, error) {
	var input Object
	if e := json.Unmarshal(data, &input); e != nil {
		return nil, e
	}
	if input == nil {
		return nil, fmt.Errorf("settings must be an object")
	}
	defaults := Defaults()
	if e := validateSettings(input, defaults, ""); e != nil {
		return nil, e
	}
	Merge(defaults, input)
	return defaults, nil
}
func validateSettings(input, defaults Object, path string) error {
	for k, v := range input {
		d, known := defaults[k]
		if !known {
			continue
		}
		field := path + k
		fail := func() error { return fmt.Errorf("invalid setting %s", field) }
		switch k {
		case "names", "sessionNames":
			m, ok := v.(map[string]any)
			if !ok {
				return fail()
			}
			for _, name := range m {
				if _, ok := name.(string); !ok {
					return fail()
				}
			}
			continue
		case "pinned":
			a, ok := v.([]any)
			if !ok {
				return fail()
			}
			for _, item := range a {
				p, ok := item.(map[string]any)
				if !ok {
					return fail()
				}
				for key, val := range p {
					switch key {
					case "path":
						if _, ok := val.(string); !ok {
							return fail()
						}
					case "displayName":
						if val != nil {
							if _, ok := val.(string); !ok {
								return fail()
							}
						}
					case "order":
						n, ok := val.(float64)
						if !ok || n != math.Trunc(n) || n < -2147483648 || n > 2147483647 {
							return fail()
						}
					}
				}
			}
			continue
		}
		switch def := d.(type) {
		case map[string]any:
			m, ok := v.(map[string]any)
			if !ok {
				return fail()
			}
			if e := validateSettings(m, def, field+"."); e != nil {
				return e
			}
		case bool:
			if _, ok := v.(bool); !ok {
				return fail()
			}
		case string:
			if _, ok := v.(string); !ok {
				return fail()
			}
		case int:
			n, ok := v.(float64)
			if !ok || n < 0 || n != math.Trunc(n) || n > 4294967295 {
				return fail()
			}
		case float64:
			if _, ok := v.(float64); !ok {
				return fail()
			}
		case []any:
			a, ok := v.([]any)
			if !ok {
				return fail()
			}
			for _, item := range a {
				if _, ok := item.(string); !ok {
					return fail()
				}
			}
		case nil:
			if v != nil {
				if _, ok := v.(string); !ok {
					return fail()
				}
			}
		}
	}
	return nil
}
