.PHONY: build sync import-save web tiles

build:
	python3 page/build.py

sync:
	python3 page/sync.py

import-save:
	python3 page/import_save.py

web:
	docker compose up -d web

tiles:
	tools/make-tiles.sh
