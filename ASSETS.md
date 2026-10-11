# Assets

Every third-party file shipped with Groundwork, and the real imagery it can fetch. Everything shipped is CC0. The web build fails if a file under `web/public/assets` is not listed here.

Machines, workers, cranes, cabins, stockpiles, fences, cars, trees, the city blocks and the Abenix core glyph are built in code from parametric parts in `web/src/scene`. They use no downloaded models. Facades, roofs, timber, steel and gravel on them come from the textures below.

## Textures, Poly Haven (CC0)

Licence: CC0 1.0, https://polyhaven.com/license

| File | Source |
|---|---|
| assets/textures/aerial_mud_1_diff_2k.jpg | https://polyhaven.com/a/aerial_mud_1 |
| assets/textures/aerial_mud_1_nor_gl_1k.jpg | https://polyhaven.com/a/aerial_mud_1 |
| assets/textures/dirt_aerial_02_diff_2k.jpg | https://polyhaven.com/a/dirt_aerial_02 |
| assets/textures/dirt_aerial_02_nor_gl_1k.jpg | https://polyhaven.com/a/dirt_aerial_02 |
| assets/textures/aerial_ground_rock_diff_2k.jpg | https://polyhaven.com/a/aerial_ground_rock |
| assets/textures/aerial_ground_rock_nor_gl_1k.jpg | https://polyhaven.com/a/aerial_ground_rock |
| assets/textures/aerial_asphalt_01_diff_2k.jpg | https://polyhaven.com/a/aerial_asphalt_01 |
| assets/textures/aerial_asphalt_01_nor_gl_1k.jpg | https://polyhaven.com/a/aerial_asphalt_01 |
| assets/textures/aerial_grass_rock_diff_2k.jpg | https://polyhaven.com/a/aerial_grass_rock |
| assets/textures/aerial_grass_rock_nor_gl_1k.jpg | https://polyhaven.com/a/aerial_grass_rock |
| assets/textures/muddy_tracks_diff_2k.jpg | https://polyhaven.com/a/muddy_tracks |
| assets/textures/muddy_tracks_nor_gl_1k.jpg | https://polyhaven.com/a/muddy_tracks |
| assets/textures/concrete_floor_02_diff_2k.jpg | https://polyhaven.com/a/concrete_floor_02 |
| assets/textures/concrete_floor_02_nor_gl_1k.jpg | https://polyhaven.com/a/concrete_floor_02 |
| assets/textures/gravel_road_diff_2k.jpg | https://polyhaven.com/a/gravel_road |
| assets/textures/gravel_road_nor_gl_1k.jpg | https://polyhaven.com/a/gravel_road |
| assets/textures/aerial_ground_rock_diff_4k.jpg | https://polyhaven.com/a/aerial_ground_rock |
| assets/textures/brick_wall_10_diff_1k.jpg | https://polyhaven.com/a/brick_wall_10 |
| assets/textures/dark_brick_wall_diff_1k.jpg | https://polyhaven.com/a/dark_brick_wall |
| assets/textures/grey_plaster_02_diff_1k.jpg | https://polyhaven.com/a/grey_plaster_02 |
| assets/textures/rectangular_facade_tiles_diff_1k.jpg | https://polyhaven.com/a/rectangular_facade_tiles |
| assets/textures/tarred_gravel_diff_1k.jpg | https://polyhaven.com/a/tarred_gravel |
| assets/textures/corrugated_iron_diff_1k.jpg | https://polyhaven.com/a/corrugated_iron |
| assets/textures/plywood_diff_1k.jpg | https://polyhaven.com/a/plywood |
| assets/textures/wood_planks_diff_1k.jpg | https://polyhaven.com/a/wood_planks |
| assets/textures/gravel_diff_1k.jpg | https://polyhaven.com/a/gravel |
| assets/textures/sandy_gravel_diff_1k.jpg | https://polyhaven.com/a/sandy_gravel |

## Light, Poly Haven (CC0)

| File | Source |
|---|---|
| assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky |

## Fonts

Inter and JetBrains Mono load from Google Fonts at runtime under the SIL Open Font Licence 1.1. They are not bundled.

## Real imagery, fetched not shipped

`scripts/fetch-real-imagery.py` downloads these into `data/real/` (gitignored) and checks their SHA-256. None is in the repo. See `docs/real-imagery.md`.

| Use | Source | Licence | Attribution |
|---|---|---|---|
| Proof site orthophoto, `data/real/src/nh108.tif` and the tiles made from it | https://map.openaerialmap.org/#/-70.9315,43.0419,18/square/0320010023/65088140f17ffb0001796e73 (file https://oin-hotosm-temp.s3.us-east-1.amazonaws.com/65088140f17ffb0001796e72/0/65088140f17ffb0001796e73.tif, SHA-256 cc0167b362f338695cd401f4be4a0948e531274ebe18956cac6bb2d4c87c1776) | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ | Orthophoto © Craig Goodspeed, via OpenAerialMap (Open Imagery Network), CC BY 4.0. Changes: cropped, reprojected to a local grid, three parked machines retouched out |

| Reconstruction test set, `data/real/caliterra/photos` (77 photos) and everything made from them | https://github.com/OpenDroneMap/odm_data_caliterra at commit bec3dc7296e90aacb3930eb9df8061849fbfe0d0, per-photo SHA-256 in `scripts/real-sources/caliterra.json` | CC0 1.0, `license.html` in the repo | Aerial photos of Caliterra, Dennis Baldwin, CC0 1.0 (credit not required, given anyway) |

Tools the reconstruction runs, downloaded or pulled, never shipped:

| Tool | Source | Licence |
|---|---|---|
| OpenDroneMap, Docker image `opendronemap/odm` | https://github.com/OpenDroneMap/ODM | AGPL-3.0, run as a separate program, none of its code is in Groundwork |
| Brush 0.3.0, Windows build, `data/tools/brush` | https://github.com/ArthurBrussee/brush/releases/tag/v0.3.0, SHA-256 b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6 | Apache-2.0 |

The photographic machines on real ground are built in code in `web/src/scene/hd`, from parametric parts with PBR materials and wear worked out in the shader. They use no downloaded models or textures, so they add no entries here.

Shortlisted, not fetched yet:

| Use | Source | Licence | Attribution |
|---|---|---|---|
| Opening drone video | https://commons.wikimedia.org/wiki/File:Cerro_Armazones_drone_footage.webm | CC BY 4.0 | G. Hüdepohl (atacamaphoto.com)/ESO |
| Context orthophoto, surface and buildings | https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10 | swisstopo free geodata terms | © swisstopo |
| Context orthophoto | https://www.pdok.nl/introductie/-/article/pdok-luchtfoto-rgb-open- | CC BY 4.0 | Luchtfoto © Beeldmateriaal Nederland, via PDOK, CC BY 4.0 |

## Industrial PCs

| File | Source | Licence |
|---|---|---|
| edge/ipc/proto/sparkplug_b.proto | Eclipse Tahu, https://github.com/eclipse-tahu/tahu/blob/5736e404889d4b95910613040a99ba79589ffb13/sparkplug_b/sparkplug_b.proto, copyright (c) 2015, 2018 Cirrus Link Solutions and others | EPL-2.0, kept as published with its header. The Python module is generated from it when the image builds and is not in git |

`edge/dbc/groundwork-j1939.dbc` is written by `edge/tools/make_dbc.py` from Groundwork's own J1939 dictionary. The sample logs in `edge/samples` were recorded from the simulated PCs.

The PC image installs these at build time, none of them is vendored: python-can (LGPL-3.0), cantools (MIT), paho-mqtt (EPL-2.0 or EDL-1.0), protobuf (BSD-3-Clause), msgpack (Apache-2.0), grpcio-tools in the build stage only (Apache-2.0).
