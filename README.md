# Only Vibes

A Starfleet tactical training simulator built as a classic single-page Asteroids
game in pure HTML and JavaScript. Take the helm of a saucer-and-nacelles
starship, fire phaser pulses, and clear the sector through an LCARS-inspired
bridge console.

![Only Vibes screenshot](screenshot.png)

<!-- Do not remove the admonition -->
> [!IMPORTANT]
> **The code quality is by no means attributed to me.** It is **146% vibe-coded for purpose**.
> The point of this project
> was the full loop: automated development, browser-based verification, and
> iterating on what the running game actually did. The implementation is the
> artefact of that loop.

## Play

Play the hosted version on [GitHub Pages](https://eigenein.github.io/only-vibes/). You can also open [`index.html`](index.html) directly in a browser.

### Controls

| Key       | Action                             |
| --------- | ---------------------------------- |
| `SPACE`   | Fire phaser pulses                 |
| `W` / `S` | Thrust / brake                     |
| `A` / `D` | Turn counter-clockwise / clockwise |
| `P`       | Pause / resume                     |
| `R`       | Restart current round              |
| `T`       | Toggle autopilot                   |
| `G`       | Toggle auto-gunner                 |
| `M`       | Toggle Aim Assist                  |

Tap `A` / `D` for fine heading adjustments. Hold to ramp up over 250 ms to
the full turn rate of one revolution per second; release to stop turning.

Aim Assist (`M`) starts disabled. Hold roughly the same heading for 0.5 seconds
(within 45° of the starting heading) to lock the closest asteroid or Borg cube
in a 90° sector around the nose. A live lock lasts at least 1 second, then releases when
ship movement or rotation puts the target outside that sector. Closer asteroids
do not steal a lock. When the locked target splits, the closest surviving
fragment inherits the lock with a fresh 1-second commitment. Further splits
keep following that fragment's descendants; destruction without survivors
releases the lock.
The gold ring identifies the target; aim at the gold crosshair to intercept its
current straight-line motion. The prediction includes phaser speed and muzzle
offset, and ignores future collisions. Unreachable targets have no crosshair;
predictions outside the arena are clipped. Pausing or losing focus clears the
lock. Every new sector starts with Aim Assist, autopilot, and auto-gunner disabled.

When your ship is destroyed, the captain automatically beams to the nearest
surviving Starfleet ship. The gold highlight, controls, HUD, and assistance
settings follow you, while the receiving helper keeps autopilot and auto-gunner
enabled. The receiving ship keeps its existing damage, shield,
phaser heat, motion, and spawn protection; handoff grants no repair or immunity.
Borg target ships by combat conditions, without a special player preference.
The round ends in defeat only when the entire friendly fleet is destroyed.

The first field contains only asteroids and the player's ship. After victory,
the next field adds one friendly to the current field's starting fleet regardless
of losses, and starts with the total number of cubes plus one (including wrecks).
Developer-spawned cubes count toward the next cube total; spawned friendlies do not
change the steady one-ship growth. Every friendly is rebuilt at full strength, and
helpers are equipped with autopilot and auto-gunner. Defeat replays the round with
its original starting fleet counts and fresh bodies.

Autopilot (`T`) pilots close-range attack passes, interception, and ramming.
Every 1.2 seconds it rolls for an attack pass: healthy shields favor closing
within about 55 pixels of a target's surface for reliable shots, with the
boldest passes continuing into contact. Low shields favor distance and
regeneration; falling shields can abort a pass immediately. Hull damage
moderates risk without permanently disabling attacks. It fights the Borg cube
at range rather than ramming its durable hull. Attack passes still avoid other
solid bodies, including the drifting wreck; only the intended ram target is
exempt from avoidance. Escape maneuvers continue until clear of the danger zone
and choose among lanes using predicted rock, cube, and wall clearance. It brakes
before walls. Manual flight cancels autopilot.

Auto-gunner (`G`) independently fires when a shot will hit, saving heat between
bursts. Manual firing cancels auto-gunner. Enable both modes for automatic
flight and firing.

Phasers fire at eight pulses per second, with about nine shots in a cold
burst lasting roughly 1.1 seconds. Each shot adds slightly more heat the warmer the
phasers already are, so spacing bursts gives more firepower than holding
Space continuously. Heat cools throughout play; release for roughly 2–3
seconds to cool fully after overheating. You can fire again as soon as heat
falls below overheat; there is no separate recovery threshold. Manual fire
and auto-gunner share heat and cadence, which mode changes and pauses cannot
reset. The Space panel reads **PHASERS** when cool, then shows heat or the
brief wait until firing becomes available.

### Combat cues

Opaque gold identifies your ship and translucent lavender identifies friendly
support.
Destroyed helpers appear as dark fractured hulls without shields or bow lights.
The coral OVERHEATING indicator lights above 80% phaser heat. The shared green
automation indicator reads AUTOPILOT, AUTO-GUNNER, or AUTO FULL according to
the enabled modes. Lavender
brackets marked STARFLEET show helper targets and the number of assigned helpers;
attack these targets to support their coordinated fire. Green BORG FOCUS markers
show targeted ships and the number of assigned cubes. Both cues appear even
with a single attacker. All Starfleet autopilots target live
Borg cubes first, then coordinate asteroid clearing once all cubes are defeated.
Autopilots increasingly favor a shared target as more ships join it; distance can
still justify a split. Borg retain their gradual, more distributed focus policy. Starship
phasers can ricochet once; Borg pulses disappear on their first contact.
Every friendly ship has three seconds of protection from collision and weapon
damage after spawning, shown by a cyan shield. Borg targeting excludes protected
ships. Pausing preserves the remaining protection.
Yellow alert automatically enables aim assist; red alert also enables autopilot.

### Shield and hull

- The ship starts with a full shield and hull.
- The collision damage is proportional to the momentum.
- Collision damage is split proportionally between the shield and hull based
  on the shield remaining at the moment of impact. The shield regenerates
  while the game is running.
- Body and wall impacts share a replenishing damage budget that limits repeated
  contacts during a scrape. Weapon hits bypass that budget and do not consume it.
- Hull damage does not regenerate during the current life.
- Arena walls also damage the ship. On an outward collision course, a temporary
  safeguard triggers from stopping distance and a short reaction buffer, capped
  to allow late high-speed impacts. It reuses autopilot wall avoidance: brake,
  turn toward an escape lane,
  then thrust until moving safely inward. It preserves an already inward-facing
  heading. Held manual throttle resumes after recovery; manual steering and
  firing stay available. Parallel travel does not activate the safeguard.
  AUTOPILOT and COLLISION COURSE light together during the safeguard and clear
  when control returns. Wall proximity alone triggers neither.
  Brake takes priority when thrust and brake inputs are held together.
- Yellow alert means the current shield/hull reserve or ongoing damage threatens
  major loss; give the situation full attention. Red means the same evidence
  threatens destruction. The reserve check warns before hull damage when shields
  are too weak for the projected contacts; the damage trend also catches weapon
  fire independently. See the [calibration protocol](ALERT_CALIBRATION.md) for
  the measured warning behavior. Alerts clear after two seconds with extra
  reserve; yellow sounds whenever yellow is entered, including recovery from red.
  Red sounds once per command hull.
- Entering yellow or red enables aim assist; entering red also enables
  autopilot. You can override these modes normally while the alert persists.
  Recovery leaves them enabled.
- When the entire fleet is destroyed, the game briefly shows the failure state before
  restarting the current round with full shield and hull.

Redder asteroids are heavier and hit harder. Fire at will. Keep the hull operational.

Phaser contact always splits or destroys rocks. Ship and asteroid impacts split
rocks only when the transferred collision impulse exceeds their shared threshold;
lighter body impacts bounce without splitting. Arena walls only bounce asteroids.
Clearing the asteroids and defeating the Borg cube wins. Points count asteroid
area removed, plus 8,000 for defeating the cube.

### Achievements

Result screens show achievements earned in the completed round only.
**Friendly Fire** requires killing a friendly helper with Starfleet phasers or
by ramming; **Wolf 359** requires losing any Starfleet vessel to Borg fire or a
collision with a cube (including its wreck). **Rammer** requires
dealing more asteroid damage by ramming than by phasers during that round.

### Borg cube

Each cube has 200 hull and an 18-point shield buffer per face.
These reserves keep fights brisk while preserving adaptive protection.
Each cube routes a fixed 100% energy budget between four faces, starting
at 25% each. Repeated hits reinforce the attacked face, taking
power away from the others. A bright green segment on each edge shows its routed
share by length, from a quarter edge at 25% to the full edge at 100%, even when
the rechargeable shield buffer is empty. Green branches grow along the reinforced edge;
sustained fire adds tightly spaced shield bands and changes bright impacts into
shallow green ripples. Switch faces or briefly pause fire to reduce resistance.

Quiet faces recover shields using power left over from adaptation. A green
sweep shows recovery. Hull loss widens glowing orange fractures across the cube
and exposes increasing patches of burned-out machinery. These structural
failures remain visible when shields recover.
A face with all 100% routed to it is immune to phasers, leaving the other three
faces without routed resistance. Burst adaptation reduces remaining damage but
cannot grant immunity by itself. Routed adaptation persists until subsequent hits redistribute
energy between faces, keeping the total at 100%.

The cube slowly closes on the ship but steers away from asteroid fields.
Threatened edges flash and maneuvering machinery lights up. Its engines have
limited acceleration, so rocks can still catch it or be pushed into its path.
Physical impacts bypass phaser adaptation and can split the impacting rock.
A green charging port and short dashed sight line track an intercept based on
the ship's current velocity, including charging time and bullet travel. Aim
locks for the final 0.15 seconds of the charge, when the cue turns pale green.
The warning shows the exact firing angle, with no random spread. The cube fires
a thick green pulse along that committed heading. Its speed and physical impact
rules match starship phasers, but its heavier mass removes about 20% of a full
shield in a stationary head-on hit: it cuts asteroids and damages ships and live
cubes without changing a vessel's momentum. It disappears on first contact with
any body or wall, with no ricochets and no immunity for allied cubes. Firing does
not recoil the cube. Changing course after aim locks or while the pulse travels
gives room to dodge.

Bright green links with moving pulses redistribute hull evenly between connected
cubes, with a four-second cooldown per cube. They transfer existing hull rather than creating new hull.

Defeat switches off weapons, shields, and engines. The intact, unlit wreck keeps
its velocity and spin, floats freely, and loses motion through the same collision
friction and inelastic bounces as asteroids and live cubes. It reflects
bullets, and still damages the ship on impact. It never splits or disappears
and no longer counts as a combat target. Defeat awards points once; clearing
the remaining asteroids completes the field. A new field replaces the wreck.
All adaptation, firing, avoidance, and damage cues appear on the cube itself.

## Developer tools / cheats

Press **B** to spawn one Borg cube or **F** to spawn one friendly Starfleet
vehicle with autopilot and auto-gunner enabled. These shortcuts also work while
paused, ignore held-key repeats, and are disabled during results or ship
destruction. They are intentionally omitted from the paused help screen.

## Built with

- HTML5 canvas
- Plain ES2025 JavaScript
- Web fonts loaded from Google Fonts

All gameplay code lives in [`index.js`](index.js); [`index.html`](index.html)
is intentionally minimal. The starfield and ship silhouette are drawn with
cached canvas paths; all rendering uses the Canvas 2D API.
