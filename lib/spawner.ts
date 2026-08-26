export class Spawner {
  private queue: WorkIntentQueue;

  constructor() {
    this.queue = new WorkIntentQueue();
  }

  public async processIntent(intent: WorkIntent) {
    const launch = await this.queue.dequeue(intent);
    await this.handleAdmitted(launch);
  }

  private async handleAdmitted(launch: LaunchIntent) {
    // Existing callback logic
  }
}