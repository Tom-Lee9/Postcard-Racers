# Postcard Racers: Noosa

A short test track for the VR kart racer. It checks three things before we build the real Noosa track:
1. **Does it look good enough?** Photo textures, a real sky, shadows, see-through turquoise water.
2. **Does it run smoothly in the headset?** Turn on Settings → Show FPS. You want 45+.
3. **Does it make you feel sick?** Try both camera views at all three speeds.

## What's in it
- A ~1 km lap: asphalt esplanade with a start gantry, then down onto a packed-sand beach track beside the water, with a wooden jump and two boost pads.
- Palm trees, ferns and shrubs, the Sunshine Beach surf club, beach umbrellas and red/yellow patrol flags.
- A 3-lap race with a countdown, lap times and a saved best lap.
- Dust behind the wheels, splashes in the shallows, boost flames, and generated engine and surf sounds.

## The Noosa lap (one lap, about 4.4 km: the real map at half scale)
Built from OpenStreetMap: the real coastline, national park, beaches, streets and Hastings St / Noosa Junction buildings, with houses along the suburban streets and gum trees where the bush is.
Sunshine Beach surf club start → underwater along the coast → boost up Lions Rock → launch into the clouds above the national park → slide down into Noosa Heads (boosts + ramps) → Noosa Junction roundabout (tight inside, or boost pads on the outside) → bush trail (log jumps, creek splash, koala signs) → over the rooftops → down to the beach and the finish.
Barriers line the track like Mario Kart. Miss a jump and you're put back down just past the gap.

Map data © OpenStreetMap contributors (ODbL). `assets/noosa-map.json` is made from it.

## Controls
| | Joy-Cons | Phone (Play) | PC |
|---|---|---|---|
| Go | ZR / R / A | GO button | W / ↑ |
| Brake / reverse | ZL / L / B | BRAKE button | S / ↓ |
| Hop / drift (hold) | button 2 (check which) | DRIFT button | Space / Shift |
| Steer | stick | ◀ ▶ buttons | A / D |
| Switch camera | X/Y (top face button) | Settings | C |
| Re-centre view (VR) | + | two-finger tap | |
| Race again (after finish) | − | ✕ Menu → Play | Enter |

## micro:bit steering wheel
1. In MakeCode, start a new project, add the **bluetooth** extension and set **Project Settings → No Pairing Required**.
2. Open the JavaScript tab, paste in `microbit-wheel.txt`, and download it to the micro:bit. It shows an **X** until it connects. (If you had the old wheel program, download the new one: the buttons changed.)
3. Open the game in **Bluefy** and tap **Connect micro:bit wheel**. Pick your micro:bit (it may show up as a 5-letter name). Hold it straight while it connects.
4. Hold it upright like a steering wheel: screen facing you, logo at the top. The menu shows how far it's turned.
5. **A = go, B = brake, touch the gold logo = hop and drift.** Flick it upwards while flying off a jump to do a trick.
6. Press **A and B together, twice quickly** to reset "straight" any time. Holding A and tapping B (brake-drifting) won't set it off.
- Steers the wrong way? Settings → **Reverse micro:bit steering**.
- Too twitchy or too slow? Settings → **micro:bit full lock** (how far you turn it for full steering).
- The Joy-Cons still work too. While the micro:bit is connected, it does the steering instead of the stick.

## Drifting
- **Start:** tap drift to hop, then steer left or right as you land and keep holding. The kart swings its nose into the corner.
- **Change the line:** while drifting, steer *into* the corner for a tight arc, or *out* for a wide one.
- **Sparks:** tiny blue sparks, then blue → orange → purple, each with a flash. Timings measured from Tom's own Mario Kart clips: steering *in* = blue 0.8 s, orange 1.6 s, purple 2.5 s. Neutral or steering out = about 2.4x slower (1.9 / 3.9 / 6.1 s).
- **Boost:** let go of drift. Blue = 0.7 s, orange = 1.8 s, purple = 2.9 s. The HUD shows three pips too, because the back-wheel sparks are hard to see from the cockpit.
- **Starting late:** if you hop and only steer a bit later, the drift still starts, as long as you're holding drift.
- **Brake-drifting:** tap brake during a drift to tighten up without losing it. Drop below about 17 km/h and the drift ends with no boost.
- **Tricks:** flick the micro:bit up (or press drift) while flying off the ramp. Land it for a short yellow boost.
- **Testing the logo:** on the menu, the micro:bit line shows A, B and logo lighting up live, plus a count of logo touches. Tap it 10 times and check the count says 10.

**VR without a controller:** hold a finger on the screen to go and tilt your head like a steering wheel. You can turn head-tilt steering off in Settings.

The Joy-Con button numbers come from the fishing game. If a button does nothing, tell Claude which one.

## Run it on the PC
In this folder, run:
```
npx http-server -p 8080 -c-1
```
Then open http://localhost:8080. Test switches: `?cam=chase`, `?at=<spot>`, `?auto=1` (drives itself), `?mb=<degrees>` (fake micro:bit), `?spark=1..3` (show drift sparks).

## Run it on the iPhone (needs https)
1. Make a new GitHub repo called `postcard-racers` and upload everything in this folder (`index.html`, `README.md`, `js/`, `lib/`, `assets/`).
2. In the repo, go to **Settings → Pages → Deploy from branch → main / root**.
3. Open `https://tom-lee9.github.io/postcard-racers/` in Safari, then **Share → Add to Home Screen** and launch it from there.
4. When you tap Play or VR Mode, tap **Allow** for motion access.
5. If the phone shows an old version, check the "Version" number on the menu card.

## Files
- `index.html`: page, menu, settings
- `js/main.js`: renderer, VR stereo view, cameras, controls, race and laps
- `js/world.js`: track shape, terrain, sea shader, palms, plants, props
- `js/kart.js`: kart model and driving physics
- `js/effects.js`: dust and splash particles
- `js/hud.js`: lap/time/speed panel (3D, so it works in VR)
- `js/audio.js`: engine, surf and beep sounds
- `js/vr.js`: phone orientation → head rotation
- `js/microbit.js`: Bluetooth link to the micro:bit wheel
- `microbit-wheel.txt`: the micro:bit program (paste into MakeCode)
- `lib/`: three.js r160 (MIT) + GLTFLoader, RGBELoader, BufferGeometryUtils

## Asset credits
- [Poly Haven](https://polyhaven.com) (CC0): textures `coast_sand_01`, `damp_beach_sand`, `asphalt_02`, `palm_bark`, `leafy_grass`; sky `kloofendal_48d_partly_cloudy_puresky`; models `fern_02`, `shrub_02`.
- `waternormals.jpg` from the three.js examples (MIT).
- Palm trees, kart, signs and buildings are built in code.

## Honest limits
- Poly Haven's palm models are 50–80 MB each, which is far too heavy for a phone, so the palms are built in code with real bark textures and drawn fronds.
- The water reflects the sky but not the palms or karts. Proper reflections would mean drawing the whole scene again for each eye.
- There's no lens distortion correction. If edges look bent, lower the VR field of view.
