"""GameEngine glues the pure pieces together. No network code, so it runs in tests."""
import logging
import random
import uuid
from dataclasses import replace
from typing import Optional

import battle as B
import config as C
import rewards as R
import state_machine as S

log = logging.getLogger("engine")


class GameEngine:
    def __init__(self, creatures: Optional[dict] = None, rng: Optional[random.Random] = None,
                 plant_db=None, need_pads: Optional[bool] = None):
        """plant_db (a plant_db.PlantDB) turns on NFC summoning: only plants whose tag is on a pad are
        in the game. Without it, need_pads decides: a plant is in the game while its pad reads any tag."""
        self.game = S.Game()
        # True: a plant is only in the game while its pad reads a tag (config.PLANTS_NEED_PADS)
        self.need_pads = C.PLANTS_NEED_PADS if need_pads is None else need_pads
        self.sim = False             # --sim: the screen may set plants down and lift them
        self.creatures = creatures or {}
        self.plant_db = plant_db
        self.pad_plant = {p: None for p in C.PLANTS}     # pad -> plant_id summoned there (plant_db only)
        self.pad_status = {p: "empty" for p in C.PLANTS}  # empty, known, unknown, invalid or moved
        self.last_xp = None   # the last XP award: {plant_id: {xp, level, levelled_up, gained}}
        self.rng = rng or random.Random()
        self.soil_pct = {p: 100.0 for p in C.PLANTS}
        self.pads = {p: "" for p in C.PLANTS}
        self.last_reward_at = {p: float("-inf") for p in C.PLANTS}
        self.last_reward = None
        self.battle: Optional[B.Battle] = None
        self.next_turn_at = 0.0
        self.health = 100.0          # overall plant health, fades while the soil is dry
        self._last_tick: Optional[float] = None
        # Manual battles: the player picks each move. With nobody connected (or in tests) the game
        # plays the turns itself so a fight never hangs.
        self.manual = False
        self.move_ready_at = 0.0     # earliest time the next move is accepted
        self.move_deadline = 0.0     # after this the game picks the move
        self.last_seen: Optional[float] = None  # last time the ESP32 sent a reading
        # After a lost fight the battle stays in the state message for a moment, so the screen
        # can play the last blow. {"plant", "tier", "source", "until"} or None.
        self.lost: Optional[dict] = None
        self.boss_kind: Optional[str] = None   # which kind of boss is here now: see config.BOSS_KINDS

    def _set(self, new: S.Game):
        if new.mode != self.game.mode:
            log.info("mode %s -> %s (boss=%s source=%s)", self.game.mode, new.mode,
                     new.boss_plant, new.source)
        if new.boss_plant is None:
            self.boss_kind = None
        elif self.boss_kind is None:
            self.boss_kind = self.rng.choice(sorted(C.BOSS_KINDS))   # every kind has the same chance
            log.info("the boss is a %s", C.BOSS_KINDS[self.boss_kind])
        self.game = new

    # inputs -----------------------------------------------------------
    def on_soil_raw(self, plant: str, raw: int, now: float) -> list:
        self._heard_from_esp32(now)
        self.soil_pct[plant] = S.soil_pct(raw)
        self._set(S.on_soil(self.game, plant, self.soil_pct[plant], now, self.present_plants()))
        return self.tick(now)

    def _heard_from_esp32(self, now: float):
        """Any reading means the ESP32 is alive, so readings are fresh again."""
        self.last_seen = now
        if self.game.stale:
            log.info("ESP32 is back")
            self._set(S.on_status(self.game, True))

    def present(self, plant: str) -> bool:
        """Is this plant's pot in the game? With the plant database every pot is (the tags only decide
        who fights, see summoned()). Otherwise, with pads in use, only while its pad reads a tag."""
        if self.plant_db is not None:
            return True
        return bool(self.pads[plant]) or not self.need_pads

    def present_plants(self) -> tuple:
        return tuple(p for p in C.PLANTS if self.present(p))

    def on_pad(self, plant: str, uid: str, now: Optional[float] = None):
        """A pad reported a tag (or "" when it was lifted). With the plant database, this summons
        or unsummons the plant that owns the tag."""
        if self.plant_db is None:
            was = self.present(plant)
            self.pads[plant] = uid.strip()
            if was and not self.present(plant):
                self._plant_lifted(plant)
            return
        self.pads[plant] = uid.strip()
        import plant_db as P  # local import: the engine still works without the database module
        before = self.pad_plant[plant]
        normalized = P.normalize_uid(uid)
        found = self.plant_db.lookup(uid) if normalized else None
        if normalized == "":
            status, plant_id = "empty", None
        elif normalized is None:
            status, plant_id = "invalid", None
        elif found is None:
            status, plant_id = "unknown", None
        else:
            status, plant_id = "known", found.plant_id
        if plant_id is not None:
            # A plant can only be in one place: the newest report wins (an old retained message
            # from the other pad is out of date).
            for other in C.PLANTS:
                if other != plant and self.pad_plant[other] == plant_id:
                    self.pad_plant[other] = None
                    self.pad_status[other] = "moved"
                    self._plant_left(other, now)
        self.pad_plant[plant] = plant_id
        self.pad_status[plant] = status
        if before is not None and before != plant_id:
            self._plant_left(plant, now)
        if before != plant_id:
            log.info("pad %s: %s", plant, f"{found.name} summoned" if plant_id else f"{status}, nobody summoned")

    def on_sim_pad(self, plant: str):
        """--sim only: the screen's button sets plant A or B down or lifts it, like the real pad."""
        if self.sim and plant in C.PLANTS:
            self.on_pad(plant, "" if self.pads[plant] else C.SIM_PAD_TAGS[plant])

    def summoned(self) -> list:
        """(pad, plant_id) for every summoned plant, in pad order. Empty without the plant database."""
        return [(p, self.pad_plant[p]) for p in C.PLANTS if self.pad_plant[p] is not None]

    def can_fight(self) -> bool:
        return self.plant_db is None or bool(self.summoned())

    def _plant_left(self, pad: str, now: Optional[float]):
        """Plant database: the plant on this pad left mid-battle, so take it out of the fight."""
        if self.battle is None or self.game.mode != S.BATTLE:
            return
        b = B.withdraw(self.battle, pad)
        if b is None:
            log.info("every fighting plant was lifted: the boss waits for a plant")
            self.battle = None
            self._set(S.on_party_empty(self.game, now if now is not None else (self._last_tick or 0.0)))
        else:
            self.battle = b

    def _plant_lifted(self, plant: str):
        """No plant database: a plant left the cube. A boss it called leaves too, and a lifted plant
        takes no part in a fight."""
        log.info("plant %s lifted off the cube", plant)
        self._set(S.on_lift(self.game, plant))
        b = self.battle
        if b is not None and self.game.mode == S.BATTLE:
            if plant == b.plant:   # the plant in the ring was lifted: the fight is over
                self._set(S.on_lift(self.game, self.game.boss_plant))
            else:
                self.battle = replace(b, bench=tuple(item for item in b.bench if item[0] != plant))
        if self.game.mode not in (S.BATTLE, S.REWARD):
            self.battle = None

    def on_esp_status(self, text: str, now: Optional[float] = None):
        online = text.strip() == "online"
        # "online" starts the silence clock but never resets it: only readings prove the soil
        # numbers are fresh, so a repeated status message cannot hide dead sensors.
        if online and now is not None and (self.last_seen is None or self.game.stale):
            self.last_seen = now
        self._set(S.on_status(self.game, online))
        if self.game.mode not in (S.BATTLE, S.REWARD):
            self.battle = None

    def _check_stale(self, now: float):
        """No reading for a while counts as offline, even if the ESP32 never said goodbye."""
        if self.last_seen is None or self.game.stale:
            return
        if now - self.last_seen > C.ESP32_STALE_SECONDS:
            log.info("no ESP32 reading for %.0fs, treating it as offline", now - self.last_seen)
            self._set(S.on_status(self.game, False))
            if self.game.mode not in (S.BATTLE, S.REWARD):
                self.battle = None

    def pick_demo_plant(self) -> str:
        """The plant on the cube, or the lower water meter if both are there (or neither has a pad
        reading, when pads are not in use). None when no plant is on the cube."""
        here = list(self.present_plants())
        if not here:
            return None
        with_creature = [p for p in here if self.pads[p]]
        pool = with_creature if len(with_creature) == 1 else here
        return min(pool, key=lambda p: self.soil_pct[p])

    def on_demo_boss(self, now: float, plant: Optional[str] = None) -> list:
        """Demo button (WebSocket) or the optional laptop topic."""
        plant = plant or self.pick_demo_plant()
        if plant is None or not self.present(plant):
            log.info("demo boss ignored, no plant on the cube to call it")
            return []
        before = self.game.mode
        tier = max(1, S.tier_for(self.soil_pct[plant]))
        self._set(S.on_demo(self.game, plant, now, tier))
        if self.game.mode == before:
            log.info("demo boss ignored, mode is %s", before)
        return self.tick(now)

    def on_player_move(self, move: str, now: float) -> list:
        """The player's move for this turn: attack, guard, special or skill."""
        if not self.manual or self.game.mode != S.BATTLE or self.battle is None:
            return []
        category = B.category_of(self.battle.creature, move)  # "attack" or the plant's own move id
        if category is None or now < self.move_ready_at:
            return []
        self.battle = B.play_turn(self.battle, self.rng, category)
        return self._after_turn(now)

    def on_debug_boss(self, payload: str, now: float) -> list:
        p = payload.strip().upper()
        return self.on_demo_boss(now, p) if p in C.PLANTS else []

    # time -------------------------------------------------------------
    def tick(self, now: float) -> list:
        commands = []
        self._update_health(now)
        self._check_stale(now)
        self._set(S.on_tick(self.game, now, can_fight=self.can_fight()))

        if self.game.mode == S.BATTLE and self.battle is None:
            if self.can_fight():
                self._start_battle(now)
            else:
                self._set(S.on_party_empty(self.game, now))

        if self.game.mode == S.BATTLE and self.battle is not None:
            if self.manual:
                if now >= self.move_deadline:  # nobody picked, the game does
                    self.battle = B.play_turn(self.battle, self.rng)
                    commands = self._after_turn(now)
            elif now >= self.next_turn_at:
                self.battle = B.play_turn(self.battle, self.rng)
                commands = self._after_turn(now)

        if self.lost and (now >= self.lost["until"] or self.game.mode in (S.BOSS, S.BATTLE)):
            self.lost = None
        if self.game.mode not in (S.BATTLE, S.REWARD) and self.battle and not self.lost:
            self.battle = None
        return commands

    def _boss_stats(self, tier: int) -> B.Stats:
        """The boss's numbers come from how dry it is, its name from which kind it is."""
        stats = B.boss_for_tier(tier)
        return replace(stats, name=C.BOSS_KINDS[self.boss_kind]) if self.boss_kind else stats

    def fighter(self, plant: str) -> Optional[B.Stats]:
        """A pad's fighting numbers. With the plant database: the summoned plant at its level, or
        None for an empty pad. Without it: the known figure on the pad, else the plant's own."""
        if self.plant_db is not None:
            plant_id = self.pad_plant.get(plant)
            if plant_id is None:
                return None
            stats = self.plant_stats(plant_id)
        else:
            stats = self.creatures.get(self.pads.get(plant, ""), B.plant_fighter(plant))
        if self.health <= 0:  # a wilted plant hits weaker
            stats = B.weakened(stats, C.WILTED_ATK_FACTOR)
        return stats

    def plant_stats(self, plant_id: str) -> B.Stats:
        """A database plant's fighting numbers at its current level, with its moves."""
        import plant_db as P
        plant = self.plant_db.plants[plant_id]
        hp, atk = P.stats_at_level(plant, self.plant_db.level(plant_id))
        moves = tuple((cat, m.move_id, m.power) for cat, m in sorted(self.plant_db.moves_of(plant).items()))
        return B.Stats(name=plant.name, hp=hp, atk=atk, skill=plant.skill, plant_id=plant_id, moves=moves)

    def _start_battle(self, now: float):
        # The plant that called the boss fights first. The others wait on the bench, driest first.
        # With the plant database only summoned plants fight; if the boss's own pad is empty, the
        # first summoned plant (driest pot first) steps up. Watering still goes to the boss's pot.
        first = self.game.boss_plant
        if self.plant_db is not None:
            party = sorted((p for p, _ in self.summoned()), key=lambda p: self.soil_pct[p])
            if first not in party:
                first = party[0]
            bench = [p for p in party if p != first]
        else:
            bench = sorted((p for p in self.present_plants() if p != first), key=lambda p: self.soil_pct[p])
        self.last_reward = None   # nothing has been won yet in this fight
        tier = self.game.tier or 1
        charge = C.SKILL_CHARGE_START if self.health >= C.HEALTH_WEARY_BELOW else C.SKILL_CHARGE_START_WEARY
        self.battle = B.start(self.fighter(first), self._boss_stats(tier), plant=first,
                              bench=[(p, self.fighter(p)) for p in bench],
                              tier=tier, charge=charge, rng=self.rng, battle_id=uuid.uuid4().hex)
        self.next_turn_at = now + C.BATTLE_TURN_SECONDS
        self.move_ready_at = now + 0.5
        self.move_deadline = now + C.PLAYER_MOVE_TIMEOUT_SECONDS

    def _after_turn(self, now: float) -> list:
        self.next_turn_at = now + C.BATTLE_TURN_SECONDS
        self.move_ready_at = now + C.BATTLE_TURN_SECONDS  # time for the client to show the turn
        # the time to choose starts when a move can be chosen, not while the last turn is still playing
        self.move_deadline = self.move_ready_at + C.PLAYER_MOVE_TIMEOUT_SECONDS
        last = self.battle.last_move or {}
        log.info("turn %d: %s vs %s (shown %s), hit=%s, plant %d hp, boss %d hp", self.battle.turn,
                 last.get("skill") or last.get("creature"), last.get("boss"), last.get("shown"),
                 last.get("hit"), self.battle.creature_hp, self.battle.boss_hp)
        extra = (C.SWAP_EXTRA_SECONDS if last.get("swap") else 0.0) + (C.ENRAGE_EXTRA_SECONDS if last.get("enraged") else 0.0)
        if extra:   # a plant fainted and the next one comes in, or the boss stops to roar
            self.next_turn_at += extra
            self.move_ready_at += extra
            self.move_deadline += extra
        result = B.winner(self.battle)
        return self._finish_battle(result == "creature", now) if result else []

    def condition(self) -> str:
        if self.health <= 0:
            return "wilted"
        if self.health < C.HEALTH_WILTING_BELOW:
            return "wilting"
        if self.health < C.HEALTH_WEARY_BELOW:
            return "weary"
        return "healthy"

    def moisture_tier(self) -> int:
        """How dry the driest plant on the cube is: 0 chill, 1 dry, 2 very dry, 3 bone dry."""
        here = self.present_plants()
        return S.tier_for(min(self.soil_pct[p] for p in here)) if here else 0

    def _update_health(self, now: float):
        """Overall health fades while any plant is dry and nobody is fighting for it, faster the
        drier it is."""
        if self._last_tick is not None:
            dt = min(max(now - self._last_tick, 0.0), 1.0)
            tier = self.moisture_tier()
            if self.game.mode in (S.BOSS, S.BATTLE, S.REWARD) or not self.present_plants():
                pass   # help is on the way: health holds while a boss is being fought, and with no plant
            elif tier >= 1:
                self.health -= C.HEALTH_DECAY_PER_SEC[tier] * dt
            else:
                self.health += C.HEALTH_RECOVER_PER_SEC * dt
            self.health = min(100.0, max(0.0, self.health))
        self._last_tick = now

    def _finish_battle(self, won: bool, now: float) -> list:
        demo = self.game.source == C.SOURCE_DEMO
        tier = self.game.tier or 1
        kind = self.boss_kind   # read now: a lost fight clears the boss as soon as the state changes
        new, plant = S.on_battle_done(self.game, won, now)
        self._set(new)
        if won:
            self.health = min(100.0, self.health + C.HEALTH_WIN_BONUS)
            if not demo:
                self._award_xp(tier)
        else:
            self.lost = {"plant": self.battle.plant, "tier": tier, "kind": kind, "until": now + C.LOSS_DISPLAY_SECONDS,
                         "source": C.SOURCE_DEMO if demo else C.SOURCE_SOIL}
        if plant is None:
            return []
        if self.game.stale or self.last_seen is None:
            log.info("reward for %s blocked, ESP32 %s", plant,
                     "offline" if self.game.stale else "not heard from yet")
            return []
        if not self.present(plant):
            log.info("reward for %s blocked, the plant is not on the cube", plant)
            return []
        pct = self.soil_pct[plant]
        cmd = R.water_reward(plant, pct, now, self.last_reward_at[plant], demo=demo, tier=tier)
        if cmd is None:
            log.info("reward for %s blocked (soil %.0f%%, demo=%s)", plant, pct, demo)
            return []
        self.last_reward_at[plant] = now
        self.last_reward = {"type": "water", "plant": plant, "size": int(cmd.payload), "tier": tier}
        log.info("command %s %s", cmd.topic, cmd.payload)
        return [cmd]

    def _award_xp(self, tier: int):
        """XP for a won fight against a real (soil) boss, once per fight. Who gets it: every plant
        still in the fight's roster when it ends (fighting, waiting on the bench, or fainted) that
        is on a pad at that moment. Lifting a plant takes it out of the roster, so it gets no XP
        even if it is put back. Never touches watering, and never blocks (saved in the background)."""
        if self.plant_db is None or self.battle is None or not self.battle.battle_id:
            return
        b = self.battle
        took_part = [b.creature.plant_id] + [s.plant_id for _, s in b.bench] + [s.plant_id for _, s in b.fallen]
        still_here = {pid for _, pid in self.summoned()}
        ids = [pid for pid in took_part if pid and pid in still_here]
        xp = C.XP_PER_WIN_BY_TIER.get(tier, C.XP_PER_WIN_BY_TIER[1])
        result = self.plant_db.award(b.battle_id, ids, xp)
        if result:
            self.last_xp = result
            for pid, r in result.items():
                log.info("%s gained %d XP (total %d, level %d%s)", pid, r["gained"], r["xp"], r["level"],
                         ", level up!" if r["levelled_up"] else "")

    # output -----------------------------------------------------------
    def _battle_snapshot(self, b) -> dict:
        skill = B.skill_of(b.creature)
        left = min(C.PLAYER_MOVE_TIMEOUT_SECONDS, max(0.0, self.move_deadline - (self._last_tick or 0.0)))
        team = {b.plant: {"name": b.creature.name, "hp": b.creature_hp, "max_hp": b.creature.hp,
                          "state": "fighting"}}
        team.update({p: {"name": s.name, "hp": s.hp, "max_hp": s.hp, "state": "ready"} for p, s in b.bench})
        team.update({p: {"name": s.name, "hp": 0, "max_hp": s.hp, "state": "down"} for p, s in b.fallen})
        return {
            "turn": b.turn,
            "plant": b.plant,      # which plant is fighting right now
            "team": team,          # every plant in this fight: fighting, ready (on the bench) or down
            "creature": b.creature.name,
            "creature_hp": b.creature_hp,
            "creature_max_hp": b.creature.hp,
            "boss_hp": b.boss_hp,
            "last_move": b.last_move,
            # the tell for the coming turn: the move the boss shows, how sure it is (grade and
            # chance), the move it would use if this is a bluff, and whether it is a heavy hit
            "intent": b.intent,
            "enraged": b.enraged,
            "enrage_hp": int(b.boss.hp * C.ENRAGE_AT),
            "hints": b.tier in C.TIER_HINTS,   # the cards may say how each move does against the tell
            "skill": None if skill is None else {
                "name": skill["name"],
                "ready": B.skill_ready(b),
                "charge": b.charge,                 # turns won so far
                "need": C.SKILL_CHARGE_NEED,        # turns to win before it can be used
            },
            "manual": self.manual,
            # false while the last turn is still being shown: a move sent then would be thrown away
            "awaiting_move": (self.manual and B.winner(b) is None
                              and (self._last_tick or 0.0) >= self.move_ready_at),
            "move_seconds_left": int(left + 0.999) if self.manual else None,
        }

    # schema 2: plant database additions ---------------------------------
    def _move_view(self, move_id: str, ready: bool = True) -> Optional[dict]:
        m = self.plant_db.moves.get(move_id) if move_id else None
        if m is None:
            return None
        return {"move_id": m.move_id, "name": m.name, "category": m.category, "type": m.type,
                "power": m.power, "animation_key": m.animation_key, "animation": dict(m.animation),
                "ready": ready}

    def _plant_view(self, plant_id: str, pad: Optional[str]) -> dict:
        import plant_db as P
        plant = self.plant_db.plants[plant_id]
        xp, level = self.plant_db.xp.get(plant_id, 0), self.plant_db.level(plant_id)
        hp, atk = P.stats_at_level(plant, level)
        return {
            "plant_id": plant_id, "pad_id": pad, "name": plant.name, "species": plant.species,
            "type": plant.type, "level": level, "xp": xp,
            "xp_to_next": None if level >= C.MAX_LEVEL else P.xp_to_reach(level + 1),
            "hp": hp, "atk": atk, "sprite_key": plant.sprite_key,
            "animation_set_key": plant.animation_set_key,
            "moves": [plant.moves[c] for c in C.MOVE_CATEGORIES],
        }

    def _schema2(self) -> dict:
        return {
            "pads": {p: {"uid": self.pads[p] or None, "plant_id": self.pad_plant[p], "status": self.pad_status[p]}
                     for p in C.PLANTS},
            "summoned_plants": [self._plant_view(pid, pad) for pad, pid in self.summoned()],
            # unsaved: XP waiting to be written. persistent: false when there is no usable save file,
            # so XP lasts only until the server restarts.
            "progress": {"last_xp": self.last_xp, "unsaved": self.plant_db.unsaved,
                         "persistent": self.plant_db.store is not None},
        }

    def _battle_schema2(self, b) -> dict:
        """Battle additions: who is fighting, their move buttons, and who made the last move."""
        roster = {b.plant: b.creature}
        roster.update({p: s for p, s in b.bench})
        roster.update({p: s for p, s in b.fallen})
        # roster only holds plants still in the fight; last_action below comes from the turn log
        moves = []
        for cat in C.MOVE_CATEGORIES:
            move_id, _ = B.move_of(b.creature, cat)
            view = self._move_view(move_id, ready=(cat != B.SKILL or B.skill_ready(b)))
            if view is not None:
                moves.append(view)
        last = None
        lm = b.last_move or {}
        if lm.get("actor_plant_id"):  # only a played turn has an actor (a lift before turn 1 does not)
            m = self.plant_db.moves.get(lm.get("move_id", ""))
            last = {"actor_pad": lm["actor_pad"], "actor_plant_id": lm["actor_plant_id"],
                    "move_id": m.move_id if m else None, "animation_key": m.animation_key if m else None,
                    "animation": dict(m.animation) if m else None}
        return {
            "battle_id": b.battle_id,
            "active_plant_id": b.creature.plant_id or None,
            "team_plants": {p: {"plant_id": s.plant_id or None, "level": self.plant_db.level(s.plant_id)
                                if s.plant_id else None} for p, s in roster.items()},
            "moves": moves,
            "last_action": last,
        }

    def snapshot(self) -> dict:
        g, b = self.game, self.battle
        boss_stats = b.boss if b else self._boss_stats(g.tier or 1)
        lost = self.lost if (b and g.boss_plant is None) else None   # the last blow of a lost fight
        snap = {
            "creatures": {p: self.pads[p] or None for p in C.PLANTS},
            "present": {p: self.present(p) for p in C.PLANTS},   # false: not on the cube, so no meter and no follower
            "sim": self.sim,
            "meters": {
                "water": {p: round(self.soil_pct[p], 1) if self.present(p) else None for p in C.PLANTS},
                "stale": g.stale,
            },
            "mode": g.mode,
            "fighters": {p: None if self.fighter(p) is None else
                         {"name": self.fighter(p).name,
                          "skill": (B.skill_of(self.fighter(p)) or {}).get("name")} for p in C.PLANTS},
            "health": round(self.health, 1),
            "condition": self.condition(),
            "tier": self.moisture_tier(),
            "boss": None if (g.boss_plant is None and not lost) else {
                "plant": lost["plant"] if lost else g.boss_plant,
                "name": boss_stats.name,
                "kind": (lost or {}).get("kind") or self.boss_kind or "chomper",
                "tier": lost["tier"] if lost else g.tier,
                "hp": b.boss_hp if b else boss_stats.hp,
                "max_hp": boss_stats.hp,
                "type": "drought",
                "source": lost["source"] if lost else g.source,
            },
            "battle": None if b is None else self._battle_snapshot(b),
            "reward": self.last_reward,
        }
        snap["schema_version"] = 1 if self.plant_db is None else 2
        if self.plant_db is not None:
            snap.update(self._schema2())
            if b is not None:
                snap["battle"].update(self._battle_schema2(b))
        return snap
