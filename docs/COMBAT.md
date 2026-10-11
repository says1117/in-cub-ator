# Active combat

The FastAPI backend now runs the imported donor battle engine. Clients send a
move with fight ID and turn through `/ws/game`, then animate the returned snapshot.
No client calculates HP, skill charge, team swaps, boss spawning or rewards.

The plant calls out its move, the boss responds after 850 ms, and the verdict
appears after 1700 ms. Effects apply displayed damage at impact; the server waits
for the exchange before accepting the next turn. Tells show confidence and bluff
possibilities before choosing. A 10-second selection timer triggers an automatic
counter; disconnected screens leave the server playing automatically.

Attack beats Special, Special beats Guard, Guard beats Attack. A counter win
(CRITICAL HIT) deals attack power; a loss (WEAK HIT, or MISS when bluffed) takes
boss damage without dealing damage. A clash grazes the plant. These are the donor
rules, replacing the previous local randomized damage and water/light costs.

Cast Iron has Vine Haymaker, Petal Aegis, Flamingo Flare and Inferno Bloom
(guaranteed 1.75× attack). Monstera has Blade Rush, Stripe Wall, Citrus Volt and
Sunburst (heal 8 plus a guaranteed 0.75× attack). Two counter wins charge skills;
healthy plants begin with one charge. Each level above 1 increases attack and
healing. Wins build up to three blooms; incoming damage clears them; skills consume
blooms for 50% extra damage each. NFC figures can replace stats and skills.

The second plant enters if the first faints, with full battle HP and a charged
skill. Both must faint to lose. The boss enrages at half HP and may counter repeated
moves, bluff, or use tier heavy attacks. Every third offensive boss action fires
the charged +20% laser, capped by the donor hit limit.

Victory watering is issued by the server, once, with persistent receipts. Default
simulation adds +20 moisture; hardware mode queues a bounded pump command and waits
for sensor updates. Reload resumes the server's fight and completed results
alternate Drought Chomper / Sporeling Trio.

See [complete import review](GAME_IMPORT.md) for thresholds, stats, hardware mode,
health, cooldowns, retained progression and differences from the earlier branch.
