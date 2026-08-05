import { SpawnManager } from './spawn-manager';

class DetachedSpawnManager extends SpawnManager {
  constructor() {
    super();
    this.persistence = new FilePersistence('detached-spawns.json');
  }

  async list() {
    return this.persistence.load();
  }

  async track(id, opts) {
    await super.track(id, opts);
    this.persistence.save(this.spawns);
  }
}

export default new DetachedSpawnManager();