.PHONY: build sync import-save web tiles

build:
	python3 page/build.py

sync:
	python3 page/sync.py

import-save:
	python3 page/import_save.py

web:
	cd web && npm run dev

tiles:
	tools/make-tiles.sh
