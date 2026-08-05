import { FilePersistence } from './persistence';

class SpawnManager {
  constructor() {
    this.spawns = {};
    this.persistence = new FilePersistence('spawn-state.json');
  }

  async track(id, opts) {
    this.spawns[id] = { ...opts, status: 'active' };
    await this.persistence.save(this.spawns);
  }

  async get(id) {
    return this.spawns[id];
  }
}

export default new SpawnManager();