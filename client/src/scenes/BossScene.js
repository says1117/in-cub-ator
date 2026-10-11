import Presentation from "./BossPresentation.js";

export default class BossScene extends Presentation {
  create() {
    this.encounter = this.registry.get("serverState")?.boss;
    super.create();
    const reject = reason => {
      this.locked = null;
      this.hud.clearLock();
      this.hud.setLog(reason);
      this.refreshLive();
    };
    this.game.events.on("moveRejected", reject);
    this.events.once("shutdown", () => this.game.events.off("moveRejected", reject));
  }
}
