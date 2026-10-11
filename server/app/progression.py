import time
from .models import Plant, WateringCooldown

FULL_DURATION = 10.0


def expire_cooldowns(db, now=None):
    now = time.time() if now is None else now
    changed = False
    for cooldown in db.query(WateringCooldown).filter(WateringCooldown.until <= now).all():
        plant = db.get(Plant, cooldown.plantId)
        if plant:
            plant.soilMoisture = 60.0
            changed = True
        db.delete(cooldown)
    return changed


def update_moisture(plant, moisture, db):
    """Hold full moisture for 10 seconds and award each full transition once."""
    cooldown = db.get(WateringCooldown, plant.plantId)
    if cooldown and cooldown.until > time.time():
        plant.soilMoisture = 100.0
        return False
    if cooldown:
        db.delete(cooldown)
        db.flush()
        plant.soilMoisture = 60.0
    leveled_up = plant.soilMoisture < 100 <= moisture
    plant.soilMoisture = moisture
    if leveled_up:
        plant.level += 1
        db.add(WateringCooldown(plantId=plant.plantId, until=time.time() + FULL_DURATION))
    return leveled_up
