# Real imagery

Northgate Yard is fictional. Its ground has been painted from CC0 aerial textures. This page covers moving it onto real drone imagery: which sources are open enough to ship in a public MIT repo, the site picked for the proof, how the light is matched, and what phase 2 would do.

No imagery is committed. `scripts/fetch-real-imagery.py` downloads the sources into `data/real/` (gitignored), checks their SHA-256 and prepares the tiles the web reads.

```bash
pip install -r scripts/requirements-real.txt
python scripts/fetch-real-imagery.py                      # about 45 MB download, 20 MB of tiles
node scripts/capture.mjs --proof --sizes 1920x1080        # the 30 s proof clip
```

The proof page is `web/proof.html` (`http://localhost:5710/proof.html`). It reads live state from the bff like the ground station, or plays a recorded take with `?playback=1`.

## Shortlist

Every licence below was read at the source on 10 Oct 2026. Pexels, Pixabay and anything without a redistribution grant were left out, including a CC0 excavator clip on Commons that was copied from Pixabay.

### Hero site, drone orthophoto or photos

| Source | Licence | Attribution | Content | Resolution | Overlap | EXIF and time | Size |
|---|---|---|---|---|---|---|---|
| [OpenAerialMap: NH108 Construction Project 20230914](https://map.openaerialmap.org/#/-70.9315,43.0419,18/square/0320010023/65088140f17ffb0001796e73), Craig Goodspeed | CC BY 4.0 (OpenAerialMap: "All imagery contained in OIN is licensed CC-BY 4.0, with attribution as contributors of Open Imagery Network") | Orthophoto © Craig Goodspeed, via OpenAerialMap (Open Imagery Network), CC BY 4.0 | Active excavation beside a road: cut faces, spoil, haul tracks, slab, pipes, an excavator, a loader and a dozer at work | 1.5 cm GSD, 16152 x 15726 px, about 245 x 240 m | Orthophoto only, the photos are not published | No photo EXIF. Capture 14 Sep 2023 20:18 to 21:20 UTC from OAM metadata, sensor DJI FC8282 | 42.5 MB GeoTIFF |
| [OpenAerialMap: Sandhill Parkway Construction 20240321](https://map.openaerialmap.org/), Sky Blue Imagery | CC BY 4.0 | Orthophoto © Sky Blue Imagery, via OpenAerialMap (Open Imagery Network), CC BY 4.0 | Large bulk earthworks pad, silt fences, ponds. A branded fuel station at one edge | 5 cm, 8499 x 17978 px | Orthophoto only | Capture 21 Mar 2024 | 35 MB |
| [OpenAerialMap: Multipurpose Agriculture Building Construction 11/13/2024](https://map.openaerialmap.org/), Ohio Expo Center & State Fair | CC BY 4.0 | Orthophoto © Ohio Expo Center & State Fair, via OpenAerialMap (Open Imagery Network), CC BY 4.0 | Building frame on a slab, parking full of cars, little earthworks | 2 cm, 17874 x 15201 px | Orthophoto only | Capture 13 Nov 2024 | 43 MB |
| [OpenDroneMap odm_data_caliterra](https://github.com/OpenDroneMap/odm_data_caliterra), Dennis Baldwin | CC0 1.0 (license.html: "Aerial photos of Caliterra in Dripping Springs, TX provided by Dennis Baldwin is licensed under a Creative Commons CC0 1.0 Universal License") | Credit not required. Aerial photos of Caliterra, Dennis Baldwin, CC0 | Subdivision roads being cut, stacked culvert pipes, overcast | 77 photos, 4000 x 3000, Canon PowerShot SX260 HS. GSD about 3 to 5 cm, estimated from altitude | Nadir grid, ODM lists it as a known good set | GPS and time in EXIF, 19 Oct 2014 18:21 UTC | 272 MB |
| [OpenDroneMap odm_wietrznia](https://github.com/merkato/odm_wietrznia), Tomasz Nycz | MIT | Copyright (c) 2019 Tomasz Nycz, MIT licence | Disused quarry, now a park with footpaths. Not an active site | 225 photos, 4000 x 3000, DJI FC300C | Nadir grid | GPS and time in EXIF, 18 May 2017 | 1.2 GB |

Also checked and dropped: `odm_data_copr` is CC BY-SA 4.0 (share-alike would bind derived tiles), `odm_sance` is CC BY-SA 4.0, `odm_data_helenenschacht` is GPL-3.0, `odm_data_toledo` and `odm_data_waterbury` carry no licence, and `drone_dataset_sheffield_cross` (Unlicense) is a housing estate.

### Context around the site

| Source | Licence | Attribution | Content | Resolution |
|---|---|---|---|---|
| [swisstopo SWISSIMAGE 10 cm](https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10), swissSURFACE3D, swissBUILDINGS3D | swisstopo free geodata terms: "may be used, distributed and made accessible. Furthermore, they may be enriched and processed and also used commercially" | © swisstopo | National orthophoto, surface model and building models | 10 cm ortho, 0.5 m surface model |
| [PDOK Luchtfoto RGB (Beeldmateriaal Nederland)](https://www.pdok.nl/introductie/-/article/pdok-luchtfoto-rgb-open-) | CC BY 4.0 | Luchtfoto © Beeldmateriaal Nederland, via PDOK, CC BY 4.0. PDOK names the licence but no exact credit line, so this one follows the CC BY 4.0 elements | National winter orthophoto | 8 cm (5 cm on a third of the country since 2025) |

Neither is needed for phase 1. The proof site's own capture is wide enough to frame the excavation.

### Opening shot, real drone video

| Source | Licence | Attribution | Content | Verdict |
|---|---|---|---|---|
| [Cerro Armazones drone footage](https://commons.wikimedia.org/wiki/File:Cerro_Armazones_drone_footage.webm), ESO | CC BY 4.0 | G. Hüdepohl (atacamaphoto.com)/ESO | 2 min 11 s, 1920 x 1080 (4K at ESO). The ELT site in 2018: summit levelled, a 55 m circular pit, haul roads, machines. Orbit and slow descent | Best fit. No readable signage, people are specks. Real place though, so it reads as a real site rather than Northgate Yard |
| [Chantier ID Ciné, Colomiers](https://commons.wikimedia.org/wiki/File:Chantier_-ID_Cin%C3%A9-10_Novembre_2020-Colomiers.webm), Damien-VICART | CC BY 3.0 | Damien-VICART, CC BY 3.0 | 4K, 2 min 25 s, a building site | Dropped: identifiable workers and supplier logos in most shots |
| [White House ballroom construction](https://commons.wikimedia.org/wiki/File:2025-12-17_White_House_ballroom_construction_Washington_DC_11-23-28_1.webm), G. Edward Johnson | CC BY 4.0 | G. Edward Johnson, CC BY 4.0 | 8K, 12 s | Dropped: a famous landmark, not a neutral site |

## The pick

**NH108 Construction Project 20230914** on OpenAerialMap.

- **Licence.** CC BY 4.0 allows redistribution and derived tiles in a public MIT repo with a credit line. The credit is on screen in the clip and listed in `ASSETS.md`.
- **Content.** It is the only open capture found that shows an active excavation from close up: fresh cut faces, spoil, haul tracks churned by the machines, a pipe store. That matches Northgate Yard's dig, load and haul story.
- **Quality.** 1.5 cm per pixel holds up down to a 25 m drone altitude. The light is a low late-afternoon sun with crisp shadows, which gives a clear direction to match.
- **Coverage.** About 245 x 240 m. The excavation is 125 x 76 m, roughly the size of the twin's site.
- **Privacy and logos.** No people are visible. No vehicles with plates are inside the excavation. The three machines parked on site that day, one with a maker's name on its roof, are cloned out with nearby ground by the fetch script, so only the twin's machines move. The roads at the edge are only seen at a quarter of the resolution.

Its gap is that only the orthophoto is published. There is no elevation model and no raw photo set, so no mesh or splat can come from it. For phase 2 that means either asking the pilot for the photos (the OAM listing carries a contact) or switching to Caliterra, which is CC0 with all 77 photos but has flat light and less going on.

## Light matched to the photo

The sun is computed from the capture time and place, with the NOAA solar position equations in `scripts/fetch-real-imagery.py`.

- Place: the excavation centre, 43.0416 N, 70.9309 W, from the GeoTIFF's UTM 19N transform.
- Time: the midpoint of the OAM acquisition window, 14 Sep 2023 20:49 UTC (16:49 local).
- Result: azimuth 252.8°, elevation 22.1°. Over the hour of the flight it moves from 246.6° at 27.4° to 258.6° at 16.6°.

Shadows in the photo fall east-north-east, which agrees. The twin's machines take the same direction once the photo's rotation onto the site is applied.

The darkness is measured from the photo. Two pairs of patches, one in an excavator's shadow and one in sun right beside it, give shadowed over sunlit ratios of 0.32, 0.42 and 0.57 in sRGB for red, green and blue. Linear, that is 0.082, 0.148 and 0.290. The blue lift is skylight.

The proof page uses that directly. The photo is drawn with a Lambert material under a sky light equal to the shadow ratio and a sun scaled by 1 / sin(elevation), so flat sunlit ground comes out at exactly the photo's own pixels. Ground in a machine's shadow comes out at the photo's shadow level and colour. No tone mapping touches the photo. Shadow softness is a 4096 px map that follows the camera, about 1 to 2 cm per texel over the frame.

## Placement

The twin keeps its own coordinates. The photo is laid under it, turned by -170° and offset so that the twin's EX1 stands at the excavation's working face. That fit was found by sweeping rotation and offset and scoring how much of the twin's excavator and truck paths land on bare ground rather than trees or the slab. 99% do at the chosen fit. Trucks still cross the odd patch the photo shows as a spoil heap, because the twin's haul roads were not drawn for this ground.

The twin queues trucks closer than the 3D model is long. On the textured site this was hidden by the angle. Straight down on a photo it is not, so the proof page leaves out a queued truck that would overlap another machine. The twin's state is not changed.

## The proof clip

`docs/media/groundwork-real-proof-1920x1080.mp4`, 30 s at 60 fps, 1799 frames, every one unique. Rendered with the same frame-stepped capture as the story film from a recorded live take of the bff (`.run/take-free.json`). A slow near-nadir push-in from 64 m to 30 m with the drone-feed lens, grain and HUD. The bottom plate labels the photo as real with its credit and the machines as simulated.

## Phase 2

Phase 2 builds everything that does not need the NH108 photo set, which is not published yet, and leaves the pipeline ready for it.

### The twin on the real ground

The site layout lives in the Abenix code asset `gw-site-twin`. It now carries two layouts with the same work: `northgate`, the rendered site the original films were made on, and `nh108`, laid on the orthophoto in metres east and north of the photo anchor. Every haul road follows a track the photo shows, and none crosses a heap, the pond, the slab or the trench.

- `"layout": "nh108"` on `init` or `site` selects it. The layout then rides in the twin's state, so steps need nothing extra and a warm runner can serve both at once.
- `northgate` is unchanged. A full 1200-step story run hashes to the same value before and after the change.
- The bff passes `GW_SITE` (default `northgate`) to `init`, and `/story/start` takes `{"site": "nh108"}`. That is the whole bff change.
- `bff/tests/test_layouts.py` checks that switching leaves `northgate` alone, that the layout survives in the state, that every route clears the photographed obstacles with a truck's half width to spare, and that no truck, dozer, roller or telehandler stands on one during a full story.
- Shipped to Abenix as `gw-site-twin` v11 through `scripts/provision.py`.

To run it beside the rendered site:

```bash
GW_BFF_PORT=8712 GW_NO_WEB=1 GW_SITE=nh108 bash scripts/dev.sh
# then http://localhost:5710/?sim=http://localhost:8712
```

The web switches to real ground by itself when `/site` carries `imagery`: the photo instead of the painted ground, the measured sun, the photographic machines, and a REAL / SIMULATED credit line in the feed, the opening title and the end card.

### Photographic machines

`web/src/scene/hd` builds the excavator, articulated hauler, dozer, single-drum roller, wheel loader, telehandler and piling rig at photographic detail in code. Each piece is merged into one mesh per material, so a machine is a handful of draw calls.

- PBR paint with wear worked out in world space in the shader: mud thrown up to about a metre, dust on what faces up, grime streaks down the sides, chipped edges.
- Rubber with tread, track shoes with grousers, grilles and walkway plate as bump maps, clear-coated glass, chrome rams.
- Fictional fleet numbers and hazard stripes only, no brand names.
- Every joint the twin reports drives the same pivot as before: swing, boom, stick, bucket, blade, drum, steer and body tip, boom and extension, auger and hammer. Rams stretch between their anchors each frame.
- Dimensions follow real machines of each class: a 20 t excavator, 30 t articulated hauler, 20 t dozer, 12 t roller, 14 m telehandler, 24 m piling mast. `docs/screenshots/real/14-scale-check.jpg` puts the simulated excavator top-down at the photo's own scale beside the real excavator in the untouched patch of the orthophoto.
- The cranes keep their models and take the same wear and plain trim on real ground.
- `scripts/capture-machines.mjs` renders each machine from three angles on the real ground for review.

No downloaded models are used. CC0 machine models of photographic quality with the right joints were not found, and editorial or no-redistribution models were ruled out.

### Reconstruction pipeline

One command takes drone photos to the files the web stands machines on:

```bash
python scripts/fetch-real-imagery.py --only caliterra      # the CC0 test set, 77 photos, checksums
python scripts/reconstruct.py caliterra                     # or: python scripts/reconstruct.py nh108 --photos D:/flight
```

Stages: `odm` runs OpenDroneMap in Docker for the orthophoto, DSM, DTM, textured mesh and camera poses. `colmap` writes the undistorted cameras as a COLMAP model. `splat` trains a Gaussian splat with Brush (WebGPU, no CUDA). `dem` levels the reconstruction and resamples the DSM, DTM and orthophoto onto the site grid. `pack` writes the splat in the same frame as a compact `.splat`.

Proven end to end on Caliterra: OpenDroneMap took 16 minutes, Brush 12,000 steps on the RTX 4070 in about 9 minutes, 1.26 M gaussians, 887 k kept after cropping (28 MB).

Two traps found and fixed in the script:

- PoissonRecon crashes at octree depth 11 inside Docker Desktop and ODM sized its threads from the host CPU count. The script now passes the Docker VM's CPU count and depth 10.
- The Caliterra camera's GPS altitude tilted the whole reconstruction by 39 degrees. The `dem` stage fits the ground plane from the lowest points per 2 m cell, rotates the dense cloud, the orthophoto and the splat level, and reports the tilt it removed. After levelling the site's relief is a believable -2 to +13 m, pipes and trees standing up.

`?ground=caliterra` lays any prepared site under the live twin, and `&layer=splat` adds the splat. Machines then sit on the reconstructed heights.

### Hosting

`scripts/publish-real-assets.py` packages the prepared tiles, DSM, DTM and splat with a manifest (site, path, size, SHA-256, licence and attribution) and SHA256SUMS, plus the exact `gh release` and Hugging Face commands. It uploads nothing. `scripts/fetch-real-imagery.py` reads the release by default, checks every file, and falls back to the original sources when there is no release yet. Both paths were tested against a local server.

### The films on real ground

`scripts/record-take.mjs --site nh108` records the story on the real-site layout, `scripts/capture.mjs --real` renders it frame by frame. The camera stays steep on the flat orthophoto: near nadir for the beats, high angle for the hero push-in and a high orbit for the end card. The original films and screenshots are untouched.

## What is still open

1. The NH108 photo set. Ask Craig Goodspeed for it under CC BY 4.0, or fly our own. With it, `scripts/reconstruct.py nh108 --photos ...` gives the site heights and a splat, and low oblique shots become possible.
2. Match-move the ESO Armazones opening with our machines composited in.
3. Computer vision in Abenix: stockpile volumes from the DSM, progress against the design surface.
4. Upload the tiles with the commands in `dist/real-assets/<tag>/UPLOAD.md`, which is the owner's call.
