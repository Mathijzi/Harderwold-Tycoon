> VERSION 3 — Revised 2026-10-12. This specification supersedes V2. Ignore recent fictional park map experiments and `Trivian.png`. Vehicle traffic, gate authorization and queue safety are mandatory.

# AELDERHOLT TYCOON — CLAUDE CODE MASTERPROMPT

You are a senior full-stack game engineer, simulation architect, pixel-perfect UI designer and technical lead. Build a working, testable, extensible browser-based 4K holiday park simulator called **Aelderholt Tycoon**. The user will provide these source assets in `references/`: `wide_isometric_aerial_illustrated_render_of_a_de.png` (PRIMARY approved visual target), `AHT_Plat.pdf` (actual Landal Aelderholt park plan), `Landal-Aelderholt-kinderbungalow-6ELK-Nederland-Drenthe-6-personen-img-1.jpeg` (real bungalow architecture), `1453_1000x670.jpg` (Landal logo/teal vehicle branding). Study the assets before implementing. Do not claim to have accurately traced the map if you have not. Create original, detailed semi-realistic isometric resort artwork based on the approved generated visual reference. Use the source park map as spatial evidence, not as the final on-screen image.


## APPROVED VISUAL DIRECTION — CURRENT REFERENCES ONLY
- The approved generated image `wide_isometric_aerial_illustrated_render_of_a_de.png` is the PRIMARY visual target for art direction, landscape richness, building density, foliage, lighting, typography, HUD subtlety and composition. It is a concept reference, NOT the canonical geographic layout and NOT a ready-to-use game background.
- Bungalows must closely resemble the REAL uploaded photo: modern Dutch holiday chalets with steep dark tiled pitched roofs, dark brown brick walls, warm vertical timber gables, large glazing, patios, and plausible architectural variation. Do not replace these with medieval or fantasy Travian houses.
- Park service vehicles (maintenance, cleaning, logistics, electric carts) should have coordinated Landal-inspired turquoise/teal and white livery, using `1453_1000x670.jpg` as the brand color/logo reference. Make the logo and vehicle markings editable assets, and avoid claiming official affiliation.
- Do not use `Trivian.png` or any recent fictional park road-map experiments. Reference priority: actual PDF for layout and house IDs; actual bungalow photo for architecture; approved generated image for overall rendering/HUD; logo for vehicle livery.
- The approved concept image is NOT an accurate map: reconstruct every house and facility from `AHT_Plat.pdf`, using the map editor to correct uncertain placements. Never invent that the concept image itself matches the actual park.
- Keep the map permanently fullscreen at 3840x2160, with incident effects directly over corresponding locations and a SMALL transparent leaderboard in the upper-left; compact status top-right. No large opaque overlays, sidebars, or camera zooms.
- Produce a visual-review milestone early: a 4K screenshot with 10 representative correct bungalow assets, two teal/white branded vehicle variants, overlay UI and map sector, for human approval BEFORE mass-producing all map assets.

## Non-negotiable experience
- A SINGLE persistent fullscreen map covering the entire 3840x2160 16:9 projection. Never pan, zoom, replace the map with panels or open a large incident modal on the projector.
- Stylized but geographically recognizable park with ALL numbered bungalows and listed amenities. Every house is a distinct selectable/data-addressable object with stable ID, map coordinate, status, and visual sprite. Houses resemble the supplied real brick-and-timber, dark pitched-roof cottage architecture; allow other house-type variants.
- Small translucent **all-player leaderboard overlaid at top left**, not a separate sidebar; compact park health/time/status overlaid top right. Events animate IN PLACE above the corresponding building with icons, particles, speech bubbles, subtle highlights and optional short sound cues. No persistent bottom bar. Maintain visual hierarchy and legibility at 4K; avoid blocking map landmarks. Build responsive fallback for 1080p.
- Live moving guest NPCs (named and persistent, with personalities and storylines), maintenance vans, cleaners and visitor cars following a physically plausible directional road/path graph with safe spacing and no collisions. Efficient 2D isometric rendering using PixiJS, with map layers and view-culling/LOD. Rendering must be smooth and not require true 3D.
- Projector is display-only; task claiming/completion happens through a separate future mobile app using a documented public API. Provide a developer test client for API operations, but do not let the projector become the player app.

## Fixed game rules
- Real-world Friday–Sunday weekend, local Europe/Amsterdam timezone, 24/7 server-authoritative clock; reduced but nonzero night events (configurable quiet hours). Game state persists after restarts.
- 6–10 individual competitors. All players can perform all job types and are always eligible for task notifications. Each can hold at most 3 concurrently claimed tasks.
- Auto-generate ~2–4 *new normal tasks per daytime hour* on average, reduced at night. Schedule using seeded randomness, weighted categories, occupancy, time-of-day, location state, cooldowns and story context; avoid rigid intervals. Major incidents 1–3/day, independently configurable, generating linked subtasks; avoid floods. Cap simultaneous unresolved tasks, prioritize player experience.
- Claim is first valid server-side atomic winner; losers receive conflict response and realtime state update. Task completion is an authenticated API action, not automatic based on animations. No personal negative points; failure impacts park health, occupancy, guest satisfaction or finances. Task reward is determined by difficulty/urgency, NOT speed. Configurable 2–30 min claim-to-completion deadlines; when claimed task times out, release/reoffer atomically, optionally escalate based on template; no double scoring.
- Player joins with display name and session/game code. Game Master has full protected administration: launch/pause/resume, seed/reset demo, incident inject/edit/cancel, player management, points adjustment with audit trail, scheduler configuration, task deadlines, park statuses and simulated time/test controls.
- Realtime task alerts both via API (websocket/event stream for app) and visual projection; browser push is optional and must not be presumed reliable when app is closed. Provide fallback polling.
- Subtle sounds on projector, muted by default until user interaction to respect autoplay restrictions, with sound toggle and rate limiting.
- Hybrid hosting: Docker Compose single-machine local deployment and configurable cloud deployment; all player devices must reach the API over LAN or public HTTPS. Offline LAN operation possible; no hardcoded localhost in mobile app config.


## CRITICAL: REALISTIC TRAFFIC, CENTRAL ACCESS, CHECK-IN / CHECK-OUT GATES
This section is mandatory and overrides any generic vehicle animations or simplistic point-to-point movement. The approved visual concept is for art style ONLY; its depicted traffic geometry is not authoritative. The actual park PDF is the starting spatial reference; where it does not establish detailed lane geometry, build a configurable road editor and explicitly mark design assumptions.

### Single central visitor arrival/departure corridor
- Model ONE central controlled park entrance/exit corridor connecting the public approach road to the internal park road network. Include an inbound lane and an outbound lane with explicit directions, and independent entry and exit barrier arms. They can share a physical gate plaza, but not the same conflicting movement space.
- Provide physically plausible queue/waiting positions BEFORE each respective barrier, with enough room for several vehicles to line up without blocking the public road, crossing traffic, or driving into each other. Make the number and spacing of waiting positions configurable. If the illustrated footprint is insufficient, expose the limitation in the editor rather than silently placing cars in overlapping slots.
- All visitor arrivals MUST enter through the inbound barrier; all visitor departures MUST pass through the outbound barrier. No alternate visitor shortcuts or spawning cars behind the barriers. Maintenance vehicles may have explicit permitted routes but must obey collision and lane rules.
- Check-in and check-out are server-side GAME TASKS. Each arriving vehicle belongs to a booking/household and creates or links to a reception check-in task. The inbound barrier may open ONLY in response to the corresponding successful authorized check-in completion. The outbound barrier may open ONLY after the corresponding successful authorized check-out completion. Gate opening must NEVER occur from an animation timer, arrival proximity, random schedule, generic admin resume, or vehicle reaching a waypoint.
- Gate actuation is per-vehicle authorization: completing check-in/check-out creates a single-use gate passage token tied to vehicle, direction, task and game session. A server-side gate controller transitions CLOSED -> OPENING -> OPEN -> CLOSING -> CLOSED only for the authorized vehicle, and closes safely after it has cleared the gate sensors. Use a bounded safety timeout only to close after clearance or fail safely, NEVER to open without authorization. Do not close onto a vehicle. Additional cars stay stopped until their own completed tasks authorize passage.
- If an accepted check-in/check-out task expires, release it back to all players (per game rules); the vehicle stays in the correct queue. Delays worsen that household's satisfaction and can generate bounded follow-up complaints. Completion grants points exactly once and only the matched vehicle may proceed. An operator emergency override may be available in the protected admin interface with explicit audit trail, and is NOT part of normal gameplay.
- On entry, vehicle navigates to its assigned bungalow or parking space and parks without blocking roads; guests disembark as separate pedestrian actors. On departure, vehicle leaves its assigned parking space, queues at the outbound barrier, waits for check-out task completion, passes safely, then exits the simulation beyond the public approach boundary. Vehicle and guest lifecycle must be persisted.

### Road graph and routing
- Create an editable road graph of directed lane centerlines with nodes, edges, intersections, lane widths, permitted directions, turn restrictions, speed limits, yield/priority rules, gate stop lines, parking spurs, holding bays and spawn/despawn portals. Separate pedestrian paths from car lanes unless a designated shared zone exists.
- On the real park map, derive topology from roads and identify uncertainties for human correction; do not infer accurate driving directions from pixels alone. In the map editor, visualize arrows, lane connections, one-way streets, turn restrictions, stop lines, gate sensors, parking stalls and route diagnostics.
- Use shortest-valid-route/pathfinding (A* or Dijkstra) over legal directed edges. Vehicles follow smooth lane-aligned curves and turn at realistic speeds. No straight-line shortcuts across grass, water, houses or through other vehicles. Use turn signals/brake lights if feasible.
- At intersections, apply deterministic right-of-way or configured priority and conflict zones: only one conflicting movement can occupy a conflict zone at a time. Prevent deadlocks with reservation timeouts and fair queue scheduling. Enforce no overtaking on single-lane roads unless explicitly modeled.
- Cars must remain on the correct side of the road for the Netherlands (drive on the right), approach stop lines in the correct direction and never reverse against traffic except in an explicitly modeled maneuver. Every spawned vehicle must have a legal destination and route or wait offscreen until one exists.

### Movement and collision avoidance
- Run vehicle motion on a fixed-step simulation independent of render frame rate. Use acceleration, deceleration, max speed, braking distance, vehicle length, safety gap and curve speed limits. A basic car-following controller (e.g. IDM or a carefully tested equivalent) is acceptable; pure lerp between map points is NOT.
- Maintain lane occupancy / vehicle order and front-bumper clearance. Vehicles must queue without overlap at red/closed barriers and intersections; allow smooth stopping and starting. Use per-lane reservations and geometric collision checks with rotated rectangles or comparable collision shapes. NPC pedestrian crossings also require stop/yield logic.
- Gate area uses approach sensors, stop line, occupied crossing segment, exit-clear sensor and authorized vehicle ID. Gate must not close until the authorized vehicle has fully cleared the crossing. Model physical open/close animation with server-owned state and frontend interpolation.
- Support multiple arrivals/departures in bursts, but cap active vehicle density to avoid gridlock and excessive 4K rendering cost. Spawn inbound traffic only when holding capacity permits; otherwise queue in an abstract offscreen approach buffer, not stacked on the same coordinates.
- Vehicles may stop and wait, but must never teleport, clip, overlap, phase through each other, pass through a closed gate, or drive the wrong direction. If a path is blocked, wait or recompute a legal route; never cut through scenery.

### Traffic-related tasks, events and game state
- Extend TaskTemplate and TaskInstance with optional vehicleId, bookingId, gateId and arrival/departure lifecycle references. Add Booking/Household, Vehicle, ParkingSpot, LaneEdge, Intersection, Gate and GatePassage records; store route/position checkpoints or reconstruct deterministically after restart. Use transactional completion of reception task plus passage authorization.
- Add `vehicle.arrived`, `vehicle.queued`, `vehicle.parked`, `vehicle.departing`, `vehicle.exited`, `gate.opening`, `gate.opened`, `gate.closing`, `gate.closed`, `gate.pass_authorized`, `queue.updated` to realtime events. Make these accessible through authenticated API and visible as subtle animations on the 4K projection.
- Include check-in and check-out as core recurring task templates, not just random incidents. Arrival/departure schedules are independent of the 2-4 ordinary incident tasks/hour: clearly configure the separate workload budget so check-in rushes do not accidentally swamp 6-10 players. Allow game master to tune booking volume and queue capacity.
- Display a small floating queue-length indicator near the barrier when relevant; avoid a large permanent traffic panel. Queued vehicles and the opening/closing boom arms should be visibly animated in-place on the map.

### Mandatory traffic acceptance tests
1. A vehicle arriving at a CLOSED inbound gate stops before the line; its check-in task is offered. Without completed check-in, it never passes even after hours of simulation.
2. Completing that exact vehicle's check-in task opens the inbound gate; ONLY that vehicle passes, then the gate closes after full clearance. A second queued vehicle does not tailgate.
3. A departing vehicle queues on the correct outbound side; completing its check-out task alone opens the outbound barrier for that vehicle.
4. With 10 simultaneous arriving cars, all use distinct valid queue positions or an offscreen buffer; no overlap, wrong-way travel or public-road blockage.
5. Two cars at an intersection negotiate right-of-way and never collide. Following vehicles maintain safe gap while braking, turning, stopping and accelerating.
6. Every vehicle follows legal directed lane edges, remains on roads, parks in a legal spot and does not pass through another car, pedestrian, house, water or closed gate.
7. Task timeout and server restart do not open the barrier or duplicate passage tokens. A duplicate completion request cannot trigger a second opening or duplicate points.
8. Demonstrate a reproducible 20-minute traffic stress-test in accelerated simulation and record zero illegal gate crossings, zero geometric collisions and zero wrong-way traversals; log and surface failures if found.
9. Provide a visual traffic debug mode (admin only) showing lane arrows, planned routes, vehicle bounding boxes, headways, stop lines, queue slots and gate states.
10. Demo mode must show a full arrival -> queue -> check-in -> gate opening -> drive to bungalow -> park -> later depart -> queue -> check-out -> gate opening -> exit cycle.

## Simulation model
Implement server-authoritative durable state, with deterministic seeded simulation ticks and catch-up after restart (bounded catch-up; no enormous backlog of alerts). Separate simulation from visualization. Model:
- Park: parkId, clock/timezone, phase, health, average guest satisfaction, finances (optional), scheduler configuration, event history.
- Location: id, canonical source number/amenity key, type, map coordinates, road/path node, building sprite variant, region, occupancy, housekeeping state, technical condition, availability, guest satisfaction, active incident IDs.
- Guest: id, name, traits (e.g. patient, demanding, forgetful, noisy), household, bungalow, arrival/departure, mood, history, itinerary and storyline references. Use fictitious humorous names and privacy-safe content.
- TaskTemplate: code, category, title/description variants, eligible locations, prerequisites, weighted probability, severity, difficulty, urgency, points, claim duration, visibility, animations, completion effects, timeout effects, escalation rule, cooldown, possible linked tasks.
- TaskInstance: id, templateId, locationId, guestId?, parentIncidentId?, state [offered, claimed, completed, expired, cancelled], assignedPlayerId?, offeredAt, claimedAt?, deadlineAt?, completedAt?, version, attempt, pointsAwarded.
- Incident: id, scope, root cause, affected locations, stages, child task IDs, escalation clock, resolved status.
- Player: id, gameId, displayName, session credential, score, active task count, joinedAt; enforce name uniqueness per session and configurable admin moderation.
- ScoreLedger: append-only, idempotent entries tied to completed task/administrative adjustment. Never calculate score by trusting client-supplied points.
- GameEvent: append-only structured history used for realtime projection and audit.
- VisualActor: NPC/vehicle route and animation state (derived or checkpointed as needed).

### Task lifecycle
Template eligibility -> generate incident/task -> persist -> broadcast -> atomic claim -> deadline timer -> (complete -> apply effects -> score ledger -> animation -> resolved) OR (timeout -> unassign -> reoffer or escalate, with cooldown and reattempt limit). Tasks may be offered and never claimed; separate offered-task expiry/escalation policy from claimed-task timeout. Define idempotency for claim, complete, retry and administrative actions. Handle simultaneous requests and process restarts correctly.

### Scoring (editable defaults)
Difficulty easy=25, medium=50, hard=100, crisis=150; urgency multiplier normal=1, high=1.25, critical=1.5; round to nearest 5. Persist points per task at creation, avoid reward drift. No speed bonus. Completion exactly once. Major incidents can contain separate independently claimable subtasks.

### Park health and escalation
Track individual house maintenance/cleanliness/satisfaction plus global park satisfaction. Unresolved leakage lowers technical condition and satisfaction; escalates into water damage/relocation; dirty room blocks check-in; delayed check-in causes complaints; unresolved facility fault affects multiple households. Bound chain reactions with per-location cooldowns, max depth and global incident budget. No runaway recursive generation. Support causal event chains and guest-specific follow-ups.

## Task library: minimum 100 distinct templates, seed from these 10 groups (10 each)
1. Maintenance: blocked toilet; leaking tap; cold shower; heating failure; power outage; broken television; jammed door; faulty smoke detector; refrigerator failure; broken patio light.
2. Housekeeping: unclean bungalow; dirty sheets; missing towels; overflowing bin; stained sofa; lost property; muddy floor; broken vacuum; missing toilet paper; urgent turnover clean.
3. Reception: missing key; double booking; wrong bungalow; late check-in; early arrival; angry complaint; incorrect guest count; upgrade request; forgotten reservation; check-out dispute.
4. Hospitality: broken fryer; coffee machine failure; missing supplies; wrong order; cold meal; queue overflow; refrigerator alarm; reservation mix-up; spilled drinks; surprise group booking.
5. Pool: water too cold; pump fault; missing flotation aid; slippery floor; locker failure; lost goggles; chlorine sensor warning; overflowing changing room; broken shower; pool temporarily closed.
6. Bike rental: puncture; missing bike; flat e-bike battery; broken lock; wrong rental; chain fallen off; late return; damaged child seat; key lost; tandem mix-up.
7. Grounds: fallen branch; blocked path; broken streetlight; stuck barrier; full waste station; sign fallen over; flooded footpath; broken bench; parking confusion; damaged fence.
8. Animals/nature: loose dog; ducks at pool; missing cat; wasp nest report; rabbits eating flowers; bird in shop; fishpond litter; nocturnal animal noise; escaped pet rabbit; goose guarding footpath.
9. Entertainment: missing mascot Bollo; bowling lane breakdown; cancelled activity; sound system fault; tennis booking dispute; air trampoline closure; missing mini-golf balls; sports field lights fail; wrong event signage; stage microphone failure.
10. Comic chaos: mascot checked in as guest; synchronized toilet failures; e-bike parade blocks road; mass key mix-up; midnight karaoke complaint; rogue cleaning cart; sudden rain floods paths; restaurant orders delivered to wrong cabins; bizarre lost-and-found pile; fake VIP arrival.

Every template MUST include specific preconditions, player-facing copy, time limit, point value, location selection, projector icon/animation, completion effects, timeout/escalation effects, and cooldown. Add a JSON/TS fixture library and validation tests for at least 100 distinct IDs. Events must be humorous but not depend on real people or unsafe physical tasks. Include several multi-step crises: water-main rupture, widespread blackout, mass check-in problem, pool closure, and missing mascot; trigger 1–3 major incidents/day on average with configurable limits.

## API (versioned, documented, authenticated)
Implement REST `/api/v1` plus WebSocket `/ws` (or documented SSE) and generate OpenAPI spec. At minimum:
- POST `/sessions/join` {gameCode, displayName} -> playerId and session token; GET `/me`.
- GET `/park` (summary); GET `/locations`; GET `/locations/:id`; GET `/leaderboard`.
- GET `/tasks?state=offered|claimed|completed`; GET `/tasks/:id`.
- POST `/tasks/:id/claim` {idempotencyKey}; POST `/tasks/:id/complete` {idempotencyKey}; optional POST `/tasks/:id/release` with clear rules.
- GET `/events?after=cursor`; WS topics task.created, task.claimed, task.reoffered, task.completed, task.expired, incident.started, incident.escalated, park.updated, leaderboard.updated, guest.updated, visual.effect.
- Admin: session lifecycle, create/cancel task, inject incident, edit score with reason, config, time/test controls, map editing and task templates; admin endpoints separately authorized.
Return explicit 401, 403, 404, 409, 422 and 429 as applicable. Enforce per-player max-three in the same transaction as claim. Validate session identity, never accept playerId/points from client as authority. Idempotency, optimistic locking or SQL row locks, rate limiting, admin audit logs and tests for race conditions are mandatory. Provide curl examples and an API simulator page.

## Map pipeline and graphics
- Parse `AHT_Plat.pdf` as the canonical list of house numbers and facility labels. The source legend includes A=reception, G=Brasserie, H=snackbar, I=service room, J=pool, V=ParkShop, W=bike rental, etc. Verify all against the actual PDF.
- Produce a structured map manifest (JSON) with source page reference, each numbered bungalow, each amenity, approximate normalized (x,y), house type where identifiable, and sprite variant. A PDF legend does not necessarily identify the type of every individual house; mark uncertain assignments rather than guessing.
- Build an internal map-editor overlay with drag-to-correct locations, path nodes, polygons, scale and versioned export/import. Artistic spacing adjustments are permitted, but maintain recognizability and numbering. Show an asset completeness report and an explicit review checklist. Do NOT invent missing houses or claim perfect automated extraction.
- Design original, consistent isometric house sprites closely matching the real reference photo and approved generated concept, with at least multiple size/type variants, rotated/shaded facades, clean roofs, window glow, gardens, roads, trees, pond, public amenities and NPC sprites. Asset pipeline should support manually supplied transparent PNG/WebP assets and placeholders while awaiting commissioned artwork. Do not simply render the original PDF as the finished game background.
- Render layered terrain, roads/water, buildings, NPCs/vehicles, per-location incident VFX, floating labels, HUD. Use fixed camera, no zoom/pan on projector. Fit the entire park to 16:9 while preserving proportions; configurable safe margins and map anchors. All UI overlays have no separate opaque panel occupying screen real estate. HUD scale is adjustable in pixels/percentage for 4K and 1080p.
- Use accessible status icon shapes as well as colors; visual density/collision avoidance when multiple incidents overlap. Animations should remain modest and performance-aware; degrade gracefully with many NPCs.

## Suggested stack
TypeScript monorepo; frontend React + Vite + PixiJS (avoid server-rendering the renderer), backend Node.js (Fastify or NestJS), PostgreSQL + Prisma or Drizzle, Redis optional for event distribution, WebSocket for realtime, Docker Compose for local setup. Prefer simple robust architecture over unnecessary services. PostgreSQL handles transactional claims and persistent scheduling. Server is source of truth; UI state is derived from snapshot plus versioned event stream with reconnect/replay. Use Playwright for end-to-end tests, Vitest for logic, and a load/race test for 10 players.

## Game Master dashboard
Protected `/admin` with session setup, join code, player list, task list, map inspector/editor, incident injection, point corrections, scheduler intensity/day-night schedule, global health, realtime logs, pause/resume, sound config, safe test reset, accelerated simulation and export of final scores. Never expose admin actions with player session token.

## Quality gates and acceptance tests
1. Display fits entire source-inspired park in one static 3840x2160 viewport with small leaderboard overlay at upper-left and compact metrics at upper-right; screenshot at 4K and 1080p.
2. All numbered houses and amenities from PDF appear in validated manifest; report any ambiguity explicitly and allow editor corrections.
3. Seed 10 named test players; all can view offered tasks; at most three claims each; 10 concurrent claims for one task yield exactly one winner.
4. Completing one task changes corresponding house status, produces in-place animation and adds score exactly once even with repeated requests.
5. Timeout releases and reoffers task; escalations bounded; server restart preserves timers and state.
6. Simulation creates average 2–4 normal daytime tasks/hour across seeded 48h runs, reduced night frequency, 1–3 major incidents/day with configured randomness. Validate with reproducible test seeds, not a brittle exact count.
7. 100 distinct validated templates, plus named guests with persistent stories and visible path-following NPCs.
8. Local Docker deployment reachable from another device on LAN; cloud config documented; projector reload reconnects without resetting game.
9. Sound can be enabled/disabled and never autoplays before user gesture.
10. Produce README, architecture diagram, API OpenAPI file, seed data, setup instructions, backup/restore guide, and operator runbook.

## Work plan: implement in verifiable phases
Phase 0: Inspect CURRENT source files, explicitly ignore Trivian.png and fictional road-map iterations, list ambiguities, choose stack, scaffold monorepo, write requirements/acceptance checklist.
Phase 1: DB schema, session auth, API, realtime event stream, claim/complete transaction tests, seed data.
Phase 2: simulation scheduler, house and guest state, task templates, score ledger, escalation chains, admin controls and reproducible test mode; include check-in/check-out task lifecycles.
Phase 3: accurate map manifest extraction, editable correction UI AND directional road graph with entry/exit lanes, queue slots, gates, parking and intersections; original art asset pipeline and map layers.
Phase 4: 4K projector view, full-map static composition, compact HUD, animations, guests, collision-safe traffic engine, gate control, arrival/departure queue behavior and sounds.
Phase 5: player API developer client, admin dashboard, full integration, performance tests, Docker/cloud deployment.
Before full park asset production, FIRST deliver a visual prototype using 10 correct bungalows, at least two branded service vehicles, a central gated access road, 3-5 waiting vehicles and a demonstrable complete check-in/check-out cycle. Stop for visual and traffic-behavior approval before expanding to all houses. At each phase run tests, report concrete files created, screenshots where relevant, blockers and what remains. Do not silently substitute a generic map or fabricated house placement. If missing art assets prevent final quality, keep functional placeholders and list precisely what to supply. Begin by examining the current reference assets, generating a build plan, and building the limited visual/traffic proof of concept first. Stop for approval of the prototype before implementing the entire park. Ask only if an essential gate or road-layout ambiguity cannot be resolved through an editable assumption.
